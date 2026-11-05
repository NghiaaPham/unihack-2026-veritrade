import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Falls back to the docker-compose defaults so `prisma validate` and
// `prisma generate` work on a machine with no environment at all — neither
// command opens a connection. `prisma migrate deploy` and `prisma db seed`
// still fail loudly if nothing is listening on that port.
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://veritrade:veritrade@localhost:5432/veritrade';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Node 22.6+ strips TypeScript types natively, so the seed runs without
    // pulling in ts-node or tsx as an extra toolchain.
    seed: 'node prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
