import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Falls back to the docker-compose defaults so `db:generate` works with no
// environment at all. `db:migrate` still fails loudly if nothing is listening.
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://veritrade:veritrade@localhost:5432/veritrade';

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
