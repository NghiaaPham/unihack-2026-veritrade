import { BlockchainOperationStatus } from '../src/generated/prisma/client.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

/**
 * Guards against the two data hazards that preceded the first Fuji deploy:
 *
 *   * The seed must never write a `BlockchainRecord`, let alone a fabricated
 *     `CONFIRMED` one on a real network's chain id (43113 / Fuji). A genuine
 *     confirmation only exists after the API signs and broadcasts a transaction
 *     and a receipt is observed, so seeding a fake "anchored on Fuji" row would
 *     make a demo invoice report itself as confirmed on a chain it was never
 *     sent to.
 *   * Synthetic business rows must not be Fuji-tagged. The legacy `trade` demo
 *     row stays on the local development chain (31337).
 *
 * These run against the same test database the rest of the suite uses (PGlite by
 * default, real PostgreSQL under `test:postgres`), so the check is enforced on
 * both engines.
 */
describe('seed safety', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('seeds no blockchain records at all', async () => {
    await import('../prisma/seed.js').then((module) => module.seedDatabase(database.prisma));

    expect(await database.prisma.blockchainRecord.count()).toBe(0);
  });

  it('seeds no Fuji (43113) blockchain record', async () => {
    const fuji = await database.prisma.blockchainRecord.findFirst({
      where: { chainId: 43113 },
    });

    expect(fuji).toBeNull();
  });

  it('leaves every seeded invoice without a confirmation', async () => {
    const invoices = await database.prisma.invoice.findMany({
      include: { blockchainRecords: true },
    });

    expect(invoices.length).toBeGreaterThan(0);
    for (const invoice of invoices) {
      expect(invoice.blockchainRecords).toEqual([]);
    }
  });

  it('keeps the demo trade row on the local dev chain, not Fuji', async () => {
    const trade = await database.prisma.trade.findUnique({
      where: { reference: 'TRD-SEED-0001' },
    });

    expect(trade).not.toBeNull();
    expect(trade?.chainId).toBe(31337);
    expect(trade?.chainId).not.toBe(43113);
  });

  it('does not leave any non-PENDING blockchain operation behind', async () => {
    const operations = await database.prisma.blockchainOperation.count({
      where: { status: { not: BlockchainOperationStatus.PENDING } },
    });

    expect(operations).toBe(0);
  });
});
