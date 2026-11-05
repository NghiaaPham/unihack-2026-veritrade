import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Global so every domain module can inject PrismaService without importing
 * this module everywhere. It owns the connection pool's lifecycle, and there
 * must only ever be one of it per process.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
