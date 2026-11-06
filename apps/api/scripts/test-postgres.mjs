#!/usr/bin/env node
/**
 * Runs the API suite against a real PostgreSQL server.
 *
 * `pnpm test` uses PGlite — a real Postgres engine, but in-process and with no
 * network, no second connection and no separate planner. This script is the
 * other half of the evidence: the same 200-odd tests against an actual server,
 * which is the only way to find the problems PGlite cannot have (connection
 * pooling, cross-connection locks, `FOR UPDATE` contention, timezone handling).
 *
 * Steps, each idempotent:
 *
 *   1. resolve the target URL (TEST_DATABASE_URL, else the compose defaults
 *      with a `_test` suffix);
 *   2. refuse anything whose database name does not contain "test" — every run
 *      truncates;
 *   3. create the database if it is missing, never dropping an existing one;
 *   4. `prisma migrate deploy`, so the schema is the committed one;
 *   5. run vitest with TEST_DATABASE_URL exported.
 *
 * Exits with vitest's status so CI can gate on it.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_URL = 'postgresql://veritrade:veritrade@127.0.0.1:5432/veritrade_test';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function databaseName(url) {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    fail(`TEST_DATABASE_URL is not a valid connection URL: ${url.replace(/:[^:@/]+@/, ':***@')}`);
  }
}

const target = databaseName(TEST_DATABASE_URL);

if (!target.toLowerCase().includes('test')) {
  fail(
    `Refusing to run: database "${target}" does not look like a test database.\n` +
      '  This script truncates every table. Set TEST_DATABASE_URL to a database\n' +
      '  whose name contains "test".',
  );
}

/** Connects to the maintenance database, because you cannot CREATE DATABASE from inside it. */
function adminUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

async function ensureDatabase() {
  const client = new pg.Client({ connectionString: adminUrl(TEST_DATABASE_URL) });

  try {
    await client.connect();
  } catch (error) {
    fail(
      `Cannot reach PostgreSQL at ${new URL(TEST_DATABASE_URL).host}: ${error.message}\n` +
        '  Start it with: pnpm db:up',
    );
  }

  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [target]);

    if (existing.rowCount === 0) {
      // Identifier quoting: the name comes from a URL, so it cannot be bound as
      // a parameter, and interpolating it unquoted would be an injection point.
      await client.query(`CREATE DATABASE "${target.replace(/"/g, '""')}"`);
      console.log(`  created database ${target}`);
    } else {
      console.log(`  database ${target} already exists (left untouched)`);
    }
  } finally {
    await client.end();
  }
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: API_ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: false,
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const host = new URL(TEST_DATABASE_URL).host;
console.log(`\nReal PostgreSQL test run -> ${host}/${target}\n`);

await ensureDatabase();

const migrateStatus = await run('npx', ['prisma', 'migrate', 'deploy'], {
  DATABASE_URL: TEST_DATABASE_URL,
});

if (migrateStatus !== 0) {
  fail('prisma migrate deploy failed; the suite was not run');
}

const testStatus = await run('npx', ['vitest', 'run', ...process.argv.slice(2)], {
  TEST_DATABASE_URL,
  DATABASE_URL: TEST_DATABASE_URL,
});

process.exit(testStatus);
