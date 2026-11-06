import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbiItem,
  toBytes,
  toHex,
  type Abi,
  type Hex,
} from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditLogsService } from '../src/audit-logs/audit-logs.service.js';
import { AvalancheRpcService } from '../src/blockchain/avalanche-rpc.service.js';
import { BlockchainReconciliationService } from '../src/blockchain/blockchain-reconciliation.service.js';
import { BlockchainTransactionService } from '../src/blockchain/blockchain-transaction.service.js';
import { NonceAllocatorService } from '../src/blockchain/nonce-allocator.service.js';
import { TransactionConfirmationService } from '../src/blockchain/transaction-confirmation.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  BlockchainOperationStatus,
  BlockchainOperationType,
  type BlockchainOperation,
} from '../src/generated/prisma/client.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

/**
 * Crash recovery against a real EVM.
 *
 * The states below are not invented: each one is a moment where a process can
 * die or a call can fail, and the point of every test is that the worker ends
 * up with *one* transaction per invoice rather than two.
 *
 * The services are built by hand rather than through Nest. Nothing here is
 * reached over HTTP, and constructing them directly keeps the test about the
 * recovery logic instead of about module wiring.
 */

const PORT = 8547;
const RPC_URL = `http://127.0.0.1:${PORT}`;

const CONTRACTS_DIR = fileURLToPath(new URL('../../../packages/contracts/', import.meta.url));
const ARTIFACT_PATH = join(
  CONTRACTS_DIR,
  'artifacts/contracts/VeriTradeInvoiceRegistry.sol/VeriTradeInvoiceRegistry.json',
);
const HARDHAT_BIN = join(CONTRACTS_DIR, 'node_modules/.bin/hardhat');

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

/**
 * Only the event this file filters on, declared here so `getLogs` can infer the
 * argument types. The artifact's ABI is typed as a generic `Abi`, which viem
 * cannot narrow to a single event.
 */
const INVOICE_RESERVED = parseAbiItem(
  'event InvoiceReserved(bytes32 indexed commitment, bytes32 indexed entityId, address indexed registrar, uint32 generation, uint16 schemaVersion, uint64 blockTimestamp)',
);

const artifact = existsSync(ARTIFACT_PATH)
  ? (JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as { abi: Abi; bytecode: Hex })
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

describe.skipIf(artifact === null)('Transaction recovery', () => {
  let node: ChildProcess | null = null;
  let database: TestDatabase;
  let registry: Hex;
  let organizationId: string;

  let wallet: ReturnType<typeof buildWallet>;
  let publicClient: ReturnType<typeof buildPublicClient>;

  let rpc: AvalancheRpcService;
  let reconciliation: BlockchainReconciliationService;
  let nonces: NonceAllocatorService;

  function buildWallet() {
    return createWalletClient({
      chain: hardhat,
      transport: http(RPC_URL),
      account: privateKeyToAccount(DEV_KEY),
    });
  }

  /**
   * Built through a function so the client keeps its concrete type. Annotating
   * the variable as `ReturnType<typeof createPublicClient>` collapses the
   * generics, and viem then cannot infer `args` for `getLogs`.
   */
  function buildPublicClient() {
    return createPublicClient({ chain: hardhat, transport: http(RPC_URL) });
  }

  const prisma = () => database.prisma;

  let sequence = 0;

  function nextCommitment(): Hex {
    sequence += 1;
    return keccak256(toBytes(`recovery-test-${sequence}`));
  }

  async function makeOperation(overrides: {
    commitment: Hex;
    status: BlockchainOperationStatus;
    txHash?: Hex | null;
    nonce?: number | null;
    nextAttemptAt?: Date | null;
    leaseOwner?: string | null;
    leaseExpiresAt?: Date | null;
  }): Promise<BlockchainOperation> {
    sequence += 1;

    return prisma().blockchainOperation.create({
      data: {
        organizationId,
        kind: BlockchainOperationType.INVOICE_ANCHOR,
        status: overrides.status,
        idempotencyKey: `INVOICE_ANCHOR:${registry}:recovery-${sequence}`,
        chainId: 31337,
        contractAddress: registry,
        commitment: overrides.commitment,
        entityId: keccak256(toBytes('entity')),
        txHash: overrides.txHash ?? null,
        fromAddress: DEV_ACCOUNT.address.toLowerCase(),
        nonce: overrides.nonce ?? null,
        nextAttemptAt: overrides.nextAttemptAt ?? null,
        leaseOwner: overrides.leaseOwner ?? null,
        leaseExpiresAt: overrides.leaseExpiresAt ?? null,
      },
    });
  }

  /** Broadcasts `register` outside the API, so the operation row can lie about it. */
  async function registerOnChain(commitment: Hex): Promise<{ hash: Hex; nonce: number }> {
    const nonce = await publicClient.getTransactionCount({
      address: DEV_ACCOUNT.address,
      blockTag: 'pending',
    });

    const hash = await wallet.writeContract({
      address: registry,
      abi: artifact!.abi,
      functionName: 'register',
      args: [commitment, keccak256(toBytes('entity'))],
      nonce,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    return { hash, nonce };
  }

  /** How many `InvoiceReserved` events exist for a commitment. Should never exceed 1. */
  async function reservationsOf(commitment: Hex): Promise<number> {
    const logs = await publicClient.getLogs({
      address: registry,
      event: INVOICE_RESERVED,
      args: { commitment },
      fromBlock: 0n,
    });

    return logs.length;
  }

  beforeAll(async () => {
    node = spawn(HARDHAT_BIN, ['node', '--port', String(PORT)], {
      cwd: CONTRACTS_DIR,
      stdio: 'ignore',
    });

    await waitForRpc();

    wallet = buildWallet();
    publicClient = buildPublicClient();

    const deployHash = await wallet.deployContract({
      abi: artifact!.abi,
      bytecode: artifact!.bytecode,
      args: [DEV_ACCOUNT.address],
    });
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });

    if (!deployReceipt.contractAddress) throw new Error('deployment produced no address');
    registry = deployReceipt.contractAddress;

    const grantHash = await wallet.writeContract({
      address: registry,
      abi: artifact!.abi,
      functionName: 'grantRole',
      args: [REGISTRAR_ROLE, DEV_ACCOUNT.address],
    });
    await publicClient.waitForTransactionReceipt({ hash: grantHash });

    const config = new ConfigService({
      AVALANCHE_CHAIN_ID: 31337,
      AVALANCHE_RPC_URL: RPC_URL,
      VERITRADE_CONTRACT_ADDRESS: registry,
      AVALANCHE_DEPLOYER_PRIVATE_KEY: DEV_KEY,
      BLOCKCHAIN_CONFIRMATIONS: 1,
      BLOCKCHAIN_RECONCILE_INTERVAL_MS: 0,
    });

    database = await createTestDatabase();
    const client = database.prisma as unknown as PrismaService;

    rpc = new AvalancheRpcService(config);
    nonces = new NonceAllocatorService(client, rpc);

    const audit = new AuditLogsService(client);
    const confirmations = new TransactionConfirmationService(client, rpc, audit, config);
    const transactions = new BlockchainTransactionService(client, rpc, confirmations, nonces);

    reconciliation = new BlockchainReconciliationService(
      client,
      rpc,
      transactions,
      confirmations,
      config,
    );

    const organization = await prisma().organization.create({
      data: { name: 'Recovery Org', slug: 'recovery-org', countryCode: 'VN' },
    });
    organizationId = organization.id;
  }, 120_000);

  afterAll(async () => {
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

  it('confirms a SUBMITTED operation the request never finished waiting for', async () => {
    const commitment = nextCommitment();
    const { hash, nonce } = await registerOnChain(commitment);

    const operation = await makeOperation({
      commitment,
      status: BlockchainOperationStatus.SUBMITTED,
      txHash: hash,
      nonce,
    });

    const result = await reconciliation.reconcileOnce();
    expect(result.confirmed).toBeGreaterThanOrEqual(1);

    const stored = await prisma().blockchainOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });

    expect(stored.status).toBe(BlockchainOperationStatus.CONFIRMED);
    expect(stored.confirmedAt).not.toBeNull();
    expect(stored.leaseOwner).toBeNull();

    const receipt = await prisma().blockchainTransactionReceipt.findUnique({
      where: { operationId: operation.id },
    });
    expect(receipt).not.toBeNull();
    expect(receipt?.txHash).toBe(hash);

    // The business-facing projection exists too, not just the raw receipt.
    const record = await prisma().blockchainRecord.findFirst({
      where: { txHash: hash, chainId: 31337 },
    });
    expect(record?.status).toBe('CONFIRMED');

    // Confirmation is evidence-backed: a CONFIRMED projection is only ever
    // written together with a receipt in the same transaction
    // (`TransactionConfirmationService.record`). A real confirmation therefore
    // always has a matching `blockchain_transaction_receipt`. Any CONFIRMED
    // record without one would be a fabricated confirmation, which is exactly
    // the hazard the seed must never reintroduce.
    const evidence = await prisma().blockchainTransactionReceipt.findFirst({
      where: { txHash: hash, chainId: 31337 },
    });
    expect(evidence).not.toBeNull();
    expect(evidence?.status).toBe('SUCCESS');
  });

  it('resolves an UNKNOWN operation by hash and sends nothing new', async () => {
    const commitment = nextCommitment();
    const { hash, nonce } = await registerOnChain(commitment);

    const operation = await makeOperation({
      commitment,
      status: BlockchainOperationStatus.UNKNOWN,
      txHash: hash,
      nonce,
    });

    const nonceBefore = await publicClient.getTransactionCount({
      address: DEV_ACCOUNT.address,
      blockTag: 'latest',
    });

    await reconciliation.reconcileOnce();

    const stored = await prisma().blockchainOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });

    expect(stored.status).toBe(BlockchainOperationStatus.CONFIRMED);
    expect(stored.txHash).toBe(hash);

    // The decisive assertion: the account nonce did not move, so no second
    // transaction was signed for this invoice.
    const nonceAfter = await publicClient.getTransactionCount({
      address: DEV_ACCOUNT.address,
      blockTag: 'latest',
    });
    expect(nonceAfter).toBe(nonceBefore);

    expect(await reservationsOf(commitment)).toBe(1);
  });

  it('re-broadcasts a hash-less operation at its reserved nonce when the nonce is unused', async () => {
    const commitment = nextCommitment();

    const reservedNonce = await publicClient.getTransactionCount({
      address: DEV_ACCOUNT.address,
      blockTag: 'pending',
    });

    // Exactly the state a crash between reserving a nonce and sending leaves
    // behind: SUBMITTING, a nonce, no hash.
    const operation = await makeOperation({
      commitment,
      status: BlockchainOperationStatus.SUBMITTING,
      txHash: null,
      nonce: reservedNonce,
    });

    const result = await reconciliation.reconcileOnce();

    const stored = await prisma().blockchainOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });

    expect(stored.status).toBe(BlockchainOperationStatus.CONFIRMED);
    expect(stored.txHash).not.toBeNull();
    expect(result.resubmitted).toBeGreaterThanOrEqual(1);
    expect(result.adopted).toBe(0);
    expect(stored.leaseOwner).toBeNull();

    // Reusing the reserved nonce is what keeps the sequence contiguous; a fresh
    // nonce would have left `reservedNonce` permanently unspent.
    expect(stored.nonce).toBe(reservedNonce);
    expect(await reservationsOf(commitment)).toBe(1);
  });

  it('adopts an existing transaction instead of signing a second one when the nonce was spent', async () => {
    const commitment = nextCommitment();
    const { hash, nonce } = await registerOnChain(commitment);

    // The process lost the hash: UNKNOWN, no txHash, but the nonce was used.
    const operation = await makeOperation({
      commitment,
      status: BlockchainOperationStatus.UNKNOWN,
      txHash: null,
      nonce,
    });

    const nonceBefore = await publicClient.getTransactionCount({
      address: DEV_ACCOUNT.address,
      blockTag: 'latest',
    });

    const result = await reconciliation.reconcileOnce();

    const stored = await prisma().blockchainOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });

    expect(stored.status).toBe(BlockchainOperationStatus.CONFIRMED);
    expect(stored.txHash).toBe(hash);

    // Adopting must not be reported as a resubmission: nothing was signed, and
    // an operator reading the worker log needs to see that difference.
    expect(result.adopted).toBeGreaterThanOrEqual(1);
    expect(result.resubmitted).toBe(0);

    // A terminal row must not keep a lease; a stale owner reads as work in
    // progress to whoever inspects the table.
    expect(stored.leaseOwner).toBeNull();

    const nonceAfter = await publicClient.getTransactionCount({
      address: DEV_ACCOUNT.address,
      blockTag: 'latest',
    });
    expect(nonceAfter).toBe(nonceBefore);

    // Two transactions for one invoice is the failure this phase exists to
    // prevent; the contract would reject the second anyway, but the point is
    // that it is never attempted.
    expect(await reservationsOf(commitment)).toBe(1);
  });

  it('leaves a confirmed operation alone', async () => {
    const commitment = nextCommitment();
    const { hash, nonce } = await registerOnChain(commitment);

    const operation = await makeOperation({
      commitment,
      status: BlockchainOperationStatus.CONFIRMED,
      txHash: hash,
      nonce,
    });

    const before = await prisma().blockchainOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });

    await reconciliation.reconcileOnce();

    const after = await prisma().blockchainOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });

    expect(after.status).toBe(BlockchainOperationStatus.CONFIRMED);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('does not touch an operation another worker is holding', async () => {
    const commitment = nextCommitment();

    const operation = await makeOperation({
      commitment,
      status: BlockchainOperationStatus.UNKNOWN,
      txHash: null,
      nonce: null,
      leaseOwner: 'a-different-instance',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });

    const result = await reconciliation.reconcileOnce();
    expect(result.claimed).toBe(0);

    const stored = await prisma().blockchainOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });
    expect(stored.status).toBe(BlockchainOperationStatus.UNKNOWN);
    expect(stored.leaseOwner).toBe('a-different-instance');
  });

  it('hands out distinct nonces under concurrent allocation', async () => {
    // Two allocators, as two instances would be: the row lock, not the process,
    // is what has to serialise them.
    const second = new NonceAllocatorService(database.prisma as unknown as PrismaService, rpc);

    const requested = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        (index % 2 === 0 ? nonces : second).allocate(DEV_ACCOUNT.address),
      ),
    );

    expect(new Set(requested).size).toBe(requested.length);

    // And they are ahead of what the chain has already used, never behind it.
    const mined = await publicClient.getTransactionCount({
      address: DEV_ACCOUNT.address,
      blockTag: 'latest',
    });
    for (const nonce of requested) {
      expect(nonce).toBeGreaterThanOrEqual(mined);
    }
  });
});
