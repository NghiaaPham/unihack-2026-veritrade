import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../src/auth/auth.types.js';
import { AvalancheRpcService } from '../src/blockchain/avalanche-rpc.service.js';
import { InvoiceAnchorService } from '../src/blockchain/invoice-anchor.service.js';
import { InvoiceCommitmentService } from '../src/blockchain/invoice-commitment.service.js';
import { BlockchainTransactionService } from '../src/blockchain/blockchain-transaction.service.js';
import { TransactionConfirmationService } from '../src/blockchain/transaction-confirmation.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  BlockchainOperationStatus,
  BlockchainOperationType,
  type BlockchainOperation,
} from '../src/generated/prisma/client.js';
import { canonicalIdentity, sha256Hex } from '../src/invoices/invoice-fingerprint.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import { makeInvoice } from './invoice-fixtures.js';

/**
 * The read-only anchor status view must never present an invoice as confirmed
 * without evidence.
 *
 * `anchored` is derived from the operation's status, which only becomes
 * `CONFIRMED` after a real transaction receipt is observed (`record()` in
 * `TransactionConfirmationService`). An operation that is still `SUBMITTED`,
 * `UNKNOWN` or `PENDING` — i.e. one with no receipt — must read as
 * `anchored: false`, even though the row exists and a hash may be known. This is
 * the guard that stops a missing or pending receipt from being displayed as a
 * real on-chain confirmation.
 *
 * No chain is required: these tests build rows directly and assert the
 * presentation, which is the property the public API exposes.
 */
describe('anchor status presentation', () => {
  const CHAIN_ID = 31337;
  const CONTRACT = '0x5fbdb2315678afecb367f032d93f642f64180aa3' as const;

  let database: TestDatabase;
  let anchor: InvoiceAnchorService;
  let organizationId: string;
  let invoiceId: string;
  let sequence = 0;

  const auth: AuthContext = {
    organizationId: '',
    userId: '01930000-0000-7000-8000-0000000000bb',
    email: 'anchor@example',
    displayName: 'Anchor Test',
    organizationSlug: 'anchor-org',
    role: 'MEMBER',
  };

  function config(): ConfigService {
    return new ConfigService({
      AVALANCHE_CHAIN_ID: CHAIN_ID,
      AVALANCHE_RPC_URL: 'http://127.0.0.1:1',
      VERITRADE_CONTRACT_ADDRESS: CONTRACT,
      AVALANCHE_DEPLOYER_PRIVATE_KEY: undefined,
      BLOCKCHAIN_CONFIRMATIONS: 1,
      BLOCKCHAIN_RECONCILE_INTERVAL_MS: 0,
    });
  }

  async function makeOperation(
    status: BlockchainOperationStatus,
    txHash: string | null,
  ): Promise<BlockchainOperation> {
    sequence += 1;

    return database.prisma.blockchainOperation.create({
      data: {
        organizationId,
        kind: BlockchainOperationType.INVOICE_ANCHOR,
        status,
        idempotencyKey: `INVOICE_ANCHOR:${CONTRACT}:present-${sequence}`,
        chainId: CHAIN_ID,
        contractAddress: CONTRACT,
        commitment: `0x${'c'.repeat(64)}`,
        entityId: `0x${'d'.repeat(64)}`,
        txHash,
        fromAddress: '0x1111111111111111111111111111111111111111',
        invoiceId,
      },
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    const prisma = database.prisma as unknown as PrismaService;

    const rpc = new AvalancheRpcService(config());
    const commitments = new InvoiceCommitmentService();
    const confirmations = new TransactionConfirmationService(prisma, rpc, null as never, config());
    const transactions = new BlockchainTransactionService(
      prisma,
      rpc,
      confirmations,
      null as never,
    );

    anchor = new InvoiceAnchorService(prisma, commitments, transactions, confirmations, rpc);
  });

  afterAll(async () => {
    await database?.close();
  });

  beforeEach(async () => {
    await database.reset();

    const organization = await database.prisma.organization.create({
      data: { name: 'Anchor Org', slug: 'anchor-org', countryCode: 'VN' },
    });
    organizationId = organization.id;
    auth.organizationId = organizationId;

    // The invoice's `uploadedById` is a foreign key; it must point at a real row.
    await database.prisma.user.create({
      data: {
        id: '01930000-0000-7000-8000-0000000000bb',
        email: 'anchor-uploader@example',
        displayName: 'Uploader',
      },
    });

    const baseInvoice = makeInvoice({ organizationId, id: '01930000-0000-7000-8000-0000000000f1' });
    const fingerprint = sha256Hex(
      canonicalIdentity({
        sellerTaxId: baseInvoice.issuerTaxId,
        series: baseInvoice.invoiceSeries,
        number: baseInvoice.invoiceNumber,
        templateCode: baseInvoice.invoiceType,
      }),
    );

    const invoice = await database.prisma.invoice.create({
      data: {
        ...baseInvoice,
        fingerprint,
        contentHash: fingerprint,
        status: 'VERIFIED',
      },
    });
    invoiceId = invoice.id;
  });

  it('reports not anchored when there is no operation at all', async () => {
    const status = await anchor.status(auth, invoiceId);

    expect(status.anchored).toBe(false);
    expect(status.operation).toBeNull();
  });

  it('reports not anchored for a SUBMITTED operation with no receipt', async () => {
    await makeOperation(BlockchainOperationStatus.SUBMITTED, `0x${'e'.repeat(64)}`);

    const status = await anchor.status(auth, invoiceId);

    expect(status.anchored).toBe(false);
    expect(status.operation?.status).toBe('SUBMITTED');
  });

  it('reports not anchored for a PENDING operation with no hash', async () => {
    await makeOperation(BlockchainOperationStatus.PENDING, null);

    const status = await anchor.status(auth, invoiceId);

    expect(status.anchored).toBe(false);
    expect(status.operation?.status).toBe('PENDING');
  });

  it('reports anchored for a CONFIRMED operation with a receipt', async () => {
    const operation = await makeOperation(
      BlockchainOperationStatus.CONFIRMED,
      `0x${'f'.repeat(64)}`,
    );

    await database.prisma.blockchainTransactionReceipt.create({
      data: {
        operationId: operation.id,
        chainId: CHAIN_ID,
        txHash: `0x${'f'.repeat(64)}`,
        blockNumber: 100,
        blockHash: `0x${'a'.repeat(64)}`,
        status: 'SUCCESS',
        gasUsed: 100_000n,
        effectiveGasPrice: 1n,
        logCount: 1,
      },
    });

    const status = await anchor.status(auth, invoiceId);

    expect(status.anchored).toBe(true);
    expect(status.operation?.status).toBe('CONFIRMED');
  });
});
