import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Invoice } from '../generated/prisma/client.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../invoices/storage/document-storage.js';
import { VERIFICATION_CHECKS, VerificationEngineService } from './verification-engine.service.js';
import type { VerificationCheck } from './checks/check.types.js';
import { toVerificationResponse, type VerificationResponse } from './verification.presenter.js';

/**
 * Identifies the process that produced a verdict.
 *
 * Stored per run so that a future external provider (`tax-authority`, a
 * bureau, a model) can be told apart from the local checks without guessing
 * from a timestamp.
 */
const PROVIDER = 'local-checks-v1';

const ENTITY_TYPE = 'invoice';
const ACTION_VERIFIED = 'invoice.verified';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_MAX_DOCUMENT_BYTES = 2_097_152;

/**
 * Runs verification and keeps the history.
 *
 * Runs are append-only. A second run does not overwrite the first: the record
 * of what was believed at a point in time is the evidence, and a re-run that
 * silently replaced it would erase the fact that the earlier verdict differed.
 */
@Injectable()
export class InvoiceVerificationService {
  private readonly labels: ReadonlyMap<string, string>;
  private readonly order: ReadonlyMap<string, number>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: VerificationEngineService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogsService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(VERIFICATION_CHECKS) checks: readonly VerificationCheck[],
  ) {
    // Labels are read from the check inventory rather than stored per row, so
    // rewording a label does not require a migration or leave two spellings.
    this.labels = new Map(checks.map((check) => [check.key, check.label]));
    this.order = new Map(checks.map((check, index) => [check.key, index]));
  }

  /**
   * Runs every check against the persisted invoice and stores the result.
   *
   * Returns null when the invoice has disappeared — the caller decides whether
   * that is a 404 or a no-op, and neither is this service's call to make.
   *
   * The verification, its checks, the invoice timestamp and the audit entry
   * commit together. A run recorded with no audit entry would be an action
   * nobody can account for.
   */
  async runAndPersist(
    invoice: Invoice,
    organizationId: string,
    actorUserId: string | null,
  ): Promise<VerificationResponse | null> {
    const document = await this.prisma.invoiceDocument.findUnique({
      where: { invoiceId: invoice.id },
    });

    const xml = document === null ? null : await this.readDocument(document.storageKey);

    const result = await this.engine.run({
      invoice,
      document,
      xml,
      organizationId,
      maxDocumentBytes:
        this.config.get<number>('INVOICE_MAX_UPLOAD_BYTES') ?? DEFAULT_MAX_DOCUMENT_BYTES,
    });

    const verifiedAt = new Date();

    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        const verification = await tx.invoiceVerification.create({
          data: {
            invoiceId: invoice.id,
            status: result.status,
            provider: PROVIDER,
            // No scoring model exists. A number here would be invented.
            score: null,
            findings: { scope: result.scope, limitations: result.limitations },
            verifiedAt,
            checks: {
              create: result.checks.map((check) => ({
                key: check.key,
                status: check.status,
                message: check.message,
                durationMs: check.durationMs,
                ...(check.details === undefined
                  ? {}
                  : { details: check.details as Prisma.InputJsonValue }),
              })),
            },
          },
          include: { checks: true },
        });

        await tx.invoice.update({
          where: { id: invoice.id },
          data: { lastVerifiedAt: verifiedAt },
        });

        await this.audit.record(
          {
            organizationId,
            actorUserId,
            action: ACTION_VERIFIED,
            entityType: ENTITY_TYPE,
            entityId: invoice.id,
            metadata: {
              verificationId: verification.id,
              status: result.status,
              scope: result.scope,
              provider: PROVIDER,
            },
          },
          tx,
        );

        return verification;
      });

      return this.present(saved);
    } catch (error) {
      if (this.isMissingInvoice(error)) {
        return null;
      }

      throw error;
    }
  }

  /** Newest verdict, or null when the invoice has never been verified. */
  async latest(organizationId: string, invoiceId: string): Promise<VerificationResponse | null> {
    await this.assertInvoiceExists(organizationId, invoiceId);

    const verification = await this.prisma.invoiceVerification.findFirst({
      where: { invoiceId },
      // `createdAt` is millisecond precision, so two runs in the same
      // millisecond would be ordered arbitrarily. The id tiebreaker makes the
      // order deterministic.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { checks: true },
    });

    return verification === null ? null : this.present(verification);
  }

  /** Every run for one invoice, newest first. */
  async listForInvoice(organizationId: string, invoiceId: string): Promise<VerificationResponse[]> {
    await this.assertInvoiceExists(organizationId, invoiceId);

    const verifications = await this.prisma.invoiceVerification.findMany({
      where: { invoiceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { checks: true },
    });

    return verifications.map((verification) => this.present(verification));
  }

  private present(
    verification: Prisma.InvoiceVerificationGetPayload<{ include: { checks: true } }>,
  ): VerificationResponse {
    const response = toVerificationResponse(verification, this.labels);

    return {
      ...response,
      // Database order is not meaningful; the canonical check order is.
      checks: [...response.checks].sort(
        (a, b) => (this.order.get(a.key) ?? 99) - (this.order.get(b.key) ?? 99),
      ),
    };
  }

  /**
   * Reads the stored bytes.
   *
   * A document row whose blob cannot be read is an integrity failure, not a
   * verification result. Reporting it as "no document" would make the
   * structural check SKIP and quietly upgrade the verdict.
   */
  private async readDocument(storageKey: string): Promise<Buffer> {
    try {
      return await this.storage.get(storageKey);
    } catch {
      throw new AppException(
        500,
        'DOCUMENT_UNAVAILABLE',
        'The stored invoice document could not be read',
      );
    }
  }

  private async assertInvoiceExists(organizationId: string, invoiceId: string): Promise<void> {
    if (!UUID.test(invoiceId)) {
      throw new NotFoundException('Invoice not found');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { id: true },
    });

    if (invoice === null) {
      throw new NotFoundException('Invoice not found');
    }
  }

  /** `P2025` is Prisma's "record required but not found". */
  private isMissingInvoice(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2025'
    );
  }
}
