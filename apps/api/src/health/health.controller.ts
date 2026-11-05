import { Controller, Get } from '@nestjs/common';
import { HealthService, type HealthStatus } from './health.service.js';

/**
 * Legacy probe path. `configureApp` excludes `health` from the global `api`
 * prefix, so this answers on `/health` and nowhere else. It stays because
 * container health checks and uptime monitors are already pointed at it;
 * `/api/v1/health` is the versioned surface for API consumers.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): HealthStatus {
    return this.healthService.getStatus();
  }
}
