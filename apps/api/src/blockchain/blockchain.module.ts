import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AvalancheRpcService } from './avalanche-rpc.service.js';
import { BlockchainController } from './blockchain.controller.js';
import { BlockchainEventIndexerService } from './blockchain-event-indexer.service.js';
import { BlockchainQuotaGuard } from './blockchain-quota.guard.js';
import { BlockchainQuotaService } from './blockchain-quota.service.js';
import { BlockchainReconciliationService } from './blockchain-reconciliation.service.js';
import { BlockchainTransactionService } from './blockchain-transaction.service.js';
import { FinancingClaimService } from './financing-claim.service.js';
import { InvoiceAnchorService } from './invoice-anchor.service.js';
import { InvoiceCommitmentService } from './invoice-commitment.service.js';
import { NonceAllocatorService } from './nonce-allocator.service.js';
import { TransactionConfirmationService } from './transaction-confirmation.service.js';

/**
 * The bridge to the Avalanche registry.
 *
 * Exported services are the only way other modules touch the chain. Nothing
 * outside this module builds a viem client or reads the signer, which keeps the
 * key in one place and makes every chain write go through the outbox.
 *
 * Two background workers live here and both are off unless configured: the
 * event indexer (`BLOCKCHAIN_INDEXER_INTERVAL_MS`) and the reconciler
 * (`BLOCKCHAIN_RECONCILE_INTERVAL_MS`). A deployment with no registry address
 * boots with neither running and says so in the log.
 *
 * `AuthModule` is imported for the guard used by the controller: a guard applied
 * with `@UseGuards()` is constructed in the consuming module's injector, so the
 * JWT dependencies have to be resolvable here. `BlockchainQuotaGuard` is
 * exported for the same reason — `invoices` and `financing-requests` apply it to
 * their chain-writing routes, and it is built from their injector.
 */
@Module({
  imports: [AuditLogsModule, AuthModule],
  controllers: [BlockchainController],
  providers: [
    AvalancheRpcService,
    InvoiceCommitmentService,
    NonceAllocatorService,
    TransactionConfirmationService,
    BlockchainTransactionService,
    InvoiceAnchorService,
    FinancingClaimService,
    BlockchainEventIndexerService,
    BlockchainReconciliationService,
    BlockchainQuotaService,
    BlockchainQuotaGuard,
  ],
  exports: [
    AvalancheRpcService,
    InvoiceCommitmentService,
    NonceAllocatorService,
    BlockchainTransactionService,
    TransactionConfirmationService,
    InvoiceAnchorService,
    FinancingClaimService,
    BlockchainEventIndexerService,
    BlockchainReconciliationService,
    BlockchainQuotaService,
    BlockchainQuotaGuard,
  ],
})
export class BlockchainModule {}
