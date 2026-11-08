# Phase 4.5 backlog

Seven work items that stood between the Phase 4 code and a system that can be demonstrated
somewhere other than a laptop. Each is self-contained: objective, files, dependencies,
acceptance criteria, owner role, and the commands that prove it is done.

**Status as of 2026-11-06.** Five are complete, one is partly complete, and one was
deliberately not attempted:

| Task   | Scope                                  | Status                                                           |
| ------ | -------------------------------------- | ---------------------------------------------------------------- |
| PG-1   | Validate against real PostgreSQL 17    | **Done** — PostgreSQL 17.11, 229 tests green                     |
| PG-2   | Migration validation and drift         | **Done** — 4 migrations applied, schema in sync                  |
| BC-1   | Reconciliation worker                  | **Done** — 7 recovery tests against a real EVM                   |
| BC-2   | Multi-instance safety                  | **Done** — nonce allocator + operation and cursor leases         |
| BC-3   | Gas measurements                       | **Done** — see [current-status.md](current-status.md) §4.3       |
| SEC-1  | Chain write rate limiting              | **Done** — quota guard, 6 HTTP tests                             |
| SEC-0  | Remove the unauthenticated `trade` API | **Done, 2026-11-08** — option 1 (delete)                          |
| FUJI-1 | Fuji deployment readiness              | **Ready, not deployed** — no key, no transaction, no address     |

The task bodies below are kept as written, so the acceptance criteria still describe what
"done" meant. Where the implementation diverged from the plan, the divergence is noted in
the task.

**These are not GitHub Issues.** Nothing has been created remotely. Copy a task into an
issue when someone picks it up.

Related: [current-status.md](current-status.md) for why each item matters,
[roadmap.md](roadmap.md) for sequencing.

---

## Dependency graph

```
PG-1  Real PostgreSQL 17
  └── PG-2  Migration validation
        └── FUJI-1  Deployment readiness
BC-1  Reconciliation worker ────┐
BC-2  Multi-instance safety ────┼── FUJI-1
BC-3  Gas measurements ─────────┘

SEC-0  Remove the trade surface      (independent)
SEC-1  Blockchain rate limiting      (independent)
```

## Parallelisation

| Track            | Tasks        | Files touched                                              | Can run beside       |
| ---------------- | ------------ | ---------------------------------------------------------- | -------------------- |
| Database         | PG-1, PG-2   | `prisma/`, `.github/workflows`, `test/test-database.ts`    | SEC-0, SEC-1, BC-3   |
| Security         | SEC-0, SEC-1 | `src/trade`, `src/blockchain`, `src/auth`, `app.module.ts` | PG-1, BC-3           |
| Chain operations | BC-1, BC-2   | `src/blockchain/**`                                        | PG-1, SEC-0, BC-3    |
| Measurement      | BC-3         | `scripts/`, `docs/`                                        | anything             |
| Release          | FUJI-1       | `scripts/`, `docs/`                                        | nothing — it is last |

`BC-1` and `BC-2` both rewrite `blockchain-event-indexer.service.ts` and
`blockchain-transaction.service.ts`. Give them to one person, or sequence them.

---

## SEC-0 — Remove the unauthenticated `trade` surface

> **Status: done, 2026-11-08.** Option 1 (delete) was chosen by the product owner. The
> `trade` module, controller, service, DTOs and `trade.e2e-spec.ts` (33 tests) are removed.
> The Prisma `Trade` model, its migration and the seed row remain. Result: 215 API tests on
> both PGlite and PostgreSQL 17.11, down from 248.

**Priority:** highest severity in the repository · **Effort:** S

### Objective

`/api/trades` accepts anonymous writes. It exists only because it was the first slice built
and its tests prove the ORM swap preserved behaviour. A deployed system must not expose it.

### Technical scope

- `apps/api/src/trade/**`
- `apps/api/src/app.module.ts`
- `apps/api/test/trade.e2e-spec.ts`
- `apps/api/test/pg-interop.spec.ts` (references the built module graph)

Two acceptable outcomes, and the choice is the Tech Lead's:

1. **Delete it** — remove the module, controller, service, DTOs and tests. The Prisma `Trade`
   model and its migration stay (dropping a table is a separate, irreversible decision).
2. **Authenticate it** — apply `JwtAuthGuard` + `RolesGuard`, scope by organisation, and
   keep the tests as authenticated ones.

Deleting is cheaper and removes the risk. Authenticating keeps a second worked example of the
guard pattern, at the cost of maintaining a module nobody uses.

### Dependencies

None.

### Acceptance criteria

- [ ] No route under `/api/trades` is reachable without a valid bearer token, or the routes
      no longer exist.
- [ ] `GET /api/docs-json` no longer advertises an unauthenticated trade path.
- [ ] `pnpm test` is green, with any deleted tests accounted for in the PR description.
- [ ] `docs/current-status.md` §6 item 1 is updated or removed.
- [ ] `AGENTS.md` §9 no longer warns about a surface that is gone.

### Suggested owner

Backend engineer with auth familiarity, or a security-minded reviewer.

### Verification

```bash
pnpm --filter @veritrade/api test
# with the API running:
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/trades \
  -H 'content-type: application/json' -d '{}'
# expect 401 or 404, never 201
```

---

## PG-1 — Validate against real PostgreSQL 17

> **Status: done, 2026-11-06.** PostgreSQL 17.11 via `docker compose`, all four migrations
> applied, seed run twice to prove idempotency, and the full suite run against the server
> (`pnpm test:postgres`). Two harness bugs were found and fixed; see
> [current-status.md](current-status.md) §4.2.

**Priority:** blocks every other database claim · **Effort:** M

### Objective

Every database assertion in this repository was made against PGlite. PGlite is PostgreSQL
compiled to WASM: same parser, same DDL semantics, no server. That is a strong signal and
**not** proof of compatibility with a networked PostgreSQL 17 instance — no connection pool,
no concurrent writers, no server configuration, no extensions.

### Technical scope

- `docker-compose.yml` (already correct; confirm it starts)
- `apps/api/prisma/migrations/**` (apply, do not edit)
- `apps/api/prisma/seed.ts`
- `docs/current-status.md` §5, `docs/development-setup.md` verification table
- `.github/workflows/ci.yml` (add a service container once this works locally)

### Dependencies

A machine with Docker (or any PostgreSQL 17 server).

### Acceptance criteria

- [ ] `pnpm db:up` starts `postgres:17-alpine` and passes its healthcheck.
- [ ] `pnpm db:migrate` applies all three migrations with no error and no manual intervention.
- [ ] `pnpm db:seed` runs twice and produces identical row counts both times.
- [ ] `pnpm --filter @veritrade/api test` passes with `DATABASE_URL` pointing at the real
      server, not PGlite. Document how the suite selects the backend.
- [ ] `psql` can read every table; no column type differs from the schema's intent.
- [ ] `docs/current-status.md` §5 stops saying "no PostgreSQL", with the version recorded.
- [ ] Any incompatibility found is filed as its own task, not worked around silently.

### Suggested owner

Backend engineer with database operations experience.

### Verification

```bash
pnpm db:up
pnpm db:migrate
pnpm db:seed && pnpm db:seed
docker compose exec postgres psql -U veritrade -d veritrade -c '\dt'
pnpm --filter @veritrade/api test
```

### Out of scope

Performance tuning, replication, backups. Those are production concerns beyond a hackathon.

---

## PG-2 — Migration validation and drift detection

> **Status: done, 2026-11-06.** The Phase 4.5 migration was authored with `migrate diff`
> before any database had it, then applied to the live server. `prisma migrate status`
> reports no drift. A CI job against a PostgreSQL service container was **not** added —
> the workflow stays container-free, and `test:postgres` is the manual equivalent.

**Priority:** high · **Effort:** M · **Depends on:** PG-1

### Objective

Three migrations exist and have been applied only to PGlite, only in sequence, only on an
empty database. Three things are unproven: that they reproduce the schema exactly, that they
survive an upgrade from an older state, and that the committed SQL matches
`schema.prisma` today.

### Technical scope

- `apps/api/prisma/migrations/**`
- `apps/api/prisma/schema.prisma`
- `.github/workflows/ci.yml` — a drift check on every PR
- `docs/database-design.md`

### Dependencies

PG-1.

### Acceptance criteria

- [ ] `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --shadow-database-url ... --exit-code`
      reports **no difference**.
- [ ] Applying migrations 1→2→3 to an empty database produces the same schema as applying
      them fresh (compare `\d+` output, not eyeballing).
- [ ] A row inserted after migration 1 survives migrations 2 and 3 with its data intact —
      this is the upgrade path a real deployment would take.
- [ ] `prisma migrate status` reports "up to date" after `migrate deploy`.
- [ ] CI fails if someone edits `schema.prisma` without adding a migration.
- [ ] `docs/database-design.md` §"Migration strategy" records the command that proves this.

### Suggested owner

Backend engineer, or whoever owns the CI pipeline.

### Verification

```bash
cd apps/api
prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code
echo "exit 0 means no drift"
```

---

## SEC-1 — Rate limiting on chain-writing routes

> **Status: done, 2026-11-06.** `BlockchainQuotaGuard` applies a fixed-window write limit
> and an in-flight cap per organization, both database-backed. Reads are exempt. See
> [blockchain-security.md](blockchain-security.md) §9.1.

**Priority:** high · **Effort:** M · **Depends on:** nothing, but coordinate with BC-1

### Objective

There is no rate limit anywhere. An authenticated client can submit invoices, attempt logins,
and — most expensively — trigger chain writes, each of which spends testnet AVAX and consumes
a nonce. A single compromised token can drain a deployer wallet and stall every other
operation behind a nonce gap.

### Technical scope

- `apps/api/src/app.module.ts` — register the throttler
- `apps/api/src/blockchain/**` — per-organisation limits on the four lifecycle routes and
  `POST /invoices/:id/anchor`
- `apps/api/src/auth/auth.controller.ts` — login attempt limiting
- `apps/api/src/config/env.validation.ts` — limit configuration with defaults
- `apps/api/.env.example`
- `apps/api/test/` — a new spec proving the limit fires

### Dependencies

None. Choose a library (Nest's `@nestjs/throttler` is the obvious fit) or implement a
per-organisation counter; a library is preferred unless it brings a storage dependency that
conflicts with the single-process model.

### Acceptance criteria

- [ ] A burst above the configured limit returns `429` with a `Retry-After` header.
- [ ] The limit is keyed per organisation for authenticated routes, not per IP — two tenants
      behind one NAT must not throttle each other.
- [ ] Login attempts are limited per account and per IP, so a password spray is bounded.
- [ ] Chain routes have a stricter limit than read routes, and the numbers are justified in
      a comment (how many writes per minute can one deployer key afford?).
- [ ] Limits are configurable through env with a documented default; a test asserts the
      default is applied.
- [ ] The `429` uses the standard error envelope, with a stable `code`.
- [ ] `docs/current-status.md` §6 item 2 is updated.

### Suggested owner

Backend engineer with API security experience.

### Verification

```bash
pnpm --filter @veritrade/api test
# against a running API, with a token:
for i in $(seq 1 50); do
  curl -s -o /dev/null -w "%{http_code} " -X POST \
    http://localhost:3001/api/v1/invoices/$ID/anchor -H "authorization: Bearer $TOKEN"
done; echo
# expect a run of 202/200 followed by 429
```

---

## BC-1 — Transaction reconciliation worker

> **Status: done, 2026-11-06.** `BlockchainReconciliationService`, with the lease from
> BC-2, bounded backoff, and a hard rule that an `UNKNOWN` is never re-signed. See
> [transaction-reconciliation.md](transaction-reconciliation.md) §6.

**Priority:** high · **Effort:** L · **Depends on:** PG-1 (wants a real database)

### Objective

An operation whose RPC call timed out is marked `UNKNOWN` and keeps its signed hash. Today
nothing resolves it unless a client polls that specific operation. If the client closes the
tab, the operation stays `UNKNOWN` forever — the claim may exist on chain while the database
says nothing happened.

### Technical scope

- `apps/api/src/blockchain/blockchain-transaction.service.ts` — expose a sweep entry point
- `apps/api/src/blockchain/transaction-confirmation.service.ts` — reuse `reconcile()`
- a new `apps/api/src/blockchain/reconciliation.service.ts` or a worker entry point
- `apps/api/src/config/env.validation.ts` — interval, batch size, max age
- `apps/api/test/` — a spec that drives an `UNKNOWN` operation to `CONFIRMED`

### Dependencies

PG-1 is not strictly required, but the worker is the first component that assumes durable,
concurrent database access. Doing it on PGlite first is acceptable if the tests are honest
about that.

### Acceptance criteria

- [ ] A periodic sweep picks up operations in `UNKNOWN` older than a configurable threshold
      and resolves them by hash lookup.
- [ ] The sweep **never** signs or broadcasts a transaction. This is the whole point.
- [ ] An operation that resolves to a successful receipt moves to `CONFIRMED` and its business
      projection is applied, exactly as the request path would.
- [ ] An operation with no receipt after the threshold moves to `FAILED` — but only after a
      documented number of attempts, and the decision is recorded.
- [ ] Retries are bounded; a permanently failing operation stops being retried and is
      surfaced (log + `attemptCount`).
- [ ] The sweep is idempotent: running it twice concurrently does not double-apply a
      projection.
- [ ] A test covers the three outcomes: confirmed, reverted, still missing.
- [ ] `docs/transaction-reconciliation.md` documents the worker and its thresholds.

### Suggested owner

Backend engineer comfortable with distributed-systems failure modes. This is the task most
likely to be done subtly wrong.

### Verification

```bash
pnpm --filter @veritrade/api test
# integration: force an UNKNOWN by pointing at an unreachable RPC mid-submit,
# then start the worker and assert the operation reaches CONFIRMED or FAILED.
```

---

## BC-2 — Multi-instance safety

> **Status: done, 2026-11-06.** Nonce allocation takes a row lock on
> `blockchain_signer_nonces`; operations and the indexer cursor carry leases. Remaining
> single-instance constraints are listed in [current-status.md](current-status.md) §7.1.

**Priority:** medium · **Effort:** M · **Depends on:** BC-1 (shares files)

### Objective

The event indexer reads a cursor row, fetches logs, and writes the new position. There is no
lease. Two API instances would both read the same cursor and both insert the same events —
saved only by the `(chainId, txHash, logIndex)` unique index, which prevents duplicates but
not wasted work or a cursor that jumps backwards. The outbox's `exclusive()` queue is an
in-process promise chain; it does nothing across processes.

### Technical scope

- `apps/api/src/blockchain/blockchain-event-indexer.service.ts`
- `apps/api/src/blockchain/blockchain-transaction.service.ts` (`exclusive()`, `nextNonce()`)
- `apps/api/src/config/env.validation.ts`
- a migration adding a lease column, or a separate `chain_sync_lease` table
- `docs/transaction-reconciliation.md`

### Dependencies

BC-1 — same files, same mental model. Sequence them.

### Acceptance criteria

- [ ] Only one instance processes events at a time, enforced by the database (advisory lock,
      `SELECT ... FOR UPDATE SKIP LOCKED`, or a lease row with an expiry) — not by an
      in-process flag.
- [ ] A crashed holder's lease expires and another instance takes over without manual
      intervention.
- [ ] The nonce allocation path is safe across processes: two instances submitting for the
      same signer must not collide. Either serialise through the database or document why
      one signer per instance is required.
- [ ] A test simulates two workers and asserts each event is processed exactly once.
- [ ] `docs/transaction-reconciliation.md` states the guarantee and the mechanism.

### Suggested owner

Backend engineer with database-concurrency experience.

### Verification

```bash
pnpm --filter @veritrade/api test
# start two API instances against one database, emit N events,
# assert blockchain_events has exactly N rows and the cursor advanced once.
```

---

## BC-3 — Gas measurements

> **Status: done, 2026-11-06.** `pnpm --filter @veritrade/contracts gas:measure` prints
> the table in [current-status.md](current-status.md) §4.3. Gas units were cross-checked
> against a real mined Fuji transaction's fee.

**Priority:** medium · **Effort:** S · **Depends on:** PG-1 is not required; a local node is enough

### Objective

Nobody knows what a `register` costs. Bytecode size is 4 308 bytes, which says nothing about
gas. Without numbers, a Fuji deployment has no budget and no way to notice a regression.

### Technical scope

- `packages/contracts/scripts/` — a `measure-gas.ts` script, or a Hardhat test that records
  `gasUsed` per function
- `packages/contracts/test/VeriTradeInvoiceRegistry.spec.ts` — assertions on upper bounds
- `docs/blockchain-security.md` or a new section in `docs/blockchain-architecture.md`

### Dependencies

None. A local Hardhat node is sufficient for measurement; Fuji numbers can be filled in after
FUJI-1.

### Acceptance criteria

- [ ] Gas measured for `register`, `declareFinanced`, `cancelReservation`, `closeClaim`, and
      for a duplicate `register` that reverts.
- [ ] A table of measurements is committed, with the solc version, optimizer settings and EVM
      target recorded alongside — numbers without that context are meaningless.
- [ ] Tests assert an upper bound per function, so a change that doubles gas fails CI.
- [ ] The cost of a full lifecycle in AVAX is estimated at a stated gas price, with the
      assumption written down.
- [ ] `docs/avalanche-fuji-deployment.md` gains a "cost" section.

### Suggested owner

Smart contract engineer, or a backend engineer comfortable with Hardhat.

### Verification

```bash
pnpm --filter @veritrade/contracts test
pnpm --filter @veritrade/contracts exec hardhat run scripts/measure-gas.ts
```

---

## FUJI-1 — Fuji deployment readiness

> **Status: ready, not deployed.** Every guard is proven, gas is known, and the RPC is
> reachable. No deployer key exists and no transaction has been sent. Deployment still
> requires an explicit human instruction.

**Priority:** last · **Effort:** M · **Depends on:** PG-1, PG-2, BC-1, BC-2, BC-3

### Objective

Everything needed to deploy, verified _up to_ the point of sending a transaction — then a
human decides whether to send it. This task ends with a rehearsal and a checklist, not
necessarily with a deployment.

### Technical scope

- `packages/contracts/scripts/**` — rehearse the full sequence
- `packages/contracts/deployments/43113.json` — produced only if deployment is approved
- `docs/avalanche-fuji-deployment.md` — replace "not deployed" with the real state
- `apps/api/.env.example` — the Fuji values
- `docs/current-status.md` §8

### Dependencies

PG-1, PG-2, BC-1, BC-2, BC-3. Deploying before the reconciler exists means the first stuck
transaction has no recovery path.

### Acceptance criteria

- [ ] A funded, throwaway Fuji-only key exists, held by one named person, never committed.
- [ ] `env:check` reports the chain id, the RPC host, the signer address and the balance.
- [ ] `deploy:fuji` refuses without `CONFIRM_DEPLOY=fuji:43113` — re-verified, not assumed.
- [ ] `roles:fuji` grants `REGISTRAR_ROLE` and `FINANCIER_ROLE` and is idempotent on a second
      run.
- [ ] `verify:fuji` matches the deployed bytecode hash against the artifact.
- [ ] A single end-to-end anchor succeeds against Fuji, and the receipt is stored.
- [ ] The indexer picks up the event and the database projection matches the chain.
- [ ] `deployments/43113.json` is committed — it is public data and the address must survive
      a fresh clone.
- [ ] `docs/avalanche-fuji-deployment.md` and `docs/current-status.md` §8 are updated with the
      real address and transaction hash.
- [ ] **Explicit written approval from the Tech Lead is recorded in the PR.**

### Suggested owner

Tech Lead, executing with one other engineer watching. Deployment is a two-person operation.

### Verification

```bash
pnpm --filter @veritrade/contracts env:check
CONFIRM_DEPLOY=fuji:43113 pnpm --filter @veritrade/contracts deploy:fuji
REGISTRAR_ADDRESSES=0x... FINANCIER_ADDRESSES=0x... \
  CONFIRM_DEPLOY=fuji:43113 pnpm --filter @veritrade/contracts roles:fuji
pnpm --filter @veritrade/contracts verify:fuji
```

### Hard rules

- No mainnet. The validator refuses chain 43114; do not relax it.
- No key in the repository, in a log, in a screenshot, or in a PR description.
- No deployment without the approval recorded above.

---

## Suggested team allocation

Three engineers plus a lead, sized to the dependency graph:

| Role                      | Owns                          | Tasks                 |
| ------------------------- | ----------------------------- | --------------------- |
| **Tech Lead / architect** | decisions, review, deployment | FUJI-1, review of all |
| **Backend / database**    | schema, migrations, CI        | PG-1, PG-2            |
| **Backend / chain**       | `src/blockchain`, contracts   | BC-1, BC-2, BC-3      |
| **Backend / security**    | auth, guards, limits          | SEC-0, SEC-1          |

With two engineers: one takes PG-1 → PG-2, the other takes SEC-0 → SEC-1 → BC-3, then both
converge on BC-1 and BC-2 before FUJI-1.

Every task above is sized so that one person can finish it without blocking on another,
except where the dependency graph says otherwise.
