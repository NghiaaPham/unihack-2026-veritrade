import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { configureOpenApi } from './openapi.js';

const DEFAULT_PORT = 3001;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  configureApp(app);

  // The schema describes every protected endpoint, the tenant model and the
  // error envelope. That is useful to a developer and useful to a scanner, so
  // it is served outside production only.
  if (process.env.NODE_ENV !== 'production') {
    configureOpenApi(app);
  }

  app.enableShutdownHooks();

  const port = Number.parseInt(process.env.API_PORT ?? String(DEFAULT_PORT), 10);
  await app.listen(port);

  Logger.log(`VeriTrade API listening on http://localhost:${port}`, 'Bootstrap');

  if (process.env.NODE_ENV !== 'production') {
    Logger.log(`OpenAPI document at http://localhost:${port}/api/docs`, 'Bootstrap');
  }
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    'VeriTrade API failed to start',
    error instanceof Error ? error.stack : String(error),
    'Bootstrap',
  );
  process.exit(1);
});
