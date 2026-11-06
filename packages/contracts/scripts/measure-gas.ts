import { network } from 'hardhat';
import { keccak256, toBytes, type Hex } from 'viem';

/**
 * Measures gas for every registry operation on a local EVM.
 *
 * Why a script and not a test: the numbers are a deliverable, and a test that
 * prints is a test nobody reads. This runs the full lifecycle and prints a
 * table that can be pasted into a report.
 *
 * What the numbers mean, and what they do not:
 *
 *   * **Gas units are a property of the bytecode**, so a `register` costs the
 *     same 60-odd thousand gas on Fuji as it does here. That part transfers.
 *   * **The price is not.** Cost in AVAX is gas × gasPrice, and gasPrice on a
 *     live chain moves with demand. The script reads the local node's price for
 *     the local total, and prints the Fuji base fee separately as an
 *     illustration rather than a quote.
 *   * **State warm-up differs.** The first write to a storage slot costs more
 *     than a later one. Each operation here runs against a fresh commitment, so
 *     the numbers are the worst case for a first claim, which is the case that
 *     matters for a budget.
 *
 * Usage:
 *   npx hardhat node            # in one terminal
 *   npx hardhat run scripts/measure-gas.ts --network localhost
 */

const REGISTRAR_ROLE = keccak256(toBytes('VT_REGISTRAR_ROLE'));
const FINANCIER_ROLE = keccak256(toBytes('VT_FINANCIER_ROLE'));

const connection = await network.getOrCreate();
const publicClient = await connection.viem.getPublicClient();
const chainId = await publicClient.getChainId();
const wallets = await connection.viem.getWalletClients();
const signer = wallets[0];

if (signer === undefined) {
  throw new Error('No signer configured for this network. Run against a local Hardhat node.');
}

const account = signer.account.address;

interface Measurement {
  step: string;
  gas: bigint;
  transactionHash: string;
}

const measurements: Measurement[] = [];

async function record(step: string, hash: Hex): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`${step} reverted in ${hash}`);
  }

  measurements.push({ step, gas: receipt.gasUsed, transactionHash: hash });
}

function commitment(label: string): Hex {
  return keccak256(toBytes(`gas-measurement-${label}-${Date.now()}`));
}

function entity(label: string): Hex {
  return keccak256(toBytes(`gas-entity-${label}`));
}

console.log(`Measuring registry gas on chain ${chainId} as ${account}\n`);

// --- Deployment ------------------------------------------------------------

const { contract, deploymentTransaction } = await connection.viem.sendDeploymentTransaction(
  'VeriTradeInvoiceRegistry',
  [account],
);

const deployReceipt = await publicClient.waitForTransactionReceipt({
  hash: deploymentTransaction.hash,
});
if (deployReceipt.status !== 'success') throw new Error('deployment reverted');

const deploymentGas = deployReceipt.gasUsed;

// --- Roles -----------------------------------------------------------------

for (const role of [REGISTRAR_ROLE, FINANCIER_ROLE]) {
  await record(
    role === REGISTRAR_ROLE ? 'grantRole(REGISTRAR)' : 'grantRole(FINANCIER)',
    await contract.write.grantRole([role, account], { account }),
  );
}

// --- Registration ----------------------------------------------------------

const first = commitment('first');
await record(
  'register (first claim)',
  await contract.write.register([first, entity('first')], { account }),
);

// A second registration of a *different* commitment, to show the cost when the
// contract's storage slot is cold again but the mapping entry is not the issue.
const second = commitment('second');
await record(
  'register (fresh commitment)',
  await contract.write.register([second, entity('second')], { account }),
);

// --- Financing -------------------------------------------------------------

await record(
  'declareFinanced',
  await contract.write.declareFinanced([first, keccak256(toBytes('financing-ref-1'))], { account }),
);

// --- Cancellation ----------------------------------------------------------

const third = commitment('third');
await contract.write.register([third, entity('third')], { account });
await record('cancelReservation', await contract.write.cancelReservation([third], { account }));

// --- Closing ---------------------------------------------------------------

await record('closeClaim', await contract.write.closeClaim([first], { account }));

// --- Report ----------------------------------------------------------------

const gasPrice = await publicClient.getGasPrice();

const rows = measurements.map((entry) => ({
  Operation: entry.step,
  'Gas used': entry.gas.toString(),
  'Cost (AVAX @ local price)': formatAvax(entry.gas * gasPrice),
}));

console.log('Deployment');
console.log(`  gas used   ${deploymentGas.toString()}`);
console.log(`  cost       ${formatAvax(deploymentGas * gasPrice)} AVAX at ${gasPrice} wei/gas\n`);

console.table(rows);

console.log('\nLocal gas price:', gasPrice.toString(), 'wei/gas');

// The Fuji figure is fetched, not assumed. It is a snapshot of the base fee at
// the moment this ran and will differ by the time anyone reads it.
const fuji = await fetchFujiGasPrice();
if (fuji !== null) {
  console.log('\nFuji C-Chain eth_gasPrice (live snapshot):', fuji.toString(), 'wei/gas');
  console.log('\nIllustrative Fuji cost using the gas units above:');

  console.table(
    measurements.map((entry) => ({
      Operation: entry.step,
      'Gas used': entry.gas.toString(),
      'Cost (AVAX)': formatAvax(entry.gas * fuji),
    })),
  );
  console.log(`Deployment: ${formatAvax(deploymentGas * fuji)} AVAX`);
  console.log(
    '\nThis is gas units × a snapshot price. It is not a quote: the base fee\n' +
      'changes, and a real transaction may be priced above it.',
  );
} else {
  console.log('\nFuji gas price unavailable (no network). Local numbers stand on their own.');
}

/**
 * AVAX with enough precision to be useful.
 *
 * 12 decimals, not 8: Avalanche's base fee is around 25 nAVAX (2.5e-8 AVAX per
 * gas), so a 100k-gas operation costs roughly 0.0025 AVAX on Fuji — and at the
 * 160 wei/gas seen on a quiet testnet it is nearer 0.000016. Eight decimals
 * would print that as zero.
 */
function formatAvax(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 12);
  return `${whole}.${fraction}`;
}

async function fetchFujiGasPrice(): Promise<bigint | null> {
  try {
    const response = await fetch('https://api.avax-test.network/ext/bc/C/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { result?: string };
    return body.result === undefined ? null : BigInt(body.result);
  } catch {
    return null;
  }
}
