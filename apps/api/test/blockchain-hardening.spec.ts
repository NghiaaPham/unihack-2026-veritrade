import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLogsService } from '../src/audit-logs/audit-logs.service.js';
import type { AuthContext } from '../src/auth/auth.types.js';
import { AvalancheRpcService } from '../src/blockchain/avalanche-rpc.service.js';
import { BlockchainQuotaService } from '../src/blockchain/blockchain-quota.service.js';
import { BlockchainReconciliationService } from '../src/blockchain/blockchain-reconciliation.service.js';
import {
  OPERATION_LEASE_MS,
  RECONCILE_BASE_DELAY_MS,
  RECONCILE_MAX_DELAY_MS,
  backoffDelay,
} from '../src/blockchain/blockchain.constants.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  BlockchainOperationStatus,
  BlockchainOperationType,
  type BlockchainOperation,
} from '../src/generated/prisma/client.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

/**
 * The coordination and quota machinery, without a chain.
 *
 * Everything here is decided in the database, so it can be tested against one.
 * The RPC service is constructed with an address but a URL nothing listens on:
 * the paths under test read and write rows, and never make a chain call. That
 * is deliberate — if one of these tests started depending on a live node, the
 * property being tested would have moved out of the database.
 */

const CONTRACT = '0x5fbdb2315678afecb367f032d93f642f64180aa3' as const;
const CHAIN_ID = 31337;

function config(values: Record<string, unknown>): ConfigService {
  return new ConfigService(values);
}

function rpcService(): AvalancheRpcService {
  return new AvalancheRpcService(
    config({
      AVALANCHE_CHAIN_ID: CHAIN_ID,
      // Nothing listens here. No test in this file makes an RPC call; if one
      // starts to, it fails loudly instead of silently reaching a real node.
      AVALANCHE_RPC_URL: 'http://127.0.0.1:1',
      VERITRADE_CONTRACT_ADDRESS: CONTRACT,
      AVALANCHE_DEPLOYER_PRIVATE_KEY: undefined,
    }),
  );
}

describe('Backoff policy', () => {
  it('grows with the attempt count and never exceeds the ceiling', () => {
    let previous = 0;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const delay = backoffDelay(attempt);

      expect(delay).toBeGreaterThanOrEqual(RECONCILE_BASE_DELAY_MS);
      expect(delay).toBeLessThanOrEqual(RECONCILE_MAX_DELAY_MS * 1.2);

      if (attempt > 0 && attempt < 6) {
        expect(delay).toBeGreaterThanOrEqual(previous * 0.9);
      }
      previous = delay;
    }
  });

  it('is bounded even for an absurd attempt count', () => {
    expect(backoffDelay(10_000)).toBeLessThanOrEqual(RECONCILE_MAX_DELAY_MS * 1.2);
  });

  it('is non-negative for a negative attempt count', () => {
    expect(backoffDelay(-5)).toBeGreaterThanOrEqual(RECONCILE_BASE_DELAY_MS);
  });
});

describe('Operation leases', () => {
  let database: TestDatabase;
  let reconciliation: BlockchainReconciliationService;

  const prisma = () => database.prisma;

  function build(): BlockchainReconciliationService {
    return new BlockchainReconciliationService(
      database.prisma as unknown as PrismaService,
      rpcService(),
      // Neither is reached by `claimDue`, which is all these tests exercise.
      null as never,
      null as never,
      config({ BLOCKCHAIN_RECONCILE_INTERVAL_MS: 0, BLOCKCHAIN_WRITE_LIMIT: 60 }),
    );
  }

  let counter = 0;

  async function makeOperation(
    overrides: Partial<{
      status: BlockchainOperationStatus;
      nextAttemptAt: Date | null;
      leaseOwner: string | null;
      leaseExpiresAt: Date | null;
    }> = {},
  ): Promise<BlockchainOperation> {
    counter += 1;

    const organization = await prisma().organization.upsert({
      where: { slug: 'lease-org' },
      create: { name: 'Lease Org', slug: 'lease-org', countryCode: 'VN' },
      update: {},
    });

    return prisma().blockchainOperation.create({
      data: {
        organizationId: organization.id,
        kind: BlockchainOperationType.INVOICE_ANCHOR,
        status: overrides.status ?? BlockchainOperationStatus.SUBMITTED,
        idempotencyKey: `INVOICE_ANCHOR:${CONTRACT}:lease-${counter}`,
        chainId: CHAIN_ID,
        contractAddress: CONTRACT,
        commitment: `0x${String(counter).padStart(64, '0')}`,
        entityId: `0x${'e'.repeat(64)}`,
        txHash: `0x${String(counter).padStart(64, 'a')}`,
        fromAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        nonce: counter,
        nextAttemptAt: overrides.nextAttemptAt ?? null,
        leaseOwner: overrides.leaseOwner ?? null,
        leaseExpiresAt: overrides.leaseExpiresAt ?? null,
      },
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.reset();
    reconciliation = build();
  });

  afterAll(async () => {
    await database.close();
  });

  it('claims a due operation and stamps a lease', async () => {
    const operation = await makeOperation();

    const result = await reconciliation.claimDue(new Date());

    expect(result.claimed.map((row) => row.id)).toEqual([operation.id]);

    const stored = await prisma().blockchainOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });

    expect(stored.leaseOwner).not.toBeNull();
    expect(stored.leaseExpiresAt?.getTime() ?? 0).toBeGreaterThan(Date.now());
  });

  it('leaves an operation alone while another worker holds an unexpired lease', async () => {
    const operation = await makeOperation({
      leaseOwner: 'other-worker',
      leaseExpiresAt: new Date(Date.now() + OPERATION_LEASE_MS),
    });

    const result = await reconciliation.claimDue(new Date());

    expect(result.claimed).toHaveLength(0);
    // Not even a candidate: the lease filter excludes it before the claim.
    expect(result.scanned).toBe(0);

    const stored = await prisma().blockchainOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });
    expect(stored.leaseOwner).toBe('other-worker');
  });

  it('takes over an operation whose lease expired, so a crashed worker cannot strand it', async () => {
    const operation = await makeOperation({
      leaseOwner: 'dead-worker',
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });

    const result = await reconciliation.claimDue(new Date());

    expect(result.claimed.map((row) => row.id)).toEqual([operation.id]);

    const stored = await prisma().blockchainOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });
    expect(stored.leaseOwner).not.toBe('dead-worker');
  });

  it('does not claim an operation that is not due yet', async () => {
    await makeOperation({ nextAttemptAt: new Date(Date.now() + 60_000) });

    const result = await reconciliation.claimDue(new Date());

    expect(result.claimed).toHaveLength(0);
    expect(result.scanned).toBe(0);
  });

  it('never claims a terminal operation', async () => {
    await makeOperation({ status: BlockchainOperationStatus.CONFIRMED });
    await makeOperation({ status: BlockchainOperationStatus.FAILED });
    await makeOperation({ status: BlockchainOperationStatus.PENDING });

    const result = await reconciliation.claimDue(new Date());

    expect(result.claimed).toHaveLength(0);
  });

  it('gives two concurrent workers disjoint sets', async () => {
    const created = [];
    for (let index = 0; index < 10; index += 1) {
      created.push(await makeOperation());
    }

    const first = build();
    const second = build();

    const [a, b] = await Promise.all([first.claimDue(new Date()), second.claimDue(new Date())]);

    const idsA = a.claimed.map((row) => row.id);
    const idsB = b.claimed.map((row) => row.id);

    // The property that matters: no operation is processed twice.
    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toEqual([]);

    // And nothing was dropped: every row was claimed exactly once.
    expect(idsA.length + idsB.length).toBe(created.length);
    expect(new Set([...idsA, ...idsB]).size).toBe(created.length);
  });

  it('shuts down cleanly and can be shut down twice', async () => {
    const worker = build();

    await expect(worker.onModuleDestroy()).resolves.toBeUndefined();
    await expect(worker.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('is idle when no registry address is configured', async () => {
    const unconfigured = new BlockchainReconciliationService(
      database.prisma as unknown as PrismaService,
      new AvalancheRpcService(config({ AVALANCHE_CHAIN_ID: CHAIN_ID })),
      null as never,
      null as never,
      config({ BLOCKCHAIN_RECONCILE_INTERVAL_MS: 0 }),
    );

    await makeOperation();

    const result = await unconfigured.reconcileOnce();

    expect(result.claimed).toBe(0);
    expect(result.scanned).toBe(0);
  });
});

describe('Write quota', () => {
  let database: TestDatabase;
  let quota: BlockchainQuotaService;
  let auth: AuthContext;

  const prisma = () => database.prisma;

  function buildQuota(values: Record<string, unknown> = {}): BlockchainQuotaService {
    return new BlockchainQuotaService(
      database.prisma as unknown as PrismaService,
      new AuditLogsService(database.prisma as unknown as PrismaService),
      config({
        BLOCKCHAIN_WRITE_LIMIT: 3,
        BLOCKCHAIN_WRITE_WINDOW_SECONDS: 60,
        BLOCKCHAIN_MAX_PENDING_OPERATIONS: 25,
        ...values,
      }),
    );
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.reset();

    const organization = await prisma().organization.create({
      data: { name: 'Quota Org', slug: 'quota-org', countryCode: 'VN' },
    });

    // A real row, because `audit_logs.actor_user_id` is a foreign key. A
    // fabricated id would make the audit insert fail, and the refusal path
    // deliberately swallows that failure — the test would then assert on an
    // empty table and pass for the wrong reason.
    const user = await prisma().user.create({
      data: { email: 'quota@example.test', displayName: 'Quota' },
    });

    auth = {
      userId: user.id,
      email: 'quota@example.test',
      displayName: 'Quota',
      organizationId: organization.id,
      organizationSlug: 'quota-org',
      role: 'OWNER',
    };

    quota = buildQuota();
  });

  afterAll(async () => {
    await database.close();
  });

  it('allows writes up to the limit', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(quota.consume(auth)).resolves.toEqual({ allowed: true });
    }
  });

  it('refuses the write after the limit with a retry hint', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await quota.consume(auth);
    }

    const decision = await quota.consume(auth);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');

    expect(decision.code).toBe('BLOCKCHAIN_RATE_LIMITED');
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('records the refusal as a security event', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await quota.consume(auth);
    }

    const events = await prisma().auditLog.findMany({
      where: { organizationId: auth.organizationId, action: 'blockchain.write.rate_limited' },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.actorUserId).toBe(auth.userId);
    expect(events[0]?.metadata).toMatchObject({ limit: 3, count: 4 });
  });

  it('counts concurrent attempts exactly once each', async () => {
    const decisions = await Promise.all(Array.from({ length: 10 }, () => quota.consume(auth)));

    const allowed = decisions.filter((decision) => decision.allowed).length;

    expect(allowed).toBe(3);

    const rows = await prisma().blockchainRateLimit.findMany({
      where: { organizationId: auth.organizationId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(10);
  });

  it('starts a fresh window after the previous one closes', async () => {
    const firstWindow = new Date('2026-11-06T10:00:10.000Z');
    const secondWindow = new Date('2026-11-06T10:01:10.000Z');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await quota.consume(auth, firstWindow);
    }
    expect((await quota.consume(auth, firstWindow)).allowed).toBe(false);

    expect((await quota.consume(auth, secondWindow)).allowed).toBe(true);
  });

  it('refuses when the organization already has too many operations in flight', async () => {
    const capped = buildQuota({ BLOCKCHAIN_MAX_PENDING_OPERATIONS: 2 });

    for (let index = 0; index < 2; index += 1) {
      await prisma().blockchainOperation.create({
        data: {
          organizationId: auth.organizationId,
          kind: BlockchainOperationType.INVOICE_ANCHOR,
          status: BlockchainOperationStatus.SUBMITTED,
          idempotencyKey: `INVOICE_ANCHOR:${CONTRACT}:pending-${index}`,
          chainId: CHAIN_ID,
          contractAddress: CONTRACT,
          commitment: `0x${String(index).padStart(64, '0')}`,
          entityId: `0x${'e'.repeat(64)}`,
        },
      });
    }

    const decision = await capped.consume(auth);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    expect(decision.code).toBe('BLOCKCHAIN_PENDING_LIMIT_REACHED');
    expect(decision.details).toMatchObject({ limit: 2, pending: 2 });
  });

  it('does not count terminal operations against the pending cap', async () => {
    const capped = buildQuota({ BLOCKCHAIN_MAX_PENDING_OPERATIONS: 1 });

    for (const [index, status] of [
      BlockchainOperationStatus.CONFIRMED,
      BlockchainOperationStatus.FAILED,
      BlockchainOperationStatus.CANCELLED,
    ].entries()) {
      await prisma().blockchainOperation.create({
        data: {
          organizationId: auth.organizationId,
          kind: BlockchainOperationType.INVOICE_ANCHOR,
          status,
          idempotencyKey: `INVOICE_ANCHOR:${CONTRACT}:terminal-${index}`,
          chainId: CHAIN_ID,
          contractAddress: CONTRACT,
          commitment: `0x${String(index).padStart(64, '0')}`,
          entityId: `0x${'e'.repeat(64)}`,
        },
      });
    }

    expect((await capped.consume(auth)).allowed).toBe(true);
    expect(await capped.pendingCount(auth.organizationId)).toBe(0);
  });

  it('keeps each organization in its own window', async () => {
    const other = await prisma().organization.create({
      data: { name: 'Other Org', slug: 'other-org', countryCode: 'VN' },
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await quota.consume(auth);
    }
    expect((await quota.consume(auth)).allowed).toBe(false);

    expect(
      (await quota.consume({ ...auth, organizationId: other.id, organizationSlug: 'other-org' }))
        .allowed,
    ).toBe(true);
  });
});
