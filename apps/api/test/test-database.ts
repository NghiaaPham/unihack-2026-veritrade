import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../prisma/migrations', import.meta.url));

/**
 * Every table the migrations create. `TRUNCATE ... CASCADE` needs the full
 * list once so the reset is a single statement rather than one per table.
 */
const TABLES = [
  'audit_logs',
  'blockchain_events',
  'blockchain_transaction_receipts',
  'blockchain_operations',
  'blockchain_records',
  'risk_assessments',
  'financing_requests',
  'verification_checks',
  'invoice_verifications',
  'invoice_documents',
  'invoices',
  'organization_memberships',
  'organizations',
  'users',
  'chain_sync_cursor',
  'trade',
] as const;

export interface TestDatabase {
  prisma: PrismaClient;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * A real Postgres engine for the tests, with the committed migrations applied.
 *
 * PGlite is Postgres compiled to WASM, so the DDL under test is the same DDL
 * that runs in production — not a hand-written approximation that can drift.
 *
 * Prisma 7 has no PGlite driver adapter, so the database is exposed over the
 * wire protocol with `PGLiteSocketServer` and Prisma connects to it through
 * the ordinary `pg` adapter. That is the same code path production uses; only
 * the server on the other end differs.
 *
 * `maxConnections` must exceed the client pool size: the server defaults to 1
 * and silently drops the second connection, which surfaces as a reset during
 * any concurrent query.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const pglite = await PGlite.create();

  for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, entry.name, 'migration.sql'), 'utf8');
    await pglite.exec(sql);
  }

  const server = new PGLiteSocketServer({
    db: pglite,
    port: 0,
    host: '127.0.0.1',
    maxConnections: 10,
  });
  await server.start();

  const pool = new Pool({
    connectionString: `postgresql://postgres@${server.getServerConn()}/postgres`,
    max: 5,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  return {
    prisma,
    reset: async () => {
      await pglite.exec(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    },
    close: async () => {
      // Release the client before the pool, and the pool before the server it
      // is talking to — otherwise shutdown races an in-flight connection.
      await prisma.$disconnect();
      await pool.end();
      await server.stop();
      await pglite.close();
    },
  };
}
