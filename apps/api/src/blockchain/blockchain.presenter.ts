import type {
  BlockchainOperation,
  BlockchainOperationStatus,
  BlockchainOperationType,
  BlockchainTransactionReceipt,
} from '../generated/prisma/client.js';
import type { ClaimStatus } from './blockchain.constants.js';

/**
 * Chain-facing API representations.
 *
 * The same two rules as the invoice presenter apply: money-like quantities are
 * strings (wei does not fit in a JS number) and instants are full ISO-8601
 * timestamps. Nothing here exposes the signer's key or any invoice content.
 */

export interface BlockchainReceiptResponse {
  chainId: number;
  txHash: string;
  blockNumber: number;
  blockHash: string;
  status: 'SUCCESS' | 'REVERTED';
  /** Decimal string: wei exceeds 2^53. */
  gasUsed: string;
  effectiveGasPrice: string;
  logCount: number;
  observedAt: string;
}

export interface BlockchainOperationResponse {
  id: string;
  kind: BlockchainOperationType;
  status: BlockchainOperationStatus;
  chainId: number;
  contractAddress: string;
  commitment: string;
  entityId: string | null;
  financingRef: string | null;
  invoiceId: string | null;
  financingRequestId: string | null;
  txHash: string | null;
  nonce: number | null;
  attemptCount: number;
  /** Present only after a failed attempt; the code is stable, the message is not. */
  error: { code: string; message: string } | null;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  receipt: BlockchainReceiptResponse | null;
}

export interface AnchorStatusResponse {
  invoiceId: string;
  /** True only when a confirmed registration exists for this invoice. */
  anchored: boolean;
  commitment: string | null;
  /** Live claim state read from the contract; null when the chain is unreachable. */
  claimStatus: ClaimStatus | null;
  operation: BlockchainOperationResponse | null;
  checkedAt: string;
}

export interface FinancingClaimResponse {
  financingRequestId: string;
  /** Business status after the attempt, re-read from the database. */
  status: string;
  operation: BlockchainOperationResponse;
}

export function presentReceipt(receipt: BlockchainTransactionReceipt): BlockchainReceiptResponse {
  return {
    chainId: receipt.chainId,
    txHash: receipt.txHash,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    status: receipt.status,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    logCount: receipt.logCount,
    observedAt: receipt.observedAt.toISOString(),
  };
}

export function presentOperation(
  operation: BlockchainOperation,
  receipt: BlockchainTransactionReceipt | null = null,
): BlockchainOperationResponse {
  return {
    id: operation.id,
    kind: operation.kind,
    status: operation.status,
    chainId: operation.chainId,
    contractAddress: operation.contractAddress,
    commitment: operation.commitment,
    entityId: operation.entityId,
    financingRef: operation.financingRef,
    invoiceId: operation.invoiceId,
    financingRequestId: operation.financingRequestId,
    txHash: operation.txHash,
    nonce: operation.nonce,
    attemptCount: operation.attemptCount,
    error:
      operation.lastErrorCode === null
        ? null
        : {
            code: operation.lastErrorCode,
            message: operation.lastErrorMessage ?? 'No detail recorded',
          },
    createdAt: operation.createdAt.toISOString(),
    submittedAt: operation.submittedAt?.toISOString() ?? null,
    confirmedAt: operation.confirmedAt?.toISOString() ?? null,
    receipt: receipt === null ? null : presentReceipt(receipt),
  };
}
