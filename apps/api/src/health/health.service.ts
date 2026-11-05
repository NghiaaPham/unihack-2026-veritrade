import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export interface HealthStatus {
  status: 'ok';
  service: 'veritrade-api';
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface DatabaseHealthStatus {
  status: 'ok' | 'error';
  service: 'veritrade-api';
  database: { connected: boolean; latencyMs?: number; error?: string };
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness only. Deliberately touches nothing external: a load balancer
   * asking "is this process alive" must not get a 503 because Postgres is
   * briefly slow, or it will restart a perfectly healthy instance.
   */
  getStatus(): HealthStatus {
    return {
      status: 'ok',
      service: 'veritrade-api',
      environment: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: proves the process can actually reach Postgres.
   *
   * The probe is a literal `SELECT 1` rather than a pool-size check, because
   * only a round trip proves the server is reachable, authenticated and
   * accepting queries.
   *
   * The driver's error text is logged but never returned. Prisma connection
   * failures can echo the connection string back, and an unauthenticated
   * health endpoint is the last place that should happen.
   */
  async getDatabaseStatus(): Promise<DatabaseHealthStatus> {
    const startedAt = process.hrtime.bigint();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const elapsedNs = process.hrtime.bigint() - startedAt;

      return {
        status: 'ok',
        service: 'veritrade-api',
        database: { connected: true, latencyMs: Number(elapsedNs / 1_000_000n) },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Database health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        status: 'error',
        service: 'veritrade-api',
        database: { connected: false, error: 'database unreachable' },
        timestamp: new Date().toISOString(),
      };
    }
  }
}
