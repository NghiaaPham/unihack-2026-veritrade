# Architecture

VeriTrade lets a business turn a verified invoice into short-term financing, with the
proof of verification anchored on Avalanche. This document covers how the codebase is
organised to deliver that, and why.

**Related:** [project-context.md](project-context.md) for the product and vocabulary ·
[current-status.md](current-status.md) for what actually works ·
[decisions.md](decisions.md) for why past choices were made ·
[blockchain-architecture.md](blockchain-architecture.md) for the chain layer, which this
document only summarises.

## Shape: a modular monolith

One deployable API, one database, nine domain modules. Not microservices.

A hackathon-scale team cannot afford the operational surface of nine services, and the
domains are not independent enough to justify it: every financing decision reads an
invoice, every invoice belongs to an organisation, every risk score belongs to a
financing request, and every chain write belongs to one of them. Splitting those across
network boundaries would replace in-process calls with distributed transactions before
there is a single user.

The chain boundary is the one place where a real external dependency exists, and it is
still an in-process module. `BlockchainModule` talks to Avalanche over RPC, which is
already asynchronous, already failure-prone and already outside the transaction
boundary — so the seam that matters is a durable outbox row, not a service split. See
[transaction-reconciliation.md](./transaction-reconciliation.md).

What _is_ enforced is the module boundary. A module exposes a service; nothing else
reaches into another module's tables. That keeps the seams real, so extracting a module
later is a mechanical move rather than a rewrite.

```
apps/api/src
├── main.ts, app.module.ts, app.setup.ts   bootstrap, root module, shared HTTP config
├── config/env.validation.ts               fail-fast environment validation
├── database/                              PrismaService, PrismaModule, error mapping
├── health/                                liveness + readiness
├── trade/                                 Phase 1 settlement record (kept)
└── <domain>/                              one directory per domain module
```

## Modules

### Domain modules

| Module                 | Owns                                                     | Tables                                                                                                                     |
| ---------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `auth`                 | Registration, login, token issuance, guards              | `users`, `organization_memberships`                                                                                        |
| `identity-access`      | User lookup seam                                         | `users`, `organization_memberships`                                                                                        |
| `organizations`        | The tenant root                                          | `organizations`                                                                                                            |
| `invoices`             | Invoice intake, canonical fingerprint, duplicate refusal | `invoices`, `invoice_documents`                                                                                            |
| `invoice-verification` | The check engine and the append-only history of runs     | `invoice_verifications`, `verification_checks`                                                                             |
| `financing-requests`   | Request lifecycle, single-active-request invariant       | `financing_requests`                                                                                                       |
| `risk-assessment`      | Scoring runs, kept as a time series                      | `risk_assessments`                                                                                                         |
| `blockchain-registry`  | The Phase 2 read seam over confirmed anchors             | `blockchain_records`                                                                                                       |
| `blockchain`           | Commitments, the outbox, receipts, event indexing        | `blockchain_operations`, `blockchain_transaction_receipts`, `blockchain_events`, `blockchain_records`, `chain_sync_cursor` |
| `audit-logs`           | Append-only record of who did what                       | `audit_logs`                                                                                                               |

Phase 3 implemented the invoice pipeline end to end. Phase 4 implemented the chain
side of it: `blockchain` submits transactions, waits for receipts and indexes events, and
`financing-requests` drives the claim lifecycle through it. `risk-assessment` still
exposes only its read seam.

`blockchain-registry` and `blockchain` are two modules, not one renamed. The first is the
Phase 2 skeleton — a read seam over `blockchain_records` that the domain-wiring test still
asserts. The second is the Phase 4 engine. Folding them together would mean either
rewriting that test or hiding the write path behind a class that also serves reads;
keeping them apart costs one module declaration.

`blockchain` sits below `invoices` and `financing-requests` rather than beside them:
both feature modules depend on it, it depends on neither. The two outbox tables it owns
are the only place where "we intend to write to the chain" is durable. See
[blockchain-architecture.md](./blockchain-architecture.md).

### Why `invoices` and `invoice-verification` are separate modules

Intake and verification have different dependencies and different failure modes. Intake
needs the XML parser and the storage backend; verification needs the parser and the
database, plus a place to record what it found. Keeping them apart means the check
inventory can grow — and the eventual tax-authority integration can arrive — without
touching the intake path.

The two share no state: `InvoiceVerificationService` reads the invoice it is given and
writes only its own tables. The dependency runs one way, `invoices → invoice-verification`,
which is why there is no `forwardRef` anywhere in the graph.

### Three small modules that exist to break cycles

| Module                  | Provides                  | Why it is not folded in                                    |
| ----------------------- | ------------------------- | ---------------------------------------------------------- |
| `InvoiceXmlModule`      | `InvoiceXmlParserService` | Both intake and verification parse documents               |
| `DocumentStorageModule` | `DocumentStorage`         | Intake writes, verification reads                          |
| `AuthModule`            | Guards + `JwtModule`      | Guards are instantiated in the consuming module's injector |

`AuthModule` re-exports `JwtModule`, not just the guards. A guard applied with
`@UseGuards()` is constructed by the _consuming_ module's injector, so `JwtService` has to
be resolvable there — omitting the re-export produces a DI error at boot, not at first
request.

### Platform modules

- **`database`** — `PrismaService` (global) owns the `pg` pool and the Prisma client.
  There is exactly one per process.
- **`health`** — liveness and readiness, described below.
- **`trade`** — the Phase 1 settlement record. Kept deliberately: it is the only
  behaviourally-tested slice that predates the domain model, and keeping it green while
  the ORM changed was the check that the migration was honest.

## Request lifecycle

```
HTTP → ValidationPipe (whitelist + forbidNonWhitelisted + transform)
     → JwtAuthGuard (verify token, re-read membership)
     → RolesGuard (@Roles metadata)
     → Controller (routing, parameter parsing)
     → Service (business rules, tenant scoping)
     → PrismaService (one shared client)
     → PostgreSQL
```

Two cross-cutting rules live in `app.setup.ts` and apply identically in `main.ts` and in
the e2e tests, so runtime and test behaviour cannot drift:

1. A global `api` prefix, with `health` excluded so probes keep a stable root URL.
2. A `ValidationPipe` that rejects unknown properties rather than dropping them. A typo
   in a field name is a `400`, not a record created with a default.

A third is registered in the same place for the same reason: `HttpExceptionFilter`, which
produces one error envelope (`statusCode`, `code`, `message`, `details`, `timestamp`,
`path`) for every failure. An error shape that exists only in production is an error shape
nobody tested.

## Health: liveness vs readiness

The two questions are different and must not share an answer.

| Endpoint                | Question                         | Touches the database | Failure code |
| ----------------------- | -------------------------------- | -------------------- | ------------ |
| `GET /api/v1/health`    | Is this process alive?           | No                   | —            |
| `GET /api/v1/health/db` | Can this process reach Postgres? | Yes, `SELECT 1`      | `503`        |
| `GET /health`           | Legacy alias for liveness        | No                   | —            |

Conflating them is a classic outage amplifier: if liveness fails because the database is
briefly slow, the orchestrator restarts every healthy instance and turns a database
hiccup into a full outage. Readiness is the endpoint that is allowed to say no.

`/health` stays at the root because container health checks and uptime monitors are
already pointed at it. `/api/health` deliberately returns `404` — it was never a route,
and a test asserts it stays that way.

The readiness handler logs the driver's error but never returns it. Prisma connection
failures can echo the connection string, and an unauthenticated endpoint is the last
place that should happen.

## Data ownership and tenancy

`Organization` is the tenant root. Every tenant-owned row carries `organizationId`, and
every index that serves a query leads with it. The consequence is deliberate: a query
that forgets its tenant filter is a visibly wrong index choice and a code-review smell,
not a silent cross-tenant read that nobody notices.

`User` is intentionally _not_ tenant-scoped. One person can belong to several
organisations; the membership row is where the boundary lives.

## Blockchain boundary

The chain is a **commitment layer, not a storage layer**. `blockchain_records` stores a
transaction hash, a contract address, a block number, and a hash of the payload — never
the invoice, the amount, the counterparties, or anything that identifies a person. See
[security-assumptions.md](./security-assumptions.md) for the full rule and its
consequences.

As of Phase 4 that boundary is implemented rather than modelled. `BlockchainModule`
owns four things: the RPC client and the single server-side signer
(`AvalancheRpcService`), the commitment derivation
(`InvoiceCommitmentService`), a durable outbox (`BlockchainTransactionService`), and
receipt handling plus the event indexer (`TransactionConfirmationService`,
`BlockchainEventIndexerService`). Feature modules call a service, never viem.

The rule that shapes the rest: **no database transaction spans Postgres and Avalanche.**
A write request commits an operation row with a unique idempotency key, then drives it
as far as one HTTP request can. A timeout is recorded as `UNKNOWN` with the signed hash
preserved; reconciliation looks the hash up and never re-signs. The full argument is in
[blockchain-architecture.md](./blockchain-architecture.md) and
[transaction-reconciliation.md](./transaction-reconciliation.md).

## Deployment topology (target)

```
Browser ──▶ apps/web (Next.js)  ──▶ apps/api (NestJS) ──▶ PostgreSQL
                                          │
                                          └──▶ Avalanche Fuji (C-Chain) via RPC
```

One API instance per environment is sufficient at this scale. The design does not depend
on it: the API is stateless, so horizontal scaling is a matter of the pool size and the
database's connection limit, not of code.

## What is deliberately absent

- **External verification providers.** Tax-authority lookup and certificate trust chains
  have no integration, so the two checks that would need them report `UNSUPPORTED` and
  `NOT_CHECKED` on every run rather than simulating a result. See
  [invoice-verification.md](./invoice-verification.md).
- **A multi-instance signer.** Nonce allocation and the indexer cursor are leased, so two
  API instances are safe, but they still share one signer account, so chain writes are
  serialised rather than scaled. See
  [transaction-reconciliation.md](./transaction-reconciliation.md).
- **Financing and risk workflows.** The chain lifecycle exists; the approval workflow
  around it (`RiskAssessment`, credit decisions) does not. The four `financing-requests`
  routes move a claim, they do not approve one.
- **Invoice status transitions.** An invoice is created `SUBMITTED` and stays there. The
  `VERIFIED` / `FINANCED` / `SETTLED` transitions belong to the financing workflow, not to
  verification, and nothing moves an invoice between them yet.
- **Rate limiting outside the chain surface.** Chain writes are metered per organization
  ([blockchain-security.md](./blockchain-security.md)); invoice intake and login are not.
  See [invoice-security.md](./invoice-security.md#known-gaps).
