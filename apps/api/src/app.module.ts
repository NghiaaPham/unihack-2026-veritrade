import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/env.validation.js';
import { PrismaModule } from './database/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AuditLogsModule } from './audit-logs/audit-logs.module.js';
import { BlockchainModule } from './blockchain/blockchain.module.js';
import { BlockchainRegistryModule } from './blockchain-registry/blockchain-registry.module.js';
import { FinancingRequestsModule } from './financing-requests/financing-requests.module.js';
import { IdentityAccessModule } from './identity-access/identity-access.module.js';
import { InvoiceVerificationModule } from './invoice-verification/invoice-verification.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { RiskAssessmentModule } from './risk-assessment/risk-assessment.module.js';

/**
 * Modular monolith. One deployable, one database, but the eight domain modules
 * below only talk to each other through their exported services — no module
 * reaches into another's tables. That keeps the boundaries honest today and
 * leaves a clean seam if a module ever needs to be split out.
 *
 * Phase 2 wires the graph; the workflows land in Phase 3.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      // Fail fast on a malformed environment: a typo in DATABASE_URL should
      // stop the process at boot, not surface as a 500 on the first query.
      validate: validateEnvironment,
    }),
    PrismaModule,
    HealthModule,
    // Domain modules
    IdentityAccessModule,
    OrganizationsModule,
    InvoicesModule,
    InvoiceVerificationModule,
    FinancingRequestsModule,
    RiskAssessmentModule,
    BlockchainModule,
    BlockchainRegistryModule,
    AuditLogsModule,
  ],
})
export class AppModule {}
