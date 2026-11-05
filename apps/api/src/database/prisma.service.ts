import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';

const POOL_SIZE = 10;
const IDLE_TIMEOUT_MS = 30_000;
// `pg` has no connect timeout by default, so an unreachable database would hang
// a request forever instead of failing it. Prisma v6 used 5s; match that.
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * The single Prisma client for the process.
 *
 * Prisma 7 requires a driver adapter for every database, so the connection is
 * an ordinary `pg` pool and the adapter borrows it. That keeps one pool per
 * process instead of one per client, and lets `onApplicationShutdown` close it
 * deterministically.
 *
 * The pool connects lazily: the API still boots when Postgres is down, and the
 * failure surfaces on the query that needed it. `GET /api/v1/health/db` exists
 * to make that failure observable instead of silent.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(configService: ConfigService) {
    const pool = new Pool({
      connectionString: configService.getOrThrow<string>('DATABASE_URL'),
      max: POOL_SIZE,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    });

    super({ adapter: new PrismaPg(pool) });

    this.pool = pool;
  }

  async onApplicationShutdown(): Promise<void> {
    // Order matters: let Prisma release its adapter first, then close the pool
    // the adapter was borrowing.
    await this.$disconnect();
    await this.pool.end();
  }
}
