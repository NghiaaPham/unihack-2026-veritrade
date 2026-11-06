# Development setup

## Prerequisites

| Tool    | Version  | Notes                                                               |
| ------- | -------- | ------------------------------------------------------------------- |
| Node.js | >= 24    | `.nvmrc` pins 26. Prisma 7 supports `^20.19 \|\| ^22.12 \|\| >=24`. |
| pnpm    | >= 9     | `packageManager` pins 12.16.1; `corepack enable` is enough.         |
| Docker  | optional | Only needed for a real PostgreSQL. The test suite does not use it.  |

Docker is optional because the API tests run against PGlite, an in-process Postgres
compiled to WASM. You need Docker only if you want `prisma migrate deploy` or
`prisma db seed` against a persistent database.

## Install

```bash
git clone <repo> && cd veritrade
pnpm install
```

`apps/api` has a `postinstall` hook that runs `prisma generate`. The generated client is
git-ignored — it is derived from `prisma/schema.prisma` — so a fresh clone has no
`apps/api/src/generated/` until install finishes. If you skip install, `pnpm typecheck`
will fail with "cannot find module `../generated/prisma/client.js`".

## Environment

```bash
cp .env.example .env                        # postgres creds for docker-compose
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp packages/contracts/.env.example packages/contracts/.env
```

The API validates its environment at boot and refuses to start if anything is malformed.
`DATABASE_URL` is required; `API_PORT`, `CORS_ORIGIN`, `AVALANCHE_CHAIN_ID`,
`AVALANCHE_RPC_URL` and `VERITRADE_CONTRACT_ADDRESS` are optional with documented
defaults. A typo in `DATABASE_URL` is a startup failure, not a `500` on the first query.

Phase 4 added the chain variables. All are optional — the API boots without a registry
and returns `503 BLOCKCHAIN_NOT_CONFIGURED` from the chain routes, which is the correct
behaviour for a deployment that has not been wired up yet:

| Variable                         | Notes                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| `AVALANCHE_CHAIN_ID`             | `43113` (Fuji) or `31337` (local). `43114` is rejected at boot.   |
| `AVALANCHE_RPC_URL`              | `https://` required, except `http://` on chain `31337`.           |
| `VERITRADE_CONTRACT_ADDRESS`     | The deployed registry. Read-only mode without it.                 |
| `AVALANCHE_DEPLOYER_PRIVATE_KEY` | API signer. Without it the chain routes are read-only (`503`).    |
| `BLOCKCHAIN_CONFIRMATIONS`       | 1–64, default 1 on local. Depth before a receipt counts as final. |
| `BLOCKCHAIN_INDEXER_INTERVAL_MS` | 0 disables the poller. Bounded to 3 600 000.                      |

The same private key is read by `packages/contracts` under `DEPLOYER_PRIVATE_KEY`. They
are separate variables in separate files on purpose: the deployer and the runtime signer
are different roles in production even though one key plays both here.

## Running the chain locally

No Docker needed — Hardhat ships an in-process EVM:

```bash
pnpm --filter @veritrade/contracts exec hardhat node --port 8545   # terminal 1
pnpm --filter @veritrade/contracts deploy:local                    # terminal 2
pnpm --filter @veritrade/contracts roles:local                     # grant both roles
```

Then point the API at it:

```bash
AVALANCHE_CHAIN_ID=31337
AVALANCHE_RPC_URL=http://127.0.0.1:8545
VERITRADE_CONTRACT_ADDRESS=0x...          # printed by deploy:local
AVALANCHE_DEPLOYER_PRIVATE_KEY=0x...      # the well-known Hardhat account #0
```

The Hardhat accounts are deterministic and public. They are safe in a local `.env` and
must never appear anywhere else. `deployments/31337.json` is written by the deploy script
and is **not** committed (the repository ships with an empty `deployments/` directory).
Delete a local record before redeploying, or the script refuses — that guard is what
stops a second registry from being created by accident. A Fuji record is a different
matter: it is public chain data and belongs in the repository, so the address survives a
fresh clone.

The test suite does the same thing on port 8546 with a fresh chain per run, so a local
node on 8545 and the tests do not interfere.

## Database

```bash
pnpm db:up        # postgres:17-alpine via docker compose, port 5432
pnpm db:migrate   # prisma migrate deploy
pnpm db:seed      # synthetic development data
```

`db:up` requires Docker. Without it, nothing below the first line works, and the test
suite is still fully runnable.

### Migration workflow

```bash
cd apps/api
prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script \
  -o prisma/migrations/<timestamp>_name/migration.sql
```

`migrate diff` reads the schema file and writes SQL; it never opens a connection. That is
why migrations can be authored and reviewed with no database running.

`prisma migrate dev` needs a shadow database and a live server, so it is only usable once
Docker (or any Postgres) is available. Prefer `migrate deploy` for applying committed
migrations.

Never edit an applied migration. Add a new one.

### Seed

`prisma/seed.ts` is idempotent: every write is an `upsert` against a natural key, and
every id is a hard-coded UUID. Running it twice produces identical row counts — verified
against PGlite before committing.

It is synthetic only. Names are invented, emails use the reserved `.example` TLD, tax ids
are obviously fake, no password is set, and no network is touched.

## Run

```bash
pnpm dev                                   # web :3000, api :3001
pnpm --filter @veritrade/api dev           # API only
pnpm --filter @veritrade/web dev           # web only
```

## Test

```bash
pnpm test                                  # all workspaces
pnpm --filter @veritrade/api test          # API only
pnpm --filter @veritrade/api test:watch
```

How the API suite works:

1. `test/setup.ts` sets a placeholder `DATABASE_URL` so `AppModule`'s environment
   validation passes. Nothing dials it.
2. `createTestDatabase()` boots PGlite, applies every committed migration in order, then
   exposes the database over the Postgres wire protocol with `PGLiteSocketServer`.
3. Prisma connects to that socket through the ordinary `pg` adapter, so the tests run the
   same query path as production.
4. Each test file gets its own database; `reset()` truncates every table with
   `RESTART IDENTITY CASCADE`.

`PGLiteSocketServer` defaults to `maxConnections: 1`, which silently drops the second
connection and surfaces as a reset during any concurrent query. The harness sets it to
10 and the client pool to 5.

The suite covers 229 tests across sixteen files: invoice API (the bulk of them), XML
parsing, verification checks and engine, fingerprinting, the trade API, schema
invariants, health, domain module wiring, ESM interop, seed compatibility, the
commitment vector, the chain end-to-end suite, the recovery suite, and the quota and
lease tests.

One test file starts a second process. `test/blockchain.e2e-spec.ts` runs
`hardhat node` on port 8546, deploys `VeriTradeInvoiceRegistry` from the compiled
artifact, grants both roles, and only then sets `AVALANCHE_CHAIN_ID=31337` and
`AVALANCHE_RPC_URL=http://127.0.0.1:8546` — and _only then_ imports `AppModule` with a
dynamic `import()`. That ordering is mandatory: `ConfigModule.forRoot({ validate })`
runs when the module is evaluated, so a static import at the top of the file would
freeze the chain configuration before the test could change it, and every anchor would
be signed for the wrong chain id.

The contracts package has its own suite, run with Hardhat rather than Vitest:

```bash
pnpm --filter @veritrade/contracts test        # hardhat test — 33 tests
pnpm --filter @veritrade/contracts typecheck   # hardhat compile && tsc
```

`hardhat test` only discovers `node:test` files when
`@nomicfoundation/hardhat-node-test-runner` is in the `plugins` array. Without it the
command reports "Running Solidity tests" and exits successfully having run nothing.

## Prisma commands

| Command               | Needs a live database | Effect                                     |
| --------------------- | --------------------- | ------------------------------------------ |
| `pnpm db:generate`    | No                    | Regenerate the client into `src/generated` |
| `pnpm db:validate`    | No                    | Parse and validate the schema              |
| `pnpm db:migrate`     | **Yes**               | Apply pending migrations                   |
| `pnpm db:migrate:dev` | **Yes** (shadow DB)   | Diff, create and apply a migration         |
| `pnpm db:seed`        | **Yes**               | Insert synthetic data                      |
| `pnpm db:reset`       | **Yes**               | Drop, recreate, re-apply, re-seed          |
| `pnpm db:studio`      | **Yes**               | Browse data                                |

## Verification status

What was actually executed while building Phase 3 and Phase 4, on a machine with **no
Docker, no PostgreSQL server and no Fuji deployer key**:

| Check                                            | Result                                                      |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `pnpm install`                                   | passed                                                      |
| `prisma validate`                                | passed                                                      |
| `prisma generate`                                | passed                                                      |
| `prisma migrate diff` (both migrations)          | passed                                                      |
| All migrations applied to PGlite in sequence     | passed — including pre-existing rows from the earlier phase |
| `pnpm typecheck` (src + tests + seed)            | passed                                                      |
| `pnpm lint`                                      | passed                                                      |
| `pnpm build`                                     | passed                                                      |
| `pnpm test` (229 tests)                          | passed                                                      |
| `hardhat compile` (solc 0.8.28, evm cancun)      | passed                                                      |
| `hardhat test` (33 contract tests)               | passed                                                      |
| Contract deployed to a local Hardhat node        | passed — then the record was deleted                        |
| `deploy:fuji` guard (no confirmation)            | refused as designed                                         |
| `env:check` on Fuji without a key                | exited 1, printed the RPC host only                         |
| Fuji RPC reachable (`eth_chainId`)               | passed — returned `0xa869`                                  |
| Transaction submitted to Fuji                    | **not run** — no deployer key, and none was generated       |
| `prisma migrate deploy` against PostgreSQL 17.11 | passed — 4 migrations                                       |
| `prisma db seed` against PostgreSQL 17.11        | passed, and idempotent on a second run                      |
| Full suite against PostgreSQL 17.11              | passed — 229 tests / 16 files                               |

The migrations are now verified against both: PGlite (Postgres compiled to WASM, same
parser and DDL semantics, no server) and a networked **PostgreSQL 17.11** instance via
`docker compose`. The second run is the one that counts, and it found two harness bugs the
first could not — see [current-status.md](current-status.md) §4.2.

`pnpm --filter @veritrade/api test:postgres` reproduces it on any machine with Docker.

The chain work is verified the same way: a real EVM (Hardhat's node) executed the real
bytecode, and the API submitted real transactions to it over JSON-RPC, waited for real
receipts and indexed real logs. What is not verified is the specific network — no
transaction has been sent to Avalanche Fuji.

Three things are also **not** verified, and are worth knowing before a demo:

- **Swagger UI is not rendered in a test.** `GET /api/docs` is wired in `main.ts` outside
  production. The Phase 4 suite asserts the _document_ contains the new paths and tags
  (`blockchain.e2e-spec.ts` checks `/v1/invoices/{id}/anchor` and friends), but nothing
  boots `main.ts` and loads the HTML page. A missing `@ApiProperty` degrades the document
  without failing a test.
- **Uploads are exercised through multer's memory storage**, not through a real reverse
  proxy. A proxy with its own body limit will reject an oversized upload before multer
  sees it, with a different status code than the one documented.
- **The reorg test is a local `evm_snapshot`/`evm_revert`.** It proves the indexer detects
  a changed block hash and rewinds. It does not prove behaviour under a deep reorg, or
  under a node that reports a different head to different clients.

## Troubleshooting

**`pnpm db:seed` fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` or `ERR_MODULE_NOT_FOUND`.**

The seed runs as `node prisma/seed.ts`, which uses Node's native type stripping. That mode
erases types but transforms nothing, so a module it imports cannot contain:

- a decorator (`@Injectable()` is a syntax error there),
- a TypeScript `enum`,
- a constructor parameter property (`constructor(private readonly x: T)`),
- a relative `./thing.js` specifier — only `.ts` files exist on disk.

The seed shares the identity rules with the API, so `invoice-fingerprint.ts` and
`invoice-normalization.ts` are deliberately free of all four. Decimal parsing lives in
`invoice-amounts.ts` because it needs the Prisma client, which the seed cannot load.
`test/seed-compat.spec.ts` fails if any of this is broken; `tsc` will not catch it.

**`Prisma only supports Node.js versions 20.19+, 22.12+, 24.0+` during install.**
A warning from Prisma's preinstall check, which uses an exact-major allowlist. Node 26 is
newer than the newest listed version. The CLI and client both run correctly; the message
is cosmetic.

**`Cannot find module '../generated/prisma/client.js'`.**
The client has not been generated. Run `pnpm --filter @veritrade/api db:generate`, or
`pnpm install` again.

**`ECONNRESET` or `Connection terminated` during tests.**
Almost always `maxConnections` on the socket server being lower than the client pool
size. See `test/test-database.ts`.

**`RangeError: Maximum call stack size exceeded` in a test.**
`expect(service).toBeInstanceOf(PrismaService)` overflows: `PrismaClient` is a Proxy and
`instanceof` against a subclass recurses through the trap. Assert on behaviour instead.

**`P1010` when connecting to Postgres.**
Prisma 7 rejects self-signed certificates. Configure a CA rather than disabling
verification.
