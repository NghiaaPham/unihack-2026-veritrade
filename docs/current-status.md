# Current status

**Last verified: 2026-11-06**, on the machine described in §5. Every number in this file
came from a command run on that date. If you are reading this weeks later, re-run
[§4](#4-how-to-re-verify-everything) before trusting it.

This document exists because a phase report is a claim, not evidence. Where the two
disagree, this file wins — and §4 tells you how to check.

---

## 1. The five statements that matter most

If you read nothing else:

1. **Real PostgreSQL 17 is now the verified target.** The three Phase 2–4 migrations and
   the Phase 4.5 migration were applied to a networked PostgreSQL **17.11** server, the
   development seed ran against it, and the full API suite passes on it. PGlite is no
   longer the only evidence — see §4.1 for both runs side by side.
2. **Automatic transaction reconciliation exists.** A background worker recovers
   `SUBMITTING`, `SUBMITTED` and `UNKNOWN` operations with bounded backoff, a database
   lease and a hard rule that an `UNKNOWN` transaction is never re-signed. It is covered by
   seven tests against a real EVM.
3. **Multi-instance coordination is database-backed where it matters.** Nonce allocation
   takes a row lock, operations and the indexer cursor are leased. Two instances can now
   run safely for everything except the constraints listed in §7.1.
4. **Chain writes are metered per organization.** A fixed-window rate limit plus an
   in-flight cap, both in the database, both enforced before the handler runs. Status
   polling is deliberately free.
5. **No Fuji deployment has occurred, and none was attempted.** No address, no transaction,
   no key. Gas has been measured on a local EVM and cross-checked against a live Fuji
   transaction's fee, but the registry has still only ever run on chain 31337.

## 2. Phase ledger

| Phase   | Scope                                          | State               | Evidence                                                      |
| ------- | ---------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| 1       | Monorepo, health endpoints, `trade` slice      | **Complete**        | 5 health tests; `trade` HTTP slice removed (SEC-0)            |
| 2       | Prisma data model, 8 domain module skeletons   | **Complete**        | 4 migrations, schema validates, 4 wiring tests                |
| 3       | Auth, tenancy, XML intake, verification engine | **Complete**        | 38 invoice e2e, 25 check tests                                |
| 4       | Avalanche registry, outbox, claim lifecycle    | **Complete (code)** | 33 contract tests, 14 blockchain e2e                          |
| **4.5** | Production hardening (DB, worker, limits)      | **Complete (code)** | 241 API tests on real PostgreSQL, 7 recovery tests, gas table |
| 5       | Product surface (UI, risk scoring, approvals)  | **Not started**     | —                                                             |

"Complete (code)" is deliberate for Phases 4 and 4.5: the implementation and its tests are
finished, but the deployment half was never executed. A complete implementation is not a
deployed system.

## 3. Implementation inventory

### 3.1 API modules

| Module                 | What exists                                                                                    | Tests                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `auth`                 | Register, login, JWT issuance, `JwtAuthGuard`, `RolesGuard`, membership re-read per request    | 38 (invoice e2e)                          |
| `identity-access`      | User lookup seam                                                                               | 4 (domain wiring)                         |
| `organizations`        | Tenant root service                                                                            | 4 (domain wiring)                         |
| `invoices`             | Create, upload, list, get, history, fingerprint v2, duplicate detection, storage abstraction   | 38 (e2e) + 18 (fingerprint) + 18 (parser) |
| `invoice-verification` | 7 checks, engine, aggregation, append-only run history                                         | 25 (checks) + 11 (engine)                 |
| `financing-requests`   | List, get, create (verified invoice, one active request) + 4 lifecycle routes via `blockchain` | 26 (e2e) + 14 (blockchain e2e)            |
| `risk-assessment`      | Read seam only. **No scoring logic.**                                                          | 4 (domain wiring)                         |
| `blockchain`           | Commitment, RPC, outbox, receipts, anchoring, claims, indexer, reconciler, quota               | 16 + 19 + 14 + 7 + 6                      |
| `blockchain-registry`  | Phase 2 read seam over `blockchain_records`                                                    | 4 (domain wiring)                         |
| `audit-logs`           | Append-only writer, read by history endpoints                                                  | 38 (invoice e2e)                          |

The `blockchain` module now owns eleven files. The ones added in Phase 4.5:

| File                                   | Job                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `nonce-allocator.service.ts`           | Hands out nonces under a row lock, so two instances cannot share one         |
| `blockchain-reconciliation.service.ts` | The background sweeper for stuck operations                                  |
| `blockchain-quota.service.ts`          | Per-organization write rate limit and in-flight cap                          |
| `blockchain-quota.guard.ts`            | Applies the quota to the four chain-writing route groups, with `Retry-After` |

### 3.2 Database

18 models, 4 committed migrations, 15 enums.

| Migration                                    | Adds                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `20261105131736_init`                        | Tenant root, users, invoices, documents, verifications, financing, risk, audit, `chain_sync_cursor`, `trade`  |
| `20261105133509_invoice_verification_engine` | Check rows, verification statuses                                                                             |
| `20261105144000_blockchain_outbox`           | `blockchain_operations`, `blockchain_transaction_receipts`, `blockchain_events`, new enums, cursor block hash |
| `20261106090000_phase45_leases_and_quota`    | Lease columns on operations and the cursor, `blockchain_rate_limits`, `blockchain_signer_nonces`              |

All four are applied to real PostgreSQL 17.11 **and** replayed from scratch by the PGlite
suite. The Phase 4.5 migration was authored with `prisma migrate diff` before any database
had it, then applied to a live server.

### 3.3 Smart contracts

| Contract                       | State                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `VeriTradeInvoiceRegistry.sol` | Phase 4. Compiles to 4 308 bytes, solc 0.8.28, EVM target `cancun`. 33 tests. Gas measured (see §4.3).              |
| `VeriTrade.sol`                | Phase 1. Compiles. **Not used by the API**, not tested, no deployment path. Treat as dead code awaiting a decision. |

### 3.4 Web

`apps/web` contains a layout, one landing page, and `/api/health`. **There is no product
UI.** No invoice list, no upload form, no financing screen. Any demo of the workflow is
currently an API demo.

### 3.5 Scripts and tooling

`packages/contracts/scripts/`: `deploy.ts`, `init-roles.ts`, `verify.ts`, `check-env.ts`,
`measure-gas.ts`, plus `lib/guards.ts` (chain-id and confirmation guards) and
`lib/deployment-record.ts`.

`apps/api/scripts/`: `test-postgres.mjs` (creates the test database if absent, migrates it,
runs the suite against it).

## 4. How to re-verify everything

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run lint typecheck build test --force
pnpm format:check
```

`--force` matters: without it Turbo serves cached results and you learn nothing about the
current tree.

Per-package:

```bash
pnpm --filter @veritrade/api test            # Vitest on PGlite, 19 files
pnpm --filter @veritrade/api test:postgres   # Vitest on a real server, 19 files
pnpm --filter @veritrade/contracts test      # Hardhat node:test, 1 file
```

### 4.1 Test evidence

**API suite, 241 tests across 19 files, run on 2026-11-08:**

| Engine                       | Command         | Result          | Duration |
| ---------------------------- | --------------- | --------------- | -------- |
| PGlite (in-process WASM)     | `pnpm test`     | **241 passing** | 26.6 s   |
| PostgreSQL 17.11 (networked) | `test:postgres` | **241 passing** | 36.4 s   |

The second row is the one that matters. The first is what CI runs, because it needs no
container.

| Check                   | Result         | Notes                                           |
| ----------------------- | -------------- | ----------------------------------------------- |
| `pnpm lint`             | **pass**       | api + web                                       |
| `pnpm typecheck`        | **pass**       | api src + api specs + web + contracts           |
| `pnpm build`            | **pass**       | 3 packages                                      |
| `pnpm format:check`     | **pass**       | —                                               |
| `prisma validate`       | **pass**       | —                                               |
| `prisma migrate deploy` | **pass**       | 4 migrations, PostgreSQL 17.11                  |
| `prisma db seed`        | **pass**       | idempotent; second run produces the same counts |
| Contracts               | **33 passing** | Hardhat, real EVM                               |

Per-file API breakdown, measured:

| File                             | Tests | Covers                                                          |
| -------------------------------- | ----- | --------------------------------------------------------------- |
| `invoice-api.e2e-spec.ts`        | 38    | Invoice endpoints, tenancy, duplicates, upload, history         |
| `financing-requests.e2e-spec.ts` | 26    | List/get/create, 400/403/404/409 rules, tenancy, no chain quota |
| `verification-checks.spec.ts`    | 25    | Each check's pass/fail/skip/unsupported path                    |
| `blockchain-hardening.spec.ts`   | 19    | Backoff bounds, leases, concurrent claims, quota, atomicity     |
| `invoice-xml-parser.spec.ts`     | 18    | Profiles, XXE/DTD rejection, UTF-8, depth limits                |
| `invoice-fingerprint.spec.ts`    | 18    | Determinism, identity sensitivity, content vs identity          |
| `blockchain-commitment.spec.ts`  | 16    | Golden vector, domain separation, ABI drift                     |
| `blockchain.e2e-spec.ts`         | 14    | Anchor, idempotency, collision, lifecycle, indexer, reorg       |
| `verification-engine.spec.ts`    | 11    | Aggregation, throwing check, no driver text stored              |
| `schema.spec.ts`                 | 8     | Tenant-scoped uniqueness, FK rules, decimal round trip          |
| `blockchain-recovery.spec.ts`    | 7     | Stuck transactions resolved against a real EVM                  |
| `blockchain-quota.e2e-spec.ts`   | 6     | 429 + `Retry-After`, polling free, auth before metering         |
| `health.e2e-spec.ts`             | 5     | Liveness, readiness, `503`, no error leak                       |
| `domain-modules.spec.ts`         | 4     | All 8 domain services resolve                                   |
| `pg-interop.spec.ts`             | 4     | Built output links under Node ESM                               |
| `seed-compat.spec.ts`            | 3     | Seed modules load under type stripping                          |

**What the suite still does not prove.** It runs against a local Hardhat node and a local
filesystem. It does not prove Fuji behaviour, a real object store, a reverse proxy, or
PostgreSQL under concurrent load from several API instances. The multi-instance tests use
two clients in one process, not two processes on two machines.

### 4.2 What real PostgreSQL changed

Running the existing suite against a real server found two things PGlite had hidden. Both
were test-harness bugs, not application bugs, and both are fixed:

1. **Parallel test files deadlocked.** Every suite truncates all 18 tables. Against one
   WASM engine that was harmless; against a real server two files take `AccessExclusive`
   locks in different orders and Postgres aborts one with `40P01`. `fileParallelism` is now
   off when `TEST_DATABASE_URL` is set.
2. **The database outlived the process.** A real server keeps the previous run's rows, so
   the second run collided on unique emails and slugs. The harness now truncates on open.

Neither could have been found with PGlite. That is the argument for this task existing.

### 4.3 Gas measurements

Measured on a local Hardhat node, chain 31337, `scripts/measure-gas.ts`:

| Operation                 | Gas used  | Note                    |
| ------------------------- | --------- | ----------------------- |
| Deployment                | 1 014 411 | full registry, no proxy |
| `grantRole` (either role) | 51 477    | per role, two needed    |
| `register` (first claim)  | 101 512   | the common write        |
| `declareFinanced`         | 78 856    | —                       |
| `cancelReservation`       | 39 452    | —                       |
| `closeClaim`              | 34 155    | —                       |

Gas **units** are a property of the bytecode and transfer to Fuji unchanged. The **price**
does not: it was 1.08e9 wei/gas on the local node and 160 wei/gas on Fuji when measured.
A `register` therefore costs about 1.6e-11 AVAX on Fuji today — verified against a real
mined transaction that paid 160 wei/gas for 75 000 gas, not inferred from `eth_gasPrice`
alone.

## 5. Infrastructure reality (this machine)

| Capability                | State                                    | Consequence                                 |
| ------------------------- | ---------------------------------------- | ------------------------------------------- |
| Node.js                   | 26.13.0                                  | matches `.nvmrc`                            |
| pnpm                      | 12.16.1                                  | matches `packageManager`                    |
| Docker                    | **installed, daemon running** (29.9.2)   | `db:*` scripts work                         |
| PostgreSQL                | **17.11-alpine container, healthy**      | on `127.0.0.1:5432`                         |
| `psql` on the host        | **not installed**                        | use `docker exec veritrade-postgres psql …` |
| `apps/api/.env`           | **present locally, git-ignored**         | generated from `.env.example`               |
| `packages/contracts/.env` | **absent**                               | deployment scripts refuse, correctly        |
| Fuji RPC                  | **reachable** (`eth_chainId` → `0xa869`) | network is up; nothing has been sent to it  |
| Fuji deployer key         | **absent**                               | `deploy:fuji` refuses                       |

Verified against the live server:

```
GET /api/v1/health      → 200 {"status":"ok", ...}
GET /api/v1/health/db   → 200 {"database":{"connected":true,"latencyMs":…}}
GET /api/docs           → 200 text/html, <title>Swagger UI</title>
GET /api/docs-json      → 20 documented paths
```

## 6. Unresolved security issues, ranked

1. **Rate limiting covers chain writes only.** Invoice uploads and login attempts are still
   unmetered. Login in particular has no lockout. This is now the highest-severity item
   left.
2. **The deployer key is a plain environment variable.** No KMS, no rotation, no separation
   between the deployer and the runtime signer. One process compromise is total.
3. **Registry admin is a single point of control.** It can pause all transitions and close
   any financed claim. Both are deliberate recovery paths; both are centralisation.
4. **The commitment is confirmable.** An observer holding a candidate invoice can test
   whether it is registered. Inherent to a public global registry; documented in
   [invoice-commitment-spec.md](invoice-commitment-spec.md), not fixed.
5. **The audit log is not tamper-evident.** Append-only by convention only; anyone with
   database credentials can rewrite it.
6. **No PII retention policy.** Nothing expires or anonymises. The on-chain commitment is
   permanent, so "delete the invoice" cannot mean "delete the trace it was financed".
7. **No document integrity check on read.** `content_sha256` is stored but not re-verified
   when a blob is read back.
8. **`VeriTrade.sol` is dead code.** Unused, untested, and confusing to a new contributor.

Closed in Phase 4.5: unlimited chain writes, the stalled-`UNKNOWN` sweep, the unleased
indexer, and process-local nonce allocation. Closed on 2026-11-08: the unauthenticated
`trade` HTTP API (SEC-0, deleted; the table and its seed row remain).

Full threat models: [security-assumptions.md](security-assumptions.md),
[blockchain-security.md](blockchain-security.md), [invoice-security.md](invoice-security.md).

## 7. Known technical debt

### 7.1 Remaining single-instance constraints

Multi-instance is now safe for nonce allocation, operation processing and event indexing.
These are the parts that are still single-instance by design or by omission:

| Constraint                           | Why it remains                                                                                          | Impact                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| One signer address per deployment    | The nonce allocator is keyed by `(chainId, address)`, so it serialises writers rather than scaling them | Chain writes queue behind one account. Throughput is bounded by block time, not by instances. |
| Reconciliation is a poll loop        | Each instance runs its own timer; the lease makes that safe but not efficient                           | N instances mean N idle queries per interval. Harmless, wasteful.                             |
| No leader election for the indexer   | The cursor lease is taken per pass, so two instances alternate rather than split                        | Fine. A dedicated indexer process would be tidier, not safer.                                 |
| `PrismaService` pool is per process  | `POOL_SIZE = 10` per instance                                                                           | PostgreSQL `max_connections` becomes the limit at roughly 10 instances.                       |
| Nonce counter survives a chain reset | `blockchain_signer_nonces` is database state, not chain state                                           | A reset local chain needs the manual procedure in `docs/transaction-reconciliation.md` §9.    |

### 7.2 Other debt

| Debt                                                                | Why it exists                                                                                                                                                                                                                           | Cost of leaving it                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web` is a shell                                               | No frontend work has been scheduled                                                                                                                                                                                                     | the product cannot be demoed without curl                                                                                         |
| Two docs sets: `architecture.md` + `blockchain-architecture.md`     | Phase 4 added a layer                                                                                                                                                                                                                   | a reader must read both to see the whole picture                                                                                  |
| `trade` table and seed row kept, no API                             | SEC-0 deleted the HTTP module on 2026-11-08; dropping a table is a separate, irreversible decision                                                                                                                                      | an unused table, one seed row, and a `Trade` model nothing reads                                                                  |
| `blockchain-registry` and `blockchain` both exist                   | the Phase 2 seam is still asserted by a test                                                                                                                                                                                            | two similar names for different jobs                                                                                              |
| Verification status `PASSED` unreachable                            | the tax-authority check has no integration                                                                                                                                                                                              | anchoring depends on `PARTIAL`, which reads oddly                                                                                 |
| Seed data is synthetic only                                         | no real documents available                                                                                                                                                                                                             | demos show invented invoices                                                                                                      |
| Seed used to write a fake `chainId: 43113` `blockchain_records` row | **Resolved.** `prisma/seed.ts` no longer writes any `BlockchainRecord`; the fabricated Fuji row was removed in `3bf26ae` and the development database was cleaned (`docs/dev-db-cleanup-plan.md`). A re-seed writes zero confirmations. | the hazard was a seed bug; it is gone, but the runbook still lists the seed row as a pre-Fuji gate for anyone re-cloning          |
| Docs are lowercase kebab-case                                       | matches 13 pre-existing files                                                                                                                                                                                                           | the phase brief asked for uppercase names; see [ADR-014](decisions.md#adr-014--documentation-filenames-stay-lowercase-kebab-case) |

## 8. Fuji deployment status

| Item                      | State                                           |
| ------------------------- | ----------------------------------------------- |
| Network reachable         | yes (`0xa869`)                                  |
| Deployer key present      | no                                              |
| Contract deployed         | **no**                                          |
| Deployment record on disk | none (`packages/contracts/deployments/` absent) |
| Roles granted on chain    | no                                              |
| Bytecode verified         | only on a local Hardhat node                    |
| Snowtrace submission      | never attempted                                 |
| Gas budget                | measured locally, see §4.3                      |

`pnpm --filter @veritrade/contracts env:check` currently exits 1 with
_"RPC reachable, but no deployer key"_. That is the correct state.

**Do not confuse the above with the database.** The seed formerly wrote a fabricated
`blockchain_records` row at `chainId: 43113` with `contractAddress 0x0000…0000` and
`txHash 0xabab…`. That row was never on any chain and would have made an invoice report as
"confirmed on Fuji" though it was never anchored. It has been **removed**: `prisma/seed.ts`
now writes zero `BlockchainRecord` rows, the development database has been cleaned (see
`docs/dev-db-cleanup-plan.md`), and `seed-safety.spec.ts` asserts the seed cannot recreate
a fabricated confirmation. The contract deploy script is unaffected: it reads
`packages/contracts/deployments/43113.json`, which does not exist yet.

## 9. Next recommended tasks

In order. Full detail, acceptance criteria and verification commands are in
[phase-4.5-backlog.md](phase-4.5-backlog.md).

1. **SEC-1 — Rate limiting for auth and invoice intake.** The chain is metered; the rest of
   the surface is not, and login has no lockout. (SEC-0, removal of the `trade` API, was
   done on 2026-11-08.)
2. **SEC-2 — Key management.** Move the signer out of a plain environment variable before
   any real value is at stake.
3. **FUJI-1 — Fuji deployment**, with explicit approval, now that gas is known and the
   guards are proven.
4. **WEB-1 — Minimal UI** for upload → verify → anchor → reserve, if a demo needs it.

## 10. How this document stays honest

- Every claim is either a command output or a link to the file that proves it.
- "Not run" is written as "not run", never softened to "should work".
- When a check is re-run and the numbers change, the old number is replaced, not appended —
  this is a status page, not a changelog.
- PGlite and PostgreSQL results are reported separately, never merged into one green line.
