import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  ConflictingInvoiceException,
  DocumentTooLargeException,
  DuplicateInvoiceException,
  InvalidRequestException,
} from '../common/errors/app.exception.js';
import { isUniqueViolation } from '../database/prisma-errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Invoice, type InvoiceDocument } from '../generated/prisma/client.js';
import { InvoiceVerificationService } from '../invoice-verification/invoice-verification.service.js';
import type { VerificationResponse } from '../invoice-verification/verification.presenter.js';
import type { CreateInvoiceDto, UploadInvoiceDto } from './dto/create-invoice.dto.js';
import type { ListInvoicesQueryDto } from './dto/list-invoices.dto.js';
import { parseAmount } from './invoice-amounts.js';
import { canonicalAmount } from './invoice-fingerprint.js';
import { InvoiceFingerprintService } from './invoice-fingerprint.service.js';
import {
  normalizeCurrency,
  normalizeInvoiceNumber,
  normalizeInvoiceSeries,
  normalizeIsoDate,
  normalizeTaxId,
  normalizeTemplateCode,
  normalizeText,
} from './invoice-normalization.js';
import {
  toInvoiceResponse,
  type InvoiceDetailResponse,
  type InvoiceHistoryResponse,
  type InvoiceListResponse,
} from './invoice.presenter.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from './storage/document-storage.js';
import { InvoiceXmlParserService } from './xml/invoice-xml-parser.service.js';
import type { ParsedInvoice } from './xml/invoice-xml.types.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const ENTITY_TYPE = 'invoice';
const ACTION_CREATED = 'invoice.created';

/** A UUID cannot exist otherwise, so a malformed id is a 404 and never a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_FILENAME_LENGTH = 255;
const MAX_MIME_LENGTH = 128;
const FALLBACK_MIME_TYPE = 'application/octet-stream';

/**
 * The parts of a multer file the service actually uses.
 *
 * Declared structurally rather than as `Express.Multer.File` so the service
 * does not depend on the HTTP layer's type augmentations — it is called from
 * tests and, later, from a queue consumer that has no request to speak of.
 */
export interface UploadedInvoiceFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Everything needed to write an invoice row, produced by either intake path. */
interface PreparedInvoice {
  invoiceSeries: string;
  invoiceNumber: string;
  invoiceType: string;
  invoiceTypeName: string | null;
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  buyerTaxId: string;
  currency: string;
  amount: Prisma.Decimal;
  subtotalAmount: Prisma.Decimal | null;
  taxAmount: Prisma.Decimal | null;
  issueDate: Date;
  dueDate: Date | null;
  fingerprint: string;
  contentHash: string;
}

interface PreparedDocument {
  filename: string;
  mimeType: string;
  byteSize: number;
  contentSha256: string;
  storageKey: string;
  format: string;
  parserVersion: string;
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Control characters are precisely what this removes: a filename or MIME type
 * carrying `\u0000` or a newline would corrupt a log line and break any
 * downstream header. The lint rule exists to catch control characters that
 * appear by accident, so it is disabled here on purpose.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/**
 * Strips everything a client could use to influence where the name is
 * rendered: path separators, control characters, and length.
 *
 * The name is metadata, never a path — the storage key is derived from the
 * content hash — but it still ends up in a UI and in logs.
 */
function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(CONTROL_CHARACTERS, '').trim();
  const fallback = cleaned.length === 0 ? 'invoice.xml' : cleaned;

  return fallback.slice(0, MAX_FILENAME_LENGTH);
}

function safeMimeType(raw: string): string {
  const cleaned = raw.replace(CONTROL_CHARACTERS, '').trim().toLowerCase();

  return cleaned.length === 0 ? FALLBACK_MIME_TYPE : cleaned.slice(0, MAX_MIME_LENGTH);
}

function calendarDate(value: string, field: string): Date {
  const iso = normalizeIsoDate(value);

  if (iso === null) {
    // The DTO checks the shape; this catches `2026-02-31`, which matches the
    // shape and is not a day.
    throw new InvalidRequestException(`${field} is not a valid calendar date`, { field });
  }

  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Invoice intake, retrieval and the verification hand-off.
 *
 * Every read and write is scoped by `organizationId`, and a row belonging to
 * another tenant is reported as *not found* rather than *forbidden*: a 403
 * would confirm the id exists, which is exactly what an attacker enumerating
 * ids wants to learn.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fingerprints: InvoiceFingerprintService,
    private readonly parser: InvoiceXmlParserService,
    private readonly verifications: InvoiceVerificationService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
  ) {}

  // -------------------------------------------------------------------------
  // Intake
  // -------------------------------------------------------------------------

  /** Creates an invoice from structured metadata, with no source document. */
  async create(auth: AuthContext, dto: CreateInvoiceDto): Promise<InvoiceDetailResponse> {
    const prepared = this.prepareFromMetadata(dto);

    const { invoice, document } = await this.insert(auth, prepared, null);

    return this.withVerification(invoice, document, await this.runVerification(invoice, auth));
  }

  /**
   * Accepts an uploaded e-invoice document.
   *
   * The bytes are written to storage *before* the row is inserted. That order
   * is deliberate: a blob with no row is an unreferenced file that the next
   * upload of the same content reuses, whereas a row with no blob is an
   * invoice that can never be re-verified.
   */
  async upload(
    auth: AuthContext,
    file: UploadedInvoiceFile | undefined,
    dto: UploadInvoiceDto,
  ): Promise<InvoiceDetailResponse> {
    if (file === undefined) {
      throw new InvalidRequestException('A multipart field named "file" is required');
    }

    const maxBytes = this.maxUploadBytes();

    if (file.buffer.byteLength > maxBytes) {
      throw new DocumentTooLargeException(
        `The uploaded document exceeds the ${maxBytes} byte limit`,
        { maxBytes, receivedBytes: file.buffer.byteLength },
      );
    }

    const parsed = this.parser.parse(file.buffer, { maxBytes });
    const prepared = this.prepareFromParsed(parsed, dto);

    const contentSha256 = sha256Hex(file.buffer);
    const storageKey = await this.storage.put(contentSha256, file.buffer);

    const document: PreparedDocument = {
      filename: safeFilename(file.originalname),
      // Advisory only: the parser is the real gate, and a client can declare
      // any type it likes. Recorded for operator forensics, not trusted.
      mimeType: safeMimeType(file.mimetype),
      byteSize: file.buffer.byteLength,
      contentSha256,
      storageKey,
      format: parsed.format,
      parserVersion: parsed.parserVersion,
    };

    const created = await this.insert(auth, prepared, document);

    return this.withVerification(
      created.invoice,
      created.document,
      await this.runVerification(created.invoice, auth),
    );
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  async getById(organizationId: string, id: string): Promise<InvoiceDetailResponse> {
    const record = await this.requireInvoice(organizationId, id);

    return {
      ...toInvoiceResponse(record.invoice, record.document),
      verification: await this.verifications.latest(organizationId, id),
    };
  }

  async list(organizationId: string, query: ListInvoicesQueryDto): Promise<InvoiceListResponse> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = query.offset ?? 0;
    const where = this.buildWhere(organizationId, query);

    // The id tiebreaker matters: `amount` and `issueDate` are not unique, and
    // without it two rows with the same value can swap places between pages,
    // so a client paging through would see one twice and miss another.
    const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = [
      { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      { id: query.sortOrder ?? 'desc' },
    ];

    const [total, invoices] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        include: { document: true },
      }),
    ]);

    return {
      items: invoices.map((invoice) => toInvoiceResponse(invoice, invoice.document)),
      pagination: { total, limit, offset },
    };
  }

  /** Latest verdict only — the common case for a detail screen. */
  getVerification(organizationId: string, id: string): Promise<VerificationResponse | null> {
    return this.verifications.latest(organizationId, id);
  }

  /** Every run, newest first, plus the audit trail. */
  async getHistory(organizationId: string, id: string): Promise<InvoiceHistoryResponse> {
    await this.requireInvoice(organizationId, id);

    const [verifications, events] = await Promise.all([
      this.verifications.listForInvoice(organizationId, id),
      this.audit.listForEntity(organizationId, ENTITY_TYPE, id),
    ]);

    return {
      invoiceId: id,
      verifications,
      events: events.map((event) => ({
        action: event.action,
        actorUserId: event.actorUserId,
        metadata: event.metadata,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  /** Re-runs verification and appends a new run to the history. */
  async reverify(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<VerificationResponse> {
    const { invoice } = await this.requireInvoice(organizationId, id);

    const result = await this.verifications.runAndPersist(invoice, organizationId, userId);

    if (result === null) {
      // The invoice was deleted between the lookup and the run. Rare, and a
      // 404 is the truthful answer.
      throw new NotFoundException('Invoice not found');
    }

    return result;
  }

  /**
   * Combines the stored row with the run that just completed.
   *
   * `lastVerifiedAt` is taken from the run rather than from the row: the row
   * was read before the verification transaction committed its timestamp, so
   * serialising it directly would report `null` for an invoice that has in
   * fact just been verified.
   */
  private withVerification(
    invoice: Invoice,
    document: InvoiceDocument | null,
    verification: VerificationResponse | null,
  ): InvoiceDetailResponse {
    const response = toInvoiceResponse(invoice, document);

    return {
      ...response,
      lastVerifiedAt: verification === null ? response.lastVerifiedAt : verification.checkedAt,
      verification,
    };
  }

  // -------------------------------------------------------------------------
  // Preparation
  // -------------------------------------------------------------------------

  private prepareFromMetadata(dto: CreateInvoiceDto): PreparedInvoice {
    const amount = parseAmount(dto.amount);

    if (amount === null || !amount.greaterThan(0)) {
      throw new InvalidRequestException('amount must be a positive decimal value');
    }

    const subtotalAmount = this.optionalAmount(dto.subtotalAmount, 'subtotalAmount');
    const taxAmount = this.optionalAmount(dto.taxAmount, 'taxAmount');

    const sellerTaxId = normalizeTaxId(dto.sellerTaxId);
    const buyerTaxId = normalizeTaxId(dto.buyerTaxId);

    if (sellerTaxId.length === 0 || buyerTaxId.length === 0) {
      throw new InvalidRequestException('Tax identifiers must contain digits or letters');
    }

    const series = normalizeInvoiceSeries(dto.invoiceSeries);
    const number = normalizeInvoiceNumber(dto.invoiceNumber);
    const templateCode = normalizeTemplateCode(dto.invoiceType);
    const issueDate = calendarDate(dto.issueDate, 'issueDate');

    return {
      invoiceSeries: series,
      invoiceNumber: number,
      invoiceType: templateCode,
      invoiceTypeName:
        dto.invoiceTypeName === undefined ? null : normalizeText(dto.invoiceTypeName),
      sellerName: normalizeText(dto.sellerName),
      sellerTaxId,
      buyerName: normalizeText(dto.buyerName),
      buyerTaxId,
      currency: normalizeCurrency(dto.currency),
      amount,
      subtotalAmount,
      taxAmount,
      issueDate,
      dueDate: dto.dueDate === undefined ? null : calendarDate(dto.dueDate, 'dueDate'),
      fingerprint: this.fingerprints.identity({
        sellerTaxId,
        series,
        number,
        templateCode,
      }),
      contentHash: this.fingerprints.content({
        buyerTaxId,
        buyerName: normalizeText(dto.buyerName),
        currency: normalizeCurrency(dto.currency),
        issueDate: issueDate.toISOString().slice(0, 10),
        subtotal: subtotalAmount === null ? null : canonicalAmount(subtotalAmount),
        taxAmount: taxAmount === null ? null : canonicalAmount(taxAmount),
        total: canonicalAmount(amount),
      }),
    };
  }

  private prepareFromParsed(parsed: ParsedInvoice, dto: UploadInvoiceDto): PreparedInvoice {
    const amount = new Prisma.Decimal(parsed.totals.total);
    const subtotalAmount =
      parsed.totals.subtotal === null ? null : new Prisma.Decimal(parsed.totals.subtotal);
    const taxAmount =
      parsed.totals.taxAmount === null ? null : new Prisma.Decimal(parsed.totals.taxAmount);

    return {
      invoiceSeries: parsed.header.series,
      invoiceNumber: parsed.header.number,
      invoiceType: parsed.header.templateCode,
      invoiceTypeName: parsed.header.templateName,
      sellerName: parsed.seller.name,
      sellerTaxId: parsed.seller.taxId,
      buyerName: parsed.buyer.name,
      buyerTaxId: parsed.buyer.taxId,
      currency: parsed.header.currency,
      amount,
      subtotalAmount,
      taxAmount,
      issueDate: new Date(`${parsed.header.issueDate}T00:00:00.000Z`),
      dueDate: dto.dueDate === undefined ? null : calendarDate(dto.dueDate, 'dueDate'),
      fingerprint: this.fingerprints.identity({
        sellerTaxId: parsed.seller.taxId,
        series: parsed.header.series,
        number: parsed.header.number,
        templateCode: parsed.header.templateCode,
      }),
      contentHash: this.fingerprints.content({
        buyerTaxId: parsed.buyer.taxId,
        buyerName: parsed.buyer.name,
        currency: parsed.header.currency,
        issueDate: parsed.header.issueDate,
        subtotal: subtotalAmount === null ? null : canonicalAmount(subtotalAmount),
        taxAmount: taxAmount === null ? null : canonicalAmount(taxAmount),
        total: canonicalAmount(amount),
      }),
    };
  }

  private optionalAmount(raw: string | undefined, field: string): Prisma.Decimal | null {
    if (raw === undefined) {
      return null;
    }

    const parsed = parseAmount(raw);

    if (parsed === null) {
      throw new InvalidRequestException(`${field} must be a decimal value`, { field });
    }

    return parsed;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Inserts the invoice, or reports the duplicate that already holds its
   * identity.
   *
   * The pre-check gives the common case a clean message. It cannot be
   * authoritative — two requests can pass it at the same time — so the unique
   * constraint is the real guard and a `P2002` is translated into the same
   * error shape. Without the second path, a concurrent double-submit would
   * surface as a 500.
   */
  private async insert(
    auth: AuthContext,
    prepared: PreparedInvoice,
    document: PreparedDocument | null,
  ): Promise<{ invoice: Invoice; document: InvoiceDocument | null }> {
    const existing = await this.prisma.invoice.findUnique({
      where: {
        organizationId_fingerprint: {
          organizationId: auth.organizationId,
          fingerprint: prepared.fingerprint,
        },
      },
      select: { id: true, contentHash: true },
    });

    if (existing !== null) {
      throw this.duplicateError(existing, prepared.contentHash);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            organizationId: auth.organizationId,
            uploadedById: auth.userId,
            invoiceNumber: prepared.invoiceNumber,
            issuerTaxId: prepared.sellerTaxId,
            debtorTaxId: prepared.buyerTaxId,
            currency: prepared.currency,
            invoiceSeries: prepared.invoiceSeries,
            invoiceType: prepared.invoiceType,
            invoiceTypeName: prepared.invoiceTypeName,
            sellerName: prepared.sellerName,
            buyerName: prepared.buyerName,
            amount: prepared.amount,
            subtotalAmount: prepared.subtotalAmount,
            taxAmount: prepared.taxAmount,
            issueDate: prepared.issueDate,
            dueDate: prepared.dueDate,
            // Submitted, not draft: the document has been handed to the
            // verifier. Draft would imply the caller has not finished editing.
            status: 'SUBMITTED',
            fingerprint: prepared.fingerprint,
            contentHash: prepared.contentHash,
          },
        });

        const createdDocument =
          document === null
            ? null
            : await tx.invoiceDocument.create({
                data: { ...document, invoiceId: invoice.id },
              });

        await this.audit.record(
          {
            organizationId: auth.organizationId,
            actorUserId: auth.userId,
            action: ACTION_CREATED,
            entityType: ENTITY_TYPE,
            entityId: invoice.id,
            metadata: {
              source: document === null ? 'metadata' : 'xml-upload',
              fingerprint: prepared.fingerprint,
              ...(document === null ? {} : { format: document.format }),
            },
          },
          tx,
        );

        return { invoice, document: createdDocument };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const raced = await this.prisma.invoice.findUnique({
        where: {
          organizationId_fingerprint: {
            organizationId: auth.organizationId,
            fingerprint: prepared.fingerprint,
          },
        },
        select: { id: true, contentHash: true },
      });

      if (raced !== null) {
        throw this.duplicateError(raced, prepared.contentHash);
      }

      throw error;
    }
  }

  /**
   * Same identity, same content is a re-upload. Same identity, different
   * content is a conflict — someone is presenting a different invoice under a
   * number that is already on file, which is worth a human look.
   */
  private duplicateError(
    existing: { id: string; contentHash: string },
    contentHash: string,
  ): Error {
    if (existing.contentHash === contentHash) {
      return new DuplicateInvoiceException(
        'This invoice has already been submitted to the organization',
        { invoiceId: existing.id },
      );
    }

    return new ConflictingInvoiceException(
      'An invoice with this identity already exists with different content',
      { invoiceId: existing.id },
    );
  }

  /**
   * Runs verification after the invoice is committed.
   *
   * A verification failure must not turn a successful create into a 500: the
   * invoice is durable at this point, and the caller would retry a request
   * that is now a duplicate. The run is logged instead, `verification` comes
   * back `null`, and `POST /:id/verify` retries it explicitly.
   */
  private async runVerification(
    invoice: Invoice,
    auth: AuthContext,
  ): Promise<VerificationResponse | null> {
    try {
      return await this.verifications.runAndPersist(invoice, auth.organizationId, auth.userId);
    } catch (error) {
      this.logger.error(
        `Verification failed for invoice ${invoice.id}; it remains unverified`,
        error instanceof Error ? error.stack : String(error),
      );

      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async requireInvoice(
    organizationId: string,
    id: string,
  ): Promise<{ invoice: Invoice; document: InvoiceDocument | null }> {
    if (!UUID.test(id)) {
      // Postgres would reject the cast and Prisma would surface it as a 500.
      // An id of the wrong shape cannot exist, so 404 is both correct and
      // cheaper.
      throw new NotFoundException('Invoice not found');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: { document: true },
    });

    if (invoice === null) {
      throw new NotFoundException('Invoice not found');
    }

    return { invoice, document: invoice.document };
  }

  private buildWhere(
    organizationId: string,
    query: ListInvoicesQueryDto,
  ): Prisma.InvoiceWhereInput {
    const where: Prisma.InvoiceWhereInput = { organizationId };

    if (query.status !== undefined) {
      where.status = query.status;
    }

    if (query.issuerTaxId !== undefined) {
      where.issuerTaxId = normalizeTaxId(query.issuerTaxId);
    }

    if (query.invoiceNumber !== undefined) {
      // Stored numbers are already normalised, so the filter must normalise
      // the term the same way or `0000123` would match nothing.
      where.invoiceNumber = normalizeInvoiceNumber(query.invoiceNumber);
    }

    if (query.from !== undefined || query.to !== undefined) {
      const range: Prisma.DateTimeFilter = {};

      if (query.from !== undefined) {
        range.gte = calendarDate(query.from, 'from');
      }

      if (query.to !== undefined) {
        const upper = calendarDate(query.to, 'to');

        if (range.gte !== undefined && upper < (range.gte as Date)) {
          throw new InvalidRequestException('from must not be later than to');
        }

        range.lte = upper;
      }

      where.issueDate = range;
    }

    return where;
  }

  private maxUploadBytes(): number {
    return this.config.get<number>('INVOICE_MAX_UPLOAD_BYTES') ?? 2_097_152;
  }

  /** Exposed for the docs test that asserts the error codes are stable. */
  static readonly ENTITY_TYPE = ENTITY_TYPE;
}
