import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  service: 'veritrade-api';
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  getStatus(): HealthStatus {
    return {
      status: 'ok',
      service: 'veritrade-api',
      environment: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
