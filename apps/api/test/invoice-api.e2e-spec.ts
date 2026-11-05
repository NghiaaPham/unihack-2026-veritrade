import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

const STORAGE_DIR = join(process.cwd(), process.env.INVOICE_STORAGE_DIR ?? 'var/test-invoices');

function fixture(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`./fixtures/invoices/${name}`, import.meta.url)));
}

/** The TT78 fixture with a different invoice number, so its blob is unique. */
function tt78WithNumber(number: string): Buffer {
  return Buffer.from(
    fixture('tt78-valid.xml')
      .toString('utf8')
      .replace('<SHDon>0000123</SHDon>', `<SHDon>${number}</SHDon>`),
    'utf8',
  );
}

interface Account {
  token: string;
  organizationId: string;
}

interface VerificationBody {
  status: string;
  scope: string;
  provider: string;
  score: number | null;
  limitations: string[];
  checks: { key: string; label: string; status: string; message: string; details: unknown }[];
}

describe('Invoice API', () => {
  let app: INestApplication;
  let database: TestDatabase;
  let server: ReturnType<INestApplication['getHttpServer']>;

  /** A supertest client bound to one bearer token. */
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
    };
  }

  function upload(
    token: string,
    body: Buffer,
    filename = 'invoice.xml',
    fields: Record<string, string> = {},
  ) {
    let pending = as(token).post('/api/v1/invoices/upload');

    for (const [key, value] of Object.entries(fields)) {
      pending = pending.field(key, value);
    }

    return pending.attach('file', body, filename);
  }

  function statusOf(verification: VerificationBody, key: string): string | undefined {
    return verification.checks.find((check) => check.key === key)?.status;
  }

  beforeAll(async () => {
    database = await createTestDatabase();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(database.prisma)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe('authorization', () => {
    it('rejects every invoice endpoint without a token', async () => {
      for (const path of [
        '/api/v1/invoices',
        '/api/v1/invoices/01930000-0000-7000-8000-000000000001',
      ]) {
        const response = await request(server).get(path).expect(401);

        expect(response.body.code).toBe('UNAUTHORIZED');
      }

      await request(server).post('/api/v1/invoices').send({}).expect(401);
      await request(server).post('/api/v1/invoices/upload').expect(401);
    });

    it('rejects a token signed with a different secret', async () => {
      // Well-formed JWT, wrong signature: the classic "I edited the payload"
      // attempt. The header is the only part a client controls.
      const forged =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4Iiwib3JnIjoieSJ9.' +
        'not-a-valid-signature';

      await request(server)
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // Structured creation
  // -------------------------------------------------------------------------

  describe('POST /api/v1/invoices', () => {
    let account: Account;

    const body = {
      invoiceSeries: 'C25MTA',
      invoiceNumber: '1',
      invoiceType: '1',
      invoiceTypeName: 'Hóa đơn giá trị gia tăng',
      sellerName: 'Công ty TNHH Vận tải Northwind',
      sellerTaxId: '0101234567',
      buyerName: 'Công ty Cổ phần Bán lẻ Minh Anh',
      buyerTaxId: '0107654321',
      currency: 'VND',
      amount: '1100000',
      subtotalAmount: '1000000',
      taxAmount: '100000',
      issueDate: '2026-09-01',
    };

    beforeAll(async () => {
      account = await register('metadata');
    });

    it('creates an invoice and returns a locally-verified result', async () => {
      const response = await as(account.token).post('/api/v1/invoices').send(body).expect(201);

      expect(response.body).toMatchObject({
        organizationId: account.organizationId,
        status: 'SUBMITTED',
        invoiceSeries: 'C25MTA',
        invoiceNumber: '1',
        sellerTaxId: '0101234567',
        buyerTaxId: '0107654321',
        currency: 'VND',
        amount: '1100000',
        subtotalAmount: '1000000',
        taxAmount: '100000',
        issueDate: '2026-09-01',
        dueDate: null,
        document: null,
      });
      expect(response.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(response.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(response.body.lastVerifiedAt).toEqual(expect.any(String));

      const verification = response.body.verification as VerificationBody;

      // Every check that needs a document is honestly reported as not run, so
      // the summary cannot be PASSED.
      expect(verification.status).toBe('PARTIAL');
      expect(verification.scope).toBe('LOCAL_CHECKS_ONLY');
      expect(verification.provider).toBe('local-checks-v1');
      expect(verification.score).toBeNull();
      expect(statusOf(verification, 'xml.structure')).toBe('SKIPPED');
      expect(statusOf(verification, 'fields.required')).toBe('PASSED');
      expect(statusOf(verification, 'arithmetic.totals')).toBe('PASSED');
      expect(statusOf(verification, 'duplicate.detection')).toBe('PASSED');
      expect(statusOf(verification, 'signature.xmldsig')).toBe('NOT_CHECKED');
      expect(statusOf(verification, 'authority.tax')).toBe('UNSUPPORTED');
      expect(verification.limitations.length).toBeGreaterThanOrEqual(3);
    });

    it('rejects the same invoice a second time as a duplicate', async () => {
      const response = await as(account.token).post('/api/v1/invoices').send(body).expect(409);

      expect(response.body.code).toBe('DUPLICATE_INVOICE');
      expect(response.body.details.invoiceId).toEqual(expect.any(String));
    });

    it('rejects the same identity with different content as a conflict', async () => {
      // Same seller, series, number and template; a different total. This is
      // the shape of a re-issued invoice being presented as if it were new.
      const response = await as(account.token)
        .post('/api/v1/invoices')
        .send({ ...body, amount: '1200000', subtotalAmount: '1100000' })
        .expect(409);

      expect(response.body.code).toBe('CONFLICTING_INVOICE');
    });

    it('rejects an impossible calendar date', async () => {
      // `2026-02-31` matches the DTO's shape check but is not a day.
      const response = await as(account.token)
        .post('/api/v1/invoices')
        .send({ ...body, invoiceNumber: '99', issueDate: '2026-02-31' })
        .expect(400);

      expect(response.body.code).toBe('INVALID_REQUEST');
      expect(response.body.message).toContain('calendar date');
    });

    it('rejects unknown properties instead of ignoring them', async () => {
      const response = await as(account.token)
        .post('/api/v1/invoices')
        .send({ ...body, invoiceNumber: '98', legalProof: 'trust me' })
        .expect(400);

      expect(response.body.code).toBe('BAD_REQUEST');
    });

    it('rejects a zero amount', async () => {
      await as(account.token)
        .post('/api/v1/invoices')
        .send({ ...body, invoiceNumber: '97', amount: '0' })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // XML upload
  // -------------------------------------------------------------------------

  describe('POST /api/v1/invoices/upload', () => {
    let account: Account;

    beforeAll(async () => {
      account = await register('uploads');
    });

    it('accepts a TT78 document and extracts the business fields', async () => {
      const response = await upload(account.token, fixture('tt78-valid.xml'), 'tt78.xml').expect(
        201,
      );

      expect(response.body).toMatchObject({
        invoiceSeries: 'C25TAA',
        invoiceNumber: '123',
        invoiceType: '1',
        invoiceTypeName: 'Hóa đơn giá trị gia tăng',
        sellerName: 'Công ty TNHH Vận tải Northwind',
        sellerTaxId: '0101234567',
        buyerName: 'Công ty Cổ phần Bán lẻ Minh Anh',
        buyerTaxId: '0107654321',
        currency: 'VND',
        amount: '1650000',
        subtotalAmount: '1500000',
        taxAmount: '150000',
        issueDate: '2026-09-01',
        status: 'SUBMITTED',
      });

      expect(response.body.document).toMatchObject({
        filename: 'tt78.xml',
        format: 'TT78_2021',
        parserVersion: '1.0.0',
        byteSize: fixture('tt78-valid.xml').byteLength,
      });
      expect(response.body.document.contentSha256).toMatch(/^[0-9a-f]{64}$/);

      const verification = response.body.verification as VerificationBody;

      expect(verification.status).toBe('PARTIAL');
      expect(statusOf(verification, 'xml.structure')).toBe('PASSED');
      expect(statusOf(verification, 'arithmetic.totals')).toBe('PASSED');
      expect(statusOf(verification, 'signature.xmldsig')).toBe('NOT_CHECKED');
      expect(statusOf(verification, 'authority.tax')).toBe('UNSUPPORTED');
    });

    it('rejects the same document uploaded again', async () => {
      const response = await upload(account.token, fixture('tt78-valid.xml')).expect(409);

      expect(response.body.code).toBe('DUPLICATE_INVOICE');
    });

    it('accepts the TT32 profile', async () => {
      const response = await upload(account.token, fixture('tt32-valid.xml')).expect(201);

      expect(response.body.document.format).toBe('TT32_2011');
      expect(response.body).toMatchObject({
        invoiceSeries: 'AA25E',
        invoiceNumber: '42',
        amount: '1080000',
      });
    });

    it('rejects a malformed document', async () => {
      const response = await upload(account.token, fixture('malformed.xml')).expect(422);

      expect(response.body.code).toBe('INVALID_INVOICE_DOCUMENT');
    });

    it('rejects a document with a DOCTYPE before parsing it', async () => {
      const response = await upload(account.token, fixture('xxe.xml')).expect(422);

      expect(response.body.code).toBe('INVALID_INVOICE_DOCUMENT');
      expect(response.body.message).toContain('DOCTYPE');
      // If the entity had been resolved, the invoice number would have been
      // the contents of /etc/passwd. Nothing from the document is echoed.
      expect(JSON.stringify(response.body)).not.toContain('root:');
    });

    it('reports an unsupported format instead of guessing', async () => {
      const response = await upload(account.token, fixture('ubl-unsupported.xml')).expect(422);

      expect(response.body.code).toBe('UNSUPPORTED_INVOICE_FORMAT');
      expect(response.body.details).toMatchObject({
        rootElement: 'Invoice',
        supportedFormats: ['TT78_2021', 'TT32_2011'],
      });
    });

    it('rejects a document without an invoice identity', async () => {
      const response = await upload(account.token, fixture('missing-fields.xml')).expect(422);

      expect(response.body.code).toBe('INVALID_INVOICE_DOCUMENT');
      expect(response.body.details).toMatchObject({
        format: 'TT78_2021',
        missingFields: expect.arrayContaining(['series', 'number']),
      });
    });

    it('stores an invoice whose totals do not reconcile, and fails verification', async () => {
      // The document is accepted because it is a well-formed invoice; the
      // arithmetic error is a verification verdict, not a parse error. Losing
      // the submission would also lose the evidence.
      const response = await upload(account.token, fixture('bad-totals.xml')).expect(201);

      const verification = response.body.verification as VerificationBody;

      expect(verification.status).toBe('FAILED');
      expect(statusOf(verification, 'arithmetic.totals')).toBe('FAILED');
      expect(statusOf(verification, 'xml.structure')).toBe('PASSED');
    });

    it('reports a signature it cannot check as unsupported', async () => {
      const response = await upload(account.token, fixture('signed-no-cert.xml')).expect(201);

      const verification = response.body.verification as VerificationBody;

      expect(statusOf(verification, 'signature.xmldsig')).toBe('UNSUPPORTED');
      expect(verification.status).toBe('PARTIAL');
    });

    it('rejects an upload with no file', async () => {
      const response = await as(account.token).post('/api/v1/invoices/upload').expect(400);

      expect(response.body.code).toBe('INVALID_REQUEST');
    });

    it('rejects an upload above the configured byte limit', async () => {
      const oversized = Buffer.alloc(2_097_153, 0x20);

      const response = await upload(account.token, oversized).expect(413);

      expect(response.body.code).toBe('DOCUMENT_TOO_LARGE');
    });

    it('accepts an invoice whose content duplicates another under a different identity', async () => {
      // Same buyer, date and amounts as the TT78 upload, different series and
      // number: the double-financing pattern. The submission is stored — it is
      // a real document — but duplicate detection fails it.
      const response = await as(account.token)
        .post('/api/v1/invoices')
        .send({
          invoiceSeries: 'C25ZZZ',
          invoiceNumber: '777',
          invoiceType: '1',
          sellerName: 'Công ty TNHH Vận tải Northwind',
          sellerTaxId: '0101234567',
          buyerName: 'Công ty Cổ phần Bán lẻ Minh Anh',
          buyerTaxId: '0107654321',
          currency: 'VND',
          amount: '1650000',
          subtotalAmount: '1500000',
          taxAmount: '150000',
          issueDate: '2026-09-01',
        })
        .expect(201);

      const verification = response.body.verification as VerificationBody;

      expect(statusOf(verification, 'duplicate.detection')).toBe('FAILED');
      expect(verification.status).toBe('FAILED');
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent submission
  // -------------------------------------------------------------------------

  describe('concurrent duplicate submission', () => {
    let account: Account;

    beforeAll(async () => {
      account = await register('concurrency');
    });

    it('stores exactly one row when the same document arrives twice at once', async () => {
      const document = tt78WithNumber('0000900');

      const [first, second] = await Promise.all([
        upload(account.token, document),
        upload(account.token, document),
      ]);

      const statuses = [first.status, second.status].sort();
      const bodies = [first.body, second.body];

      expect(statuses).toEqual([201, 409]);

      const rejected = bodies.find((body) => body.code === 'DUPLICATE_INVOICE');
      const accepted = bodies.find((body) => body.id !== undefined);

      expect(rejected).toBeDefined();
      expect(accepted).toBeDefined();

      const stored = await database.prisma.invoice.count({
        where: { organizationId: account.organizationId },
      });

      expect(stored).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Retrieval, listing and tenant isolation
  // -------------------------------------------------------------------------

  describe('GET /api/v1/invoices', () => {
    let owner: Account;
    let outsider: Account;
    const created: string[] = [];

    beforeAll(async () => {
      owner = await register('reader');
      outsider = await register('outsider');

      const documents = [
        { series: 'C25LST', number: '10', amount: '300000', day: '2026-07-01' },
        { series: 'C25LST', number: '11', amount: '100000', day: '2026-08-01' },
        { series: 'C25LST', number: '12', amount: '200000', day: '2026-09-01' },
      ];

      for (const document of documents) {
        const response = await as(owner.token)
          .post('/api/v1/invoices')
          .send({
            invoiceSeries: document.series,
            invoiceNumber: document.number,
            invoiceType: '1',
            sellerName: 'Công ty TNHH Vận tải Northwind',
            sellerTaxId: '0101234567',
            buyerName: 'Công ty Cổ phần Bán lẻ Minh Anh',
            buyerTaxId: `01076543${document.number}`,
            currency: 'VND',
            amount: document.amount,
            issueDate: document.day,
          })
          .expect(201);

        created.push(response.body.id as string);
      }
    });

    it('returns a page with a total and the requested window', async () => {
      const response = await as(owner.token)
        .get('/api/v1/invoices?limit=2&offset=0&sortBy=issueDate&sortOrder=asc')
        .expect(200);

      expect(response.body.pagination).toEqual({ total: 3, limit: 2, offset: 0 });
      expect(response.body.items).toHaveLength(2);
      expect(response.body.items[0].issueDate).toBe('2026-07-01');
      expect(response.body.items[1].issueDate).toBe('2026-08-01');
    });

    it('does not repeat or drop rows across pages', async () => {
      const first = await as(owner.token)
        .get('/api/v1/invoices?limit=2&offset=0&sortBy=amount&sortOrder=asc')
        .expect(200);
      const second = await as(owner.token)
        .get('/api/v1/invoices?limit=2&offset=2&sortBy=amount&sortOrder=asc')
        .expect(200);

      const ids = [...first.body.items, ...second.body.items].map(
        (item: { id: string }) => item.id,
      );

      expect(new Set(ids).size).toBe(3);
    });

    it('sorts by amount', async () => {
      const response = await as(owner.token)
        .get('/api/v1/invoices?sortBy=amount&sortOrder=asc')
        .expect(200);

      expect(response.body.items.map((item: { amount: string }) => item.amount)).toEqual([
        '100000',
        '200000',
        '300000',
      ]);
    });

    it('filters by issue date range', async () => {
      const response = await as(owner.token)
        .get('/api/v1/invoices?from=2026-08-01&to=2026-08-31')
        .expect(200);

      expect(response.body.pagination.total).toBe(1);
      expect(response.body.items[0].invoiceNumber).toBe('11');
    });

    it('normalises the invoice-number filter the same way as storage', async () => {
      const response = await as(owner.token)
        .get('/api/v1/invoices?invoiceNumber=0000012')
        .expect(200);

      expect(
        response.body.items.map((item: { invoiceNumber: string }) => item.invoiceNumber),
      ).toEqual(['12']);
    });

    it('rejects an inverted date range', async () => {
      const response = await as(owner.token)
        .get('/api/v1/invoices?from=2026-12-01&to=2026-01-01')
        .expect(400);

      expect(response.body.code).toBe('INVALID_REQUEST');
    });

    it('rejects a limit above the cap', async () => {
      await as(owner.token).get('/api/v1/invoices?limit=101').expect(400);
    });

    it('rejects an unknown sort field', async () => {
      await as(owner.token).get('/api/v1/invoices?sortBy=passwordHash').expect(400);
    });

    it("never returns another organization's invoices", async () => {
      const response = await as(outsider.token).get('/api/v1/invoices').expect(200);

      expect(response.body.pagination.total).toBe(0);
      expect(response.body.items).toEqual([]);
    });

    it("hides another organization's invoice behind a 404", async () => {
      // Not 403: a 403 would confirm the id exists, which is exactly what an
      // attacker enumerating ids is trying to learn.
      const response = await as(outsider.token).get(`/api/v1/invoices/${created[0]}`).expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('returns 404 for a malformed id rather than a 500', async () => {
      await as(owner.token).get('/api/v1/invoices/not-a-uuid').expect(404);
    });

    it('returns one invoice with its latest verification', async () => {
      const response = await as(owner.token).get(`/api/v1/invoices/${created[0]}`).expect(200);

      expect(response.body.id).toBe(created[0]);
      expect(response.body.verification.scope).toBe('LOCAL_CHECKS_ONLY');
    });
  });

  // -------------------------------------------------------------------------
  // Verification history
  // -------------------------------------------------------------------------

  describe('verification endpoints', () => {
    let account: Account;
    let invoiceId: string;

    beforeAll(async () => {
      account = await register('history');

      const response = await upload(account.token, fixture('tt32-valid.xml')).expect(201);
      invoiceId = response.body.id as string;
    });

    it('returns the latest verification', async () => {
      const response = await as(account.token)
        .get(`/api/v1/invoices/${invoiceId}/verification`)
        .expect(200);

      expect(response.body.status).toBe('PARTIAL');
      expect(response.body.checks).toHaveLength(7);
    });

    it('returns the checks in the canonical order', async () => {
      const response = await as(account.token)
        .get(`/api/v1/invoices/${invoiceId}/verification`)
        .expect(200);

      expect(response.body.checks.map((check: { key: string }) => check.key)).toEqual([
        'xml.structure',
        'fields.required',
        'arithmetic.totals',
        'duplicate.detection',
        'signature.xmldsig',
        'signature.trust',
        'authority.tax',
      ]);
    });

    it('re-runs verification and appends to the history', async () => {
      const before = await as(account.token)
        .get(`/api/v1/invoices/${invoiceId}/history`)
        .expect(200);

      const rerun = await as(account.token)
        .post(`/api/v1/invoices/${invoiceId}/verify`)
        .expect(200);

      expect(rerun.body.status).toBe('PARTIAL');

      const after = await as(account.token)
        .get(`/api/v1/invoices/${invoiceId}/history`)
        .expect(200);

      // Append-only: the earlier verdict is still there, not overwritten.
      expect(after.body.verifications).toHaveLength(before.body.verifications.length + 1);
      expect(after.body.verifications[0].id).toBe(rerun.body.id);

      // Both actions are audited, and each verification run has its own entry.
      const actions = after.body.events.map((event: { action: string }) => event.action);

      expect(actions).toContain('invoice.created');
      expect(actions.filter((action: string) => action === 'invoice.verified')).toHaveLength(2);
    });

    it("does not expose another organization's verification", async () => {
      const outsider = await register('history-outsider');

      await as(outsider.token).get(`/api/v1/invoices/${invoiceId}/verification`).expect(404);
      await as(outsider.token).post(`/api/v1/invoices/${invoiceId}/verify`).expect(404);
      await as(outsider.token).get(`/api/v1/invoices/${invoiceId}/history`).expect(404);
    });

    it('fails loudly when the stored document has disappeared', async () => {
      // A document row whose blob is gone is an integrity failure. Reporting
      // "no document" would let the structural check skip and quietly change
      // the verdict.
      const response = await upload(account.token, tt78WithNumber('0000500')).expect(201);
      const sha = response.body.document.contentSha256 as string;

      rmSync(join(STORAGE_DIR, sha.slice(0, 2), `${sha}.xml`), { force: true });

      const rerun = await as(account.token)
        .post(`/api/v1/invoices/${response.body.id}/verify`)
        .expect(500);

      expect(rerun.body.code).toBe('DOCUMENT_UNAVAILABLE');
      expect(JSON.stringify(rerun.body)).not.toContain(STORAGE_DIR);
    });
  });
});
