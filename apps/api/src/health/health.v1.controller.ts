import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService, type DatabaseHealthStatus, type HealthStatus } from './health.service.js';

/**
 * Versioned health surface. With the global `api` prefix this resolves to
 * `/api/v1/health` and `/api/v1/health/db`.
 */
@Controller('v1/health')
export class HealthV1Controller {
  constructor(private readonly healthService: HealthService) {}

  /** Liveness: is the process up and serving? Never touches the database. */
  @Get()
  check(): HealthStatus {
    return this.healthService.getStatus();
  }

  /**
   * Readiness: can this process reach Postgres?
   *
   * Answers 503 when it cannot, so an orchestrator removes the instance from
   * rotation instead of routing traffic into a database outage. `passthrough`
   * keeps Nest's normal serialisation of the returned body.
   */
  @Get('db')
  async checkDatabase(
    @Res({ passthrough: true }) response: Response,
  ): Promise<DatabaseHealthStatus> {
    const status = await this.healthService.getDatabaseStatus();

    response.status(status.database.connected ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return status;
  }
}
