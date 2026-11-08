# Onboarding

From a clean machine to a running stack, in order. Every command here was executed against
this repository on 2026-11-05; the verification matrix at the end says what was actually
observed.

If a command fails, check [development-setup.md](development-setup.md#troubleshooting)
first — it covers the errors people actually hit.

---

## 0. The short version

```bash
git clone https://github.com/NghiaaPham/unihack-2026-veritrade.git
cd unihack-2026-veritrade
corepack enable
pnpm install
cp apps/api/.env.example apps/api/.env      # then set JWT_SECRET
pnpm dev                                    # web :3000, api :3001
```

That is enough to have both servers running **without Docker and without a database**.
Everything else is optional until you need it.

## 1. Prerequisites

| Tool    | Version                            | Why                        | Check              |
| ------- | ---------------------------------- | -------------------------- | ------------------ |
| Node.js | 26 (`.nvmrc`); `>=20.9.0` accepted | Prisma 7 and NestJS 12     | `node -v`          |
| pnpm    | 12.16.1 (`packageManager`)         | workspace protocol         | `pnpm -v`          |
| Git     | any recent                         | —                          | `git --version`    |
| Docker  | optional                           | only for a real PostgreSQL | `docker --version` |

Install Node with nvm so `.nvmrc` is honoured:

```bash
nvm install    # reads .nvmrc → 26
nvm use
node -v        # v26.x
```

Enable pnpm through Corepack rather than a global install — it reads the pinned version from
`package.json` and refuses to drift:

```bash
corepack enable
pnpm -v        # 12.16.1
```

**Do not** install pnpm with `npm i -g pnpm`. A different pnpm major will rewrite
`pnpm-lock.yaml` and produce a lockfile conflict nobody can explain.

## 2. Clone and install

```bash
git clone https://github.com/NghiaaPham/unihack-2026-veritrade.git
cd unihack-2026-veritrade
pnpm install
```

`pnpm install` runs `prisma generate` through a `postinstall` hook, so
`apps/api/src/generated/` appears afterwards. That directory is git-ignored — it is derived
from `prisma/schema.prisma`.

Use `pnpm install --frozen-lockfile` in CI or when you do not intend to change dependencies.
It fails instead of silently updating the lockfile.

pnpm blocks lifecycle scripts by default. `pnpm-workspace.yaml` lists the exact packages
allowed to run them. If you add a dependency that needs a postinstall, that is a deliberate
decision, not a silent one.

## 3. Environment variables

Four `.env.example` files exist. Copy the ones you need; the real `.env` files are
git-ignored.

```bash
cp .env.example .env                              # Postgres credentials for docker-compose
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp packages/contracts/.env.example packages/contracts/.env
```

### What is actually required

| File                      | Required now?                 | Why                                                  |
| ------------------------- | ----------------------------- | ---------------------------------------------------- |
| `apps/api/.env`           | **Yes**, before the API boots | `DATABASE_URL` and `JWT_SECRET` are mandatory        |
| `apps/web/.env`           | No                            | the page falls back to `http://localhost:3001`       |
| `packages/contracts/.env` | No                            | needed only to deploy; the scripts refuse without it |
| `.env` (root)             | No                            | read by `docker compose` only                        |

**The API fails fast without its env file.** Verified:

```
Error: Invalid environment configuration:
  - DATABASE_URL is required
  - JWT_SECRET is required
    at validateEnvironment (src/config/env.validation.ts:248)
```

That is intended — a misconfigured process should not start and then return 500s.

### Minimum viable `apps/api/.env`

```dotenv
DATABASE_URL=postgresql://veritrade:veritrade@localhost:5432/veritrade
JWT_SECRET=change-me-to-at-least-32-random-characters
```

Generate a real secret with `openssl rand -base64 48`. `JWT_SECRET` must be at least 32
characters; the validator rejects anything shorter.

The URL does **not** have to point at a live server to boot. `PrismaService` connects
lazily: the API serves `/api/v1/health` even when nothing is listening on 5432, and the
failure surfaces on `/api/v1/health/db` as a `503`.

## 4. Database — two paths

### Path A: no Docker (CI and `pnpm test`)

Nothing to do. `pnpm test` runs against **PGlite**, an in-process PostgreSQL compiled to
WASM, with the committed migrations applied at startup. You get real DDL and real
constraints with no server.

What you **cannot** do on this path: `db:migrate`, `db:seed`, `db:studio`, `db:reset`,
`test:postgres`, and anything that needs a persistent database. It also cannot find the class
of problem a real server has — connection pooling, cross-connection locks — which is why
Path B exists.

### Path B: Docker

```bash
cp .env.example .env        # if not done already
pnpm db:up                  # postgres:17-alpine on :5432
pnpm db:migrate             # prisma migrate deploy
pnpm db:seed                # synthetic development data, idempotent
pnpm db:studio              # browse the data (optional)

# the same 229-test suite, against the real server instead of PGlite
pnpm --filter @veritrade/api test:postgres
```

Useful companions:

```bash
pnpm db:logs                # follow the container log
pnpm db:down                # stop it
pnpm db:reset               # drop, recreate, migrate, seed
```

`pnpm db:reset` destroys the database. It is fine on a development container and is never
something to run against a shared server.

If you have PostgreSQL installed locally instead of Docker, set `DATABASE_URL` to it and
skip `db:up`. Everything after that is identical.

### Authoring a migration (no database required)

```bash
cd apps/api
prisma migrate diff --from-schema prisma/schema.prisma --to-schema /tmp/next.prisma --script \
  -o prisma/migrations/<timestamp>_name/migration.sql
```

`migrate diff` reads schema files and writes SQL; it never opens a connection. That is why
migrations can be written and reviewed on a machine with no Postgres. Applying them still
requires a server.

Never edit an applied migration. Add a new one.

## 5. Run

```bash
pnpm dev                              # both, via Turbo
```

| Service       | URL                                    | Health                              |
| ------------- | -------------------------------------- | ----------------------------------- |
| Web           | http://localhost:3000                  | http://localhost:3000/api/health    |
| API           | http://localhost:3001                  | http://localhost:3001/api/v1/health |
| API readiness | http://localhost:3001/api/v1/health/db | `503` without a database            |
| Swagger UI    | http://localhost:3001/api/docs         | non-production only                 |
| OpenAPI JSON  | http://localhost:3001/api/docs-json    | 18 documented paths                 |

Individually:

```bash
pnpm --filter @veritrade/web dev
pnpm --filter @veritrade/api dev
```

`pnpm dev` runs both in watch mode and keeps them in one terminal. Use the scoped commands
when you want separate logs or are debugging a restart loop.

## 6. Contracts

Compile:

```bash
pnpm --filter @veritrade/contracts compile
```

Test (33 tests against an in-process EVM, no network, no key):

```bash
pnpm --filter @veritrade/contracts test
```

Measure gas (needs a local node running, see below):

```bash
pnpm --filter @veritrade/contracts gas:measure
```

It deploys a registry, runs the full lifecycle and prints gas per operation, plus an
illustrative Fuji cost from a live `eth_gasPrice` snapshot. It sends nothing to Fuji.

Run a local chain and deploy to it:

```bash
# terminal 1
pnpm --filter @veritrade/contracts node

# terminal 2
pnpm --filter @veritrade/contracts deploy:local
pnpm --filter @veritrade/contracts roles:local
```

`deploy:local` writes `packages/contracts/deployments/31337.json`, which is git-ignored.
Delete it before redeploying — the script refuses if a record already exists, which is what
stops a second registry being created by accident.

To point the API at the local chain, set in `apps/api/.env`:

```dotenv
AVALANCHE_CHAIN_ID=31337
AVALANCHE_RPC_URL=http://127.0.0.1:8545
VERITRADE_CONTRACT_ADDRESS=<printed by deploy:local>
AVALANCHE_DEPLOYER_PRIVATE_KEY=<Hardhat account #0>
```

`http://` is accepted **only** on chain 31337. Every other chain requires `https://`.

### Fuji

Read [avalanche-fuji-deployment.md](avalanche-fuji-deployment.md) first. Then:

```bash
pnpm --filter @veritrade/contracts env:check     # read-only; exits 1 without a key
```

**Do not deploy to Fuji without explicit approval from the Tech Lead.** The script requires
`CONFIRM_DEPLOY=fuji:43113` precisely so that it cannot happen by muscle memory.

## 7. Checks

Run these before every pull request:

```bash
pnpm format:check     # Prettier, no writes
pnpm lint             # ESLint, api + web
pnpm typecheck        # tsc --noEmit, all three packages
pnpm build            # Turbo, dependency-ordered
pnpm test             # Vitest (api) + Hardhat (contracts)
```

To force a real run instead of a Turbo cache hit:

```bash
pnpm exec turbo run lint typecheck build test --force
```

`--force` matters. Without it Turbo replays a cached result and tells you nothing about the
current tree.

Formatting:

```bash
pnpm format           # rewrite files
```

## 8. Verification matrix

Observed on 2026-11-06, Node 26.13.0, pnpm 12.16.1, macOS, Docker 29.9.2 with a
PostgreSQL 17.11 container.

| Step                     | Command                                         | Result                     |
| ------------------------ | ----------------------------------------------- | -------------------------- |
| Frozen install           | `pnpm install --frozen-lockfile`                | pass                       |
| Prisma schema            | `pnpm db:validate`                              | pass                       |
| Format                   | `pnpm format:check`                             | pass                       |
| Lint                     | `pnpm lint`                                     | pass                       |
| Typecheck                | `pnpm typecheck`                                | pass (3 packages)          |
| Build                    | `pnpm build`                                    | pass                       |
| API tests                | `pnpm --filter @veritrade/api test`             | 229 passed / 16 files      |
| Contract tests           | `pnpm --filter @veritrade/contracts test`       | 33 passed                  |
| Dev servers              | `pnpm dev`                                      | web 200, api 200           |
| API without DB           | `GET /api/v1/health`                            | 200 `{"status":"ok"}`      |
| API without DB           | `GET /api/v1/health/db`                         | 503, no driver text leaked |
| Swagger UI               | `GET /api/docs`                                 | 200 `text/html`            |
| OpenAPI                  | `GET /api/docs-json`                            | 18 paths                   |
| Fuji RPC                 | `eth_chainId`                                   | `0xa869` (43113)           |
| Fuji deploy guard        | `deploy:fuji` without confirmation              | refused                    |
| Fuji key check           | `env:check`                                     | exit 1, "no deployer key"  |
| API tests, real Postgres | `pnpm --filter @veritrade/api test:postgres`    | 229 passed / 16 files      |
| `db:migrate` / `db:seed` | `pnpm db:up && pnpm db:migrate && pnpm db:seed` | pass, PostgreSQL 17.11     |

## 9. First-day checklist

- [ ] `pnpm install` finished and `apps/api/src/generated/` exists
- [ ] `apps/api/.env` created, `JWT_SECRET` at least 32 characters
- [ ] `pnpm dev` serves both ports
- [ ] `pnpm test` is green
- [ ] Read [current-status.md](current-status.md) — especially §6
- [ ] Read [AGENTS.md](../AGENTS.md) if you are using an AI agent
- [ ] Pick a task from [phase-4.5-backlog.md](phase-4.5-backlog.md)
- [ ] Create a branch: `feat/<short-name>` or `fix/<short-name>`

## 10. Where things go wrong

The full list is in [development-setup.md](development-setup.md#troubleshooting). The four
that catch everyone:

| Symptom                                                       | Cause                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Invalid environment configuration: DATABASE_URL is required` | no `apps/api/.env`                                                                 |
| `Cannot find module '../generated/prisma/client.js'`          | `pnpm install` was skipped; run `pnpm db:generate`                                 |
| `ERR_MODULE_NOT_FOUND` on a relative import                   | missing `.js` on a specifier in `apps/api`                                         |
| `ECONNRESET` during tests                                     | PGlite socket `maxConnections` below the client pool — see `test/test-database.ts` |
