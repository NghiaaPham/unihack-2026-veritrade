import { network } from 'hardhat';

import {
  DeploymentRefused,
  assertSupportedChain,
  parseAddressList,
  requireExplicitConfirmation,
} from './lib/guards.js';
import { readDeployment } from './lib/deployment-record.js';

/**
 * Grants REGISTRAR_ROLE and FINANCIER_ROLE on an existing deployment.
 *
 * Idempotent: an address that already holds the role is reported and skipped,
 * so the script can be re-run after a partial failure without emitting
 * redundant transactions. It never grants DEFAULT_ADMIN_ROLE — that role is
 * fixed at deployment time and is intentionally not rotatable from here.
 */
const connection = await network.getOrCreate();
const publicClient = await connection.viem.getPublicClient();
const chainId = await publicClient.getChainId();
const networkName = connection.networkName;

assertSupportedChain(chainId, networkName);

const record = await readDeployment(chainId);
if (record === null) {
  throw new DeploymentRefused(
    `No deployment recorded for chain ${chainId}. Run the deploy script first.`,
  );
}

requireExplicitConfirmation(chainId, networkName);

const registrars = parseAddressList('REGISTRAR_ADDRESSES');
const financiers = parseAddressList('FINANCIER_ADDRESSES');

if (registrars.length === 0 && financiers.length === 0) {
  throw new DeploymentRefused(
    'Nothing to do: set REGISTRAR_ADDRESSES and/or FINANCIER_ADDRESSES (comma-separated).',
  );
}

const wallets = await connection.viem.getWalletClients();
const signer = wallets[0];
if (signer === undefined) {
  throw new DeploymentRefused(
    `No signer is configured for "${networkName}". Set DEPLOYER_PRIVATE_KEY to the admin key.`,
  );
}

// Captured before the closure so the narrowing survives into `grant`.
const account = signer.account;

const registry = await connection.viem.getContractAt('VeriTradeInvoiceRegistry', record.address);

const adminRole = await registry.read.DEFAULT_ADMIN_ROLE();
const isAdmin = await registry.read.hasRole([adminRole, account.address]);
if (!isAdmin) {
  throw new DeploymentRefused(
    `${account.address} does not hold DEFAULT_ADMIN_ROLE on ${record.address}. ` +
      'Run this script with the admin key.',
  );
}

console.log(`Registry ${record.address} on ${record.network} (${chainId})`);
console.log(`Signer   ${account.address}\n`);

const registrarRole = await registry.read.REGISTRAR_ROLE();
const financierRole = await registry.read.FINANCIER_ROLE();

async function grant(role: `0x${string}`, roleName: string, addresses: `0x${string}`[]) {
  for (const address of addresses) {
    const alreadyHolds = await registry.read.hasRole([role, address]);
    if (alreadyHolds) {
      console.log(`  ${roleName} ${address} already granted, skipping`);
      continue;
    }

    const hash = await registry.write.grantRole([role, address], { account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new DeploymentRefused(`grantRole ${roleName} ${address} reverted (${hash}).`);
    }
    console.log(`  ${roleName} granted to ${address} (${hash})`);
  }
}

await grant(registrarRole, 'REGISTRAR_ROLE', registrars);
await grant(financierRole, 'FINANCIER_ROLE', financiers);

console.log('\nRole initialisation complete.');
