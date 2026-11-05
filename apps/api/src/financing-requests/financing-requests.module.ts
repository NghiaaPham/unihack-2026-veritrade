import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { BlockchainModule } from '../blockchain/blockchain.module.js';
import { FinancingRequestsController } from './financing-requests.controller.js';
import { FinancingRequestsService } from './financing-requests.service.js';

/**
 * Financing requests.
 *
 * The lifecycle endpoints live here but the chain work is delegated to
 * `BlockchainModule`: this module owns the business state machine, that one
 * owns the transaction. The dependency runs one way, so there is no cycle.
 */
@Module({
  imports: [AuthModule, BlockchainModule],
  controllers: [FinancingRequestsController],
  providers: [FinancingRequestsService],
  exports: [FinancingRequestsService],
})
export class FinancingRequestsModule {}
