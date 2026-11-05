/**
 * Synthetic development data.
 *
 * Rules this file obeys:
 *   * **Idempotent.** Every write is an `upsert` against a natural key and
 *     every id is a hard-coded UUID, so running it twice converges instead of
 *     duplicating. That is what makes `pnpm db:seed` safe to re-run after a
 *     partial failure.
 *   * **Synthetic only.** Names are invented, emails use the reserved
 *     `.example` TLD, tax ids are obviously fake, and no password is set.
 *     Nothing here came from a real company or a real person.
 *   * **No chain traffic.** Transaction hashes are well-formed but fabricated;
 *     the seed never touches a network.
 *
 * Run with `pnpm db:seed`, or let `prisma migrate reset` call it.
 */
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { Prisma, PrismaClient, type Invoice } from '../src/generated/prisma/client.ts';
import {
  canonicalAmount,
  canonicalContent,
  canonicalIdentity,
  sha256Hex,
} from '../src/invoices/invoice-fingerprint.ts';
import {
  normalizeInvoiceNumber,
  normalizeInvoiceSeries,
  normalizeTaxId,
  normalizeTemplateCode,
} from '../src/invoices/invoice-normalization.ts';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://veritrade:veritrade@localhost:5432/veritrade';

// --- Deterministic ids ------------------------------------------------------
// Grouped by entity so a failure is easy to trace back to the block that wrote
// it. All are valid version-4/variant-1 UUID strings.
const ID = {
  orgNorthwind: '0a000000-0000-4000-8000-000000000001',
  orgBlueHarbor: '0a000000-0000-4000-8000-000000000002',
  userOps: '0b000000-0000-4000-8000-000000000001',
  userFinance: '0b000000-0000-4000-8000-000000000002',
  userAnalyst: '0b000000-0000-4000-8000-000000000003',
  membershipOwner: '0c000000-0000-4000-8000-000000000001',
  membershipFinance: '0c000000-0000-4000-8000-000000000002',
  membershipAnalyst: '0c000000-0000-4000-8000-000000000003',
  invoiceFreight: '0d000000-0000-4000-8000-000000000001',
  invoicePort: '0d000000-0000-4000-8000-000000000002',
  invoiceFuel: '0d000000-0000-4000-8000-000000000003',
  verificationPassed: '0e000000-0000-4000-8000-000000000001',
  verificationPending: '0e000000-0000-4000-8000-000000000002',
  financingActive: '0f000000-0000-4000-8000-000000000001',
  riskAssessment: '10000000-0000-4000-8000-000000000001',
  blockchainRecord: '11000000-0000-4000-8000-000000000001',
  auditCreated: '12000000-0000-4000-8000-000000000001',
  auditVerified: '12000000-0000-4000-8000-000000000002',
} as const;

/**
 * Invoice fingerprints.
 *
 * The seed calls the *same* functions the API uses rather than recomputing the
 * canonical string here. Two implementations of an identity rule are two
 * chances to disagree, and a disagreement means the seeded rows would never be
 * recognised as duplicates of a real upload.
 *
 * It imports the pure module, not the `@Injectable` wrapper: `prisma db seed`
 * runs `node prisma/seed.ts` with type stripping only, which cannot load a file
 * containing decorators.
 */
interface SeedInvoice {
  id: string;
  invoiceSeries: string;
  invoiceNumber: string;
  invoiceType: string;
  invoiceTypeName: string;
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  buyerTaxId: string;
  currency: string;
  amount: string;
  subtotal: string;
  taxAmount: string;
  issueDate: string;
  dueDate: string;
}

const invoices: readonly SeedInvoice[] = [
  {
    id: ID.invoiceFreight,
    invoiceSeries: 'C26TAA',
    invoiceNumber: '41',
    invoiceType: '1',
    invoiceTypeName: 'Hóa đơn giá trị gia tăng',
    sellerName: 'Northwind Freight (demo)',
    sellerTaxId: 'XX-0000001',
    buyerName: 'Harbor Retail (demo)',
    buyerTaxId: 'XX-0000002',
    currency: 'USD',
    amount: '48250',
    subtotal: '43863.64',
    taxAmount: '4386.36',
    issueDate: '2026-09-01',
    dueDate: '2026-12-01',
  },
  {
    id: ID.invoicePort,
    invoiceSeries: 'C26TAA',
    invoiceNumber: '42',
    invoiceType: '1',
    invoiceTypeName: 'Hóa đơn giá trị gia tăng',
    sellerName: 'Northwind Freight (demo)',
    sellerTaxId: 'XX-0000001',
    buyerName: 'Delta Foods (demo)',
    buyerTaxId: 'XX-0000003',
    currency: 'USD',
    amount: '127500.50',
    subtotal: '115909.55',
    taxAmount: '11590.95',
    issueDate: '2026-09-14',
    dueDate: '2026-12-14',
  },
  {
    id: ID.invoiceFuel,
    invoiceSeries: 'C26TAA',
    invoiceNumber: '43',
    invoiceType: '1',
    invoiceTypeName: 'Hóa đơn giá trị gia tăng',
    sellerName: 'Northwind Freight (demo)',
    sellerTaxId: 'XX-0000001',
    buyerName: 'Harbor Retail (demo)',
    buyerTaxId: 'XX-0000002',
    currency: 'EUR',
    amount: '9300.75',
    subtotal: '8455.23',
    taxAmount: '845.52',
    issueDate: '2026-10-02',
    dueDate: '2027-01-02',
  },
] as const;

function identityOf(invoice: SeedInvoice): string {
  return sha256Hex(
    canonicalIdentity({
      sellerTaxId: normalizeTaxId(invoice.sellerTaxId),
      series: normalizeInvoiceSeries(invoice.invoiceSeries),
      number: normalizeInvoiceNumber(invoice.invoiceNumber),
      templateCode: normalizeTemplateCode(invoice.invoiceType),
    }),
  );
}

function contentOf(invoice: SeedInvoice): string {
  return sha256Hex(
    canonicalContent({
      buyerTaxId: normalizeTaxId(invoice.buyerTaxId),
      buyerName: invoice.buyerName,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      subtotal: canonicalAmount(new Prisma.Decimal(invoice.subtotal)),
      taxAmount: canonicalAmount(new Prisma.Decimal(invoice.taxAmount)),
      total: canonicalAmount(new Prisma.Decimal(invoice.amount)),
    }),
  );
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const northwind = await prisma.organization.upsert({
      where: { slug: 'northwind-logistics' },
      update: { name: 'Northwind Logistics (demo)' },
      create: {
        id: ID.orgNorthwind,
        name: 'Northwind Logistics (demo)',
        slug: 'northwind-logistics',
        countryCode: 'VN',
      },
    });

    const blueHarbor = await prisma.organization.upsert({
      where: { slug: 'blue-harbor-factoring' },
      update: { name: 'Blue Harbor Factoring (demo)' },
      create: {
        id: ID.orgBlueHarbor,
        name: 'Blue Harbor Factoring (demo)',
        slug: 'blue-harbor-factoring',
        countryCode: 'SG',
      },
    });

    const ops = await prisma.user.upsert({
      where: { email: 'ops@northwind.example' },
      update: {},
      create: {
        id: ID.userOps,
        email: 'ops@northwind.example',
        displayName: 'Demo Operations',
      },
    });

    const finance = await prisma.user.upsert({
      where: { email: 'finance@northwind.example' },
      update: {},
      create: {
        id: ID.userFinance,
        email: 'finance@northwind.example',
        displayName: 'Demo Finance',
      },
    });

    const analyst = await prisma.user.upsert({
      where: { email: 'analyst@blueharbor.example' },
      update: {},
      create: {
        id: ID.userAnalyst,
        email: 'analyst@blueharbor.example',
        displayName: 'Demo Analyst',
      },
    });

    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: northwind.id, userId: ops.id } },
      update: { role: 'OWNER' },
      create: {
        id: ID.membershipOwner,
        organizationId: northwind.id,
        userId: ops.id,
        role: 'OWNER',
      },
    });

    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: northwind.id, userId: finance.id } },
      update: { role: 'MEMBER' },
      create: {
        id: ID.membershipFinance,
        organizationId: northwind.id,
        userId: finance.id,
        role: 'MEMBER',
      },
    });

    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: blueHarbor.id, userId: analyst.id } },
      update: { role: 'ADMIN' },
      create: {
        id: ID.membershipAnalyst,
        organizationId: blueHarbor.id,
        userId: analyst.id,
        role: 'ADMIN',
      },
    });

    const storedInvoices: Invoice[] = [];
    for (const [index, invoice] of invoices.entries()) {
      const fingerprint = identityOf(invoice);

      const stored = await prisma.invoice.upsert({
        where: {
          organizationId_fingerprint: { organizationId: northwind.id, fingerprint },
        },
        update: {},
        create: {
          id: invoice.id,
          organizationId: northwind.id,
          uploadedById: finance.id,
          invoiceNumber: normalizeInvoiceNumber(invoice.invoiceNumber),
          invoiceSeries: normalizeInvoiceSeries(invoice.invoiceSeries),
          invoiceType: normalizeTemplateCode(invoice.invoiceType),
          invoiceTypeName: invoice.invoiceTypeName,
          sellerName: invoice.sellerName,
          buyerName: invoice.buyerName,
          issuerTaxId: normalizeTaxId(invoice.sellerTaxId),
          debtorTaxId: normalizeTaxId(invoice.buyerTaxId),
          currency: invoice.currency,
          amount: invoice.amount,
          subtotalAmount: invoice.subtotal,
          taxAmount: invoice.taxAmount,
          issueDate: new Date(`${invoice.issueDate}T00:00:00.000Z`),
          dueDate: new Date(`${invoice.dueDate}T00:00:00.000Z`),
          // The first invoice is already through verification so the demo has
          // something financeable; the rest stay at the start of the pipeline.
          status: index === 0 ? 'VERIFIED' : 'SUBMITTED',
          fingerprint,
          contentHash: contentOf(invoice),
        },
      });

      storedInvoices.push(stored);
    }

    // Both ids are seeded in the loop above, so these are guaranteed present.
    const verifiedInvoice = storedInvoices[0]!;
    const pendingInvoice = storedInvoices[1]!;

    await prisma.invoiceVerification.upsert({
      where: { id: ID.verificationPassed },
      update: {},
      create: {
        id: ID.verificationPassed,
        invoiceId: verifiedInvoice.id,
        status: 'PASSED',
        provider: 'manual',
        score: 92,
        findings: {
          checks: ['issuer_matches_registry', 'amount_consistent', 'no_prior_financing'],
        },
        verifiedAt: new Date('2026-09-05T09:30:00.000Z'),
      },
    });

    await prisma.invoiceVerification.upsert({
      where: { id: ID.verificationPending },
      update: {},
      create: {
        id: ID.verificationPending,
        invoiceId: pendingInvoice.id,
        status: 'PENDING',
        provider: 'manual',
      },
    });

    const financing = await prisma.financingRequest.upsert({
      where: { invoiceId_activeKey: { invoiceId: verifiedInvoice.id, activeKey: 'ACTIVE' } },
      update: {},
      create: {
        id: ID.financingActive,
        organizationId: northwind.id,
        invoiceId: verifiedInvoice.id,
        requestedById: finance.id,
        requestedAmount: '38600.000000000000000000',
        currency: 'USD',
        status: 'APPROVED',
        termDays: 60,
        interestRateBps: 850,
        purpose: 'Bridge working capital ahead of the December receivable.',
        activeKey: 'ACTIVE',
      },
    });

    await prisma.riskAssessment.upsert({
      where: { id: ID.riskAssessment },
      update: {},
      create: {
        id: ID.riskAssessment,
        financingRequestId: financing.id,
        level: 'MEDIUM',
        score: 68,
        model: 'rules-v1',
        factors: { debtorConcentration: 0.42, paymentHistoryMonths: 26, priorDefaults: 0 },
        assessedAt: new Date('2026-09-06T11:00:00.000Z'),
      },
    });

    await prisma.blockchainRecord.upsert({
      where: {
        chainId_txHash: {
          chainId: 43113,
          txHash: `0x${'ab'.repeat(32)}`,
        },
      },
      update: {},
      create: {
        id: ID.blockchainRecord,
        organizationId: northwind.id,
        kind: 'INVOICE_REGISTRY',
        status: 'CONFIRMED',
        chainId: 43113,
        contractAddress: '0x0000000000000000000000000000000000000000',
        txHash: `0x${'ab'.repeat(32)}`,
        blockNumber: 58_400_000,
        logIndex: 0,
        payloadHash: `0x${createHash('sha256').update(verifiedInvoice.fingerprint).digest('hex')}`,
        invoiceId: verifiedInvoice.id,
        confirmedAt: new Date('2026-09-05T10:02:00.000Z'),
      },
    });

    await prisma.auditLog.upsert({
      where: { id: ID.auditCreated },
      update: {},
      create: {
        id: ID.auditCreated,
        organizationId: northwind.id,
        actorUserId: finance.id,
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: verifiedInvoice.id,
        metadata: { invoiceNumber: verifiedInvoice.invoiceNumber },
      },
    });

    await prisma.auditLog.upsert({
      where: { id: ID.auditVerified },
      update: {},
      create: {
        id: ID.auditVerified,
        organizationId: northwind.id,
        actorUserId: ops.id,
        action: 'invoice.verified',
        entityType: 'invoice',
        entityId: verifiedInvoice.id,
        metadata: { score: 92, provider: 'manual' },
      },
    });

    await prisma.trade.upsert({
      where: { reference: 'TRD-SEED-0001' },
      update: {},
      create: {
        reference: 'TRD-SEED-0001',
        buyerAddress: '0x1111111111111111111111111111111111111111',
        sellerAddress: '0x2222222222222222222222222222222222222222',
        asset: 'USDC',
        amount: '1000.000000000000000000',
        chainId: 43113,
      },
    });

    console.log(
      [
        'Seed complete (idempotent):',
        `  organizations: ${await prisma.organization.count()}`,
        `  users:         ${await prisma.user.count()}`,
        `  memberships:   ${await prisma.organizationMembership.count()}`,
        `  invoices:      ${await prisma.invoice.count()}`,
        `  verifications: ${await prisma.invoiceVerification.count()}`,
        `  financing:     ${await prisma.financingRequest.count()}`,
        `  risk:          ${await prisma.riskAssessment.count()}`,
        `  chain records: ${await prisma.blockchainRecord.count()}`,
        `  audit logs:    ${await prisma.auditLog.count()}`,
        `  trades:        ${await prisma.trade.count()}`,
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
