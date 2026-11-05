import { RequestMethod, ValidationPipe, type INestApplication } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';

function parseOrigins(value: string | undefined): string[] {
  return (value ?? DEFAULT_CORS_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Shared HTTP configuration. `main.ts` and the e2e tests both apply it, so a
 * route prefix, pipe or error-shape change cannot drift between runtime and
 * tests.
 */
export function configureApp(app: INestApplication): void {
  // Business endpoints live under /api. Health checks stay at the root so
  // load balancers and container probes can reach them without a prefix.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  app.enableCors({ origin: parseOrigins(process.env.CORS_ORIGIN), credentials: true });

  // Reject unknown properties instead of silently dropping them: a typo in a
  // field name should be a 400, not a trade created with a default value.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Registered here rather than in `main.ts` so the tests assert the same
  // error envelope the deployed API returns. An error shape that only exists
  // in production is an error shape nobody tested.
  app.useGlobalFilters(new HttpExceptionFilter());
}
