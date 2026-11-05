import hardhatNodeTestRunner from '@nomicfoundation/hardhat-node-test-runner';
import hardhatViem from '@nomicfoundation/hardhat-viem';
import { defineConfig } from 'hardhat/config';
import 'dotenv/config';

const FUJI_CHAIN_ID = 43113;
const FUJI_RPC_URL = process.env.FUJI_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc';
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

export default defineConfig({
  plugins: [hardhatViem, hardhatNodeTestRunner],
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // `hardhat node` exposes the simulated chain over HTTP. Accounts are
    // "remote" because the node already holds the unlocked dev keys; this
    // network exists so the deploy/role/verify scripts can be exercised
    // end-to-end without touching a public chain.
    localhost: {
      type: 'http',
      chainType: 'l1',
      url: 'http://127.0.0.1:8545',
      accounts: 'remote',
    },
    fuji: {
      type: 'http',
      chainType: 'l1',
      url: FUJI_RPC_URL,
      chainId: FUJI_CHAIN_ID,
      // No key configured means no signer; deploys fail loudly instead of
      // silently falling back to an unlocked node account.
      accounts: DEPLOYER_PRIVATE_KEY === undefined ? [] : [DEPLOYER_PRIVATE_KEY],
    },
  },
});
