# VeriTrade

Verifiable trade settlement on Avalanche. pnpm + Turborepo monorepo.

## Stack

| Layer     | Technology                               |
| --------- | ---------------------------------------- |
| Web       | Next.js 16 (App Router) + React 19       |
| API       | NestJS 12                                |
| Contracts | Solidity 0.8.28 + Hardhat 3 (viem)       |
| Database  | PostgreSQL 17 + Drizzle ORM              |
| Chain     | Avalanche Fuji Testnet (C-Chain, 43113)  |
| Tooling   | TypeScript 6, ESLint 10, Prettier, Turbo |

## Layout

```
apps/
  web/                 Next.js client            -> :3000
  api/                 NestJS HTTP API           -> :3001
packages/
  config/              Shared tsconfig presets (no build step)
  contracts/           Hardhat project, Fuji network, deploy script
```

### Why this shape

- **`apps/` holds deployables, `packages/` holds shared libraries.** `contracts` lives
  under `packages/` because its output (ABIs, addresses) is consumed by `apps/`, not
  deployed as a service. It still exposes a `build` task, so Turbo builds it first
  whenever a consumer declares `dependsOn: ["^build"]`.
- **One tsconfig per target, not per app.** `packages/config` ships three presets —
  `nextjs` (bundler resolution, `jsx: preserve`), `nestjs` (NodeNext, decorator
  metadata), `node` (NodeNext, for scripts). Apps extend them by package name, so
  compiler settings change in one place. The package has no build step: TypeScript
  resolves the JSON directly.
- **Workspace packages are consumed as source.** `@veritrade/config` and
  `@veritrade/contracts` are linked with `workspace:*`. No `dist` indirection until a
  package actually needs to publish.
- **Health endpoints are unversioned on purpose.** The API sets a global `api` prefix
  but excludes `/health`, so load balancers and container probes hit a stable root URL
  while business routes stay namespaced.
- **Drizzle over Prisma/TypeORM.** The schema is TypeScript and the types are inferred,
  so there is no `generate` step in the Turbo graph and no engine binary to download.
  `drizzle-kit` emits plain SQL files that get reviewed in the PR, and it can generate a
  migration with no database running. `drizzle-orm` is dual CJS/ESM, so it drops into
  Nest's CommonJS output without adapter shims.
- **The ORM lives in `apps/api`, not a shared package.** Only the API talks to Postgres
  today. Lifting `src/database` into `packages/db` is a mechanical move once a second
  consumer appears; doing it now would be premature.

## Getting started

```bash
pnpm install

# environment
cp .env.example .env                        # postgres creds for docker-compose
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp packages/contracts/.env.example packages/contracts/.env

pnpm db:up                                 # postgres via docker compose
pnpm db:migrate                            # apply schema
pnpm dev                                   # web :3000, api :3001
```

## Commands

| Command             | Effect                                    |
| ------------------- | ----------------------------------------- |
| `pnpm dev`          | Run all apps in watch mode                |
| `pnpm build`        | Build every workspace, dependency-ordered |
| `pnpm lint`         | ESLint across workspaces                  |
| `pnpm typecheck`    | `tsc --noEmit` across workspaces          |
| `pnpm test`         | Vitest across workspaces                  |
| `pnpm format`       | Prettier write                            |
| `pnpm format:check` | Prettier check (CI gate)                  |
| `pnpm db:up`        | Start PostgreSQL                          |
| `pnpm db:generate`  | Generate SQL migration from schema diff   |
| `pnpm db:migrate`   | Apply pending migrations                  |
| `pnpm clean`        | Remove build artifacts                    |

Scoped runs: `pnpm --filter @veritrade/api dev`, `pnpm --filter @veritrade/web build`.

Contracts:

```bash
pnpm --filter @veritrade/contracts compile
pnpm --filter @veritrade/contracts deploy:fuji   # needs DEPLOYER_PRIVATE_KEY
```

## Database and migrations

Schema: `apps/api/src/database/schema.ts`. Migrations: `apps/api/drizzle/*.sql`, committed
and reviewed like code. `drizzle-kit` diffs the schema against the last snapshot, so
generating never needs a live database.

```bash
pnpm db:generate     # edit schema.ts, then generate SQL
pnpm db:migrate      # apply pending migrations (needs Postgres)
pnpm --filter @veritrade/api db:check     # detect a corrupted migration history
pnpm --filter @veritrade/api db:studio    # browse data
```

Workflow: change `schema.ts` → `db:generate` → read the SQL diff → commit it →
`db:migrate` locally and in deploy. Never edit an applied migration; add a new one.

`DatabaseService` (`apps/api/src/database/database.service.ts`) owns a `pg` pool and is
exported globally from `DatabaseModule`, so feature modules inject it directly. The pool
connects lazily: the API boots and serves `/health` even when Postgres is down, and the
failure surfaces on the first query instead of at startup. A missing `DATABASE_URL` is
the exception — it fails fast at boot.

Two tables:

- `chain_sync_cursor` — infrastructure. Indexer progress per
  `(chain_id, contract_address)` so replays stay idempotent.
- `trade` — the settlement record: parties, asset, exact `numeric(38,18)` amount,
  status enum, and the settlement transaction. `reference` is the caller-supplied
  idempotency key and is unique; settlement columns stay null until the on-chain
  transaction confirms. Amounts are stored and read as strings, never floats.

## Trade API

| Method | Path                                 | Behaviour                                          |
| ------ | ------------------------------------ | -------------------------------------------------- |
| `POST` | `/api/trades`                        | `201` with the row; `409` on duplicate `reference` |
| `GET`  | `/api/trades?status=&limit=&offset=` | `{ data, total }`; `limit` 1–100, default 20       |
| `GET`  | `/api/trades/:id`                    | `200`, or `404` when missing                       |

Validation runs through a global `ValidationPipe` with `whitelist` and
`forbidNonWhitelisted`, so an unknown field is a `400` rather than being silently
dropped. Input rules: `reference` ≤ 64 chars, both addresses `0x` + 40 hex, `amount` a
positive decimal string with ≤ 18 fraction digits, `chainId` optional (defaults to
43113). Addresses are lowercased before insert so the checksummed and unchecksummed
forms cannot become separate rows. `amount` is returned as a string — it is never
parsed into a float.

`status` is not settable on create; it defaults to `draft`. Settlement transitions are
not implemented yet.

## Testing

`apps/api` runs Vitest. The suite boots the real `AppModule` through
`@nestjs/testing` and overrides only `DatabaseService`, so routing, the validation pipe,
exception mapping and the trade service all run for real. The database is PGlite with the
committed migrations applied at startup — the tests exercise the actual DDL, including
the unique constraint behind the 409 response.

```bash
pnpm test                                  # all workspaces
pnpm --filter @veritrade/api test          # one workspace
pnpm --filter @veritrade/api test:watch
```

TypeScript is compiled through SWC (`unplugin-swc`), not esbuild: Nest's DI reads
`design:paramtypes` metadata, which esbuild cannot emit. Tests are typechecked by
`tsconfig.spec.json` (it adds `vitest/globals` and the `test/` directory); the build
config does not see them.

## Health checks

| Service | Endpoint                               |
| ------- | -------------------------------------- |
| API     | `GET http://localhost:3001/health`     |
| Web     | `GET http://localhost:3000/api/health` |

Both return `status`, `service`, `environment` and `timestamp`. The API also reports
`uptimeSeconds`.

## Environment

Every variable is documented in a committed `.env.example`; real `.env` files are
git-ignored. Only `NEXT_PUBLIC_*` values reach the browser — never put a private key or
database URL behind that prefix. `DEPLOYER_PRIVATE_KEY` belongs to `packages/contracts`
only.

## Module format

`apps/api` is ESM (`"type": "module"`, `module: NodeNext`). Every `@nestjs/*` package in
v12 is ESM-only, so a CommonJS build only ran by leaning on Node's `require(esm)` and
would have failed on Node 20.

The one rule this imposes: **relative imports need a `.js` extension**. TypeScript does
not rewrite specifiers, so `./app.module` must be written `./app.module.js` even though
the file on disk is `app.module.ts`.

`apps/web` and `packages/contracts` are unaffected.

## Deliberately not included yet

Health checks, the trade endpoints above, and one placeholder contract
(`VeriTrade.sol`) are the whole surface. Auth, trade state transitions (settle/dispute),
an ABI-driven API client, and CI workflows are intentionally deferred — the contracts
ABI export path and the `dependsOn: ["^build"]` graph are the hooks they will attach to.
