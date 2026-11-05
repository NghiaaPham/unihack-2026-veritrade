import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly db: NodePgDatabase<typeof schema>;

  private readonly pool: Pool;

  constructor(configService: ConfigService) {
    this.pool = new Pool({
      connectionString: configService.getOrThrow<string>('DATABASE_URL'),
      max: 10,
      idleTimeoutMillis: 30_000,
    });

    // The pool connects lazily, so the API still boots when Postgres is down.
    // Queries surface the failure instead of the whole process failing to start.
    this.db = drizzle(this.pool, { schema });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
