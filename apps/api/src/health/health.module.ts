import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthV1Controller } from './health.v1.controller.js';
import { HealthService } from './health.service.js';

@Module({
  controllers: [HealthController, HealthV1Controller],
  providers: [HealthService],
})
export class HealthModule {}
