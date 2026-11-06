import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../src/database/prisma.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

/**
 * The quota as a client sees it.
 *
 * The chain is deliberately *not* configured here, and the invoice ids do not
 * exist. Both are the point: the guard runs before the handler, so the limit is
 * enforced without a node, a contract or a key, and a request that the handler
 * would reject still costs quota. Otherwise a caller could probe with garbage
 * ids for free and only pay on the attempts that succeed.
 *
 * The limit is 2 per minute so the third request is the interesting one.
 */

const WRITE_LIMIT = 2;

const MISSING_INVOICE = '01930000-0000-7000-8000-0000000000ff';
const MISSING_REQUEST = '01930000-0000-7000-8000-0000000000fe';

describe('Chain write quota over HTTP', () => {
  let app: INestApplication;
  let database: TestDatabase;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let token: string;
  let organizationId: string;

  beforeAll(async () => {
    database = await createTestDatabase();

    // Set before the dynamic import: `ConfigModule.forRoot({ validate })` runs
    // when `AppModule` is evaluated, not when the testing module is compiled.
    process.env.BLOCKCHAIN_WRITE_LIMIT = String(WRITE_LIMIT);
    process.env.BLOCKCHAIN_WRITE_WINDOW_SECONDS = '60';
    process.env.BLOCKCHAIN_MAX_PENDING_OPERATIONS = '25';
    process.env.BLOCKCHAIN_RECONCILE_INTERVAL_MS = '0';
    delete process.env.VERITRADE_CONTRACT_ADDRESS;

    const { AppModule } = await import('../src/app.module.js');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(database.prisma)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    const { configureApp } = await import('../src/app.setup.js');
    configureApp(app);
    await app.init();

    server = app.getHttpServer();

    const registration = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'quota-http@example.test',
        displayName: 'Quota HTTP',
        password: 'a-long-test-password',
        organizationName: 'Quota HTTP Org',
        organizationCountry: 'VN',
      })
      .expect(201);

    token = registration.body.accessToken as string;
    organizationId = registration.body.organization.id as string;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  function anchor() {
    return request(server)
      .post(`/api/v1/invoices/${MISSING_INVOICE}/anchor`)
      .set('Authorization', `Bearer ${token}`);
  }

  function anchorStatus() {
    return request(server)
      .get(`/api/v1/invoices/${MISSING_INVOICE}/anchor-status`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function windowCount(): Promise<number> {
    const rows = await database.prisma.blockchainRateLimit.findMany({
      where: { organizationId },
    });
    return rows.reduce((total, row) => total + row.count, 0);
  }

  it('lets the first writes through and refuses the one after the limit', async () => {
    // 404, because the invoice does not exist. The guard still charged the
    // request: quota is spent on the attempt, not on the outcome, so a caller
    // cannot dodge the limit by sending ids that resolve to nothing.
    await anchor().expect(404);
    await anchor().expect(404);

    const refused = await anchor().expect(429);

    expect(refused.body.code).toBe('BLOCKCHAIN_RATE_LIMITED');
    expect(refused.headers['retry-after']).toBeDefined();
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.body.details).toMatchObject({ limit: WRITE_LIMIT });
  });

  it('records the refusal in the audit log', async () => {
    const events = await database.prisma.auditLog.findMany({
      where: { organizationId, action: 'blockchain.write.rate_limited' },
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.entityType).toBe('blockchain_quota');
  });

  it('does not charge status polling', async () => {
    const before = await windowCount();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      // 404, because the invoice does not exist — but never 429, and never
      // charged. Polling is how a client learns the outcome of a write it has
      // already paid for.
      await anchorStatus().expect(404);
    }

    expect(await windowCount()).toBe(before);
  });

  it('does not charge the transaction lookup either', async () => {
    const before = await windowCount();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .get(`/api/v1/blockchain/transactions/${MISSING_INVOICE}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    }

    expect(await windowCount()).toBe(before);
  });

  it('applies the same quota to the financing lifecycle routes', async () => {
    const before = await windowCount();

    // The window is still exhausted from the first test, so these are refused
    // by the guard before the handler can answer 404.
    const response = await request(server)
      .post(`/api/v1/financing-requests/${MISSING_REQUEST}/reserve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(429);

    expect(response.body.code).toBe('BLOCKCHAIN_RATE_LIMITED');
    expect(await windowCount()).toBeGreaterThan(before);
  });

  it('requires authentication before it meters anything', async () => {
    const before = await windowCount();

    await request(server).post(`/api/v1/invoices/${MISSING_INVOICE}/anchor`).expect(401);

    // An unauthenticated caller has no organization to charge, and answering
    // 429 would tell them the endpoint exists.
    expect(await windowCount()).toBe(before);
  });
});
