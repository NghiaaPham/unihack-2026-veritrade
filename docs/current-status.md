# Current status

**Last verified: 2026-11-05**, on the machine described in §5. Every number in this file
came from a command run on that date. If you are reading this weeks later, re-run
[§4](#4-how-to-re-verify-everything) before trusting it.

This document exists because a phase report is a claim, not evidence. Where the two
disagree, this file wins — and §4 tells you how to check.

---

## 1. The five statements that matter most

If you read nothing else:

1. **Phase 4.5 has not started.** No work exists on PostgreSQL integration, a reconciliation
   worker, multi-instance safety, rate limiting or gas measurement. The backlog is written
   ([phase-4.5-backlog.md](phase-4.5-backlog.md)); the code is not.
2. **Real PostgreSQL has never been used.** No migration has been applied to a networked
   PostgreSQL server. Every database test runs against **PGlite** — Postgres compiled to
   WASM, reached over the wire protocol. That proves the SQL parses and the constraints
   behave; it does **not** prove compatibility with PostgreSQL 17 in production.
3. **No Fuji deployment has occurred.** No address, no transaction hash, no verified
   contract. `packages/contracts/deployments/` does not exist. The registry has only ever
   run on a local Hardhat node.
4. **Automatic transaction reconciliation is incomplete.** `UNKNOWN` operations are
   resolved only when a client polls them. There is no background sweeper, so an operation
   whose client disappears stays `UNKNOWN` until a human looks.
5. **Rate limiting is missing, and multi-instance safety is unproven.** Any authenticated
   client can submit unlimited chain writes (each costing testnet AVAX), and the event
   indexer has no lease, so two API instances would race on the same cursor.

## 2. Phase ledger

| Phase   | Scope                                          | State               | Evidence                                       |
| ------- | ---------------------------------------------- | ------------------- | ---------------------------------------------- |
| 1       | Monorepo, health endpoints, `trade` slice      | **Complete**        | 33 trade tests, 5 health tests                 |
| 2       | Prisma data model, 8 domain module skeletons   | **Complete**        | 3 migrations, schema validates, 4 wiring tests |
| 3       | Auth, tenancy, XML intake, verification engine | **Complete**        | 38 invoice e2e, 25 check tests                 |
| 4       | Avalanche registry, outbox, claim lifecycle    | **Complete (code)** | 33 contract tests, 14 blockchain e2e           |
| **4.5** | Production hardening (DB, worker, limits)      | **Not started**     | —                                              |
| 5       | Product surface (UI, risk scoring, approvals)  | **Not started**     | —                                              |

"Complete (code)" is deliberate for Phase 4: the implementation and its tests are finished,
but the deployment half of the phase was never executed. A complete implementation is not a
deployed system.

## 3. Implementation inventory

### 3.1 API modules

| Module                 | What exists                                                                                  | Tests                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `auth`                 | Register, login, JWT issuance, `JwtAuthGuard`, `RolesGuard`, membership re-read per request  | 38 (invoice e2e)                          |
| `identity-access`      | User lookup seam                                                                             | 4 (domain wiring)                         |
| `organizations`        | Tenant root service                                                                          | 4 (domain wiring)                         |
| `invoices`             | Create, upload, list, get, history, fingerprint v2, duplicate detection, storage abstraction | 38 (e2e) + 18 (fingerprint) + 18 (parser) |
| `invoice-verification` | 7 checks, engine, aggregation, append-only run history                                       | 25 (checks) + 11 (engine)                 |
| `financing-requests`   | Read seam + 4 lifecycle routes delegating to `blockchain`                                    | 14 (blockchain e2e)                       |
| `risk-assessment`      | Read seam only. **No scoring logic.**                                                        | 4 (domain wiring)                         |
| `blockchain`           | Commitment, RPC, outbox, receipts, anchoring, claims, indexer                                | 16 (commitment) + 14 (e2e)                |
| `blockchain-registry`  | Phase 2 read seam over `blockchain_records`                                                  | 4 (domain wiring)                         |
| `audit-logs`           | Append-only writer, read by history endpoints                                                | 38 (invoice e2e)                          |
| `trade`                | Phase 1 legacy, **unauthenticated**                                                          | 33                                        |

### 3.2 Database

16 models, 3 committed migrations (562 lines of SQL total), 15 enums.

| Migration                                    | Adds                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `20261105131736_init`                        | Tenant root, users, invoices, documents, verifications, financing, risk, audit, `chain_sync_cursor`, `trade`  |
| `20261105133509_invoice_verification_engine` | Check rows, verification statuses                                                                             |
| `20261105144000_blockchain_outbox`           | `blockchain_operations`, `blockchain_transaction_receipts`, `blockchain_events`, new enums, cursor block hash |

Migrations were authored with `prisma migrate diff` and applied **only** to PGlite.

### 3.3 Smart contracts

| Contract                       | State                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `VeriTradeInvoiceRegistry.sol` | Phase 4. Compiles to 4 308 bytes, solc 0.8.28, EVM target `cancun`. 33 tests.                                       |
| `VeriTrade.sol`                | Phase 1. Compiles. **Not used by the API**, not tested, no deployment path. Treat as dead code awaiting a decision. |

### 3.4 Web

`apps/web` contains a layout, one landing page, and `/api/health`. **There is no product
UI.** No invoice list, no upload form, no financing screen. Any demo of the workflow is
currently an API demo.

### 3.5 Scripts and tooling

`packages/contracts/scripts/`: `deploy.ts`, `init-roles.ts`, `verify.ts`, `check-env.ts`,
plus `lib/guards.ts` (chain-id and confirmation guards) and `lib/deployment-record.ts`.

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
pnpm --filter @veritrade/api test            # Vitest, 13 files
pnpm --filter @veritrade/contracts test      # Hardhat node:test, 1 file
```

### Test evidence

Reported at the end of Phase 4, and **independently re-executed on 2026-11-05**:

| Suite               | Reported    | Re-executed     | Files      |
| ------------------- | ----------- | --------------- | ---------- |
| API (Vitest)        | 197 passing | **197 passing** | 13         |
| Contracts (Hardhat) | 33 passing  | **33 passing**  | 1          |
| `pnpm lint`         | pass        | **pass**        | —          |
| `pnpm typecheck`    | pass        | **pass**        | 3 packages |
| `pnpm build`        | pass        | **pass**        | 3 packages |
| `pnpm format:check` | pass        | **pass**        | —          |
| `prisma validate`   | pass        | **pass**        | —          |

Per-file API breakdown, measured:

| File                            | Tests | Covers                                                    |
| ------------------------------- | ----- | --------------------------------------------------------- |
| `trade.e2e-spec.ts`             | 33    | Phase 1 trade API, unchanged                              |
| `invoice-api.e2e-spec.ts`       | 38    | Invoice endpoints, tenancy, duplicates, upload, history   |
| `verification-checks.spec.ts`   | 25    | Each check's pass/fail/skip/unsupported path              |
| `invoice-xml-parser.spec.ts`    | 18    | Profiles, XXE/DTD rejection, UTF-8, depth limits          |
| `invoice-fingerprint.spec.ts`   | 18    | Determinism, identity sensitivity, content vs identity    |
| `blockchain-commitment.spec.ts` | 16    | Golden vector, domain separation, ABI drift               |
| `blockchain.e2e-spec.ts`        | 14    | Anchor, idempotency, collision, lifecycle, indexer, reorg |
| `verification-engine.spec.ts`   | 11    | Aggregation, throwing check, no driver text stored        |
| `schema.spec.ts`                | 8     | Tenant-scoped uniqueness, FK rules, decimal round trip    |
| `health.e2e-spec.ts`            | 5     | Liveness, readiness, `503`, no error leak                 |
| `domain-modules.spec.ts`        | 4     | All 8 domain services resolve                             |
| `pg-interop.spec.ts`            | 4     | Built output links under Node ESM                         |
| `seed-compat.spec.ts`           | 3     | Seed modules load under type stripping                    |

**What the test suite does not prove.** It runs against PGlite, a local Hardhat node and a
local filesystem. It proves logic, SQL DDL, and the HTTP contract. It does not prove
PostgreSQL 17 behaviour under load, Fuji behaviour, a real object store, or a reverse proxy.

## 5. Infrastructure reality (this machine)

| Capability                | State                                    | Consequence                                              |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| Node.js                   | 26.13.0                                  | matches `.nvmrc`                                         |
| pnpm                      | 12.16.1                                  | matches `packageManager`                                 |
| Docker                    | **not installed**                        | `db:up`, `db:migrate`, `db:seed`, `db:studio` cannot run |
| `psql`                    | **not installed**                        | no manual database access                                |
| Port 5432                 | **closed**                               | no PostgreSQL anywhere                                   |
| `apps/api/.env`           | **absent**                               | must be created from `.env.example` before the API boots |
| `packages/contracts/.env` | **absent**                               | deployment scripts refuse, correctly                     |
| Fuji RPC                  | **reachable** (`eth_chainId` → `0xa869`) | network is up; nothing has been sent to it               |
| Fuji deployer key         | **absent**                               | `deploy:fuji` refuses                                    |

Verified locally, without a database:

```
GET /api/v1/health      → 200 {"status":"ok", ...}
GET /api/v1/health/db   → 503 {"database":{"connected":false,"error":"database unreachable"}}
GET /api/docs           → 200 text/html, <title>Swagger UI</title>
GET /api/docs-json      → 20 documented paths
```

The `503` body carries no driver text — the Prisma error is logged, not returned. That is
intentional and tested.

## 6. Unresolved security issues, ranked

1. **The legacy `trade` endpoints are unauthenticated.** `/api/trades` accepts anonymous
   writes. They exist for the regression suite. A deployment must remove or route around
   them. This is the highest-severity item in the repository.
2. **No rate limiting anywhere.** Unlimited invoice submissions, unlimited login attempts
   (no lockout), unlimited chain writes. Each chain write spends real testnet AVAX.
3. **The deployer key is a plain environment variable.** No KMS, no rotation, no separation
   between the deployer and the runtime signer. One process compromise is total.
4. **Registry admin is a single point of control.** It can pause all transitions and close
   any financed claim. Both are deliberate recovery paths; both are centralisation.
5. **The commitment is confirmable.** An observer holding a candidate invoice can test
   whether it is registered. Inherent to a public global registry; documented in
   [invoice-commitment-spec.md](invoice-commitment-spec.md), not fixed.
6. **The audit log is not tamper-evident.** Append-only by convention only; anyone with
   database credentials can rewrite it.
7. **No PII retention policy.** Nothing expires or anonymises. The on-chain commitment is
   permanent, so "delete the invoice" cannot mean "delete the trace it was financed".
8. **No document integrity check on read.** `content_sha256` is stored but not re-verified
   when a blob is read back.
9. **Single-instance indexer.** No lease; two instances would double-process or race.
10. **`VeriTrade.sol` is dead code.** Unused, untested, and confusing to a new contributor.

Full threat models: [security-assumptions.md](security-assumptions.md),
[blockchain-security.md](blockchain-security.md), [invoice-security.md](invoice-security.md).

## 7. Known technical debt

| Debt                                                            | Why it exists                                | Cost of leaving it                                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web` is a shell                                           | No frontend work has been scheduled          | the product cannot be demoed without curl                                                                                         |
| Two docs sets: `architecture.md` + `blockchain-architecture.md` | Phase 4 added a layer                        | a reader must read both to see the whole picture                                                                                  |
| `trade` module kept                                             | proved the Drizzle→Prisma swap was honest    | unauthenticated surface, extra tests, reader confusion                                                                            |
| `blockchain-registry` and `blockchain` both exist               | the Phase 2 seam is still asserted by a test | two similar names for different jobs                                                                                              |
| No reconciliation worker                                        | polling was enough for a demo                | operations can stall in `UNKNOWN` forever                                                                                         |
| Indexer has no lease                                            | one instance was assumed                     | not horizontally scalable                                                                                                         |
| Verification status `PASSED` unreachable                        | the tax-authority check has no integration   | anchoring depends on `PARTIAL`, which reads oddly                                                                                 |
| Seed data is synthetic only                                     | no real documents available                  | demos show invented invoices                                                                                                      |
| No gas measurements                                             | never deployed                               | cannot budget a real deployment                                                                                                   |
| Docs are lowercase kebab-case                                   | matches 13 pre-existing files                | the phase brief asked for uppercase names; see [ADR-014](decisions.md#adr-014--documentation-filenames-stay-lowercase-kebab-case) |

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

`pnpm --filter @veritrade/contracts env:check` currently exits 1 with
_"RPC reachable, but no deployer key"_. That is the correct state.

## 9. Next recommended tasks

In order. Full detail, acceptance criteria and verification commands are in
[phase-4.5-backlog.md](phase-4.5-backlog.md).

1. **PG-1 — Validate migrations against real PostgreSQL 17.** Everything else that touches
   the database is guesswork until this is done. It is also the cheapest task: one machine
   with Docker.
2. **SEC-1 — Remove or authenticate the `trade` endpoints.** The only anonymous write path.
3. **SEC-2 — Add rate limiting** to auth and to chain-writing routes.
4. **BC-1 — Reconciliation worker** with a lease, so `UNKNOWN` resolves without a client.
5. **BC-2 — Indexer lease / single-writer guarantee.**
6. **BC-3 — Gas measurements** on Fuji, so a deployment has a budget.
7. **FUJI-1 — Fuji deployment dry run**, only after 1–6, with explicit approval.
8. **WEB-1 — Minimal UI** for upload → verify → anchor → reserve, if a demo needs it.

## 10. How this document stays honest

- Every claim is either a command output or a link to the file that proves it.
- "Not run" is written as "not run", never softened to "should work".
- When a check is re-run and the numbers change, the old number is replaced, not appended —
  this is a status page, not a changelog.
- Phase 4.5 work, when it starts, gets its own section here rather than being implied by a
  commit message.
