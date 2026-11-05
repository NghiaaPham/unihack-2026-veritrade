import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  toHex,
  type Abi,
  type Hex,
} from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApp } from '../src/app.setup.js';
import { configureOpenApi } from '../src/openapi.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { BlockchainEventIndexerService } from '../src/blockchain/blockchain-event-indexer.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

/**
 * End-to-end registry test.
 *
 * This is the only test that exercises the whole path: HTTP → Nest → outbox →
 * viem → a real EVM → receipt → database. It runs against `hardhat node`
 * (a real EVM, not a mock) and PGlite (a real Postgres engine), so neither the
 * chain nor the database is simulated by a hand-written double.
 *
 * It is skipped when the contract has not been compiled, because the deploy
 * needs the artifact's bytecode. `turbo test` builds first, so the normal
 * pipeline always runs it.
 */

const PORT = 8546;
const RPC_URL = `http://127.0.0.1:${PORT}`;

const CONTRACTS_DIR = fileURLToPath(new URL('../../../packages/contracts/', import.meta.url));
const ARTIFACT_PATH = join(
  CONTRACTS_DIR,
  'artifacts/contracts/VeriTradeInvoiceRegistry.sol/VeriTradeInvoiceRegistry.json',
);
const HARDHAT_BIN = join(CONTRACTS_DIR, 'node_modules/.bin/hardhat');

/**
 * Hardhat's documented development account #0, derived from its default test
 * mnemonic rather than pasted in as a literal.
 *
 * Both the mnemonic and the resulting key are public, and the account is only
 * meaningful on the chain this test spawns. Deriving it keeps a 64-hex string
 * out of the repository, where it would look like a leaked secret to a
 * scanner — and would be one the day someone reuses it by accident.
 */
const DEV_ACCOUNT = mnemonicToAccount(
  'test test test test test test test test test test test junk',
);

function devPrivateKey(): Hex {
  const key = DEV_ACCOUNT.getHdKey().privateKey;
  if (key === null) throw new Error('the test mnemonic produced no private key');
  return toHex(key);
}

const DEV_KEY = devPrivateKey();

const REGISTRAR_ROLE = keccak256(toBytes('VT_REGISTRAR_ROLE'));
const FINANCIER_ROLE = keccak256(toBytes('VT_FINANCIER_ROLE'));

const CLAIM_UNREGISTERED = 0;
const CLAIM_RESERVED = 1;
const CLAIM_FINANCED = 2;
const CLAIM_CLOSED = 3;

/** Built through a helper so the wallet's client type can be derived. */
function buildWallet() {
  return createWalletClient({
    chain: hardhat,
    transport: http(RPC_URL),
    account: privateKeyToAccount(DEV_KEY),
  });
}

type TestWallet = ReturnType<typeof buildWallet>;

const artifact = existsSync(ARTIFACT_PATH)
  ? (JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as {
      abi: Abi;
      bytecode: Hex;
    })
  : null;

async function waitForRpc(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });

      if (response.ok) return;
    } catch {
      // Node not up yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`hardhat node did not start on ${RPC_URL}`);
}

describe.skipIf(artifact === null)('Blockchain registry end to end', () => {
  let node: ChildProcess | null = null;
  let app: INestApplication;
  let database: TestDatabase;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let registryAddress: Hex;
  let publicClient: ReturnType<typeof createPublicClient>;
  let wallet: TestWallet;

  function as(token: string) {
    return {
      post: (path: string) => request(server).post(path).set('Authorization', `Bearer ${token}`),
      get: (path: string) => request(server).get(path).set('Authorization', `Bearer ${token}`),
    };
  }

  async function register(label: string): Promise<{ token: string; organizationId: string }> {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: `${label}@example.test`,
        displayName: label,
        password: 'a-long-test-password',
        organizationName: `${label} organisation`,
        organizationCountry: 'VN',
      })
      .expect(201);

    return {
      token: response.body.accessToken as string,
      organizationId: response.body.organization.id as string,
    };
  }

  let invoiceCounter = 1000;

  async function createInvoice(token: string, number?: string): Promise<string> {
    invoiceCounter += 1;
    const invoiceNumber = number ?? String(invoiceCounter);

    const response = await as(token)
      .post('/api/v1/invoices')
      .send({
        invoiceSeries: 'C25TAA',
        invoiceNumber,
        invoiceType: '1',
        sellerName: 'Công ty TNHH Vận tải Northwind',
        sellerTaxId: '0101234567',
        buyerName: 'Công ty Cổ phần Bán lẻ Minh Anh',
        buyerTaxId: '0107654321',
        currency: 'VND',
        amount: '1650000',
        subtotalAmount: '1500000',
        taxAmount: '150000',
        issueDate: '2026-09-01',
      })
      .expect(201);

    return response.body.id as string;
  }

  async function claimStatus(commitment: string): Promise<number> {
    return (await publicClient.readContract({
      address: registryAddress,
      abi: artifact!.abi,
      functionName: 'statusOf',
      args: [commitment as Hex],
    })) as number;
  }

  beforeAll(async () => {
    node = spawn(HARDHAT_BIN, ['node', '--port', String(PORT)], {
      cwd: CONTRACTS_DIR,
      // 'ignore' on purpose: an unconsumed pipe fills up and blocks the child.
      stdio: 'ignore',
    });

    await waitForRpc();

    const account = privateKeyToAccount(DEV_KEY);
    wallet = buildWallet();
    publicClient = createPublicClient({ chain: hardhat, transport: http(RPC_URL) });

    const deployHash = await wallet.deployContract({
      abi: artifact!.abi,
      bytecode: artifact!.bytecode,
      args: [account.address],
    });
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });

    if (!deployReceipt.contractAddress) {
      throw new Error('Deployment produced no contract address');
    }
    registryAddress = deployReceipt.contractAddress;

    for (const role of [REGISTRAR_ROLE, FINANCIER_ROLE]) {
      const hash = await wallet.writeContract({
        address: registryAddress,
        abi: artifact!.abi,
        functionName: 'grantRole',
        args: [role, account.address],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }

    // `ConfigModule.forRoot` validates the environment when `AppModule` is
    // *evaluated*, not when the testing module is compiled. Importing it
    // statically at the top of this file would therefore freeze the defaults
    // before the chain exists, so it is imported dynamically below.
    process.env.AVALANCHE_CHAIN_ID = '31337';
    process.env.AVALANCHE_RPC_URL = RPC_URL;
    process.env.VERITRADE_CONTRACT_ADDRESS = registryAddress;
    process.env.AVALANCHE_DEPLOYER_PRIVATE_KEY = DEV_KEY;
    process.env.BLOCKCHAIN_CONFIRMATIONS = '1';

    database = await createTestDatabase();

    const { AppModule } = await import('../src/app.module.js');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(database.prisma)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    configureOpenApi(app);
    await app.init();

    server = app.getHttpServer();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await database?.close();

    if (node !== null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          node?.kill('SIGKILL');
          resolve();
        }, 3_000);

        node?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        node?.kill('SIGTERM');
      });
    }
  }, 30_000);

  describe('anchoring', () => {
    it('anchors an invoice, confirms the transaction and reserves the claim', async () => {
      const org = await register('anchor-happy');
      const invoiceId = await createInvoice(org.token);

      const response = await as(org.token).post(`/api/v1/invoices/${invoiceId}/anchor`).expect(200);

      expect(response.body.status).toBe('CONFIRMED');
      expect(response.body.kind).toBe('INVOICE_ANCHOR');
      expect(response.body.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(response.body.receipt.status).toBe('SUCCESS');
      expect(response.body.receipt.blockNumber).toBeGreaterThan(0);

      expect(await claimStatus(response.body.commitment)).toBe(CLAIM_RESERVED);
    });

    it('does not send a second transaction when called again', async () => {
      const org = await register('anchor-idempotent');
      const invoiceId = await createInvoice(org.token);

      const first = await as(org.token).post(`/api/v1/invoices/${invoiceId}/anchor`).expect(200);
      const second = await as(org.token).post(`/api/v1/invoices/${invoiceId}/anchor`).expect(200);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.txHash).toBe(first.body.txHash);
      expect(second.body.attemptCount).toBe(first.body.attemptCount);
    });

    it('reports anchor status with the live claim state', async () => {
      const org = await register('anchor-status');
      const invoiceId = await createInvoice(org.token);

      const before = await as(org.token)
        .get(`/api/v1/invoices/${invoiceId}/anchor-status`)
        .expect(200);
      expect(before.body.anchored).toBe(false);
      expect(before.body.operation).toBeNull();

      await as(org.token).post(`/api/v1/invoices/${invoiceId}/anchor`).expect(200);

      const after = await as(org.token)
        .get(`/api/v1/invoices/${invoiceId}/anchor-status`)
        .expect(200);
      expect(after.body.anchored).toBe(true);
      expect(after.body.claimStatus).toBe('RESERVED');
      expect(after.body.operation.status).toBe('CONFIRMED');
    });

    it('refuses to anchor an invoice with no verification run', async () => {
      const org = await register('anchor-unverified');
      const membership = await database.prisma.organizationMembership.findFirstOrThrow({
        where: { organizationId: org.organizationId },
      });

      const invoice = await database.prisma.invoice.create({
        data: {
          organizationId: org.organizationId,
          uploadedById: membership.userId,
          invoiceNumber: 'UNVERIFIED-1',
          issuerTaxId: '0101234567',
          debtorTaxId: '0107654321',
          currency: 'VND',
          invoiceSeries: 'C25TAA',
          invoiceType: '1',
          sellerName: 'Công ty TNHH Vận tải Northwind',
          buyerName: 'Công ty Cổ phần Bán lẻ Minh Anh',
          amount: new Prisma.Decimal('1650000'),
          issueDate: new Date('2026-09-01T00:00:00.000Z'),
          status: 'SUBMITTED',
          fingerprint: 'd'.repeat(64),
          contentHash: 'e'.repeat(64),
        },
      });

      const response = await as(org.token)
        .post(`/api/v1/invoices/${invoice.id}/anchor`)
        .expect(409);

      expect(response.body.code).toBe('INVOICE_NOT_VERIFIED');
    });

    it('rejects the same invoice anchored by a second organization', async () => {
      const seller = await register('collision-a');
      const copycat = await register('collision-b');

      // The same identity in two tenants: the per-tenant unique index allows
      // it off-chain, and the globally keyed commitment is what stops the
      // second financing.
      const sellerInvoice = await createInvoice(seller.token, '5001');
      const copycatInvoice = await createInvoice(copycat.token, '5001');

      const first = await as(seller.token)
        .post(`/api/v1/invoices/${sellerInvoice}/anchor`)
        .expect(200);

      const response = await as(copycat.token)
        .post(`/api/v1/invoices/${copycatInvoice}/anchor`)
        .expect(409);

      expect(response.body.status).toBe('FAILED');
      expect(response.body.error.code).toContain('ClaimAlreadyActive');
      expect(response.body.error.message).toContain('register');
      expect(await claimStatus(first.body.commitment)).toBe(CLAIM_RESERVED);
    });
  });

  describe('transaction lookup', () => {
    it('returns a confirmed operation with its receipt', async () => {
      const org = await register('tx-lookup');
      const invoiceId = await createInvoice(org.token);
      const anchored = await as(org.token).post(`/api/v1/invoices/${invoiceId}/anchor`).expect(200);

      const response = await as(org.token)
        .get(`/api/v1/blockchain/transactions/${anchored.body.id}`)
        .expect(200);

      expect(response.body.status).toBe('CONFIRMED');
      expect(response.body.receipt.gasUsed).toMatch(/^\d+$/);
    });

    it('hides another organization operation behind a 404', async () => {
      const owner = await register('tx-owner');
      const stranger = await register('tx-stranger');
      const invoiceId = await createInvoice(owner.token);
      const anchored = await as(owner.token)
        .post(`/api/v1/invoices/${invoiceId}/anchor`)
        .expect(200);

      await as(stranger.token)
        .get(`/api/v1/blockchain/transactions/${anchored.body.id}`)
        .expect(404);
    });
  });

  describe('financing lifecycle', () => {
    async function reservedRequest(label: string) {
      const org = await register(label);
      const invoiceId = await createInvoice(org.token);
      const membership = await database.prisma.organizationMembership.findFirstOrThrow({
        where: { organizationId: org.organizationId },
      });

      const financingRequest = await database.prisma.financingRequest.create({
        data: {
          organizationId: org.organizationId,
          invoiceId,
          requestedById: membership.userId,
          requestedAmount: new Prisma.Decimal('1000000'),
          currency: 'VND',
          status: 'REQUESTED',
          termDays: 30,
          interestRateBps: 1200,
          purpose: 'Working capital',
          activeKey: 'ACTIVE',
        },
      });

      const reserved = await as(org.token)
        .post(`/api/v1/financing-requests/${financingRequest.id}/reserve`)
        .expect(200);

      return { org, financingRequest, reserved };
    }

    it('reserves, declares financing and closes', async () => {
      const { org, financingRequest, reserved } = await reservedRequest('lifecycle');

      expect(reserved.body.status).toBe('RESERVED');
      expect(reserved.body.operation.status).toBe('CONFIRMED');
      expect(await claimStatus(reserved.body.operation.commitment)).toBe(CLAIM_RESERVED);

      const declared = await as(org.token)
        .post(`/api/v1/financing-requests/${financingRequest.id}/declare-financed`)
        .expect(200);

      expect(declared.body.status).toBe('FINANCING_DECLARED');
      expect(await claimStatus(declared.body.operation.commitment)).toBe(CLAIM_FINANCED);

      const closed = await as(org.token)
        .post(`/api/v1/financing-requests/${financingRequest.id}/close`)
        .expect(200);

      expect(closed.body.status).toBe('CLOSED');
      expect(await claimStatus(closed.body.operation.commitment)).toBe(CLAIM_CLOSED);

      // Anchoring is idempotent, so re-posting returns the original confirmed
      // operation. The claim state is what moved, and the status endpoint is
      // where a client must look.
      const again = await as(org.token)
        .post(`/api/v1/invoices/${financingRequest.invoiceId}/anchor`)
        .expect(200);
      expect(again.body.id).toBe(reserved.body.operation.id);

      const status = await as(org.token)
        .get(`/api/v1/invoices/${financingRequest.invoiceId}/anchor-status`)
        .expect(200);
      expect(status.body.claimStatus).toBe('CLOSED');
    });

    it('cancels a reservation without marking the invoice financed', async () => {
      const { org, financingRequest, reserved } = await reservedRequest('cancellation');

      const cancelled = await as(org.token)
        .post(`/api/v1/financing-requests/${financingRequest.id}/cancel-reservation`)
        .expect(200);

      expect(cancelled.body.status).toBe('CANCELLED');
      expect(await claimStatus(reserved.body.operation.commitment)).toBe(CLAIM_UNREGISTERED);
    });

    it('rejects closing a claim that was never financed', async () => {
      const { org, financingRequest } = await reservedRequest('invalid-transition');

      const response = await as(org.token)
        .post(`/api/v1/financing-requests/${financingRequest.id}/close`)
        .expect(409);

      expect(response.body.code).toBe('INVALID_FINANCING_STATE');
    });

    it('rejects declaring financing twice', async () => {
      const { org, financingRequest } = await reservedRequest('double-declare');

      await as(org.token)
        .post(`/api/v1/financing-requests/${financingRequest.id}/declare-financed`)
        .expect(200);

      const response = await as(org.token)
        .post(`/api/v1/financing-requests/${financingRequest.id}/declare-financed`)
        .expect(409);

      expect(response.body.code).toBe('INVALID_FINANCING_STATE');
    });
  });

  describe('openapi', () => {
    it('publishes every registry endpoint in the generated document', async () => {
      const response = await request(server).get('/api/docs-json').expect(200);

      expect(Object.keys(response.body.paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/invoices/{id}/anchor',
          '/api/v1/invoices/{id}/anchor-status',
          '/api/v1/financing-requests/{id}/reserve',
          '/api/v1/financing-requests/{id}/declare-financed',
          '/api/v1/financing-requests/{id}/close',
          '/api/v1/financing-requests/{id}/cancel-reservation',
          '/api/v1/blockchain/transactions/{id}',
        ]),
      );
    });
  });

  describe('event indexing', () => {
    it('indexes registry events once and ignores a replay', async () => {
      const org = await register('indexer');
      const invoiceId = await createInvoice(org.token);
      await as(org.token).post(`/api/v1/invoices/${invoiceId}/anchor`).expect(200);

      const indexer = app.get(BlockchainEventIndexerService);

      const first = await indexer.syncOnce();
      expect(first.indexed).toBeGreaterThan(0);

      const stored = await database.prisma.blockchainEvent.count();
      expect(stored).toBeGreaterThan(0);

      // Rewind the cursor without deleting anything: the same logs are seen
      // again, and the unique key must absorb them.
      await database.prisma.chainSyncCursor.updateMany({
        data: { lastProcessedBlock: 0n, lastProcessedBlockHash: null },
      });

      const replay = await indexer.syncOnce();
      expect(replay.indexed).toBe(0);
      expect(await database.prisma.blockchainEvent.count()).toBe(stored);
    });

    it('rewinds when the block it stopped at is replaced', async () => {
      const org = await register('reorg');
      const invoiceId = await createInvoice(org.token);
      await as(org.token).post(`/api/v1/invoices/${invoiceId}/anchor`).expect(200);

      const indexer = app.get(BlockchainEventIndexerService);
      await indexer.syncOnce();

      const snapshot = (await publicClient.request({
        method: 'evm_snapshot',
        params: [],
      })) as Hex;

      const filler = await wallet.sendTransaction({
        to: wallet.account.address,
        value: 1n,
      });
      await publicClient.waitForTransactionReceipt({ hash: filler });
      await indexer.syncOnce();

      await publicClient.request({ method: 'evm_revert', params: [snapshot] });

      // Mine a different block at the same height, so the stored hash for that
      // height no longer describes the canonical chain.
      const replacement = await wallet.sendTransaction({
        to: wallet.account.address,
        value: 2n,
      });
      await publicClient.waitForTransactionReceipt({ hash: replacement });

      const result = await indexer.syncOnce();
      expect(result.reorged).toBe(true);
    });
  });
});
