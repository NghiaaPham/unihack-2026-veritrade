# Avalanche Fuji deployment

Everything needed to deploy `VeriTradeInvoiceRegistry` to Fuji, and an honest statement of
what has actually been deployed.

## Current status

**Not deployed to Fuji.** No deployer key exists in this environment, so no address, no
transaction hash and no verification claim is made. The RPC endpoint was confirmed reachable
(`eth_chainId` → `0xa869` = 43113), and the whole pipeline was exercised against a local
`hardhat node`, but that is not a testnet deployment.

`packages/contracts/deployments/` does not exist. A deployment creates it and writes
`<chainId>.json` inside; its absence is the evidence. `packages/contracts/deployments/31337.json`
is git-ignored because a local chain is not a deployment worth keeping, while a Fuji record
is public chain data and is meant to be committed.

## Prerequisites

- A throwaway Fuji-only key with testnet AVAX from the
  [Avalanche faucet](https://faucet.avax.network/).
- Node 20.9+ and pnpm 9+.
- The contract compiled: `pnpm --filter @veritrade/contracts build`.

## Environment

Create `packages/contracts/.env` (git-ignored; `.env.example` is the template):

```dotenv
DEPLOYER_PRIVATE_KEY=0x...          # 32-byte hex, never committed, never printed
FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
REGISTRY_ADMIN_ADDRESS=             # defaults to the deployer when empty
REGISTRAR_ADDRESSES=                # comma-separated
FINANCIER_ADDRESSES=                # comma-separated
CONFIRM_DEPLOY=                     # must equal "fuji:43113" to deploy
```

The scripts never print the key and never print the full RPC URL (providers embed API keys
in the path). `check-env` reports only whether a key is present.

## Pre-flight

```bash
pnpm --filter @veritrade/contracts env:check
```

This connects to Fuji, reads the chain id from the node, and reports:

```
Environment check for "fuji"
  chain id           43113
  rpc host           default public Fuji endpoint
  deployer key       MISSING
  signer             none configured
  deployment         none recorded for this chain

Result: RPC reachable, but no deployer key. Deployment and role grants are blocked.
```

Exit code 1 when a Fuji deployment is not possible. It sends no transaction.

## Local rehearsal

Do this before spending testnet AVAX. It exercises the same scripts against a real EVM.

```bash
# terminal 1
pnpm --filter @veritrade/contracts node

# terminal 2
pnpm --filter @veritrade/contracts deploy:local
REGISTRAR_ADDRESSES=0x... FINANCIER_ADDRESSES=0x... \
  pnpm --filter @veritrade/contracts roles:local
pnpm --filter @veritrade/contracts verify:local
```

The `localhost` network is configured with `accounts: 'remote'`, so the node's unlocked dev
accounts are used; no key is needed locally.

## Deploy to Fuji

```bash
CONFIRM_DEPLOY=fuji:43113 pnpm --filter @veritrade/contracts deploy:fuji
```

Guards, in order:

1. The chain id is read **from the node**, not from the config. A misconfigured
   `FUJI_RPC_URL` pointing somewhere else is refused before anything is signed.
2. `43114` (mainnet) is refused with a dedicated message. Any chain other than `31337` or
   `43113` is refused.
3. `CONFIRM_DEPLOY` must equal `<network>:<chainId>` exactly. A stale `CONFIRM_DEPLOY=1`
   from another shell cannot satisfy it.
4. An existing `deployments/<chainId>.json` stops the run: a second registry would silently
   split duplicate detection in two. Delete the record deliberately if that is really what
   you want.
5. No signer → no deployment. There is no fallback to a node account.

Output:

```
Deploying VeriTradeInvoiceRegistry
  network    fuji (43113)
  deployer   0x...
  admin      0x...

Deployed.
  contract   VeriTradeInvoiceRegistry 1.0.0
  address    0x...
  tx         0x...
  block      12345678
  deployed   2026-11-05T14:22:46.573Z
```

The record is written to `packages/contracts/deployments/43113.json`. It contains public
data only: address, transaction hash, chain id, deployer and admin addresses, block number,
timestamp, constructor arguments.

## Roles

```bash
REGISTRAR_ADDRESSES=0xabc...,0xdef... \
FINANCIER_ADDRESSES=0x123... \
CONFIRM_DEPLOY=fuji:43113 \
pnpm --filter @veritrade/contracts roles:fuji
```

- Idempotent: an address that already holds the role is reported and skipped.
- Requires the signer to hold `DEFAULT_ADMIN_ROLE`. If `REGISTRY_ADMIN_ADDRESS` differs from
  the deployer, run this with the admin key.
- Never grants `DEFAULT_ADMIN_ROLE`. That role is fixed at deployment and is not rotatable
  from this script.

Role layout:

| Role                 | Held by                | Can                                                       |
| -------------------- | ---------------------- | --------------------------------------------------------- |
| `DEFAULT_ADMIN_ROLE` | deployer or a multisig | grant/revoke roles, pause/unpause, close a stranded claim |
| `REGISTRAR_ROLE`     | the API's signer       | `register`, `cancelReservation`                           |
| `FINANCIER_ROLE`     | the API's signer       | `declareFinanced`, `closeClaim`                           |

For anything beyond a demo, `DEFAULT_ADMIN_ROLE` belongs on a multisig, not on the same hot
key that signs routine registrations.

## Verification

```bash
CONFIRM_DEPLOY=fuji:43113 pnpm --filter @veritrade/contracts verify:fuji
```

This is a **bytecode comparison**, not an explorer submission:

1. read the deployed code at the recorded address;
2. compare its keccak against the locally compiled `deployedBytecode`;
3. compare the contract's `CONTRACT_VERSION()` with the record.

A mismatch aborts with a non-zero exit. It answers "is this the code in this repository?",
which is the question that matters before trusting a record.

Publishing source to Snowtrace needs an explorer API key that is not part of this
repository. It is a **manual step** and is not performed by any script here. Do not describe
a deployment as "verified on Snowtrace" unless that step was actually done.

## Wiring the API

```dotenv
AVALANCHE_CHAIN_ID=43113
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
VERITRADE_CONTRACT_ADDRESS=0x...     # from deployments/43113.json
AVALANCHE_DEPLOYER_PRIVATE_KEY=0x... # the REGISTRAR/FINANCIER key
BLOCKCHAIN_CONFIRMATIONS=1
BLOCKCHAIN_INDEXER_INTERVAL_MS=0     # 0 disables the background indexer
```

Without `VERITRADE_CONTRACT_ADDRESS` the API boots and every chain endpoint answers
`503 BLOCKCHAIN_NOT_CONFIGURED`. Without the key it answers
`503 BLOCKCHAIN_SIGNER_NOT_CONFIGURED`. Neither state is a crash.

## What not to do

- Do not commit a private key, even a testnet one. `.env` is git-ignored; keep it that way.
- Do not deploy to mainnet. Three guards refuse it, and they are not configurable.
- Do not delete `deployments/<chainId>.json` to "start over" without a plan for the claims
  already registered against the old address.
- Do not reuse a registry address across chains. The record is keyed by chain id.
