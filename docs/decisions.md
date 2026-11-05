# Decisions

An architecture decision record log. Each entry is a decision that is **expensive to
reverse** or **easy to undo by accident**. If you are about to change one, change the entry
too, in the same pull request.

Format: context → decision → consequence. Status is `accepted`, `superseded` or
`deprecated`.

---

## ADR-001 — Prisma 7 instead of Drizzle

**Status:** accepted · **Date:** 2026-11-05 · **Supersedes:** an earlier Drizzle setup

**Context.** The data layer was originally built on Drizzle, and it worked: two committed
migrations, 36 passing tests. The Phase 2 specification required Prisma — schema validation,
client generation, a `PrismaService`. Keeping Drizzle would have meant documenting a
deviation from the brief.

**Decision.** Migrate fully to Prisma 7.10.1, Rust-free, over the `@prisma/adapter-pg`
driver adapter. Delete Drizzle entirely rather than running both.

**Consequence.** One ORM, one migration mechanism, one generated client. The `trade` module
was kept and had to stay green through the swap — that was the honesty check (ADR-002).
The cost: Prisma 7's `prisma-client` generator emits TypeScript into
`apps/api/src/generated/`, which must be git-ignored and regenerated on install.

**Do not** reintroduce Drizzle, or add a second query layer beside Prisma.

---

## ADR-002 — Keep the Phase 1 `trade` module

**Status:** accepted · **Date:** 2026-11-05

**Context.** `trade` predates the domain model, is unauthenticated, and is not part of the
product. Deleting it during the ORM migration would have been tidy.

**Decision.** Keep it, with its tests.

**Consequence.** It is the only behaviourally-tested slice written before the domain model,
so keeping it green proved the Prisma swap preserved behaviour rather than only compiling.
The cost is a live unauthenticated write surface (see
[current-status.md](current-status.md#6-unresolved-security-issues-ranked), item 1) that a
deployment must remove.

---

## ADR-003 — Health endpoints are split, and the legacy route stays

**Status:** accepted · **Date:** 2026-11-05

**Context.** `/health` existed from Phase 1. Phase 2 added versioned endpoints.

**Decision.** Three routes, three jobs: `/api/v1/health` (liveness, touches nothing),
`/api/v1/health/db` (readiness, runs `SELECT 1`), `/health` (legacy liveness alias, kept at
the root for container probes). `/api/health` stays a `404`, and a test asserts that.

**Consequence.** A slow database cannot trigger a restart loop, because liveness does not
depend on it. Merging the two would be a one-line change with an outage-shaped blast radius.

---

## ADR-004 — Verification is local-only, and `PASSED` is unreachable

**Status:** accepted · **Date:** 2026-11-05

**Context.** The check engine has seven checks. Two of them — tax-authority approval and
certificate trust chains — need integrations that do not exist. They could have been
stubbed to return success, which would make the demo look better.

**Decision.** Report them as `UNSUPPORTED` and `NOT_CHECKED`, and scope every result
`LOCAL_CHECKS_ONLY`. Because a check is unsupported, no run can aggregate to `PASSED`; the
best outcome is `PARTIAL`.

**Consequence.** The API cannot claim an invoice is legally valid, which is correct. A
downstream consumer must handle `PARTIAL` as the happy path (ADR-005). **Do not** make the
unimplemented checks pass, and do not delete `PARTIAL` to simplify the enum.

---

## ADR-005 — Anchoring accepts `PASSED` or `PARTIAL`

**Status:** accepted · **Date:** 2026-11-05 · **Depends on:** ADR-004

**Context.** If anchoring required `PASSED`, and `PASSED` is unreachable, nothing could ever
be anchored.

**Decision.** `assertAnchorable()` accepts the latest verification if its status is `PASSED`
or `PARTIAL`. Anything else is a `409 INVOICE_NOT_VERIFIED`.

**Consequence.** Anchoring works today. Tightening it to `PASSED` alone would silently
disable the entire chain workflow — a change that passes every unit test and breaks the
product.

---

## ADR-006 — The on-chain commitment is not the database fingerprint

**Status:** accepted · **Date:** 2026-11-05

**Context.** Phase 3 already had a SHA-256 fingerprint over
`number | issuer | debtor | currency | amount | issueDate | dueDate`. Publishing it on chain
was the obvious move.

**Decision.** Derive a separate, narrower identity digest (seller tax id, series, number,
template code) and wrap it:
`commitment = keccak256(abi.encode(DOMAIN, SCHEMA_VERSION, identityDigest))`.

**Consequence.** Amounts and dates are not frozen on chain, so a corrected re-issue is a new
document version rather than a new invoice identity. The domain tag stops the value being
reusable as a fingerprint in another system. The privacy analysis — including what a
dictionary attack can still achieve — is in
[invoice-commitment-spec.md](invoice-commitment-spec.md). Changing the encoding is a
breaking change requiring a new schema version, not an edit.

---

## ADR-007 — Custom errors with a selector-based fallback

**Status:** accepted · **Date:** 2026-11-05

**Context.** Solidity `require` strings cost gas and are hard to map to stable API codes.
Custom errors are cheaper and typed, but a node may truncate revert data to the 4-byte
selector, leaving viem unable to decode the name.

**Decision.** Use custom errors, and build a `selector → name` map from the local ABI at
module load. `decodeRevert()` tries the decoded name first, then the map, then `'Reverted'`.

**Consequence.** The API returns `SIMULATION_REVERTED:ClaimAlreadyActive` rather than
`SIMULATION_REVERTED:Reverted`. Without the fallback the collision test failed against a
real node while passing in isolation — the fallback is not defensive coding, it is required.

---

## ADR-008 — No upgradeability proxy

**Status:** accepted · **Date:** 2026-11-05

**Context.** A proxy would let the registry be fixed after deployment.

**Decision.** Immutable contract.

**Consequence.** A bug means deploying a new registry and migrating claims, which is
painful. In exchange, no admin can rewrite a claim after the fact — which is the property
the registry exists to provide. A proxy would make the admin's power unbounded and the
guarantee meaningless.

---

## ADR-009 — No `ReentrancyGuard`

**Status:** accepted · **Date:** 2026-11-05

**Context.** Security checklists say "add `nonReentrant` to state-changing functions".

**Decision.** Do not. The contract makes no external calls, holds no funds, and transfers
nothing.

**Consequence.** One less inherited behaviour and less gas. If a future version adds a call
out — a hook, a callback, an ERC-20 transfer — this ADR must be revisited **in the same
change**, not after.

---

## ADR-010 — A durable outbox instead of direct submission

**Status:** accepted · **Date:** 2026-11-05

**Context.** Submitting a transaction inside an HTTP handler and writing the result
afterwards loses the intent if the process dies between the two.

**Decision.** `blockchain_operations` is written first, with a `@unique` idempotency key
derived from operation type + entity identity. The HTTP handler then drives the operation as
far as one request can.

**Consequence.** A repeated request reads the existing row instead of creating a second
transaction. A crash leaves a durable record to resume from. **No database transaction spans
PostgreSQL and Avalanche** — that constraint is the reason for the whole design, not an
implementation detail.

---

## ADR-011 — `UNKNOWN` is reconciled, never re-signed

**Status:** accepted · **Date:** 2026-11-05 · **Depends on:** ADR-010

**Context.** An RPC timeout is ambiguous: the transaction may or may not have been
broadcast. Treating it as a failure and retrying is the classic double-spend-of-intent bug.

**Decision.** A timeout moves the operation to `UNKNOWN` and keeps the signed hash.
Reconciliation calls `getTransactionReceipt` by hash. It never re-signs, and there is no
automatic retry that could produce a second transaction for the same intent.

**Consequence.** An operation can sit in `UNKNOWN` indefinitely if nobody polls it — see
item 4 in [current-status.md](current-status.md#1-the-five-statements-that-matter-most).
That is the safe failure direction: a stuck operation is recoverable, a duplicate claim is
not.

---

## ADR-012 — Receipts are stored separately from business state

**Status:** accepted · **Date:** 2026-11-05

**Context.** The receipt and the business projection are written in the same logical step.

**Decision.** `blockchain_transaction_receipts` is its own table, one row per operation,
`operationId @unique`.

**Consequence.** The receipt is evidence about the chain; the business row is a projection
of it. A failed projection write can be replayed from the receipt. Merging them would make
the evidence unrecoverable exactly when it is needed.

---

## ADR-013 — A generation counter, so cancellation is not erasure

**Status:** accepted · **Date:** 2026-11-05

**Context.** A cancelled reservation returns the commitment to `UNREGISTERED`. Without more,
a later reservation is indistinguishable from the first, and the cancellation disappears.

**Decision.** Increment `generation` on every reservation. Emit it in every event, and keep
`reservedAt`, `registrar`, `financier` and `financingRef` after cancellation.

**Consequence.** "A completed state transition cannot silently disappear" is enforced
structurally. An indexer or auditor can reconstruct the full history from events. Closing
never clears the financing record, and a test asserts it.

---

## ADR-014 — Documentation filenames stay lowercase kebab-case

**Status:** accepted · **Date:** 2026-11-05

**Context.** The Phase 4.5 brief asked for `docs/ARCHITECTURE.md`, `docs/CURRENT_STATUS.md`
and similar. The repository already had 13 documents named `architecture.md`,
`database-design.md`, `transaction-reconciliation.md`. macOS is case-insensitive: creating
`docs/ARCHITECTURE.md` beside `docs/architecture.md` does not create a second file, it
silently targets the first. Committing both spellings would also break a Linux checkout.

**Decision.** Keep lowercase kebab-case for every document, including the new ones
(`current-status.md`, `project-context.md`, `onboarding.md`, `roadmap.md`, `decisions.md`).
`architecture.md` is the architecture document the brief asked for; it was extended, not
duplicated.

**Consequence.** Consistent naming and no broken links on any platform. If the team prefers
uppercase, the rename has to be a single `git mv` sweep across all 20 files **and** every
cross-reference in the same commit — not a partial rename.

---

## ADR-015 — TypeScript 6.0.3 and ESLint 10 are pinned

**Status:** accepted · **Date:** 2026-11-05

**Context.** NestJS 12 requires `typescript >= 6.0.0`; `typescript-eslint` 8.72.1 peers on
`>=4.8.4 <6.1.0`. TypeScript 5 fails the Nest peer; TypeScript 7 fails the lint peer.
ESLint 9 is flagged deprecated by pnpm.

**Decision.** Pin TypeScript 6.0.3 and ESLint 10.14.0 across the workspace.

**Consequence.** 6.0.3 is the only version satisfying both constraints. **Do not** bump to
TypeScript 7 or downgrade ESLint to 9 without checking both peers again.

---

## ADR-016 — `apps/api` is ESM with `.js` specifiers

**Status:** accepted · **Date:** 2026-11-05

**Context.** Every `@nestjs/*` package in v12 is ESM-only. A CommonJS build only ran by
leaning on Node's `require(esm)` and would fail on Node 20.

**Decision.** `"type": "module"`, `module: NodeNext`. Every relative import ends in `.js`.

**Consequence.** TypeScript does not rewrite specifiers, so `./app.module` must be written
`./app.module.js` even though the file is `.ts`. Prisma's generated client is the one
exception, handled by `rewriteRelativeImportExtensions`. A missing `.js` is a runtime
`ERR_MODULE_NOT_FOUND`, not a compile error.

---

## ADR-017 — PGlite is the test database

**Status:** accepted · **Date:** 2026-11-05

**Context.** No Docker on the development machine, but the tests must exercise real DDL and
real constraints — a mocked Prisma client would not catch a wrong unique index.

**Decision.** Boot PGlite (Postgres compiled to WASM), apply the committed migrations, and
expose it over the Postgres wire protocol so Prisma reaches it through the ordinary `pg`
adapter.

**Consequence.** Tests run the real query path with no external service. **This is not
proof of PostgreSQL 17 compatibility** and must never be described as such. It does not
exercise a networked server, connection pooling under load, or production extensions.

---

## ADR-018 — `FINANCING_DECLARED` instead of `FUNDED`

**Status:** accepted · **Date:** 2026-11-05

**Context.** The natural lifecycle ends in "financed". The contract records that a financier
attested to an agreement. It cannot observe a bank transfer.

**Decision.** Map the chain's `FINANCED` state to the database's `FINANCING_DECLARED`. Leave
`FUNDED` in the enum and write it from nowhere.

**Consequence.** The system never claims money moved. Anyone adding a `FUNDED` write is
making a factual claim the architecture cannot support, and should stop.
