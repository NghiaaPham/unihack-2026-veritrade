import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '../src/database/schema.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface TestDatabase {
  db: PgliteDatabase<typeof schema>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Real Postgres (PGlite) with the committed migrations applied, so the tests
 * exercise the actual DDL rather than a hand-built approximation of it.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of migrations) {
    await client.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }

  return {
    db: drizzle(client, { schema }),
    reset: async () => {
      await client.exec('truncate table trade');
    },
    close: async () => {
      await client.close();
    },
  };
}
