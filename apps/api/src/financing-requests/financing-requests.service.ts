import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/auth.types.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { InvoiceAnchorService } from '../blockchain/invoice-anchor.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import { isUniqueViolation } from '../database/prisma-errors.js';
import { Prisma, type FinancingRequest } from '../generated/prisma/client.js';
import { parseAmount } from '../invoices/invoice-amounts.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import type { CreateFinancingRequestDto } from './dto/create-financing-request.dto.js';
import type { ListFinancingRequestsQueryDto } from './dto/list-financing-requests.dto.js';
import {
  toFinancingRequestResponse,
  type FinancingRequestListResponse,
  type FinancingRequestResponse,
} from './financing-request.presenter.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const ENTITY_TYPE = 'financing_request';
const ACTION_CREATED = 'financing_request.created';

/** The value of `activeKey` while a request is live; NULL once it is terminal. */
const ACTIVE_KEY = 'ACTIVE';

/** A UUID cannot exist otherwise, so a malformed id is a 404 and never a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Financing requests.
 *
 * Owns the `activeKey` invariant that stops one invoice being financed twice
 * while still allowing a rejected request to be retried. The approval workflow
 * is Phase 3; chain transitions live in `BlockchainModule`.
 *
 * Invoice data arrives through `InvoicesService` and the verdict check through
 * `InvoiceAnchorService`, so this module never reads another module's tables.
 */
@Injectable()
export class FinancingRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly anchor: InvoiceAnchorService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * Scoped by tenant on purpose: `organizationId` is the first column of the
   * supporting index, so a caller that forgets it is a visible bug rather than
   * a slow full scan that silently leaks another organisation's rows.
   */
  listForOrganization(organizationId: string): Promise<FinancingRequest[]> {
    return this.prisma.financingRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async list(
    organizationId: string,
    query: ListFinancingRequestsQueryDto,
  ): Promise<FinancingRequestListResponse> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = query.offset ?? 0;
    const where: Prisma.FinancingRequestWhereInput = {
      organizationId,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.invoiceId === undefined ? {} : { invoiceId: query.invoiceId }),
    };

    // The id tiebreaker keeps pages stable when two rows share a createdAt.
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.financingRequest.count({ where }),
      this.prisma.financingRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
    ]);

    const summaries = await this.invoices.summariesByIds(organizationId, [
      ...new Set(rows.map((row) => row.invoiceId)),
    ]);

    return {
      items: rows.map((row) => {
        const invoice = summaries.get(row.invoiceId);
        if (invoice === undefined) {
          // The foreign key makes this unreachable; failing loudly beats
          // returning a request with a hole where its invoice should be.
          throw new Error(`Invoice ${row.invoiceId} missing for financing request ${row.id}`);
        }
        return toFinancingRequestResponse(row, invoice);
      }),
      pagination: { total, limit, offset },
    };
  }

  async getById(organizationId: string, id: string): Promise<FinancingRequestResponse> {
    const row = UUID.test(id)
      ? await this.prisma.financingRequest.findFirst({ where: { id, organizationId } })
      : null;

    if (row === null) {
      throw this.notFound();
    }

    return toFinancingRequestResponse(row, await this.requireSummary(organizationId, row));
  }

  /**
   * Opens a request, in this order so the cheapest and most informative
   * refusal wins: the invoice must be the caller's (404), the amount must fit
   * it (400), the invoice must carry a usable verdict (409), and only then does
   * the unique index decide whether another request is already live (409).
   */
  async create(
    auth: AuthContext,
    dto: CreateFinancingRequestDto,
  ): Promise<FinancingRequestResponse> {
    const invoice = await this.invoices.findSummary(auth.organizationId, dto.invoiceId);

    if (invoice === null) {
      throw new AppException(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Invoice not found');
    }

    const requested = parseAmount(dto.requestedAmount);

    if (requested === null || !requested.greaterThan(0)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'INVALID_REQUESTED_AMOUNT',
        'requestedAmount must be a positive decimal string',
      );
    }

    // Decimal comparison: a float would call 0.1 + 0.2 greater than 0.3.
    if (requested.greaterThan(new Prisma.Decimal(invoice.amount))) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'REQUESTED_AMOUNT_EXCEEDS_INVOICE',
        'The requested amount cannot exceed the invoice amount',
        {
          invoiceId: invoice.id,
          requestedAmount: requested.toFixed(),
          invoiceAmount: invoice.amount,
        },
      );
    }

    await this.anchor.assertAnchorable(invoice.id);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const request = await tx.financingRequest.create({
          data: {
            organizationId: auth.organizationId,
            invoiceId: invoice.id,
            requestedById: auth.userId,
            requestedAmount: requested,
            currency: invoice.currency,
            status: 'REQUESTED',
            termDays: dto.termDays,
            interestRateBps: dto.interestRateBps,
            purpose: dto.purpose,
            activeKey: ACTIVE_KEY,
          },
        });

        await this.audit.record(
          {
            organizationId: auth.organizationId,
            actorUserId: auth.userId,
            action: ACTION_CREATED,
            entityType: ENTITY_TYPE,
            entityId: request.id,
            metadata: { invoiceId: invoice.id, status: request.status },
          },
          tx,
        );

        return request;
      });

      return toFinancingRequestResponse(created, invoice);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      // The unique index, not a read-then-write check, is the guard: two
      // concurrent requests can both pass a pre-check.
      throw new AppException(
        HttpStatus.CONFLICT,
        'FINANCING_REQUEST_ACTIVE',
        'This invoice already has an active financing request',
        { invoiceId: invoice.id },
      );
    }
  }

  private async requireSummary(organizationId: string, row: FinancingRequest) {
    const invoice = await this.invoices.findSummary(organizationId, row.invoiceId);

    if (invoice === null) {
      throw new Error(`Invoice ${row.invoiceId} missing for financing request ${row.id}`);
    }

    return invoice;
  }

  private notFound(): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      'FINANCING_REQUEST_NOT_FOUND',
      'Financing request not found',
    );
  }
}
