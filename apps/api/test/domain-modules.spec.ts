import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuditLogsService } from '../src/audit-logs/audit-logs.service.js';
import { BlockchainRegistryService } from '../src/blockchain-registry/blockchain-registry.service.js';
import { FinancingRequestsService } from '../src/financing-requests/financing-requests.service.js';
import { IdentityAccessService } from '../src/identity-access/identity-access.service.js';
import { InvoiceVerificationService } from '../src/invoice-verification/invoice-verification.service.js';
import { InvoicesService } from '../src/invoices/invoices.service.js';
import { OrganizationsService } from '../src/organizations/organizations.service.js';
import { RiskAssessmentService } from '../src/risk-assessment/risk-assessment.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

const DOMAIN_SERVICES = [
  IdentityAccessService,
  OrganizationsService,
  InvoicesService,
  InvoiceVerificationService,
  FinancingRequestsService,
  RiskAssessmentService,
  BlockchainRegistryService,
  AuditLogsService,
];

/**
 * The modular monolith only holds together if every domain module is actually
 * in the graph and its dependencies resolve. A missing provider or a
 * forgotten `imports` entry fails here rather than at the first request that
 * happens to touch that module in production.
 */
describe('Domain module wiring', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    database = await createTestDatabase();

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(database.prisma)
      .compile();
  });

  afterAll(async () => {
    await moduleRef.close();
    await database.close();
  });

  it('resolves all eight domain services from the root container', () => {
    for (const service of DOMAIN_SERVICES) {
      expect(moduleRef.get(service, { strict: false })).toBeInstanceOf(service);
    }
  });

  it('exposes the read seam each skeleton owns', () => {
    const identity = moduleRef.get(IdentityAccessService, { strict: false });
    const organizations = moduleRef.get(OrganizationsService, { strict: false });
    const invoices = moduleRef.get(InvoicesService, { strict: false });
    const verifications = moduleRef.get(InvoiceVerificationService, { strict: false });
    const financing = moduleRef.get(FinancingRequestsService, { strict: false });
    const risk = moduleRef.get(RiskAssessmentService, { strict: false });
    const registry = moduleRef.get(BlockchainRegistryService, { strict: false });
    const audit = moduleRef.get(AuditLogsService, { strict: false });

    expect(typeof identity.findUserByEmail).toBe('function');
    expect(typeof organizations.findById).toBe('function');
    // `getById`, not a bare `findById`: every invoice read is tenant-scoped,
    // and an unscoped finder would be the shortest path to a cross-tenant leak.
    expect(typeof invoices.getById).toBe('function');
    expect(typeof verifications.listForInvoice).toBe('function');
    expect(typeof financing.listForOrganization).toBe('function');
    expect(typeof risk.latestForRequest).toBe('function');
    expect(typeof registry.findByTxHash).toBe('function');
    expect(typeof audit.listForOrganization).toBe('function');
  });

  it('returns null rather than throwing for a missing row', async () => {
    const missing = '11111111-1111-4111-8111-111111111111';
    const organizations = moduleRef.get(OrganizationsService, { strict: false });

    await expect(organizations.findById(missing)).resolves.toBeNull();
  });

  it('normalises email before the lookup', async () => {
    const identity = moduleRef.get(IdentityAccessService, { strict: false });

    await database.prisma.user.create({
      data: {
        email: 'mixed@northwind.example',
        displayName: 'Mixed Case',
      },
    });

    await expect(identity.findUserByEmail('  MIXED@Northwind.Example ')).resolves.not.toBeNull();
  });
});
