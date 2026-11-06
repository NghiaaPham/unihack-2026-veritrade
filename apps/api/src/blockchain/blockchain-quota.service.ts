import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { isUniqueViolation } from '../database/prisma-errors.js';
import { BlockchainOperationStatus, Prisma } from '../generated/prisma/client.js';

const ACTION_RATE_LIMITED = 'blockchain.write.rate_limited';
const ACTION_PENDING_CAP = 'blockchain.write.pending_cap_reached';
const ENTITY_TYPE = 'blockchain_quota';

/** Operation states that still hold a slot and may still cost gas. */
const IN_FLIGHT: BlockchainOperationStatus[] = [
  BlockchainOperationStatus.PENDING,
  BlockchainOperationStatus.SUBMITTING,
  BlockchainOperationStatus.SUBMITTED,
  BlockchainOperationStatus.UNKNOWN,
];

export interface QuotaDenial {
  allowed: false;
  code: 'BLOCKCHAIN_RATE_LIMITED' | 'BLOCKCHAIN_PENDING_LIMIT_REACHED';
  message: string;
  retryAfterSeconds: number;
  details: Record<string, unknown>;
}

export type QuotaDecision = { allowed: true } | QuotaDenial;

/**
 * Bounds how much chain work one tenant can ask for.
 *
 * Two limits, because they stop different things:
 *
 *   * **a rate limit** — writes per fixed window. Stops a script from firing
 *     hundreds of transactions a minute. A fixed window is used rather than a
 *     sliding log because it is one atomic upsert per request instead of one
 *     insert per request plus a range scan, and the burst at a window boundary
 *     is not worth that cost here.
 *   * **a pending cap** — operations that have not reached a terminal state.
 *     This is the one that bounds spend: every in-flight operation may become a
 *     transaction, so capping the number in flight caps the gas a tenant can
 *     have outstanding regardless of how slowly they send.
 *
 * Both counters live in the database. An in-process counter would reset on
 * deploy and would be per-instance, which makes it a suggestion rather than a
 * limit.
 *
 * Reads are not charged. `GET /invoices/:id/anchor-status` and
 * `GET /blockchain/transactions/:id` are how a client learns what happened to a
 * write it already paid for; charging them would punish polling and push
 * clients towards guessing. Only the routes that can create a transaction call
 * this service.
 */
@Injectable()
export class BlockchainQuotaService {
  private readonly logger = new Logger(BlockchainQuotaService.name);

  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxPending: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    config: ConfigService,
  ) {
    this.limit = config.get<number>('BLOCKCHAIN_WRITE_LIMIT') ?? 60;
    this.windowMs = (config.get<number>('BLOCKCHAIN_WRITE_WINDOW_SECONDS') ?? 60) * 1_000;
    this.maxPending = config.get<number>('BLOCKCHAIN_MAX_PENDING_OPERATIONS') ?? 25;
  }

  /**
   * Charges one write attempt and reports whether it may proceed.
   *
   * Never throws: a guard that has to translate an exception into a header
   * should receive a decision, not catch one.
   */
  async consume(auth: AuthContext, now: Date = new Date()): Promise<QuotaDecision> {
    const windowStart = new Date(Math.floor(now.getTime() / this.windowMs) * this.windowMs);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowStart.getTime() + this.windowMs - now.getTime()) / 1_000),
    );

    const count = await this.increment(auth.organizationId, windowStart);

    if (count > this.limit) {
      await this.record(auth, ACTION_RATE_LIMITED, {
        limit: this.limit,
        count,
        windowSeconds: this.windowMs / 1_000,
      });

      return {
        allowed: false,
        code: 'BLOCKCHAIN_RATE_LIMITED',
        message: `Too many chain writes. The limit is ${this.limit} per ${this.windowMs / 1_000}s.`,
        retryAfterSeconds,
        details: { limit: this.limit, windowSeconds: this.windowMs / 1_000 },
      };
    }

    const pending = await this.prisma.blockchainOperation.count({
      where: { organizationId: auth.organizationId, status: { in: IN_FLIGHT } },
    });

    if (pending >= this.maxPending) {
      await this.record(auth, ACTION_PENDING_CAP, { limit: this.maxPending, pending });

      return {
        allowed: false,
        code: 'BLOCKCHAIN_PENDING_LIMIT_REACHED',
        message:
          `This organization already has ${pending} chain operations in flight ` +
          `(limit ${this.maxPending}). Wait for them to confirm or fail.`,
        // A pending operation usually resolves in seconds; there is no window
        // to wait for, so point at a short poll interval instead.
        retryAfterSeconds: 30,
        details: { limit: this.maxPending, pending },
      };
    }

    return { allowed: true };
  }

  /**
   * Atomic increment of the current window.
   *
   * `upsert` compiles to `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1`,
   * so two instances incrementing the same window produce the true total rather
   * than each reading the other's pre-increment value. The P2002 retry covers
   * the narrow case where the driver falls back to a read-then-write.
   */
  private async increment(organizationId: string, windowStart: Date): Promise<number> {
    const key = { organizationId_windowStart: { organizationId, windowStart } };

    try {
      const row = await this.prisma.blockchainRateLimit.upsert({
        where: key,
        create: { organizationId, windowStart, count: 1 },
        update: { count: { increment: 1 } },
      });

      return row.count;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const row = await this.prisma.blockchainRateLimit.update({
        where: key,
        data: { count: { increment: 1 } },
      });

      return row.count;
    }
  }

  /**
   * Writes the security event.
   *
   * Best effort on purpose: an audit insert that fails must not turn a 429 into
   * a 500, and must not let the request through either. The refusal has already
   * been decided by the time this runs.
   */
  private async record(
    auth: AuthContext,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record({
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action,
        entityType: ENTITY_TYPE,
        entityId: auth.organizationId,
        metadata: metadata as Prisma.InputJsonValue,
      });
    } catch (error) {
      this.logger.warn(
        `could not record ${action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * How many operations the tenant currently has in flight.
   *
   * Exposed for the tests and for an operator looking at a stuck tenant; the
   * decision path counts the same rows inline.
   */
  async pendingCount(organizationId: string): Promise<number> {
    return this.prisma.blockchainOperation.count({
      where: { organizationId, status: { in: IN_FLIGHT } },
    });
  }
}
