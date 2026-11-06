# Fuji deployment runbook

A step-by-step execution order for deploying `VeriTradeInvoiceRegistry` to Avalanche Fuji
and wiring the API to it. **Precedence:** `avalanche-fuji-deployment.md` is the source of
truth for the design and the guard rationale. If anything here contradicts it, that document
wins and this file is the bug — fix it, don't fork the facts.

This runbook adds nothing new about the guards; it is the checklist and the exact commands.

## 0. Before you start

- You need a funded throwaway Fuji key and the deployment is gated on your explicit
  approval (see §10). Nothing here runs a transaction by itself.
- Three guards refuse mainnet (`43114`): the contract scripts, and the API's env validation
  (`AVALANCHE_CHAIN_ID` is restricted to `43113` and `31337`). Pointing either at mainnet is
  rejected, not just discouraged.
- The contract deploy script reads the chain id **from the node**, not from config, so a
  misconfigured RPC is caught before anything is signed.

## 1. Pre-deployment checklist

- [ ] Node 20.9+ and pnpm 9+ installed (`node -v`, `pnpm -v`).
- [ ] Contract compiled: `pnpm --filter @veritrade/contracts build`.
- [ ] API migrations are committed and replay cleanly on a fresh Postgres
      (`pnpm --filter @veritrade/api db:migrate` against a scratch database).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` green (229 API + 33 contracts).
- [ ] **Local rehearsal done** end-to-end against `hardhat node` (§3).
- [ ] The seed's synthetic `chainId: 43113` record has been dealt with
      (see `docs/current-status.md` / the Phase 4.6 report, §3). The seeded fake Fuji record
      must not be present when the API first talks to real Fuji, or it will report an invoice
      as "confirmed on Fuji" that was never anchored.
- [ ] Confirmation depth decided. `BLOCKCHAIN_CONFIRMATIONS` is valid 1–64; on Fuji use **3–5**,
      not the local default of 1.
- [ ] A Fuji-only key is prepared and funded from the faucet, and it is **not** the same key
      used for local dev.

## 2. Test wallet setup

A throwaway Fuji key only. Generate it offline and fund it:

- Derive a fresh key with any wallet you trust; never reuse a key that holds real funds.
- Fund from the [Avalanche faucet](https://faucet.avax.network/).
- This key is `DEPLOYER_PRIVATE_KEY` in `packages/contracts/.env` and, after deployment, is
  the natural holder of `DEFAULT_ADMIN_ROLE`. For anything past a demo, set
  `REGISTRY_ADMIN_ADDRESS` to a separate key or a multisig and run role init with that key.

The API's runtime signer (`AVALANCHE_DEPLOYER_PRIVATE_KEY` in `apps/api/.env`) is a **separate**
key that holds only `REGISTRAR_ROLE` and `FINANCIER_ROLE` — never the admin key, never a key
with real funds.

## 3. Local rehearsal (exercises the real scripts, no testnet spend)

```bash
# terminal 1
pnpm --filter @veritrade/contracts node

# terminal 2
pnpm --filter @veritrade/contracts deploy:local
REGISTRAR_ADDRESSES=0x... FINANCIER_ADDRESSES=0x... \
  pnpm --filter @veritrade/contracts roles:local
pnpm --filter @veritrade/contracts verify:local
```

The `localhost` network uses `accounts: 'remote'`, so the node's unlocked dev accounts are
used and no key file is needed. Verify the same three steps against Fuji only after this
passes.

## 4. Safe local secret configuration

`packages/contracts/.env` (git-ignored; `packages/contracts/.env.example` is the template):

```dotenv
DEPLOYER_PRIVATE_KEY=0x...          # Fuji-only throwaway, never committed, never printed
FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
REGISTRY_ADMIN_ADDRESS=             # defaults to the deployer when empty
REGISTRAR_ADDRESSES=                # comma-separated, the API signer goes here
FINANCIER_ADDRESSES=                # comma-separated, the API signer goes here
CONFIRM_DEPLOY=                     # must equal "fuji:43113" to deploy
```

`apps/api/.env` (git-ignored) holds only the API side:

```dotenv
AVALANCHE_CHAIN_ID=43113            # explicit — do not rely on the 43113 default
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
VERITRADE_CONTRACT_ADDRESS=0x...     # from deployments/43113.json
AVALANCHE_DEPLOYER_PRIVATE_KEY=0x... # the REGISTRAR/FINANCIER key, not the admin key
BLOCKCHAIN_CONFIRMATIONS=3           # 3-5 on Fuji
```

The scripts never print the key and never print the full RPC URL (providers embed API keys
in the path); `env:check` prints only "present"/"MISSING" and the RPC host.

## 5. Contract deployment commands

Pre-flight (read-only, no transaction):

```bash
pnpm --filter @veritrade/contracts env:check
```

Deploy (requires `CONFIRM_DEPLOY=fuji:43113` and a funded key):

```bash
CONFIRM_DEPLOY=fuji:43113 pnpm --filter @veritrade/contracts deploy:fuji
```

Guards, in order: chain id read from the node → mainnet refused → any chain other than
`31337`/`43113` refused → `CONFIRM_DEPLOY` must equal `fuji:43113` exactly → an existing
`deployments/43113.json` stops the run (no second registry) → no signer means no deploy.
Output writes `packages/contracts/deployments/43113.json`, which contains public data only
(address, tx hash, chain, deployer/admin, block, args). **Commit that file** — it is public
chain data meant to survive a fresh clone.

## 6. Role initialization

```bash
REGISTRAR_ADDRESSES=0x... FINANCIER_ADDRESSES=0x... \
  CONFIRM_DEPLOY=fuji:43113 \
  pnpm --filter @veritrade/contracts roles:fuji
```

- Grant the API's signer both `REGISTRAR_ROLE` and `FINANCIER_ROLE`.
- Idempotent: already-held roles are reported and skipped.
- Requires the signer to hold `DEFAULT_ADMIN_ROLE`. If `REGISTRY_ADMIN_ADDRESS` differs from
  the deployer, run this with the admin key.
- Never grants `DEFAULT_ADMIN_ROLE`. That role is fixed at deploy time.

## 7. Contract verification

```bash
CONFIRM_DEPLOY=fuji:43113 pnpm --filter @veritrade/contracts verify:fuji
```

This is a **bytecode comparison** against the locally compiled artifact plus a
`CONTRACT_VERSION()` check. A mismatch aborts. It is not a Snowtrace source submission; that
is a separate manual step needing an explorer API key and is not performed by any script here.
Do not call a deployment "verified on Snowtrace" unless you did that by hand.

## 8. Smoke test with a synthetic invoice

Point the API at the new registry (§4 config), then drive one invoice through the whole path:

```bash
# 1. register an org + user, capture ACCESS_TOKEN (see onboarding.md)
# 2. upload a synthetic invoice XML
curl -X POST http://localhost:3001/api/v1/invoices \
  -H "Authorization: Bearer $ACCESS_TOKEN" -F "file=@path/to/sample.xml"
# 3. verify
curl http://localhost:3001/api/v1/invoices/$INVOICE_ID/verification
# 4. anchor (the API signs with the REGISTRAR key, broadcasts, reconciles)
curl -X POST http://localhost:3001/api/v1/invoices/$INVOICE_ID/anchor
# 5. inspect the operation until it is CONFIRMED
curl http://localhost:3001/api/v1/blockchain/transactions/$OPERATION_ID
```

Success looks like the Phase 4.5 HTTP proof: `200`, `status: CONFIRMED`, a `receipt` with
`status: SUCCESS`, `gasUsed`, a block number and one `INVOICE_RESERVED` log, and
`leaseOwner` cleared. A `503 BLOCKCHAIN_NOT_CONFIGURED` means the address is unset;
`503 BLOCKCHAIN_SIGNER_NOT_CONFIGURED` means the API key is unset — neither is a crash.

## 9. Backend environment configuration

Final `apps/api/.env` values (see §4). After setting them, boot and check:

```bash
curl http://localhost:3001/api/v1/health/db     # {"connected":true,"latencyMs":...}
curl http://localhost:3001/api/v1/docs-json     # 20 paths
```

`BLOCKCHAIN_INDEXER_INTERVAL_MS=0` disables the event indexer; set it to a non-zero value
(default 3000) on Fuji so `blockchain_events` is populated.

## 10. Rollback and incident response

- **The registry cannot be un-deployed** and addresses are not reusable across chains. The
  deployment record is the only durable link; deleting `deployments/43113.json` to "start
  over" abandons any claims registered against the old address — plan for them first.
- **Pause is the circuit breaker.** The contract supports `pause()`/`unpause()` (admin only).
  If something is wrong, pause before anything else; in-flight registrations then revert.
- **Stuck transaction recovery** is automatic: the reconciliation worker recovers
  `SUBMITTING`/`SUBMITTED`/`UNKNOWN` operations. If an operation stays `UNKNOWN` past the
  backoff ceiling, follow the operator runbook in `docs/transaction-reconciliation.md` §9 —
  including the **chain-reset** section if the signer's chain was reset (the persisted nonce
  counter must be cleared, or the next allocation is a nonce the fresh chain never mines).
- **Key compromise:** if the admin key leaks, pause immediately, then rotate roles from a
  second admin if one exists. The deployer key and the API signer are separate; a leak of the
  API signer lets an attacker register/cancel/declare but not grant roles or close claims.
- **Mainnet is unreachable by design.** If you ever see `43114` in a guard error, stop — the
  config is wrong and no transaction was sent.
