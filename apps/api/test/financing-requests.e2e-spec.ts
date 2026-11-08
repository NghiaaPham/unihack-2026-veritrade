import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../src/database/prisma.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

/**
 * Financing request read and create routes over HTTP.
 *
 * The chain is deliberately not configured: these routes never send a
 * transaction, and the quota test below depends on that. The write limit is 2
 * so that any metering of a read or create route would show up immediately.
 */

const WRITE_LIMIT = 2;
const INVOICE_AMOUNT = '1650000';
const MISSING_ID = '01930000-0000-7000-8000-0000000000ff';

interface Account {
  token: string;
  organizationId: string;
  userId: string;
}

describe('Financing requests API', () => {
  let app: INestApplication;
  let database: TestDatabase;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let invoiceCounter = 0;

  function as(token: string) {
    return {
      post: (path: string) => request(server).post(path).set('Authorization', `Bearer ${token}`),
      get: (path: string) => request(server).get(path).set('Authorization', `Bearer ${token}`),
    };
  }

  async function register(label: string): Promise<Account> {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: `${label}@example.test`,
        displayName: label,
        password: 'a-long-test-password',
        organizationName: `${label} organisation`,
        organizationCountry: 'VN',
      })
      .expect(201);

    return {
      token: response.body.accessToken as string,
      organizationId: response.body.organization.id as string,
      userId: response.body.user.id as string,
    };
  }

  /** Metadata-only invoices verify as PARTIAL, the strongest verdict reachable today. */
  async function createInvoice(
    token: string,
    overrides: Record<string, string> = {},
  ): Promise<string> {
    invoiceCounter += 1;

    const response = await as(token)
      .post('/api/v1/invoices')
      .send({
        invoiceSeries: 'C25TAA',
        invoiceNumber: String(invoiceCounter),
        invoiceType: '1',
        sellerName: 'Công ty TNHH Vận tải Northwind',
        sellerTaxId: '0101234567',
        buyerName: 'Công ty Cổ phần Bán lẻ Minh Anh',
        buyerTaxId: '0107654321',
        currency: 'VND',
        amount: INVOICE_AMOUNT,
        subtotalAmount: '1500000',
        taxAmount: '150000',
        issueDate: '2026-09-01',
        ...overrides,
      })
      .expect(201);

    return response.body.id as string;
  }

  function body(invoiceId: string, overrides: Record<string, unknown> = {}) {
    return {
      invoiceId,
      requestedAmount: '1000000',
      termDays: 60,
      interestRateBps: 1200,
      purpose: 'Vốn lưu động cho đơn hàng quý 4',
      ...overrides,
    };
  }

  function create(token: string, payload: unknown) {
    return as(token)
      .post('/api/v1/financing-requests')
      .send(payload as object);
  }

  async function windowCount(organizationId: string): Promise<number> {
    const rows = await database.prisma.blockchainRateLimit.findMany({ where: { organizationId } });
    return rows.reduce((total, row) => total + row.count, 0);
  }

  beforeAll(async () => {
    database = await createTestDatabase();

    // Before the dynamic import: config validation runs when `AppModule` loads.
    process.env.BLOCKCHAIN_WRITE_LIMIT = String(WRITE_LIMIT);
    process.env.BLOCKCHAIN_WRITE_WINDOW_SECONDS = '60';
    process.env.BLOCKCHAIN_MAX_PENDING_OPERATIONS = '25';
    process.env.BLOCKCHAIN_RECONCILE_INTERVAL_MS = '0';
    delete process.env.VERITRADE_CONTRACT_ADDRESS;

    const { AppModule } = await import('../src/app.module.js');
    const { configureApp } = await import('../src/app.setup.js');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(database.prisma)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    server = app.getHttpServer();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  describe('authorization', () => {
    it('rejects every route without a token', async () => {
      await request(server).get('/api/v1/financing-requests').expect(401);
      await request(server).get(`/api/v1/financing-requests/${MISSING_ID}`).expect(401);
      await request(server).post('/api/v1/financing-requests').send({}).expect(401);
    });
  });

  describe('create', () => {
    let account: Account;

    beforeAll(async () => {
      account = await register('fr-create');
    });

    it('creates a REQUESTED request and returns the contract shape', async () => {
      const invoiceId = await createInvoice(account.token);

      const response = await create(account.token, body(invoiceId)).expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        organizationId: account.organizationId,
        invoiceId,
        requestedById: account.userId,
        requestedAmount: '1000000',
        currency: 'VND',
        status: 'REQUESTED',
        termDays: 60,
        interestRateBps: 1200,
        purpose: 'Vốn lưu động cho đơn hàng quý 4',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        invoice: {
          id: invoiceId,
          invoiceSeries: 'C25TAA',
          invoiceNumber: expect.any(String),
          sellerName: 'Công ty TNHH Vận tải Northwind',
          sellerTaxId: '0101234567',
          buyerName: 'Công ty Cổ phần Bán lẻ Minh Anh',
          amount: INVOICE_AMOUNT,
          currency: 'VND',
          issueDate: '2026-09-01',
          dueDate: null,
          status: 'SUBMITTED',
        },
      });

      const row = await database.prisma.financingRequest.findUniqueOrThrow({
        where: { id: response.body.id as string },
      });
      expect(row.activeKey).toBe('ACTIVE');

      // The invoice status is left alone: nothing else moves it, and a cancelled
      // or rejected request would have no path back.
      const invoice = await database.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.status).toBe('SUBMITTED');
    });

    it('normalises the amount the way invoice amounts are normalised', async () => {
      const invoiceId = await createInvoice(account.token);

      const response = await create(
        account.token,
        body(invoiceId, { requestedAmount: '1000.500000' }),
      ).expect(201);

      expect(response.body.requestedAmount).toBe('1000.5');
    });

    it('writes an audit entry without the request contents', async () => {
      const invoiceId = await createInvoice(account.token);
      const response = await create(account.token, body(invoiceId)).expect(201);

      const entries = await database.prisma.auditLog.findMany({
        where: {
          organizationId: account.organizationId,
          action: 'financing_request.created',
          entityId: response.body.id as string,
        },
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorUserId: account.userId,
        entityType: 'financing_request',
        metadata: { invoiceId, status: 'REQUESTED' },
      });
    });

    it('rejects unknown and client-controlled fields', async () => {
      const invoiceId = await createInvoice(account.token);

      for (const extra of [
        { status: 'APPROVED' },
        { organizationId: account.organizationId },
        { currency: 'USD' },
        { requestedById: account.userId },
        { activeKey: null },
      ]) {
        const response = await create(account.token, { ...body(invoiceId), ...extra }).expect(400);
        expect(response.body.statusCode).toBe(400);
      }
    });

    it('rejects malformed fields', async () => {
      const invoiceId = await createInvoice(account.token);

      const invalid: Record<string, unknown>[] = [
        { requestedAmount: 'abc' },
        { requestedAmount: '-5' },
        { requestedAmount: '0' },
        { requestedAmount: '0.000' },
        { requestedAmount: '1,000' },
        { requestedAmount: '1.0000000000000000001' },
        { requestedAmount: 1000 },
        { termDays: 0 },
        { termDays: 366 },
        { termDays: 1.5 },
        { interestRateBps: -1 },
        { interestRateBps: 10001 },
        { purpose: '' },
        { purpose: 'x'.repeat(281) },
        { invoiceId: 'not-a-uuid' },
      ];

      for (const override of invalid) {
        await create(account.token, body(invoiceId, override)).expect(400);
      }

      for (const missing of [
        'invoiceId',
        'requestedAmount',
        'termDays',
        'interestRateBps',
        'purpose',
      ]) {
        const payload: Record<string, unknown> = body(invoiceId);
        delete payload[missing];
        await create(account.token, payload).expect(400);
      }
    });

    it('accepts the boundary values', async () => {
      const invoiceId = await createInvoice(account.token);

      const response = await create(
        account.token,
        body(invoiceId, {
          requestedAmount: '0.000000000000000001',
          termDays: 365,
          interestRateBps: 0,
          purpose: 'x'.repeat(280),
        }),
      ).expect(201);

      // Exponent notation (`1e-18`) would be parsed as a float by a client.
      expect(response.body.requestedAmount).toBe('0.000000000000000001');
    });

    it('refuses an amount above the invoice amount, comparing as decimals', async () => {
      const invoiceId = await createInvoice(account.token);

      const response = await create(
        account.token,
        body(invoiceId, { requestedAmount: '1650000.000000000000000001' }),
      ).expect(400);

      expect(response.body.code).toBe('REQUESTED_AMOUNT_EXCEEDS_INVOICE');

      // A float comparison would see both of these as 1650000 and let the first
      // through; as decimals only the exact amount fits.
      await create(account.token, body(invoiceId, { requestedAmount: '1650000.5' })).expect(400);
      await create(
        account.token,
        body(invoiceId, { requestedAmount: '1650000.000000000000000000' }),
      ).expect(201);
    });

    it('returns 404 for an invoice that does not exist', async () => {
      const response = await create(account.token, body(MISSING_ID)).expect(404);

      expect(response.body.code).toBe('INVOICE_NOT_FOUND');
    });

    it("returns 404, not 403, for another organization's invoice", async () => {
      const other = await register('fr-create-other');
      const foreignInvoice = await createInvoice(other.token);

      const response = await create(account.token, body(foreignInvoice)).expect(404);

      expect(response.body.code).toBe('INVOICE_NOT_FOUND');
      expect(
        await database.prisma.financingRequest.count({ where: { invoiceId: foreignInvoice } }),
      ).toBe(0);
    });

    it('returns 409 when the latest verification failed', async () => {
      // Subtotal + tax does not add up to the total, so the arithmetic check fails.
      const invoiceId = await createInvoice(account.token, {
        subtotalAmount: '1000000',
        taxAmount: '100000',
      });

      const response = await create(account.token, body(invoiceId)).expect(409);

      expect(response.body.code).toBe('INVOICE_NOT_VERIFIED');
      expect(response.body.details).toMatchObject({ invoiceId, verificationStatus: 'FAILED' });
    });

    it('returns 409 when the invoice has no verification run', async () => {
      const invoiceId = await createInvoice(account.token);
      await database.prisma.invoiceVerification.deleteMany({ where: { invoiceId } });

      const response = await create(account.token, body(invoiceId)).expect(409);

      expect(response.body.code).toBe('INVOICE_NOT_VERIFIED');
    });

    it('returns 409 for a second active request on the same invoice', async () => {
      const invoiceId = await createInvoice(account.token);
      await create(account.token, body(invoiceId)).expect(201);

      const response = await create(account.token, body(invoiceId)).expect(409);

      expect(response.body.code).toBe('FINANCING_REQUEST_ACTIVE');
      expect(await database.prisma.financingRequest.count({ where: { invoiceId } })).toBe(1);
    });

    it('lets exactly one of two concurrent requests win', async () => {
      const invoiceId = await createInvoice(account.token);

      const results = await Promise.all([
        create(account.token, body(invoiceId)),
        create(account.token, body(invoiceId)),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(await database.prisma.financingRequest.count({ where: { invoiceId } })).toBe(1);
    });

    it('allows a new request once the previous one is terminal', async () => {
      const invoiceId = await createInvoice(account.token);
      const first = await create(account.token, body(invoiceId)).expect(201);

      // The terminal-state write is the approval workflow's job (Phase 3); this
      // is the state it will leave behind.
      await database.prisma.financingRequest.update({
        where: { id: first.body.id as string },
        data: { status: 'REJECTED', activeKey: null },
      });

      await create(account.token, body(invoiceId)).expect(201);
    });
  });

  describe('roles', () => {
    it('forbids a VIEWER from creating but lets them read', async () => {
      const account = await register('fr-viewer');
      const invoiceId = await createInvoice(account.token);
      const created = await create(account.token, body(invoiceId)).expect(201);
      const spare = await createInvoice(account.token);

      await database.prisma.organizationMembership.updateMany({
        where: { organizationId: account.organizationId },
        data: { role: 'VIEWER' },
      });

      const response = await create(account.token, body(spare)).expect(403);
      expect(response.body.statusCode).toBe(403);
      expect(await database.prisma.financingRequest.count({ where: { invoiceId: spare } })).toBe(0);

      await as(account.token).get('/api/v1/financing-requests').expect(200);
      await as(account.token)
        .get(`/api/v1/financing-requests/${created.body.id as string}`)
        .expect(200);
    });

    it.each(['ADMIN', 'MEMBER'] as const)('lets a %s create', async (role) => {
      const account = await register(`fr-${role.toLowerCase()}`);
      await database.prisma.organizationMembership.updateMany({
        where: { organizationId: account.organizationId },
        data: { role },
      });

      await create(account.token, body(await createInvoice(account.token))).expect(201);
    });
  });

  describe('read', () => {
    let alice: Account;
    let bob: Account;
    const aliceIds: string[] = [];
    const aliceInvoices: string[] = [];
    let bobRequestId: string;

    beforeAll(async () => {
      alice = await register('fr-read-alice');
      bob = await register('fr-read-bob');

      // Sequential on purpose: `createdAt` order is what the pagination test asserts.
      for (let index = 0; index < 3; index += 1) {
        const invoiceId = await createInvoice(alice.token);
        const response = await create(alice.token, body(invoiceId)).expect(201);
        aliceInvoices.push(invoiceId);
        aliceIds.push(response.body.id as string);
      }

      await database.prisma.financingRequest.update({
        where: { id: aliceIds[0] as string },
        data: { status: 'CANCELLED', activeKey: null },
      });

      const bobInvoice = await createInvoice(bob.token);
      bobRequestId = (await create(bob.token, body(bobInvoice)).expect(201)).body.id as string;
    });

    it('lists only the caller organization, newest first, with the invoice embedded', async () => {
      const response = await as(alice.token).get('/api/v1/financing-requests').expect(200);

      expect(response.body.pagination).toEqual({ total: 3, limit: 20, offset: 0 });
      expect(response.body.items.map((item: { id: string }) => item.id)).toEqual(
        [...aliceIds].reverse(),
      );
      expect(response.body.items.map((item: { id: string }) => item.id)).not.toContain(
        bobRequestId,
      );
      for (const item of response.body.items as {
        organizationId: string;
        invoice: { id: string };
      }[]) {
        expect(item.organizationId).toBe(alice.organizationId);
        expect(aliceInvoices).toContain(item.invoice.id);
      }
    });

    it('returns an empty page for an organization with no requests', async () => {
      const empty = await register('fr-read-empty');

      const response = await as(empty.token).get('/api/v1/financing-requests').expect(200);

      expect(response.body).toEqual({ items: [], pagination: { total: 0, limit: 20, offset: 0 } });
    });

    it('filters by status and by invoice', async () => {
      const cancelled = await as(alice.token)
        .get('/api/v1/financing-requests?status=CANCELLED')
        .expect(200);
      expect(cancelled.body.items.map((item: { id: string }) => item.id)).toEqual([aliceIds[0]]);

      const active = await as(alice.token)
        .get('/api/v1/financing-requests?status=REQUESTED')
        .expect(200);
      expect(active.body.pagination.total).toBe(2);

      const byInvoice = await as(alice.token)
        .get(`/api/v1/financing-requests?invoiceId=${aliceInvoices[1] as string}`)
        .expect(200);
      expect(byInvoice.body.items.map((item: { id: string }) => item.id)).toEqual([aliceIds[1]]);

      // Another tenant's invoice id is not an oracle: it simply matches nothing.
      const foreign = await as(bob.token)
        .get(`/api/v1/financing-requests?invoiceId=${aliceInvoices[1] as string}`)
        .expect(200);
      expect(foreign.body.items).toEqual([]);
    });

    it('paginates', async () => {
      const first = await as(alice.token).get('/api/v1/financing-requests?limit=2').expect(200);
      const second = await as(alice.token)
        .get('/api/v1/financing-requests?limit=2&offset=2')
        .expect(200);

      expect(first.body.pagination).toEqual({ total: 3, limit: 2, offset: 0 });
      expect(second.body.pagination).toEqual({ total: 3, limit: 2, offset: 2 });
      expect(
        [...first.body.items, ...second.body.items].map((item: { id: string }) => item.id),
      ).toEqual([...aliceIds].reverse());
    });

    it('rejects invalid query parameters', async () => {
      for (const query of [
        'limit=0',
        'limit=101',
        'limit=abc',
        'offset=-1',
        'status=NOPE',
        'invoiceId=not-a-uuid',
        'organizationId=x',
      ]) {
        await as(alice.token).get(`/api/v1/financing-requests?${query}`).expect(400);
      }
    });

    it('gets one request by id', async () => {
      const response = await as(alice.token)
        .get(`/api/v1/financing-requests/${aliceIds[1] as string}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: aliceIds[1],
        invoiceId: aliceInvoices[1],
        status: 'REQUESTED',
        invoice: { id: aliceInvoices[1], amount: INVOICE_AMOUNT },
      });
    });

    it("returns 404 for another organization's request and for malformed ids", async () => {
      const crossTenant = await as(alice.token)
        .get(`/api/v1/financing-requests/${bobRequestId}`)
        .expect(404);
      expect(crossTenant.body.code).toBe('FINANCING_REQUEST_NOT_FOUND');

      await as(alice.token).get(`/api/v1/financing-requests/${MISSING_ID}`).expect(404);
      await as(alice.token).get('/api/v1/financing-requests/not-a-uuid').expect(404);
    });
  });

  describe('chain quota', () => {
    it('does not meter read or create routes, while chain routes still are', async () => {
      const account = await register('fr-quota');
      const invoiceId = await createInvoice(account.token);
      const before = await windowCount(account.organizationId);

      // Well past the limit of 2: any metering would have produced a 429.
      const created = await create(account.token, body(invoiceId)).expect(201);
      for (let attempt = 0; attempt < WRITE_LIMIT + 3; attempt += 1) {
        await as(account.token).get('/api/v1/financing-requests').expect(200);
        await as(account.token)
          .get(`/api/v1/financing-requests/${created.body.id as string}`)
          .expect(200);
      }
      await create(account.token, body(invoiceId)).expect(409);
      await create(account.token, body(MISSING_ID)).expect(404);

      expect(await windowCount(account.organizationId)).toBe(before);

      // Control: the lifecycle routes on the same path prefix are still charged.
      await as(account.token)
        .post(`/api/v1/financing-requests/${created.body.id as string}/reserve`)
        .expect((response) => expect(response.status).not.toBe(429));
      expect(await windowCount(account.organizationId)).toBe(before + 1);
    });
  });
});
