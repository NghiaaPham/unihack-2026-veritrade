import { createTestDatabase, type TestDatabase } from './test-database.js';

/**
 * These tests assert the invariants the schema is supposed to enforce, not the
 * services built on top of them. If a constraint is dropped from the migration,
 * the corresponding test fails here — which is the point: the duplicate
 * protections are a database guarantee, not an application convention.
 */
describe('Schema invariants', () => {
  let database: TestDatabase;

  const prisma = () => database.prisma;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.reset();
  });

  afterAll(async () => {
    await database.close();
  });

  async function makeOrganization(slug: string) {
    return prisma().organization.create({
      data: { name: slug, slug, countryCode: 'VN' },
    });
  }

  async function makeUser(email: string) {
    return prisma().user.create({ data: { email, displayName: email } });
  }

  async function makeInvoice(
    organizationId: string,
    uploadedById: string,
    fingerprint: string,
    amount = '10.000000000000000000',
  ) {
    return prisma().invoice.create({
      data: {
        organizationId,
        uploadedById,
        invoiceNumber: 'INV-0001',
        invoiceSeries: 'C26TAA',
        invoiceType: '1',
        sellerName: 'Seller (test)',
        buyerName: 'Buyer (test)',
        issuerTaxId: 'XX-1',
        debtorTaxId: 'XX-2',
        currency: 'USD',
        amount,
        issueDate: new Date('2026-09-01T00:00:00.000Z'),
        dueDate: new Date('2026-12-01T00:00:00.000Z'),
        fingerprint,
        // Content hash is a different commitment from the identity
        // fingerprint; here it only has to be present and distinct per row.
        contentHash: fingerprint.split('').reverse().join(''),
      },
    });
  }

  describe('invoice duplicate detection', () => {
    it('rejects the same fingerprint twice inside one organisation', async () => {
      const org = await makeOrganization('acme');
      const user = await makeUser('ops@acme.example');
      const fingerprint = 'a'.repeat(64);

      await makeInvoice(org.id, user.id, fingerprint);

      await expect(makeInvoice(org.id, user.id, fingerprint)).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('allows the same fingerprint in a different organisation', async () => {
      const first = await makeOrganization('first-co');
      const second = await makeOrganization('second-co');
      const user = await makeUser('ops@shared.example');
      const fingerprint = 'b'.repeat(64);

      await makeInvoice(first.id, user.id, fingerprint);
      await expect(makeInvoice(second.id, user.id, fingerprint)).resolves.toBeDefined();
    });
  });

  describe('duplicate financing protection', () => {
    async function makeFinancing(invoiceId: string, organizationId: string, userId: string) {
      return prisma().financingRequest.create({
        data: {
          organizationId,
          invoiceId,
          requestedById: userId,
          requestedAmount: '5.000000000000000000',
          currency: 'USD',
          termDays: 30,
          interestRateBps: 500,
          purpose: 'Working capital',
          activeKey: 'ACTIVE',
        },
      });
    }

    it('allows at most one live request per invoice', async () => {
      const org = await makeOrganization('acme');
      const user = await makeUser('finance@acme.example');
      const invoice = await makeInvoice(org.id, user.id, 'c'.repeat(64));

      await makeFinancing(invoice.id, org.id, user.id);

      await expect(makeFinancing(invoice.id, org.id, user.id)).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('permits a retry once the previous request reaches a terminal state', async () => {
      const org = await makeOrganization('acme');
      const user = await makeUser('finance@acme.example');
      const invoice = await makeInvoice(org.id, user.id, 'd'.repeat(64));

      const rejected = await makeFinancing(invoice.id, org.id, user.id);
      await prisma().financingRequest.update({
        where: { id: rejected.id },
        data: { status: 'REJECTED', activeKey: null },
      });

      await expect(makeFinancing(invoice.id, org.id, user.id)).resolves.toBeDefined();

      // Two terminal requests coexist because Postgres treats NULLs as distinct
      // in a unique index.
      await prisma().financingRequest.updateMany({
        where: { invoiceId: invoice.id, activeKey: 'ACTIVE' },
        data: { status: 'CANCELLED', activeKey: null },
      });

      await expect(makeFinancing(invoice.id, org.id, user.id)).resolves.toBeDefined();
      expect(await prisma().financingRequest.count({ where: { invoiceId: invoice.id } })).toBe(3);
    });
  });

  describe('blockchain records', () => {
    async function makeRecord(organizationId: string, chainId: number, txHash: string) {
      return prisma().blockchainRecord.create({
        data: {
          organizationId,
          kind: 'INVOICE_REGISTRY',
          chainId,
          contractAddress: '0x0000000000000000000000000000000000000000',
          txHash,
          payloadHash: `0x${'0'.repeat(64)}`,
        },
      });
    }

    it('scopes transaction-hash uniqueness to the chain', async () => {
      const org = await makeOrganization('acme');
      const txHash = `0x${'f'.repeat(64)}`;

      await makeRecord(org.id, 43113, txHash);

      await expect(makeRecord(org.id, 43114, txHash)).resolves.toBeDefined();
      await expect(makeRecord(org.id, 43113, txHash)).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('referential integrity', () => {
    it('refuses to delete an organisation that still owns invoices', async () => {
      const org = await makeOrganization('acme');
      const user = await makeUser('ops@acme.example');
      await makeInvoice(org.id, user.id, 'e'.repeat(64));

      await expect(prisma().organization.delete({ where: { id: org.id } })).rejects.toMatchObject({
        code: 'P2003',
      });
    });

    it('cascades membership deletion when the user is removed', async () => {
      const org = await makeOrganization('acme');
      const user = await makeUser('ops@acme.example');

      await prisma().organizationMembership.create({
        data: { organizationId: org.id, userId: user.id, role: 'OWNER' },
      });

      await prisma().user.delete({ where: { id: user.id } });

      expect(await prisma().organizationMembership.count()).toBe(0);
    });
  });

  describe('decimal precision', () => {
    it('round-trips a 38-digit decimal without loss', async () => {
      const org = await makeOrganization('acme');
      const user = await makeUser('ops@acme.example');
      // 20 integer digits + 18 fraction digits is exactly numeric(38,18).
      const amount = '12345678901234567890.123456789012345678';

      const created = await makeInvoice(org.id, user.id, 'f'.repeat(64), amount);
      const readBack = await prisma().invoice.findUniqueOrThrow({ where: { id: created.id } });

      expect(readBack.amount.toString()).toBe(amount);
    });
  });
});
