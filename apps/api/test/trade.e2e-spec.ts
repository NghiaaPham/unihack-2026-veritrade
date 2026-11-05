import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

const TRADE = {
  reference: 'TRD-0001',
  buyerAddress: '0x1111111111111111111111111111111111111111',
  sellerAddress: '0x2222222222222222222222222222222222222222',
  asset: 'USDC',
  amount: '1000.000000000000000001',
};

const INVALID_PAYLOADS: Array<[label: string, overrides: Record<string, unknown>]> = [
  ['a non-hex buyer address', { buyerAddress: '0xnot-an-address' }],
  ['a short seller address', { sellerAddress: '0x1234' }],
  ['a zero amount', { amount: '0' }],
  ['a zero decimal amount', { amount: '0.000' }],
  ['a negative amount', { amount: '-5' }],
  ['nineteen fraction digits', { amount: '1.0000000000000000001' }],
  ['a non-numeric amount', { amount: 'ten' }],
  ['an empty reference', { reference: '' }],
  ['a 65-character reference', { reference: 'x'.repeat(65) }],
  ['a 17-character asset', { asset: 'x'.repeat(17) }],
  ['a missing amount', { amount: undefined }],
  ['a fractional chainId', { chainId: 1.5 }],
  ['a zero chainId', { chainId: 0 }],
];

const INVALID_QUERIES: Array<[label: string, query: string]> = [
  ['an unknown status', '?status=refunded'],
  ['a limit above the cap', '?limit=101'],
  ['a limit of zero', '?limit=0'],
  ['a negative offset', '?offset=-1'],
  ['a non-numeric limit', '?limit=abc'],
];

describe('Trade API', () => {
  let app: INestApplication;
  let database: TestDatabase;

  const http = () => request(app.getHttpServer());
  const createTrade = (body: Record<string, unknown> = {}) =>
    http()
      .post('/api/trades')
      .send({ ...TRADE, ...body });

  beforeAll(async () => {
    database = await createTestDatabase();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Swap the production client for one pointed at the in-process database.
      // It is a real PrismaClient, so every query below runs through the same
      // Prisma engine and SQL generation that production uses.
      .overrideProvider(PrismaService)
      .useValue(database.prisma)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    await database.reset();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  describe('POST /api/trades', () => {
    it('creates a trade and applies server-side defaults', async () => {
      const response = await createTrade().expect(201);

      expect(response.body).toMatchObject({
        reference: TRADE.reference,
        buyerAddress: TRADE.buyerAddress,
        sellerAddress: TRADE.sellerAddress,
        asset: TRADE.asset,
        amount: TRADE.amount,
        status: 'draft',
        chainId: 43113,
        settlementTxHash: null,
        settledAt: null,
      });
      expect(response.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(response.body.createdAt).toBeDefined();
    });

    it('preserves the exact decimal amount as a string', async () => {
      const response = await createTrade({ amount: '1234.123456789012345678' }).expect(201);

      expect(response.body.amount).toBe('1234.123456789012345678');
    });

    it('lowercases mixed-case addresses', async () => {
      const response = await createTrade({
        buyerAddress: '0xAbCdEf0000000000000000000000000000000001',
        sellerAddress: '0xAbCdEf0000000000000000000000000000000002',
      }).expect(201);

      expect(response.body.buyerAddress).toBe('0xabcdef0000000000000000000000000000000001');
      expect(response.body.sellerAddress).toBe('0xabcdef0000000000000000000000000000000002');
    });

    it('accepts an explicit chainId', async () => {
      const response = await createTrade({ chainId: 43114 }).expect(201);

      expect(response.body.chainId).toBe(43114);
    });

    it('rejects a duplicate reference with 409', async () => {
      await createTrade().expect(201);
      const response = await createTrade().expect(409);

      expect(response.body.message).toContain(TRADE.reference);
    });

    for (const [label, overrides] of INVALID_PAYLOADS) {
      it(`rejects ${label} with 400`, async () => {
        await createTrade(overrides).expect(400);
      });
    }

    it('rejects unknown properties with 400 instead of dropping them', async () => {
      const response = await createTrade({ typo: 'value' }).expect(400);

      expect(JSON.stringify(response.body.message)).toContain('typo');
    });

    it('does not persist a trade when validation fails', async () => {
      await createTrade({ amount: '0' }).expect(400);

      const list = await http().get('/api/trades').expect(200);
      expect(list.body.total).toBe(0);
    });
  });

  describe('GET /api/trades', () => {
    it('returns an empty page when there are no trades', async () => {
      const response = await http().get('/api/trades').expect(200);

      expect(response.body).toEqual({ data: [], total: 0 });
    });

    it('returns trades newest first', async () => {
      await createTrade({ reference: 'TRD-A' }).expect(201);
      await createTrade({ reference: 'TRD-B' }).expect(201);
      await createTrade({ reference: 'TRD-C' }).expect(201);

      const response = await http().get('/api/trades').expect(200);

      expect(response.body.total).toBe(3);
      expect(response.body.data.map((t: { reference: string }) => t.reference)).toEqual([
        'TRD-C',
        'TRD-B',
        'TRD-A',
      ]);
    });

    it('filters by status', async () => {
      await createTrade().expect(201);

      const draft = await http().get('/api/trades?status=draft').expect(200);
      expect(draft.body.total).toBe(1);

      const settled = await http().get('/api/trades?status=settled').expect(200);
      expect(settled.body).toEqual({ data: [], total: 0 });
    });

    it('paginates without changing the total', async () => {
      await createTrade({ reference: 'TRD-1' }).expect(201);
      await createTrade({ reference: 'TRD-2' }).expect(201);
      await createTrade({ reference: 'TRD-3' }).expect(201);

      const firstPage = await http().get('/api/trades?limit=2&offset=0').expect(200);
      expect(firstPage.body.data).toHaveLength(2);
      expect(firstPage.body.total).toBe(3);

      const secondPage = await http().get('/api/trades?limit=2&offset=2').expect(200);
      expect(secondPage.body.data).toHaveLength(1);
      expect(secondPage.body.total).toBe(3);

      const references = [...firstPage.body.data, ...secondPage.body.data].map(
        (t: { reference: string }) => t.reference,
      );
      expect(new Set(references).size).toBe(3);
    });

    for (const [label, query] of INVALID_QUERIES) {
      it(`rejects ${label} with 400`, async () => {
        await http().get(`/api/trades${query}`).expect(400);
      });
    }
  });

  describe('GET /api/trades/:id', () => {
    it('returns a single trade', async () => {
      const created = await createTrade().expect(201);

      const response = await http().get(`/api/trades/${created.body.id}`).expect(200);
      expect(response.body.id).toBe(created.body.id);
    });

    it('rejects a malformed uuid with 400', async () => {
      await http().get('/api/trades/not-a-uuid').expect(400);
    });

    it('returns 404 for an unknown uuid', async () => {
      const response = await http()
        .get('/api/trades/11111111-1111-4111-8111-111111111111')
        .expect(404);

      expect(response.body.message).toContain('11111111-1111-4111-8111-111111111111');
    });
  });

  describe('health endpoint routing', () => {
    it('serves /health at the root and not under /api', async () => {
      await http().get('/health').expect(200);
      await http().get('/api/health').expect(404);
    });
  });
});
