import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

const DEFAULT_PORT = 3001;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  configureApp(app);
  app.enableShutdownHooks();

  const port = Number.parseInt(process.env.API_PORT ?? String(DEFAULT_PORT), 10);
  await app.listen(port);

  Logger.log(`VeriTrade API listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    'VeriTrade API failed to start',
    error instanceof Error ? error.stack : String(error),
    'Bootstrap',
  );
  process.exit(1);
});
