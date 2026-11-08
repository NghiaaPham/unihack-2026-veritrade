import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BlockchainModule } from '../blockchain/blockchain.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { FinancingRequestsController } from './financing-requests.controller.js';
import { FinancingRequestsResourceController } from './financing-requests-resource.controller.js';
import { FinancingRequestsService } from './financing-requests.service.js';

/**
 * Financing requests.
 *
 * Two controllers share one route prefix on purpose. The lifecycle controller
 * drives chain transactions and is metered by the chain quota; the resource
 * controller reads and creates database rows and is not. The chain work is
 * delegated to `BlockchainModule`: this module owns the business state machine,
 * that one owns the transaction. The dependency runs one way, so there is no
 * cycle. Invoice data comes through `InvoicesModule`'s service, never its tables.
 */
@Module({
  imports: [AuthModule, BlockchainModule, InvoicesModule, AuditLogsModule],
  controllers: [FinancingRequestsController, FinancingRequestsResourceController],
  providers: [FinancingRequestsService],
  exports: [FinancingRequestsService],
})
export class FinancingRequestsModule {}
