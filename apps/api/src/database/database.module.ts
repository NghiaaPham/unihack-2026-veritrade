import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';

/**
 * Global so feature modules can inject DatabaseService without importing this
 * module everywhere. It owns the connection pool's lifecycle.
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
