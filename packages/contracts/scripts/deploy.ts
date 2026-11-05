import { network } from 'hardhat';

import {
  DeploymentRefused,
  assertSupportedChain,
  requireAddress,
  requireExplicitConfirmation,
} from './lib/guards.js';
import { describeDeployment, readDeployment, writeDeployment } from './lib/deployment-record.js';

/**
 * Deploys VeriTradeInvoiceRegistry.
 *
 * The script never invents a signer: if the target network has no configured
 * account it stops instead of falling back to an unlocked node account. It also
 * refuses to overwrite an existing deployment record, because a second registry
 * on the same chain would silently split duplicate detection in two.
 */
const connection = await network.getOrCreate();
// The chain id is read from the node, not from the config: a misconfigured RPC
// URL must be caught here rather than trusted because a name says "fuji".
const publicClient = await connection.viem.getPublicClient();
const chainId = await publicClient.getChainId();
const networkName = connection.networkName;

assertSupportedChain(chainId, networkName);

const existing = await readDeployment(chainId);
if (existing !== null) {
  throw new DeploymentRefused(
    `Chain ${chainId} already has a registry recorded at ${existing.address}.\n` +
      'Deploying again would create a second registry with its own duplicate-detection state.\n' +
      `If you really need a new one, remove deployments/${chainId}.json first.`,
  );
}

requireExplicitConfirmation(chainId, networkName);

const wallets = await connection.viem.getWalletClients();
const deployer = wallets[0];
if (deployer === undefined) {
  throw new DeploymentRefused(
    `No signer is configured for "${networkName}". ` +
      'Set DEPLOYER_PRIVATE_KEY (a throwaway testnet key) before deploying.',
  );
}

const admin =
  process.env.REGISTRY_ADMIN_ADDRESS === undefined ||
  process.env.REGISTRY_ADMIN_ADDRESS.trim() === ''
    ? deployer.account.address
    : requireAddress('REGISTRY_ADMIN_ADDRESS');

console.log(`Deploying VeriTradeInvoiceRegistry`);
console.log(`  network    ${networkName} (${chainId})`);
console.log(`  deployer   ${deployer.account.address}`);
console.log(`  admin      ${admin}`);
if (admin.toLowerCase() !== deployer.account.address.toLowerCase()) {
  console.log(
    '  note       the deployer will hold no admin role; run init-roles with the admin key',
  );
}

const { contract, deploymentTransaction } = await connection.viem.sendDeploymentTransaction(
  'VeriTradeInvoiceRegistry',
  [admin],
);

const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash });
if (receipt.status !== 'success') {
  throw new DeploymentRefused(`Deployment transaction ${deploymentTransaction.hash} reverted.`);
}

const contractVersion = await contract.read.CONTRACT_VERSION();

const record = {
  contract: 'VeriTradeInvoiceRegistry' as const,
  contractVersion,
  chainId,
  network: networkName,
  address: contract.address,
  transactionHash: deploymentTransaction.hash,
  deployer: deployer.account.address,
  admin,
  blockNumber: receipt.blockNumber.toString(),
  deployedAt: new Date().toISOString(),
  constructorArgs: [admin] as [`0x${string}`],
};

const path = await writeDeployment(record);

console.log('\nDeployed.');
console.log(describeDeployment(record));
console.log(`\nRecord written to ${path}`);
console.log(
  'No role has been granted yet. Run init-roles with the admin key to assign REGISTRAR_ROLE and FINANCIER_ROLE.',
);
