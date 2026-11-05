import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/auth.types.js';
import { AppException } from '../common/errors/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  BlockchainOperationStatus,
  BlockchainOperationType,
  type BlockchainOperation,
  type FinancingRequest,
  type Invoice,
} from '../generated/prisma/client.js';
import { presentOperation, type FinancingClaimResponse } from './blockchain.presenter.js';
import { BlockchainTransactionService } from './blockchain-transaction.service.js';
import { InvoiceAnchorService } from './invoice-anchor.service.js';
import { InvoiceCommitmentService } from './invoice-commitment.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestWithInvoice = FinancingRequest & { invoice: Invoice };

/**
 * Financing lifecycle actions against the registry.
 *
 * Every action is idempotent through the outbox key: repeating a request
 * returns the operation the first call created instead of sending a second
 * transaction. The business status is a projection of the on-chain claim and is
 * only advanced when a receipt says the transition happened.
 */
@Injectable()
export class FinancingClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: InvoiceCommitmentService,
    private readonly transactions: BlockchainTransactionService,
    private readonly anchor: InvoiceAnchorService,
  ) {}

  /**
   * Holds the invoice claim for this financing request.
   *
   * Reserving is anchoring: the contract has no separate reservation call, so
   * this delegates to the same operation. What it adds is the business link —
   * the request moves to RESERVED once the registration is confirmed.
   */
  async reserve(auth: AuthContext, requestId: string): Promise<FinancingClaimResponse> {
    const request = await this.requireRequest(auth.organizationId, requestId);
    this.assertStatus(request, ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'RESERVED']);

    const invoice = request.invoice;
    await this.anchor.assertAnchorable(invoice.id);
    const { commitment } = this.commitments.forInvoice(invoice);

    const { operation } = await this.transactions.enqueue({
      organizationId: auth.organizationId,
      kind: BlockchainOperationType.INVOICE_ANCHOR,
      commitment,
      identity: invoice.id,
      entityId: this.commitments.entityId(auth.organizationId),
      invoiceId: invoice.id,
      financingRequestId: request.id,
    });

    // An anchor confirmed before this request existed cannot have applied the
    // request's status, so the link is attached retroactively. The operation is
    // already terminal, so nothing is re-sent.
    const linked =
      operation.financingRequestId === null
        ? await this.prisma.blockchainOperation.update({
            where: { id: operation.id },
            data: { financingRequestId: request.id },
          })
        : operation;

    const driven = await this.transactions.drive(linked);

    if (driven.status === BlockchainOperationStatus.CONFIRMED) {
      await this.prisma.financingRequest.updateMany({
        where: {
          id: request.id,
          organizationId: auth.organizationId,
          status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'] },
        },
        data: { status: 'RESERVED' },
      });
    }

    return this.respond(request.id, driven);
  }

  /**
   * Records the financier's attestation that financing was agreed.
   *
   * The contract deliberately does not claim that funds moved, and neither does
   * this method: the request moves to FINANCING_DECLARED, not FUNDED.
   */
  async declareFinanced(auth: AuthContext, requestId: string): Promise<FinancingClaimResponse> {
    const request = await this.requireRequest(auth.organizationId, requestId);
    this.assertStatus(request, ['RESERVED']);

    const { commitment } = this.commitments.forInvoice(request.invoice);

    const { operation } = await this.transactions.enqueue({
      organizationId: auth.organizationId,
      kind: BlockchainOperationType.FINANCING_DECLARE,
      commitment,
      identity: request.id,
      financingRef: this.commitments.financingRef(request.id),
      invoiceId: request.invoiceId,
      financingRequestId: request.id,
    });

    return this.respond(request.id, await this.transactions.drive(operation));
  }

  /** Ends a financed claim. Only reachable from FINANCING_DECLARED. */
  async close(auth: AuthContext, requestId: string): Promise<FinancingClaimResponse> {
    const request = await this.requireRequest(auth.organizationId, requestId);
    this.assertStatus(request, ['FINANCING_DECLARED']);

    const { commitment } = this.commitments.forInvoice(request.invoice);

    const { operation } = await this.transactions.enqueue({
      organizationId: auth.organizationId,
      kind: BlockchainOperationType.FINANCING_CLOSE,
      commitment,
      identity: request.id,
      invoiceId: request.invoiceId,
      financingRequestId: request.id,
    });

    return this.respond(request.id, await this.transactions.drive(operation));
  }

  /**
   * Releases a reservation that was never financed.
   *
   * Cancelling is only valid while RESERVED. A financed claim must be closed
   * instead, which is also what the contract enforces; the check here exists so
   * the API returns a 409 with a reason rather than a decoded revert.
   */
  async cancelReservation(auth: AuthContext, requestId: string): Promise<FinancingClaimResponse> {
    const request = await this.requireRequest(auth.organizationId, requestId);
    this.assertStatus(request, ['RESERVED']);

    const { commitment } = this.commitments.forInvoice(request.invoice);

    const { operation } = await this.transactions.enqueue({
      organizationId: auth.organizationId,
      kind: BlockchainOperationType.RESERVATION_CANCEL,
      commitment,
      identity: request.id,
      invoiceId: request.invoiceId,
      financingRequestId: request.id,
    });

    return this.respond(request.id, await this.transactions.drive(operation));
  }

  private async requireRequest(organizationId: string, id: string): Promise<RequestWithInvoice> {
    if (!UUID.test(id)) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'FINANCING_REQUEST_NOT_FOUND',
        'Financing request not found',
      );
    }

    const request = await this.prisma.financingRequest.findFirst({
      where: { id, organizationId },
      include: { invoice: true },
    });

    if (request === null) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'FINANCING_REQUEST_NOT_FOUND',
        'Financing request not found',
      );
    }
    return request;
  }

  private assertStatus(request: FinancingRequest, allowed: readonly string[]): void {
    if (!allowed.includes(request.status)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'INVALID_FINANCING_STATE',
        `A financing request in status ${request.status} cannot perform this action`,
        { financingRequestId: request.id, status: request.status, allowed },
      );
    }
  }

  private async respond(
    requestId: string,
    operation: BlockchainOperation,
  ): Promise<FinancingClaimResponse> {
    const [request, receipt] = await Promise.all([
      this.prisma.financingRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { status: true },
      }),
      this.prisma.blockchainTransactionReceipt.findUnique({
        where: { operationId: operation.id },
      }),
    ]);

    return {
      financingRequestId: requestId,
      status: request.status,
      operation: presentOperation(operation, receipt),
    };
  }
}
