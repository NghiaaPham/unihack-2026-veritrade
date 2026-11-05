import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AvalancheRpcService } from './avalanche-rpc.service.js';
import { BlockchainController } from './blockchain.controller.js';
import { BlockchainEventIndexerService } from './blockchain-event-indexer.service.js';
import { BlockchainTransactionService } from './blockchain-transaction.service.js';
import { FinancingClaimService } from './financing-claim.service.js';
import { InvoiceAnchorService } from './invoice-anchor.service.js';
import { InvoiceCommitmentService } from './invoice-commitment.service.js';
import { TransactionConfirmationService } from './transaction-confirmation.service.js';

/**
 * The bridge to the Avalanche registry.
 *
 * Exported services are the only way other modules touch the chain. Nothing
 * outside this module builds a viem client or reads the signer, which keeps the
 * key in one place and makes every chain write go through the outbox.
 *
 * `AuthModule` is imported for the guard used by the controller: a guard applied
 * with `@UseGuards()` is constructed in the consuming module's injector, so the
 * JWT dependencies have to be resolvable here.
 */
@Module({
  imports: [AuditLogsModule, AuthModule],
  controllers: [BlockchainController],
  providers: [
    AvalancheRpcService,
    InvoiceCommitmentService,
    TransactionConfirmationService,
    BlockchainTransactionService,
    InvoiceAnchorService,
    FinancingClaimService,
    BlockchainEventIndexerService,
  ],
  exports: [
    AvalancheRpcService,
    InvoiceCommitmentService,
    BlockchainTransactionService,
    TransactionConfirmationService,
    InvoiceAnchorService,
    FinancingClaimService,
    BlockchainEventIndexerService,
  ],
})
export class BlockchainModule {}
