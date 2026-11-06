# Database design

Schema: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).
Migrations: [`apps/api/prisma/migrations/`](../apps/api/prisma/migrations/), committed and
reviewed like code.

## Conventions

| Concern     | Choice                                      | Why                                                                                                          |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Primary key | `UUIDv7` (`@default(uuid(7))`)              | Time-ordered, so inserts stay clustered on the primary-key index. Random v4 scatters them.                   |
| Money       | `Decimal(38, 18)` everywhere                | 20 integer + 18 fraction digits covers any ERC-20 token plus fiat, and never round-trips through a JS float. |
| Timestamps  | `timestamptz(3)`                            | Millisecond precision matches JS `Date` exactly, so what Prisma writes is what the API serialises.           |
| Naming      | camelCase fields, snake_case DB             | `@map` / `@@map` keep SQL conventional without camelCase identifiers leaking into `psql`.                    |
| Tenancy     | `organization_id` on every tenant-owned row | The tenant filter is visible at the call site and leads every composite index.                               |

UUIDv7 is generated **client-side** by Prisma, not by the database. There is no
`DEFAULT gen_random_uuid()` on the `id` columns. That is fine for every write path that
goes through Prisma, but a raw `INSERT` must supply an id.

## Entity relationships

```
                         ┌──────────────┐
                         │ Organization │ (tenant root)
                         └──────┬───────┘
        ┌───────────────────────┼────────────────────────┬───────────────┐
        │                       │                        │               │
┌───────▼────────┐    ┌─────────▼──────┐      ┌──────────▼────────┐  ┌───▼─────────┐
│  Membership    │    │    Invoice     │      │ FinancingRequest  │  │ Blockchain  │
│ (user ↔ org)   │    └─────────┬──────┘      └──────────┬────────┘  │   Record    │
└───────┬────────┘              │                        │           └─────────────┘
        │              ┌────────▼─────────┐    ┌─────────▼────────┐
        │              │InvoiceVerification│    │  RiskAssessment  │
        │              └──────────────────┘    └──────────────────┘
┌───────▼──────┐
│     User     │  (global, not tenant-scoped)
└──────────────┘

AuditLog ──▶ Organization (optional), User (optional)
```

`BlockchainRecord` holds optional foreign keys to `Invoice`, `InvoiceVerification`,
`FinancingRequest` and `RiskAssessment`. A record anchors exactly one of them; which one
is determined by `kind`. The alternative — four separate anchor tables — would multiply
the index surface for no query benefit.

Phase 4 added a second, orthogonal set of chain tables. They are **not** tenant-owned in
the same way, because they describe operations rather than documents:

```
BlockchainOperation ──1:1──▶ BlockchainTransactionReceipt
        │
        ├──▶ Organization (who asked)
        ├──▶ Invoice (optional, for INVOICE_ANCHOR)
        └──▶ FinancingRequest (optional, for the three lifecycle operations)

BlockchainEvent ──▶ (chainId, txHash, logIndex)   // no FK, keyed by chain identity
ChainSyncCursor ──▶ (chainId, contractAddress)    // infrastructure, no FK
```

The outbox is separate from `blockchain_records` on purpose. An operation is an
_intent_ that may never produce a record; a record is a _confirmed_ projection. Merging
them would mean writing "confirmed" before the chain agreed.

## Models

### `users`

A person. Not tenant-scoped: one human can belong to several organisations.

- `email` is unique and stored **lowercased**, so `Alice@Example.com` and
  `alice@example.com` are one account. `IdentityAccessService.findUserByEmail`
  normalises before lookup; the unique index is what actually prevents duplicates.
- `password_hash` is nullable: a wallet-only account authenticates by signature and has
  no password to store. When set, it holds an Argon2id hash, never the password.

### `organizations`

The tenant. `slug` is globally unique so it can appear in links. `country_code` is a
`CHAR(2)` ISO 3166-1 alpha-2 code — fixed width because the format is fixed.

### `organization_memberships`

Join table with a role. `@@unique([organizationId, userId])` is the invariant that stops
a user being added to the same organisation twice; `@@index([userId])` serves the reverse
lookup ("which organisations does this person belong to").

### `invoices`

The trade receivable. `status` is the pipeline state, `fingerprint` is the duplicate
detection key.

`@@unique([organizationId, fingerprint])` is scoped to the tenant on purpose: two
different organisations may legitimately hold invoices that look identical to each
other, and a global unique index would reject the second one.

Indexes:

| Index                                   | Serves                                |
| --------------------------------------- | ------------------------------------- |
| `(organization_id, fingerprint)` unique | duplicate refusal on upload           |
| `(organization_id, status, due_date)`   | "my verified invoices due this month" |
| `(organization_id, invoice_number)`     | lookup by the human-readable number   |

### `invoice_verifications`

One attempt per row, many per invoice. The history of failed and repeated checks is
evidence, not noise — overwriting it would destroy the audit trail behind a decision.

`findings` is `JSONB` because provider output is provider-shaped and would otherwise
force a schema change per integration. It is off-chain only.

`@@index([invoiceId, createdAt DESC])` serves "latest verdict", which is what callers
almost always want.

### `financing_requests`

`interest_rate_bps` is an **integer** in basis points, not a float. Interest arithmetic
must not depend on binary floating point; 850 means 8.50%.

`active_key` is the duplicate-financing guard. Postgres treats `NULL`s as distinct in a
unique index, so:

- a live request stores `'ACTIVE'`
- a terminal request stores `NULL`
- `@@unique([invoiceId, activeKey])` therefore permits **at most one live request per
  invoice**, while allowing any number of rejected or cancelled ones

This is the Prisma-native equivalent of a partial index
(`CREATE UNIQUE INDEX ... WHERE status IN (...)`). It was chosen because Prisma cannot
express a partial index in the schema, and a hand-added index in raw SQL would be dropped
the next time `prisma migrate dev` diffed the database.

### `risk_assessments`

A time series, never updated in place. `score` is 0–100 (higher is safer), `level` is the
banded verdict, `model` names the ruleset that produced it, `factors` is the per-factor
breakdown.

`@@index([financingRequestId, assessedAt DESC])` serves "current score".

### `blockchain_records`

Pointers and hashes only.

- `tx_hash` is `CHAR(66)` (0x + 64 hex). Uniqueness is `@@unique([chainId, txHash])`
  because a transaction hash is unique _per chain_, not globally.
- `payload_hash` is `CHAR(66)` — a Keccak-256 of the canonical off-chain payload.
- `block_number` is `Int`, not `BigInt`. Block numbers fit in 32 bits on every EVM chain
  in use, and `BigInt` is not JSON-serialisable, so it would break every response that
  included one.

This table is now the _confirmed_ projection only. It is written by
`TransactionConfirmationService` after a receipt lands, never before.

### `blockchain_operations` (the outbox)

The durable record of "we intend to change the chain". One row per intended transition,
created before any RPC call.

- `idempotency_key` is `@unique` and is derived from the operation type plus the entity
  identity (`anchor:<invoiceId>`, `declare:<financingRequestId>`, …). A repeated call
  reads the existing row instead of creating a second transaction.
- `status` walks `PENDING → SUBMITTING → SUBMITTED → CONFIRMED`, with `FAILED` for a
  definite rejection and `UNKNOWN` for an ambiguous one. `UNKNOWN` is the important
  state: it means a transaction may exist and must not be re-signed.
- `tx_hash` is nullable because a row exists before a hash does. Once set, it is the
  reconciliation handle.
- `nonce` and `from_address` are stored so a restart can reason about what this process
  already put on the wire.
- `attempt_count` / `next_attempt_at` back bounded retry. `@@index([status,
nextAttemptAt])` is the sweep index; `@@index([txHash])` is the reconciliation lookup.

### `blockchain_transaction_receipts`

One row per confirmed operation, `operationId @unique` so a receipt cannot be attached
twice. Gas fields are `BigInt` here because gas _can_ exceed 2^53 and this table is never
serialised directly — the presenter converts to strings. `@@unique([chainId, txHash])`
mirrors `blockchain_records` for the same reason.

Receipts are stored **separately from business state** on purpose: the receipt is
evidence about the chain, the business row is the projection. Mixing them means a failed
projection write can leave the receipt unrecoverable.

### `blockchain_events`

Decoded logs, `@@unique([chainId, txHash, logIndex])` so an indexer replay inserts
nothing. `payload` is `Json` with bigints stringified — a log is not queryable data, it
is an audit trail with a searchable key. `eventType` is the enum `INVOICE_RESERVED`,
`FINANCING_DECLARED`, `RESERVATION_CANCELLED`, `CLAIM_CLOSED`.

### `audit_logs`

Append-only. There is no update or delete path in the application. A correction is a new
row.

`ip_hash` stores a salted hash, not the client address: enough to correlate abuse, not
enough to identify a person from a database dump alone.

`organization_id` and `actor_user_id` use `ON DELETE SET NULL` rather than `RESTRICT`.
Deleting a user must not be blocked forever by their history, but the history must not
disappear either.

### `chain_sync_cursor` (infrastructure)

Indexer progress per `(chain_id, contract_address)`, composite primary key. It records how
far on-chain events have been consumed so a restart or replay does not double-process
them. Not domain data.

`last_processed_block_hash` was added in Phase 4. Without it the cursor can only say
"we reached height N"; with it the indexer can detect that the block at height N now has
a different hash — a reorg — and rewind. The rewind deletes events at or above that
height and clears the hash, so the next pass re-reads the canonical chain. One block per
pass: rewinding to genesis on a bad read would be worse than being briefly stale.

### `blockchain_rate_limits` (Phase 4.5, infrastructure)

Fixed-window request counter, primary key `(organization_id, window_start)`.

`window_start` is the clock quantised to the window size, so an increment is a single
`INSERT … ON CONFLICT DO UPDATE SET count = count + 1`. That is why a fixed window was
chosen over a sliding log: one atomic upsert per request instead of an insert plus a range
scan, and two instances incrementing the same window still produce the true total.

Rows are disposable — nothing reads a window after it closes. There is no cleanup job yet;
the table grows by one row per organization per window and is safe to prune with
`DELETE FROM blockchain_rate_limits WHERE window_start < now() - interval '1 day'`.

### `blockchain_signer_nonces` (Phase 4.5, infrastructure)

Primary key `(chain_id, address)`, one column of interest: `next_nonce`.

This row is the serialisation point for nonce allocation. Two instances reading
`eth_getTransactionCount` and adding one would both sign with the same nonce, and the node
accepts both — one silently replaces the other. Taking `SELECT … FOR UPDATE` on this row
makes the second allocator wait, so the sequence stays contiguous.

Not tenant data: keyed by chain and signer address, with no organization relationship.

### Lease columns (Phase 4.5)

`blockchain_operations` and `chain_sync_cursor` both gained `lease_owner` and
`lease_expires_at`. A worker claims work with a conditional update:

```sql
UPDATE … SET lease_owner = $worker, lease_expires_at = now() + interval '120 seconds'
 WHERE id = $id AND status = $observed AND (lease_expires_at IS NULL OR lease_expires_at < now())
```

`count = 1` means the claim was won. A crashed worker leaves a lease that expires, so its
rows are picked up without an operator. There is deliberately no separate lock table: the
row being worked on is the lock, which means a lease cannot outlive the row it protects.

### `trade` (Phase 1, preserved)

The settlement record from Phase 1: parties, asset, exact `numeric(38,18)` amount, status
enum, settlement transaction. `reference` is the caller-supplied idempotency key and is
unique. Settlement columns stay null until the on-chain transaction confirms.

`TradeStatus` values are **lowercase** (`draft`, `pending`, …) because that is what the
existing API contract returns and what the Phase 1 tests assert. Renaming them would be a
breaking API change for cosmetic gain.

## State machines

Two machines now, and they are not the same machine.

```
Invoice:            DRAFT → SUBMITTED → UNDER_REVIEW → VERIFIED → FINANCING_REQUESTED → FINANCED → SETTLED
                                              └──────▶ REJECTED
   any non-terminal ─────────────────────────────────────────────────────────────────▶ CANCELLED

FinancingRequest:   REQUESTED → UNDER_REVIEW → APPROVED → FUNDED → REPAID
                                   └─────────▶ REJECTED
   any non-terminal ──────────────────────────────────────▶ CANCELLED
   (Phase 4 projection: REQUESTED → RESERVED → FINANCING_DECLARED → CLOSED, or
    RESERVED → CANCELLED)

Chain claim:        UNREGISTERED → RESERVED → FINANCED → CLOSED
                                  └──────────▶ UNREGISTERED  (reservation cancelled)

Verification:       PENDING → PASSED | FAILED

BlockchainRecord:   PENDING → CONFIRMED | FAILED

BlockchainOperation: PENDING → SUBMITTING → SUBMITTED → CONFIRMED
                                  └────────────▶ FAILED
                     SUBMITTING | SUBMITTED ────▶ UNKNOWN ──▶ CONFIRMED | FAILED

RiskLevel:          LOW | MEDIUM | HIGH | CRITICAL
```

**Terminal** financing states are the ones that release `active_key` to `NULL`:
`REJECTED`, `CANCELLED`, `REPAID`, plus the Phase 4 `CLOSED`. Everything else holds it.

The chain machine and the database machine are deliberately not identical, and the
mapping is one-directional in one respect: `FINANCING_DECLARED` is _not_ `FUNDED`. The
contract records an attestation that a financier agreed to finance; it cannot observe a
bank transfer, so nothing in the system claims money moved. `FUNDED` stays in the enum
and nothing writes it. The full argument, including why `generation` increments on
re-registration, is in [financing-state-machine.md](./financing-state-machine.md).

## Duplicate financing: threat model

The attack is straightforward and worth stating plainly: submit the same receivable to
several lenders, or to the same lender several times, and borrow against it more than
once. Three vectors, three controls.

| #   | Vector                                             | Control                                                              |
| --- | -------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Same organisation uploads the same invoice twice   | `@@unique([organizationId, fingerprint])` → `P2002` → `409`          |
| 2   | Two organisations hold the same underlying invoice | Detected by the on-chain registry, not by this database — see below. |
| 3   | Same invoice financed twice, possibly concurrently | `@@unique([invoiceId, activeKey])` → at most one live request        |

Vector 3 is the one a naive implementation gets wrong. Checking `SELECT ... WHERE
invoice_id = ? AND status = 'ACTIVE'` in application code and then inserting is a
time-of-check/time-of-use race: two concurrent requests both see nothing and both insert.
The database constraint is the only reliable answer, and it holds under concurrency
because the index is enforced inside the insert.

Vector 2 used to be an explicit gap and is now closed at a different layer. The
database cannot see across tenants — that is the point of tenancy — so the check lives
in the registry contract, which is global. Both organisations derive the same
`commitment` from the same canonical identity, and the second `register` reverts with
`ClaimAlreadyActive`. The database's job is only to record the outcome.

What that buys and what it costs is worth stating precisely:

- **Gained:** a second organisation cannot reserve an invoice that is already reserved or
  financed, and the refusal is enforced by consensus rather than by an application check
  one bug away from being skipped.
- **Cost:** the commitment is public. Anyone reading the chain can see that _some_
  invoice with a given commitment exists, even without knowing which. That is why the
  commitment is domain-separated and versioned rather than a bare fingerprint — see
  [invoice-commitment-spec.md](./invoice-commitment-spec.md), which also covers what a
  dictionary attack on predictable invoice numbers can still achieve.
- **Not gained:** the registry proves _a claim was made_, not that the invoice is real.
  Two organisations that both hold a forged invoice still collide, and neither is
  protected from the other's fraud beyond the fact that only one can finance it.

## Invoice fingerprint

The fingerprint is a SHA-256 over a canonical field tuple. Canonicalisation exists so two
systems holding the same invoice derive the same hash.

```
v1|<INVOICE_NUMBER>|<ISSUER_TAX_ID>|<DEBTOR_TAX_ID>|<CURRENCY>|<AMOUNT>|<ISSUE_DATE>|<DUE_DATE>
```

Rules, in order:

1. Prefix `v1` — a version marker so a future change is distinguishable rather than
   silently invalidating stored hashes.
2. `invoiceNumber`, `issuerTaxId`, `debtorTaxId`, `currency`: trimmed, uppercased.
3. `amount`: fixed-point string, normalised to 18 fraction digits
   (`48250.000000000000000000`). Never a float.
4. `issueDate`, `dueDate`: `YYYY-MM-DD`, UTC.
5. Fields joined with `|`; UTF-8; SHA-256; lowercase hex, 64 characters.

The reference implementation is `fingerprint()` in
[`apps/api/prisma/seed.ts`](../apps/api/prisma/seed.ts).

### Collision and duplication risk

- **Hash collisions.** SHA-256 collision probability is negligible. The realistic risk is
  not a collision but a _mismatch_: two implementations that disagree on normalisation
  produce different hashes for the same invoice, and duplicate detection silently fails.
  That is why the canonical form is specified as a versioned string rather than left to
  each caller.
- **False positives.** Two genuinely different invoices that normalise to the same tuple
  (same number, parties, currency, amount and dates) are indistinguishable to this
  scheme. In practice they would also be indistinguishable to a human reviewer. The
  unique constraint rejects the second, and the `409` tells the caller why.
- **Excluded fields.** Free-text descriptions, line items and attachments are not part of
  the fingerprint. Including them would make the hash unstable across cosmetic edits.
- **Changing the algorithm** is a schema migration: every stored fingerprint becomes
  stale and must be recomputed. Bump the `v1` prefix, add the new column or recompute in
  a background job, and never do it in place without a backfill plan.

### Fingerprint versus commitment

The fingerprint above is the **database** identity: it is computed over the full tuple
(number, tax ids, currency, amount, dates) and is never published. The **on-chain**
commitment is derived from a narrower identity digest and wrapped in a domain-separated
envelope:

```
identityDigest = keccak256(canonicalIdentity)          // seller tax id, series, number, template
commitment     = keccak256(abi.encode(DOMAIN, SCHEMA_VERSION, identityDigest))
```

Two differences matter. The identity is narrower because amount and dates must not be
frozen on chain — a corrected amount is a new document version, not a new invoice. The
envelope exists so the on-chain value is not a bare hash of a guessable string. Both
decisions, and the residual dictionary-attack risk, are argued in
[invoice-commitment-spec.md](./invoice-commitment-spec.md).

## Migration strategy

Migrations are **generated without a live database**:

```bash
cd apps/api
prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script \
  -o prisma/migrations/<timestamp>_init/migration.sql
```

`migrate diff` reads the schema file and emits SQL; it never opens a connection. That is
what allows the migration to be written and reviewed on a machine with no Postgres, and
it is why the committed SQL is the reviewable artifact rather than an opaque snapshot.

Applying them (`prisma migrate deploy`) _does_ need a live server. Until one is
available, the migration is verified by applying it to PGlite — Postgres compiled to
WASM — which runs the same DDL through the same parser. See
[development-setup.md](./development-setup.md) for the exact commands and what was and
was not verified.

Rules:

- Never edit an applied migration. Add a new one.
- Every migration is reviewed as SQL in the pull request.
- `prisma migrate dev` requires a shadow database and a reachable server; it is not
  available in an environment without Docker.
