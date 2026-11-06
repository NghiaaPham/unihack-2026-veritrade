import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Hex } from 'viem';

import { PrismaService } from '../database/prisma.service.js';
import { BlockchainOperationStatus, type BlockchainOperation } from '../generated/prisma/client.js';
import { AvalancheRpcService } from './avalanche-rpc.service.js';
import {
  NONCE_SCAN_BLOCKS,
  OPERATION_LEASE_MS,
  RECONCILE_BATCH_SIZE,
  backoffDelay,
} from './blockchain.constants.js';
import { BlockchainTransactionService } from './blockchain-transaction.service.js';
import { TransactionConfirmationService } from './transaction-confirmation.service.js';

export interface ReconcileResult {
  /** Operations that were due and visible to this worker. */
  scanned: number;
  /** Of those, the ones this worker won the lease for. */
  claimed: number;
  /** Another worker held the lease; this pass left them alone. */
  skipped: number;
  confirmed: number;
  /** A transaction was broadcast at a reserved nonce that had not been spent. */
  resubmitted: number;
  /**
   * A lost transaction was found by nonce and adopted. Kept apart from
   * `resubmitted` because nothing was signed: an operator reading the log must
   * be able to tell that no second transaction was sent.
   */
  adopted: number;
  rescheduled: number;
}

/**
 * Finishes chain operations that a request could not finish.
 *
 * Without this, an operation that timed out mid-flight stays SUBMITTED or
 * UNKNOWN forever: the hash is kept, so nothing is lost, but nothing resolves
 * it either, and a client that stops polling strands it permanently. This
 * worker is the sweep.
 *
 * Four rules govern it, and each one exists because the alternative is a
 * duplicate transaction for the same invoice:
 *
 *   1. **Never re-sign an UNKNOWN transaction that might exist.** If a hash is
 *      known, only `getTransactionReceipt` is called. If no hash is known, the
 *      decision is made from the account's *mined* nonce count, not from an
 *      error message.
 *   2. **Reuse the reserved nonce when re-broadcasting.** A fresh nonce would
 *      leave a permanent hole, and every later transaction from the signer
 *      would queue behind it in the mempool.
 *   3. **Take a lease before touching a row.** Two instances share the
 *      database; a conditional UPDATE is the only claim that one of them loses.
 *   4. **Back off with a ceiling.** A node that is down must not be hammered,
 *      and an operation must not be abandoned either.
 */
@Injectable()
export class BlockchainReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockchainReconciliationService.name);

  /**
   * Identity for lease claims. Host and pid make a stuck lease attributable to
   * a machine; the random suffix separates two workers in one process (tests,
   * or a future in-process shard).
   */
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: AvalancheRpcService,
    private readonly transactions: BlockchainTransactionService,
    private readonly confirmations: TransactionConfirmationService,
    config: ConfigService,
  ) {
    this.intervalMs = config.get<number>('BLOCKCHAIN_RECONCILE_INTERVAL_MS') ?? 0;
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0) return;

    if (!this.rpc.configured) {
      this.logger.log('reconciliation worker idle: no registry address is configured');
      return;
    }

    this.logger.log(`reconciliation worker started (every ${this.intervalMs}ms, ${this.workerId})`);
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // A background sweep is not a reason for the process to stay alive.
    this.timer.unref?.();
  }

  /**
   * Stops accepting work and waits for the pass in flight.
   *
   * Waiting matters: a pass that is interrupted between signing and persisting
   * the hash is exactly the state the worker exists to clean up, so shutting
   * down mid-pass would manufacture the problem it solves. The wait is bounded
   * so a hung RPC cannot block process exit indefinitely.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const inFlight = this.inFlight;
    if (inFlight === null) return;

    await Promise.race([
      inFlight,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        timer.unref?.();
      }),
    ]);
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return;

    this.running = true;
    this.inFlight = this.runPass();

    try {
      await this.inFlight;
    } finally {
      this.running = false;
      this.inFlight = null;
    }
  }

  private async runPass(): Promise<void> {
    try {
      const result = await this.reconcileOnce();

      if (result.claimed > 0) {
        this.logger.log(
          `reconciled ${result.claimed} operation(s): ` +
            `${result.confirmed} confirmed, ${result.resubmitted} resubmitted, ` +
            `${result.adopted} adopted, ${result.rescheduled} rescheduled, ` +
            `${result.skipped} held by another worker`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `reconciliation pass failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * One pass. Public so the test suite can drive it deterministically instead
   * of waiting for a timer.
   */
  async reconcileOnce(): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      scanned: 0,
      claimed: 0,
      skipped: 0,
      confirmed: 0,
      resubmitted: 0,
      adopted: 0,
      rescheduled: 0,
    };

    if (!this.rpc.configured) return result;

    const due = await this.claimDue(new Date());

    result.scanned = due.scanned;
    result.skipped = due.skipped;

    for (const operation of due.claimed) {
      result.claimed += 1;

      try {
        const outcome = await this.process(operation);

        if (outcome === 'confirmed') {
          // Terminal. Drop the lease rather than leave a stale owner on a row
          // nobody will ever claim again.
          await this.release(operation.id);
          result.confirmed += 1;
        } else if (outcome === 'resubmitted') result.resubmitted += 1;
        else if (outcome === 'adopted') result.adopted += 1;
        else result.rescheduled += 1;
      } catch (error) {
        // One bad operation must not abort the batch: the rest are still due.
        this.logger.warn(
          `operation ${operation.id} could not be reconciled: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        await this.reschedule(operation, 'RECONCILE_ERROR').catch(() => undefined);
        result.rescheduled += 1;
      }
    }

    return result;
  }

  /**
   * Selects due operations and wins a lease on as many as it can.
   *
   * The select is only a hint — a candidate may be taken by another worker
   * between the read and the claim, which is why the claim re-asserts the
   * status and the lease condition and counts the rows it actually changed.
   */
  async claimDue(
    now: Date,
  ): Promise<{ scanned: number; skipped: number; claimed: BlockchainOperation[] }> {
    const candidates = await this.prisma.blockchainOperation.findMany({
      where: {
        chainId: this.rpc.chainId,
        contractAddress: this.rpc.requireContractAddress(),
        status: {
          in: [
            BlockchainOperationStatus.SUBMITTING,
            BlockchainOperationStatus.SUBMITTED,
            BlockchainOperationStatus.UNKNOWN,
          ],
        },
        AND: [
          { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: RECONCILE_BATCH_SIZE,
    });

    const claimed: BlockchainOperation[] = [];
    let skipped = 0;

    for (const candidate of candidates) {
      const won = await this.prisma.blockchainOperation.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
        data: {
          leaseOwner: this.workerId,
          leaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS),
        },
      });

      if (won.count === 1) claimed.push(candidate);
      else skipped += 1;
    }

    return { scanned: candidates.length, skipped, claimed };
  }

  private async process(
    operation: BlockchainOperation,
  ): Promise<'confirmed' | 'resubmitted' | 'adopted' | 'rescheduled'> {
    // A hash is evidence that something was broadcast, so it is always the
    // first thing to look up — for SUBMITTED and UNKNOWN alike.
    if (operation.txHash !== null) {
      const settled = await this.confirmations.reconcile(operation);

      if (
        settled.status === BlockchainOperationStatus.CONFIRMED ||
        settled.status === BlockchainOperationStatus.FAILED
      ) {
        return 'confirmed';
      }

      await this.reschedule(settled);
      return 'rescheduled';
    }

    // No hash. Either the process died between reserving a nonce and sending,
    // or the send threw before returning one. Both are resolved the same way:
    // ask the chain whether the nonce was used.
    return this.resolveWithoutHash(operation);
  }

  /**
   * Decides whether a hash-less operation can be re-broadcast.
   *
   * The account's *mined* transaction count is the arbiter:
   *
   *   * `mined <= nonce` — nothing with this nonce is in a block. Either our
   *     transaction is still in the mempool, where replacing it at the same
   *     nonce is safe, or it never left. Re-broadcasting cannot create a second
   *     transaction because a nonce can only be spent once.
   *   * `mined > nonce` — the nonce was spent, so a transaction exists and must
   *     be found. Signing another one would be a second transaction for the
   *     same invoice, which is the exact failure this whole subsystem prevents.
   */
  private async resolveWithoutHash(
    operation: BlockchainOperation,
  ): Promise<'resubmitted' | 'adopted' | 'rescheduled'> {
    const from = operation.fromAddress as Hex | null;
    const nonce = operation.nonce;

    if (from === null || nonce === null) {
      // Never reached the signer: no nonce was reserved, so nothing can have
      // been broadcast and a fresh submission is safe.
      return this.rebroadcast(operation);
    }

    const mined = await this.rpc.publicClient().getTransactionCount({
      address: from,
      blockTag: 'latest',
    });

    if (mined <= nonce) {
      return this.rebroadcast(operation);
    }

    const hash = await this.findByNonce(from, nonce);

    if (hash === null) {
      // Spent, but not in the scan window. Keep looking on a later pass and do
      // not re-sign: an operator can resolve this by hash if it persists.
      await this.reschedule(operation, 'NONCE_SPENT_TX_NOT_FOUND');
      return 'rescheduled';
    }

    // Adopt the transaction the process lost track of, then settle it.
    const adopted = await this.prisma.blockchainOperation.update({
      where: { id: operation.id },
      data: { txHash: hash, status: BlockchainOperationStatus.SUBMITTED },
    });

    const settled = await this.confirmations.reconcile(adopted);

    if (
      settled.status === BlockchainOperationStatus.CONFIRMED ||
      settled.status === BlockchainOperationStatus.FAILED
    ) {
      // Terminal: nobody will claim this row again, so the lease must go.
      await this.release(settled.id);
      return 'adopted';
    }

    await this.reschedule(settled);
    return 'rescheduled';
  }

  private async rebroadcast(
    operation: BlockchainOperation,
  ): Promise<'resubmitted' | 'rescheduled'> {
    if (!this.rpc.writable) {
      // Read-only deployment: the operation stays where it is and the next
      // instance that holds a key will finish it.
      await this.reschedule(operation, 'SIGNER_NOT_CONFIGURED');
      return 'rescheduled';
    }

    const submitted = await this.transactions.resubmit(operation);

    if (
      submitted.status === BlockchainOperationStatus.CONFIRMED ||
      submitted.status === BlockchainOperationStatus.FAILED
    ) {
      // Terminal: nobody will claim this row again, so the lease must go.
      await this.release(submitted.id);
      return 'resubmitted';
    }

    // `resubmit` broadcasts but does not wait. Settle it here so a single pass
    // finishes the operation on a fast chain, and leave it SUBMITTED — with the
    // hash recorded — when the receipt is not there yet.
    if (submitted.status === BlockchainOperationStatus.SUBMITTED) {
      const settled = await this.confirmations.reconcile(submitted);
      // Whether it settled or not, this pass is done with the row: a terminal
      // row must not keep a lease, and a still-pending one is due again later.
      await this.release(settled.id);
      return 'resubmitted';
    }

    await this.release(submitted.id);
    return 'resubmitted';
  }

  /**
   * Finds the transaction hash for a `(from, nonce)` pair.
   *
   * Scanned block by block rather than asked of the node because no standard
   * JSON-RPC method answers "which transaction used nonce N". The window is
   * deliberately small: this runs only when the nonce is already known to be
   * spent, and an unbounded scan on a public RPC would be worse than the rare
   * unresolved operation it might rescue.
   */
  private async findByNonce(from: Hex, nonce: number): Promise<Hex | null> {
    const publicClient = this.rpc.publicClient();
    const latest = await publicClient.getBlockNumber();
    const floor = latest > BigInt(NONCE_SCAN_BLOCKS) ? latest - BigInt(NONCE_SCAN_BLOCKS) : 0n;

    for (let height = latest; height >= floor; height -= 1n) {
      const block = await publicClient.getBlock({
        blockNumber: height,
        includeTransactions: true,
      });

      const match = block.transactions.find(
        (transaction) =>
          typeof transaction !== 'string' &&
          transaction.from.toLowerCase() === from.toLowerCase() &&
          transaction.nonce === nonce,
      );

      if (match !== undefined && typeof match !== 'string') return match.hash;
    }

    return null;
  }

  private async reschedule(
    operation: BlockchainOperation,
    code?: string,
  ): Promise<BlockchainOperation> {
    return this.prisma.blockchainOperation.update({
      where: { id: operation.id },
      data: {
        nextAttemptAt: new Date(Date.now() + backoffDelay(operation.attemptCount)),
        leaseOwner: null,
        leaseExpiresAt: null,
        ...(code === undefined ? {} : { lastErrorCode: code.slice(0, 64) }),
      },
    });
  }

  /** Drops the lease so another instance can pick the row up immediately. */
  private async release(id: string): Promise<void> {
    await this.prisma.blockchainOperation.update({
      where: { id },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
  }
}
