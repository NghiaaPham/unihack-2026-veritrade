import { Module } from '@nestjs/common';
import { IdentityAccessService } from './identity-access.service.js';

@Module({
  providers: [IdentityAccessService],
  exports: [IdentityAccessService],
})
export class IdentityAccessModule {}
