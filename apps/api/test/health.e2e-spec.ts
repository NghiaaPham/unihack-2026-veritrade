import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

async function bootApp(prisma: unknown): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  return app;
}

describe('Health API', () => {
  let app: INestApplication;
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await bootApp(database.prisma);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('serves liveness at /api/v1/health without touching the database', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', service: 'veritrade-api' });
    expect(response.body.database).toBeUndefined();
  });

  it('serves readiness at /api/v1/health/db and reports a real round trip', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/db').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.database.connected).toBe(true);
    expect(typeof response.body.database.latencyMs).toBe('number');
    expect(response.body.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps the legacy /health alias and leaves /api/health unrouted', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/api/health').expect(404);
  });
});

describe('Health API when the database is unreachable', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootApp({
      $queryRaw: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports 503 and does not echo the driver error', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/db').expect(503);

    expect(response.body.status).toBe('error');
    expect(response.body.database).toEqual({
      connected: false,
      error: 'database unreachable',
    });
    // The raw driver message can contain the connection string, so it must
    // never reach an unauthenticated caller.
    expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
  });

  it('still answers liveness while the database is down', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
});
