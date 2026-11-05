import { Module } from '@nestjs/common';
import { BlockchainRegistryService } from './blockchain-registry.service.js';

@Module({
  providers: [BlockchainRegistryService],
  exports: [BlockchainRegistryService],
})
export class BlockchainRegistryModule {}
