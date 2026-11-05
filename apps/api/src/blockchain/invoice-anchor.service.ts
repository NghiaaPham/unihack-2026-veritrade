import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/auth.types.js';
import { AppException } from '../common/errors/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  BlockchainOperationStatus,
  BlockchainOperationType,
  type BlockchainOperation,
  type BlockchainTransactionReceipt,
  type Invoice,
} from '../generated/prisma/client.js';
import { AvalancheRpcService } from './avalanche-rpc.service.js';
import { REGISTRY_ABI, claimStatusOf, type ClaimStatus } from './blockchain.constants.js';
import { BlockchainTransactionService } from './blockchain-transaction.service.js';
import { presentOperation, type AnchorStatusResponse } from './blockchain.presenter.js';
import { InvoiceCommitmentService } from './invoice-commitment.service.js';
import { TransactionConfirmationService } from './transaction-confirmation.service.js';

/** A UUID cannot exist otherwise, so a malformed id is a 404 and never a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AnchorResult {
  operation: BlockchainOperation;
  receipt: BlockchainTransactionReceipt | null;
}

/**
 * Anchoring an invoice in the registry.
 *
 * Anchoring *is* the reservation: the contract has one `register` call and it
 * moves the commitment to RESERVED. There is no second on-chain step that would
 * make the same invoice available to another financier, which is why a separate
 * "reserve" endpoint delegates here instead of sending its own transaction.
 */
@Injectable()
export class InvoiceAnchorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commitments: InvoiceCommitmentService,
    private readonly transactions: BlockchainTransactionService,
    private readonly confirmations: TransactionConfirmationService,
    private readonly rpc: AvalancheRpcService,
  ) {}

  /**
   * Idempotent: a second call returns the operation created by the first,
   * whether it is pending, confirmed or failed. Only a new invoice can produce
   * a new transaction.
   */
  async anchor(auth: AuthContext, invoiceId: string): Promise<AnchorResult> {
    const invoice = await this.requireInvoice(auth.organizationId, invoiceId);
    await this.assertAnchorable(invoice.id);

    const { commitment } = this.commitments.forInvoice(invoice);

    const { operation } = await this.transactions.enqueue({
      organizationId: auth.organizationId,
      kind: BlockchainOperationType.INVOICE_ANCHOR,
      commitment,
      identity: invoice.id,
      entityId: this.commitments.entityId(auth.organizationId),
      invoiceId: invoice.id,
    });

    const driven = await this.transactions.drive(operation);
    return this.withReceipt(driven);
  }

  /**
   * Read-only view. It may finish a poll (SUBMITTED → CONFIRMED) but never
   * submits a transaction: a GET must not spend gas.
   */
  async status(auth: AuthContext, invoiceId: string): Promise<AnchorStatusResponse> {
    const invoice = await this.requireInvoice(auth.organizationId, invoiceId);
    const { commitment } = this.commitments.forInvoice(invoice);

    const stored = await this.prisma.blockchainOperation.findFirst({
      where: {
        invoiceId: invoice.id,
        organizationId: auth.organizationId,
        kind: BlockchainOperationType.INVOICE_ANCHOR,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (stored === null) {
      return {
        invoiceId: invoice.id,
        anchored: false,
        commitment,
        claimStatus: await this.readClaimStatus(commitment),
        operation: null,
        checkedAt: new Date().toISOString(),
      };
    }

    const advanced =
      stored.status === BlockchainOperationStatus.SUBMITTED
        ? await this.confirmations.settle(stored)
        : stored.status === BlockchainOperationStatus.UNKNOWN
          ? await this.confirmations.reconcile(stored)
          : stored;

    const operation = await this.prisma.blockchainOperation.findUniqueOrThrow({
      where: { id: advanced.id },
      include: { receipt: true },
    });

    return {
      invoiceId: invoice.id,
      anchored: operation.status === BlockchainOperationStatus.CONFIRMED,
      commitment,
      claimStatus: await this.readClaimStatus(commitment),
      operation: presentOperation(operation, operation.receipt),
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * An invoice may only be anchored once a verification run has produced a
   * usable verdict.
   *
   * PASSED is unreachable by design (the tax-authority check is UNSUPPORTED),
   * so PARTIAL is the strongest verdict this system can currently produce.
   * Requiring PASSED would make anchoring impossible; requiring nothing would
   * put an unverified claim on a public registry.
   */
  async assertAnchorable(invoiceId: string): Promise<void> {
    const latest = await this.prisma.invoiceVerification.findFirst({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });

    if (latest === null) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'INVOICE_NOT_VERIFIED',
        'The invoice has no completed verification run, so it cannot be anchored',
        { invoiceId },
      );
    }

    if (latest.status !== 'PASSED' && latest.status !== 'PARTIAL') {
      throw new AppException(
        HttpStatus.CONFLICT,
        'INVOICE_NOT_VERIFIED',
        'The latest verification did not produce a usable verdict, so the invoice cannot be anchored',
        { invoiceId, verificationId: latest.id, verificationStatus: latest.status },
      );
    }
  }

  private async requireInvoice(organizationId: string, id: string): Promise<Invoice> {
    if (!UUID.test(id)) {
      throw new AppException(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Invoice not found');
    }

    const invoice = await this.prisma.invoice.findFirst({ where: { id, organizationId } });
    if (invoice === null) {
      throw new AppException(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', 'Invoice not found');
    }
    return invoice;
  }

  private async withReceipt(operation: BlockchainOperation): Promise<AnchorResult> {
    const receipt = await this.prisma.blockchainTransactionReceipt.findUnique({
      where: { operationId: operation.id },
    });
    return { operation, receipt };
  }

  /**
   * Best effort: the chain is authoritative, but a read failure must not turn
   * a status endpoint into a 500. `null` means "unknown", which is honest.
   */
  private async readClaimStatus(commitment: string): Promise<ClaimStatus | null> {
    if (!this.rpc.configured) return null;

    try {
      const value = await this.rpc.publicClient().readContract({
        address: this.rpc.requireContractAddress(),
        abi: REGISTRY_ABI,
        functionName: 'statusOf',
        args: [commitment as `0x${string}`],
      });
      return claimStatusOf(Number(value));
    } catch {
      return null;
    }
  }
}
