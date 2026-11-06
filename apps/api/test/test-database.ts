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
  'blockchain_rate_limits',
  'blockchain_records',
  'blockchain_signer_nonces',
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
  /** Which engine answered. Reported so a run cannot be mistaken for the other. */
  engine: 'pglite' | 'postgres';
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * A Postgres engine for the tests, with the committed migrations applied.
 *
 * Two backends, one interface, and the caller is told which it got:
 *
 *   * **PGlite** (default) — Postgres compiled to WASM, in-process. No Docker,
 *     no server, and the same parser and DDL semantics as the real thing. It is
 *     not a networked PostgreSQL, and a green run here must not be reported as
 *     one.
 *   * **real PostgreSQL** — selected by `TEST_DATABASE_URL`. Same adapter, same
 *     `pg` wire protocol, an actual server with its own planner, its own
 *     connection handling and its own lock manager.
 *
 * `pnpm test:postgres` sets the variable and prepares the database. Everything
 * else is unchanged, because both paths end at the same `PrismaClient`.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const externalUrl = process.env.TEST_DATABASE_URL;

  if (externalUrl !== undefined && externalUrl.trim() !== '') {
    return createExternalDatabase(externalUrl.trim());
  }

  return createInProcessDatabase();
}

/**
 * Refuses to point the suite at a database it might destroy.
 *
 * Every test run truncates. A stray `TEST_DATABASE_URL` pointing at the
 * development database would erase the seeded data without warning, so the
 * name has to say `test`. This is a guardrail, not authentication — it stops
 * the accident, not an attacker.
 */
function assertDisposable(url: string): void {
  let databaseName: string;
  try {
    databaseName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid connection URL');
  }

  if (!databaseName.toLowerCase().includes('test')) {
    throw new Error(
      `Refusing to run destructive tests against database "${databaseName}": ` +
        'TEST_DATABASE_URL must name a database containing "test".',
    );
  }
}

async function createExternalDatabase(url: string): Promise<TestDatabase> {
  assertDisposable(url);

  const pool = new Pool({ connectionString: url, max: 5 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const reset = async (): Promise<void> => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  };

  // A real server outlives the process, so the previous run's rows are still
  // there. PGlite always starts empty and hid this; without the truncate, a
  // second run collides on the unique email and slug columns. Truncating at
  // open is what makes both engines behave the same way.
  await reset();

  return {
    prisma,
    engine: 'postgres',
    reset,
    close: async () => {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}

/**
 * Prisma 7 has no PGlite driver adapter, so the database is exposed over the
 * wire protocol with `PGLiteSocketServer` and Prisma connects to it through
 * the ordinary `pg` adapter. That is the same code path production uses; only
 * the server on the other end differs.
 *
 * `maxConnections` must exceed the client pool size: the server defaults to 1
 * and silently drops the second connection, which surfaces as a reset during
 * any concurrent query.
 */
async function createInProcessDatabase(): Promise<TestDatabase> {
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
    engine: 'pglite',
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
