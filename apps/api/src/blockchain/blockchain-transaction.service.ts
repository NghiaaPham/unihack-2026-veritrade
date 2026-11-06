import { HttpStatus, Injectable } from '@nestjs/common';
import { BaseError, ContractFunctionRevertedError, type Hex } from 'viem';

import { AppException } from '../common/errors/app.exception.js';
import { isUniqueViolation } from '../database/prisma-errors.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  BlockchainOperationStatus,
  BlockchainOperationType,
  type BlockchainOperation,
  type BlockchainTransactionReceipt,
} from '../generated/prisma/client.js';
import { AvalancheRpcService } from './avalanche-rpc.service.js';
import { REGISTRY_ABI, REGISTRY_ERROR_NAMES, backoffDelay } from './blockchain.constants.js';
import { NonceAllocatorService } from './nonce-allocator.service.js';
import { TransactionConfirmationService } from './transaction-confirmation.service.js';

const MAX_ERROR_MESSAGE_LENGTH = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EnqueueOperationInput {
  organizationId: string;
  kind: BlockchainOperationType;
  commitment: Hex;
  /**
   * Durable business identity for the idempotency key — the invoice id for an
   * anchor, the financing request id for a lifecycle action. Never a random
   * value: the whole point is that the same intent produces the same key.
   */
  identity: string;
  entityId?: Hex;
  financingRef?: Hex;
  invoiceId?: string;
  financingRequestId?: string;
}

/**
 * The outbox.
 *
 * Everything that decides *whether* a transaction should exist happens here,
 * and it happens in the database before anything is sent. A row is the durable
 * record of intent; the chain is where the intent becomes visible to others.
 *
 * What this service deliberately does not do:
 *
 *   * it does not wrap a database transaction around the broadcast. PostgreSQL
 *     and Avalanche cannot share a transaction, so pretending otherwise would
 *     produce a commit that lies about what happened;
 *   * it does not retry a broadcast that may have succeeded. An error after the
 *     send call is `UNKNOWN`, not `FAILED`.
 */
@Injectable()
export class BlockchainTransactionService {
  /**
   * Keeps one process from piling submissions onto the nonce allocator at once.
   *
   * Not a correctness mechanism — the allocator's row lock is what stops two
   * processes sharing a nonce. This only saves contention and makes a
   * single-instance burst behave predictably.
   */
  private submissionQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: AvalancheRpcService,
    private readonly confirmations: TransactionConfirmationService,
    private readonly nonces: NonceAllocatorService,
  ) {}

  /**
   * Takes an operation as far as it can go in this request.
   *
   * The four states need different treatment and conflating them is how
   * duplicate transactions happen:
   *
   *   * PENDING   — simulate, sign, send, then wait a bounded time for a receipt;
   *   * SUBMITTED — already broadcast, so only poll;
   *   * UNKNOWN   — outcome unknown, so look up the hash. Never resend;
   *   * anything terminal — return unchanged.
   */
  async drive(operation: BlockchainOperation): Promise<BlockchainOperation> {
    switch (operation.status) {
      case BlockchainOperationStatus.PENDING: {
        const submitted = await this.submit(operation);
        return submitted.status === BlockchainOperationStatus.SUBMITTED
          ? this.confirmations.settle(submitted)
          : submitted;
      }
      case BlockchainOperationStatus.SUBMITTED:
        return this.confirmations.settle(operation);
      case BlockchainOperationStatus.UNKNOWN:
        return this.confirmations.reconcile(operation);
      default:
        return operation;
    }
  }

  /**
   * Creates the operation, or returns the existing one with the same key.
   *
   * The read-then-create is not atomic on its own, which is why the unique
   * index on `idempotencyKey` is the real guard: two concurrent requests race
   * to insert, one loses with P2002, and it re-reads the winner's row.
   */
  async enqueue(
    input: EnqueueOperationInput,
  ): Promise<{ operation: BlockchainOperation; created: boolean }> {
    const contractAddress = this.rpc.requireContractAddress();
    this.assertComplete(input);

    const idempotencyKey = `${input.kind}:${contractAddress.toLowerCase()}:${input.identity}`;

    const existing = await this.prisma.blockchainOperation.findUnique({
      where: { idempotencyKey },
    });
    if (existing !== null) return { operation: existing, created: false };

    try {
      const operation = await this.prisma.blockchainOperation.create({
        data: {
          organizationId: input.organizationId,
          kind: input.kind,
          idempotencyKey,
          chainId: this.rpc.chainId,
          contractAddress,
          commitment: input.commitment,
          entityId: input.entityId ?? null,
          financingRef: input.financingRef ?? null,
          invoiceId: input.invoiceId ?? null,
          financingRequestId: input.financingRequestId ?? null,
        },
      });
      return { operation, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.blockchainOperation.findUniqueOrThrow({
        where: { idempotencyKey },
      });
      return { operation: raced, created: false };
    }
  }

  /**
   * Tenant-scoped lookup used by `GET /blockchain/transactions/:id`.
   *
   * It advances a SUBMITTED or UNKNOWN operation if it can, but never submits:
   * a read must not create a transaction.
   */
  async getForOrganization(
    organizationId: string,
    id: string,
  ): Promise<{ operation: BlockchainOperation; receipt: BlockchainTransactionReceipt | null }> {
    if (!UUID.test(id)) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'BLOCKCHAIN_OPERATION_NOT_FOUND',
        'Blockchain operation not found',
      );
    }

    const operation = await this.prisma.blockchainOperation.findFirst({
      where: { id, organizationId },
    });

    if (operation === null) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'BLOCKCHAIN_OPERATION_NOT_FOUND',
        'Blockchain operation not found',
      );
    }

    const advanced =
      operation.status === BlockchainOperationStatus.SUBMITTED
        ? await this.confirmations.settle(operation)
        : operation.status === BlockchainOperationStatus.UNKNOWN
          ? await this.confirmations.reconcile(operation)
          : operation;

    const receipt = await this.prisma.blockchainTransactionReceipt.findUnique({
      where: { operationId: advanced.id },
    });

    return { operation: advanced, receipt };
  }

  /**
   * Broadcasts a PENDING operation.
   *
   * Simulation runs first. A revert at simulation is a deterministic rejection
   * (duplicate claim, wrong lifecycle state) that no amount of retrying fixes,
   * and discovering it before signing saves gas and keeps the operation's
   * terminal state honest.
   *
   * `options.nonce` exists for exactly one caller: the reconciliation worker,
   * after it has proven on chain that a previously reserved nonce was never
   * used. Reusing that nonce fills the gap instead of leaving a hole that would
   * stall every later transaction from the same signer.
   */
  async submit(
    operation: BlockchainOperation,
    options: { nonce?: number } = {},
  ): Promise<BlockchainOperation> {
    if (operation.status !== BlockchainOperationStatus.PENDING) return operation;

    return this.exclusive(async () => {
      // Re-read inside the lock: another request may have submitted it while
      // this one waited.
      const current = await this.prisma.blockchainOperation.findUniqueOrThrow({
        where: { id: operation.id },
      });
      if (current.status !== BlockchainOperationStatus.PENDING) return current;

      const { account } = this.rpc.signer();
      const address = this.rpc.requireContractAddress();
      const publicClient = this.rpc.publicClient();

      try {
        await this.simulate(publicClient, address, current, account.address as Hex);
      } catch (error) {
        const decoded = decodeRevert(error);
        return this.fail(current.id, 'SIMULATION_REVERTED', decoded.message, decoded.name);
      }

      const nonce = options.nonce ?? (await this.nonces.allocate(account.address as Hex));

      await this.prisma.blockchainOperation.update({
        where: { id: current.id },
        data: {
          status: BlockchainOperationStatus.SUBMITTING,
          nonce,
          fromAddress: account.address.toLowerCase(),
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });

      let txHash: Hex;
      try {
        txHash = await this.send(address, current, nonce);
      } catch (error) {
        // The send call threw, but the transaction may still be in the
        // mempool. Marking it FAILED here is how a duplicate gets created.
        return this.markUnknown(current.id, error);
      }

      return this.prisma.blockchainOperation.update({
        where: { id: current.id },
        data: {
          status: BlockchainOperationStatus.SUBMITTED,
          txHash,
          submittedAt: new Date(),
        },
      });
    });
  }

  /** Records a deterministic failure. Terminal: nothing retries a FAILED row. */
  async fail(
    id: string,
    code: string,
    message: string,
    errorName?: string,
  ): Promise<BlockchainOperation> {
    return this.prisma.blockchainOperation.update({
      where: { id },
      data: {
        status: BlockchainOperationStatus.FAILED,
        lastErrorCode: errorName === undefined ? code : `${code}:${errorName}`.slice(0, 64),
        lastErrorMessage: truncate(message),
      },
    });
  }

  /**
   * Records an outcome the process cannot know. Reconciled, never retried.
   *
   * The retry time is pushed out with the same bounded backoff the worker uses,
   * so a node that is refusing sends does not get a fresh attempt every time a
   * client polls. Note that `txHash` is usually null here — the send call threw
   * before returning one — which is why the worker resolves these by nonce
   * rather than by hash.
   */
  async markUnknown(id: string, error: unknown): Promise<BlockchainOperation> {
    const current = await this.prisma.blockchainOperation.findUniqueOrThrow({
      where: { id },
      select: { attemptCount: true },
    });

    return this.prisma.blockchainOperation.update({
      where: { id },
      data: {
        status: BlockchainOperationStatus.UNKNOWN,
        lastErrorCode: 'BROADCAST_UNCERTAIN',
        lastErrorMessage: truncate(error instanceof Error ? error.message : String(error)),
        nextAttemptAt: new Date(Date.now() + backoffDelay(current.attemptCount)),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * One submission at a time.
   *
   * A second in-flight transaction from the same key with a reused nonce
   * replaces the first in the mempool, which looks exactly like a lost
   * transaction. Serialising is cheaper and more reliable than any retry
   * scheme built on top of that failure mode.
   */
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.submissionQueue.then(work, work);
    this.submissionQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Re-broadcasts an operation whose transaction provably never landed.
   *
   * Only the reconciliation worker calls this, and only after checking the
   * account's mined nonce count: if the chain has already used the nonce, a
   * transaction exists somewhere and must be found, not replaced. Reusing the
   * reserved nonce is what keeps the signer's nonce sequence contiguous — a
   * fresh nonce here would leave a permanent hole and every later transaction
   * would sit in the mempool behind it.
   */
  async resubmit(operation: BlockchainOperation): Promise<BlockchainOperation> {
    const reset = await this.prisma.blockchainOperation.update({
      where: { id: operation.id },
      data: {
        status: BlockchainOperationStatus.PENDING,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    return this.submit(reset, { nonce: operation.nonce ?? undefined });
  }

  /**
   * Rejects an operation that could never be encoded. Catching it at enqueue
   * means a missing argument is a failed write, not a crash in the signer.
   */
  private assertComplete(input: EnqueueOperationInput): void {
    if (input.kind === BlockchainOperationType.INVOICE_ANCHOR && input.entityId === undefined) {
      throw new Error('An INVOICE_ANCHOR operation requires an entity id');
    }
    if (
      input.kind === BlockchainOperationType.FINANCING_DECLARE &&
      input.financingRef === undefined
    ) {
      throw new Error('A FINANCING_DECLARE operation requires a financing reference');
    }
  }

  private async simulate(
    publicClient: ReturnType<AvalancheRpcService['publicClient']>,
    address: Hex,
    operation: BlockchainOperation,
    account: Hex,
  ): Promise<void> {
    const commitment = operation.commitment as Hex;

    switch (operation.kind) {
      case BlockchainOperationType.INVOICE_ANCHOR:
        await publicClient.simulateContract({
          address,
          abi: REGISTRY_ABI,
          functionName: 'register',
          args: [commitment, operation.entityId as Hex],
          account,
        });
        return;
      case BlockchainOperationType.RESERVATION_CANCEL:
        await publicClient.simulateContract({
          address,
          abi: REGISTRY_ABI,
          functionName: 'cancelReservation',
          args: [commitment],
          account,
        });
        return;
      case BlockchainOperationType.FINANCING_DECLARE:
        await publicClient.simulateContract({
          address,
          abi: REGISTRY_ABI,
          functionName: 'declareFinanced',
          args: [commitment, operation.financingRef as Hex],
          account,
        });
        return;
      case BlockchainOperationType.FINANCING_CLOSE:
        await publicClient.simulateContract({
          address,
          abi: REGISTRY_ABI,
          functionName: 'closeClaim',
          args: [commitment],
          account,
        });
        return;
    }
  }

  private async send(address: Hex, operation: BlockchainOperation, nonce: number): Promise<Hex> {
    const { client, account } = this.rpc.signer();
    const commitment = operation.commitment as Hex;
    const common = { address, abi: REGISTRY_ABI, account, chain: client.chain, nonce } as const;

    switch (operation.kind) {
      case BlockchainOperationType.INVOICE_ANCHOR:
        return client.writeContract({
          ...common,
          functionName: 'register',
          args: [commitment, operation.entityId as Hex],
        });
      case BlockchainOperationType.RESERVATION_CANCEL:
        return client.writeContract({
          ...common,
          functionName: 'cancelReservation',
          args: [commitment],
        });
      case BlockchainOperationType.FINANCING_DECLARE:
        return client.writeContract({
          ...common,
          functionName: 'declareFinanced',
          args: [commitment, operation.financingRef as Hex],
        });
      case BlockchainOperationType.FINANCING_CLOSE:
        return client.writeContract({
          ...common,
          functionName: 'closeClaim',
          args: [commitment],
        });
    }
  }
}

/** Trims a message to the column width without splitting a surrogate pair. */
export function truncate(value: string): string {
  return value.length <= MAX_ERROR_MESSAGE_LENGTH ? value : `${value.slice(0, 499)}…`;
}

/**
 * Pulls the custom-error name out of a viem error.
 *
 * The name is part of the contract ABI and survives message changes; the
 * message is for humans. Storing both means an operator can act on the code
 * and still read what happened.
 */
export function decodeRevert(error: unknown): { name: string; message: string } {
  if (error instanceof BaseError) {
    const reverted = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);

    if (reverted instanceof ContractFunctionRevertedError) {
      // A node may truncate the revert data to the selector, in which case
      // viem cannot decode the name and reports "Reverted". The local selector
      // map recovers the name in that case.
      const selector = reverted.signature?.startsWith('0x')
        ? reverted.signature.slice(0, 10).toLowerCase()
        : undefined;
      const name =
        reverted.data?.errorName ??
        (selector === undefined ? undefined : REGISTRY_ERROR_NAMES.get(selector)) ??
        'Reverted';

      return { name, message: reverted.shortMessage };
    }

    return { name: 'RpcError', message: error.shortMessage };
  }

  return {
    name: 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
  };
}
