import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { keccak256, type Hex, type TransactionReceipt } from 'viem';

import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  BlockchainOperationStatus,
  BlockchainOperationType,
  BlockchainReceiptStatus,
  FinancingStatus,
  Prisma,
  type BlockchainOperation,
} from '../generated/prisma/client.js';
import { AvalancheRpcService } from './avalanche-rpc.service.js';
import { RECEIPT_POLL_INTERVAL_MS, RECEIPT_WAIT_TIMEOUT_MS } from './blockchain.constants.js';
import { callDataFor, callSummary } from './registry-call.js';

const ACTION_CONFIRMED = 'blockchain.operation.confirmed';
const ENTITY_TYPE = 'blockchain_operation';

/**
 * Turns a broadcast transaction into durable facts.
 *
 * The receipt is written to its own table because it is evidence: it records
 * what the chain did, independent of what the business meant. The business
 * projection (a financing request moving to RESERVED, for example) is written
 * from the same database transaction, so the two can never disagree.
 */
@Injectable()
export class TransactionConfirmationService {
  private readonly confirmations: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: AvalancheRpcService,
    private readonly audit: AuditLogsService,
    config: ConfigService,
  ) {
    this.confirmations = config.get<number>('BLOCKCHAIN_CONFIRMATIONS') ?? 1;
  }

  /**
   * Waits for the receipt, bounded.
   *
   * A timeout is not a failure: the transaction is still in flight, the caller
   * gets a 202, and the indexer or the next poll will finish the job.
   */
  async settle(
    operation: BlockchainOperation,
    options: { timeoutMs?: number } = {},
  ): Promise<BlockchainOperation> {
    if (operation.txHash === null) return operation;
    if (
      operation.status === BlockchainOperationStatus.CONFIRMED ||
      operation.status === BlockchainOperationStatus.FAILED
    ) {
      return operation;
    }

    const publicClient = this.rpc.publicClient();

    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: operation.txHash as Hex,
        confirmations: this.confirmations,
        timeout: options.timeoutMs ?? RECEIPT_WAIT_TIMEOUT_MS,
        pollingInterval: RECEIPT_POLL_INTERVAL_MS,
      });
      return this.record(operation, receipt);
    } catch {
      // Timeout, dropped connection or a reorg mid-poll: all leave the
      // operation in SUBMITTED, which is the truth. Nothing is guessed here.
      return operation;
    }
  }

  /**
   * Resolves an UNKNOWN operation by hash.
   *
   * This is the only correct response to a broadcast whose outcome is unknown.
   * Resubmitting would risk a second transaction for the same invoice; looking
   * the hash up cannot.
   */
  async reconcile(operation: BlockchainOperation): Promise<BlockchainOperation> {
    if (operation.txHash === null) return operation;

    const receipt = await this.rpc
      .publicClient()
      .getTransactionReceipt({ hash: operation.txHash as Hex })
      .catch(() => null);

    if (receipt === null) return operation;
    return this.record(operation, receipt);
  }

  /**
   * Persists the receipt, the operation's terminal status and the business
   * projection in one database transaction.
   */
  private async record(
    operation: BlockchainOperation,
    receipt: TransactionReceipt,
  ): Promise<BlockchainOperation> {
    const succeeded = receipt.status === 'success';

    return this.prisma.$transaction(async (tx) => {
      await tx.blockchainTransactionReceipt.upsert({
        where: { operationId: operation.id },
        create: {
          operationId: operation.id,
          chainId: operation.chainId,
          txHash: operation.txHash as string,
          blockNumber: Number(receipt.blockNumber),
          blockHash: receipt.blockHash,
          status: succeeded ? BlockchainReceiptStatus.SUCCESS : BlockchainReceiptStatus.REVERTED,
          gasUsed: receipt.gasUsed,
          effectiveGasPrice: receipt.effectiveGasPrice,
          logCount: receipt.logs.length,
        },
        // Receipts are immutable. The update branch exists only to heal a row
        // written by an interrupted attempt, not to revise history.
        update: {
          status: succeeded ? BlockchainReceiptStatus.SUCCESS : BlockchainReceiptStatus.REVERTED,
          blockNumber: Number(receipt.blockNumber),
          blockHash: receipt.blockHash,
        },
      });

      const updated = await tx.blockchainOperation.update({
        where: { id: operation.id },
        data: {
          status: succeeded
            ? BlockchainOperationStatus.CONFIRMED
            : BlockchainOperationStatus.FAILED,
          confirmedAt: succeeded ? new Date() : null,
          nextAttemptAt: null,
          lastErrorCode: succeeded ? null : 'TRANSACTION_REVERTED',
          lastErrorMessage: succeeded ? null : `Reverted in block ${receipt.blockNumber}`,
        },
      });

      if (!succeeded) return updated;

      await this.recordConfirmedProjection(tx, operation, receipt);
      await this.applyBusinessEffect(tx, operation);

      return updated;
    });
  }

  /**
   * Writes the tenant-scoped `BlockchainRecord` for a confirmed operation.
   *
   * `payloadHash` is the keccak of the calldata, so the record identifies the
   * exact call rather than merely pointing at a transaction that may have
   * carried several.
   */
  private async recordConfirmedProjection(
    tx: Prisma.TransactionClient,
    operation: BlockchainOperation,
    receipt: TransactionReceipt,
  ): Promise<void> {
    await tx.blockchainRecord.upsert({
      where: {
        chainId_txHash: {
          chainId: operation.chainId,
          txHash: operation.txHash as string,
        },
      },
      create: {
        organizationId: operation.organizationId,
        kind: 'INVOICE_REGISTRY',
        status: 'CONFIRMED',
        chainId: operation.chainId,
        contractAddress: operation.contractAddress,
        txHash: operation.txHash as string,
        blockNumber: Number(receipt.blockNumber),
        payloadHash: keccak256(callDataFor(operation)),
        invoiceId: operation.invoiceId,
        financingRequestId: operation.financingRequestId,
        confirmedAt: new Date(),
      },
      update: {
        status: 'CONFIRMED',
        blockNumber: Number(receipt.blockNumber),
        confirmedAt: new Date(),
      },
    });

    await this.audit.record(
      {
        organizationId: operation.organizationId,
        actorUserId: null,
        action: ACTION_CONFIRMED,
        entityType: ENTITY_TYPE,
        entityId: operation.id,
        metadata: {
          ...callSummary(operation),
          txHash: operation.txHash,
          blockNumber: Number(receipt.blockNumber),
        },
      },
      tx,
    );
  }

  /**
   * Mirrors the on-chain claim state onto the business row.
   *
   * The contract is the source of truth for the claim; this projection exists
   * so a list of financing requests does not need a chain call per row. It is
   * derived, never authoritative, and is rewritten if a confirmation is
   * replayed.
   */
  private async applyBusinessEffect(
    tx: Prisma.TransactionClient,
    operation: BlockchainOperation,
  ): Promise<void> {
    const target = operation.financingRequestId;

    switch (operation.kind) {
      case BlockchainOperationType.INVOICE_ANCHOR:
        if (target === null) return;
        await tx.financingRequest.updateMany({
          where: { id: target, organizationId: operation.organizationId },
          data: { status: FinancingStatus.RESERVED },
        });
        return;
      case BlockchainOperationType.RESERVATION_CANCEL:
        if (target === null) return;
        await tx.financingRequest.updateMany({
          where: { id: target, organizationId: operation.organizationId },
          data: { status: FinancingStatus.CANCELLED, activeKey: null },
        });
        return;
      case BlockchainOperationType.FINANCING_DECLARE:
        if (target === null) return;
        await tx.financingRequest.updateMany({
          where: { id: target, organizationId: operation.organizationId },
          data: { status: FinancingStatus.FINANCING_DECLARED },
        });
        return;
      case BlockchainOperationType.FINANCING_CLOSE:
        if (target === null) return;
        await tx.financingRequest.updateMany({
          where: { id: target, organizationId: operation.organizationId },
          data: { status: FinancingStatus.CLOSED, activeKey: null },
        });
        return;
    }
  }
}
