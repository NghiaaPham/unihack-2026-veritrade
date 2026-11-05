import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A deployment record is the only durable link between the repository and a
 * deployed registry. It contains no secrets: an address, a transaction hash and
 * the chain it belongs to are all public.
 */
export interface DeploymentRecord {
  contract: 'VeriTradeInvoiceRegistry';
  contractVersion: string;
  chainId: number;
  network: string;
  address: `0x${string}`;
  transactionHash: `0x${string}`;
  deployer: `0x${string}`;
  admin: `0x${string}`;
  blockNumber: string;
  deployedAt: string;
  constructorArgs: [`0x${string}`];
}

const DEPLOYMENTS_DIRECTORY = join(import.meta.dirname, '..', '..', 'deployments');

export function deploymentPath(chainId: number): string {
  return join(DEPLOYMENTS_DIRECTORY, `${chainId}.json`);
}

/** Returns null when the chain has never been deployed to from this checkout. */
export async function readDeployment(chainId: number): Promise<DeploymentRecord | null> {
  try {
    const contents = await readFile(deploymentPath(chainId), 'utf8');
    return JSON.parse(contents) as DeploymentRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeDeployment(record: DeploymentRecord): Promise<string> {
  await mkdir(DEPLOYMENTS_DIRECTORY, { recursive: true });
  const path = deploymentPath(record.chainId);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return path;
}

export function describeDeployment(record: DeploymentRecord): string {
  return [
    `  contract   ${record.contract} ${record.contractVersion}`,
    `  chain      ${record.network} (${record.chainId})`,
    `  address    ${record.address}`,
    `  tx         ${record.transactionHash}`,
    `  deployer   ${record.deployer}`,
    `  admin      ${record.admin}`,
    `  block      ${record.blockNumber}`,
    `  deployed   ${record.deployedAt}`,
  ].join('\n');
}
