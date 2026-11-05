import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { network } from 'hardhat';
import { keccak256, type Hex } from 'viem';

import { DeploymentRefused, assertSupportedChain } from './lib/guards.js';
import { readDeployment } from './lib/deployment-record.js';

/**
 * Verifies that the code at the recorded address is the code this repository
 * compiles.
 *
 * This is a bytecode comparison, not a block-explorer submission. Publishing
 * source to Snowtrace needs an explorer API key that is not part of this
 * repository, so that step stays a documented manual action — see
 * docs/avalanche-fuji-deployment.md. Nothing here claims source verification.
 */
const connection = await network.getOrCreate();
const publicClient = await connection.viem.getPublicClient();
const chainId = await publicClient.getChainId();

assertSupportedChain(chainId, connection.networkName);

const record = await readDeployment(chainId);
if (record === null) {
  throw new DeploymentRefused(`No deployment recorded for chain ${chainId}. Nothing to verify.`);
}

const artifactPath = join(
  import.meta.dirname,
  '..',
  'artifacts',
  'contracts',
  'VeriTradeInvoiceRegistry.sol',
  'VeriTradeInvoiceRegistry.json',
);

let artifact: { deployedBytecode?: Hex };
try {
  artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as { deployedBytecode?: Hex };
} catch {
  throw new DeploymentRefused(
    `Compiled artifact not found at ${artifactPath}. Run "pnpm --filter @veritrade/contracts build" first.`,
  );
}

const expected = artifact.deployedBytecode;
if (expected === undefined || expected === '0x') {
  throw new DeploymentRefused('The compiled artifact has no deployed bytecode.');
}

const onChain = await publicClient.getCode({ address: record.address });

if (onChain === undefined || onChain === '0x') {
  throw new DeploymentRefused(`No contract code at ${record.address} on chain ${chainId}.`);
}

const matches = keccak256(onChain) === keccak256(expected);
const registry = await connection.viem.getContractAt('VeriTradeInvoiceRegistry', record.address);
const onChainVersion = await registry.read.CONTRACT_VERSION();

console.log(`Registry ${record.address} on ${record.network} (${chainId})`);
console.log(`  recorded version   ${record.contractVersion}`);
console.log(`  on-chain version   ${onChainVersion}`);
console.log(`  bytecode           ${matches ? 'matches the compiled artifact' : 'DOES NOT MATCH'}`);
console.log(`  code hash          ${keccak256(onChain)}`);

if (onChainVersion !== record.contractVersion) {
  throw new DeploymentRefused(
    `Version mismatch: record says ${record.contractVersion}, contract says ${onChainVersion}.`,
  );
}

if (!matches) {
  throw new DeploymentRefused(
    'Bytecode mismatch: the deployed contract was not built from this source. ' +
      'Do not trust the deployment record until this is explained.',
  );
}

console.log(
  '\nBytecode verification passed. Source verification on Snowtrace is a separate manual step.',
);
