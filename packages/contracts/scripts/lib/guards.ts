/**
 * Network guards for every script that can mutate a public chain.
 *
 * These are deliberately restrictive. The deployer key is a throwaway Fuji
 * key; nothing in this repository may ever be pointed at Avalanche mainnet.
 */

export const AVALANCHE_MAINNET_CHAIN_ID = 43114;
export const AVALANCHE_FUJI_CHAIN_ID = 43113;
export const LOCAL_CHAIN_ID = 31337;

/** Chains these scripts are allowed to touch. */
const ALLOWED_CHAIN_IDS = new Set<number>([LOCAL_CHAIN_ID, AVALANCHE_FUJI_CHAIN_ID]);

export class DeploymentRefused extends Error {
  override readonly name = 'DeploymentRefused';
}

/**
 * Rejects anything that is not the local simulated chain or Fuji.
 * Mainnet gets a dedicated message so the refusal is unmistakable.
 */
export function assertSupportedChain(chainId: number, networkName: string): void {
  if (chainId === AVALANCHE_MAINNET_CHAIN_ID) {
    throw new DeploymentRefused(
      `Refusing to run against Avalanche mainnet (chain ${chainId}). ` +
        'This project targets testnet only.',
    );
  }

  if (!ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new DeploymentRefused(
      `Refusing to run against "${networkName}" (chain ${chainId}). ` +
        `Supported chains: ${[...ALLOWED_CHAIN_IDS].join(', ')}.`,
    );
  }
}

/**
 * Requires an explicit operator confirmation before an irreversible deployment.
 *
 * The confirmation is a network/chain pair rather than a boolean so a stale
 * `CONFIRM_DEPLOY=1` copied from another terminal cannot point at the wrong
 * chain. The in-process chain is exempt: it is discarded with the process.
 */
export function requireExplicitConfirmation(chainId: number, networkName: string): void {
  if (chainId === LOCAL_CHAIN_ID) return;

  const expected = `${networkName}:${chainId}`;
  const provided = process.env.CONFIRM_DEPLOY?.trim();

  if (provided !== expected) {
    throw new DeploymentRefused(
      `Refusing to submit a transaction to "${networkName}" (chain ${chainId}) without confirmation.\n` +
        `Re-run with CONFIRM_DEPLOY=${expected} once you have checked the network and the deployer address.`,
    );
  }
}

/** Reads an address from the environment, failing with a readable message. */
export function requireAddress(variable: string): `0x${string}` {
  const value = process.env[variable]?.trim();
  if (value === undefined || value === '') {
    throw new DeploymentRefused(`Missing ${variable}.`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new DeploymentRefused(`${variable} is not a 20-byte hex address.`);
  }
  return value as `0x${string}`;
}

/** Parses a comma-separated address list, tolerating empty entries. */
export function parseAddressList(variable: string): `0x${string}`[] {
  const raw = process.env[variable]?.trim();
  if (raw === undefined || raw === '') return [];

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(entry)) {
        throw new DeploymentRefused(`${variable} contains an invalid address: ${entry}`);
      }
      return entry as `0x${string}`;
    });
}
