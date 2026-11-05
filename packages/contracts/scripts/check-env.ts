import { network } from 'hardhat';

import { AVALANCHE_FUJI_CHAIN_ID, assertSupportedChain } from './lib/guards.js';
import { readDeployment } from './lib/deployment-record.js';

/**
 * Pre-flight environment check. Reads only; sends no transaction.
 *
 * It prints whether a key is present, never the key itself, and never the full
 * RPC URL — RPC providers often embed an API key in the path.
 */
const connection = await network.getOrCreate();
const publicClient = await connection.viem.getPublicClient();
const chainId = await publicClient.getChainId();
const networkName = connection.networkName;

console.log(`Environment check for "${networkName}"`);
console.log(`  chain id           ${chainId}`);

assertSupportedChain(chainId, networkName);

const rpcUrl = process.env.FUJI_RPC_URL;
if (rpcUrl !== undefined && rpcUrl.trim() !== '') {
  try {
    console.log(`  rpc host           ${new URL(rpcUrl).host}`);
  } catch {
    console.log('  rpc host           <FUJI_RPC_URL is not a valid URL>');
  }
} else if (chainId === AVALANCHE_FUJI_CHAIN_ID) {
  console.log('  rpc host           default public Fuji endpoint');
} else {
  console.log('  rpc host           not configured through FUJI_RPC_URL');
}

const keyPresent = (process.env.DEPLOYER_PRIVATE_KEY ?? '').trim() !== '';
console.log(`  deployer key       ${keyPresent ? 'present' : 'MISSING'}`);

const wallets = await connection.viem.getWalletClients();
const deployer = wallets[0];

if (deployer === undefined) {
  console.log('  signer             none configured');
} else {
  console.log(`  signer             ${deployer.account.address}`);

  const balance = await publicClient.getBalance({ address: deployer.account.address });
  console.log(`  balance            ${balance} wei`);

  if (balance === 0n) {
    console.log('  warning            balance is zero; a deploy will fail without testnet AVAX');
  }
}

const record = await readDeployment(chainId);
console.log(
  record === null
    ? '  deployment         none recorded for this chain'
    : `  deployment         ${record.address} (${record.contractVersion})`,
);

if (chainId === AVALANCHE_FUJI_CHAIN_ID) {
  if (!keyPresent) {
    console.log(
      '\nResult: RPC reachable, but no deployer key. Deployment and role grants are blocked.',
    );
    process.exitCode = 1;
  } else if (deployer === undefined) {
    console.log('\nResult: a key is present but Hardhat produced no signer. Check the key format.');
    process.exitCode = 1;
  } else {
    console.log('\nResult: ready. Deploying still requires CONFIRM_DEPLOY=fuji:43113.');
  }
} else {
  console.log('\nResult: local chain, nothing to confirm.');
}
