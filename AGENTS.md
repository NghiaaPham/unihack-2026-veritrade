# AGENTS.md

Instructions for AI coding agents (CodeBuddy CLI, Claude Code, Codex, Cursor) and for
humans who want the same rules. **Read this file and
[`docs/current-status.md`](docs/current-status.md) before changing anything.**

This file is the contract. It links out instead of duplicating; the linked documents are
the source of truth for their subject.

---

## 1. What this repository is

VeriTrade lets a business turn a verified invoice into short-term financing, with a
privacy-preserving commitment to that invoice anchored on Avalanche so two financiers
cannot both finance it.

Three deployables in one pnpm + Turborepo monorepo:

| Path                 | What it is                                        | Port |
| -------------------- | ------------------------------------------------- | ---- |
| `apps/api`           | NestJS 12 HTTP API, Prisma 7, PostgreSQL          | 3001 |
| `apps/web`           | Next.js 16 App Router client (shell only, see §9) | 3000 |
| `packages/contracts` | Solidity 0.8.28 + Hardhat 3 + viem                | —    |

## 2. Required reading, in order

1. **This file.**
2. [`docs/current-status.md`](docs/current-status.md) — what actually works, what does not,
   and what has never been run. Do not trust a phase report over this file.
3. [`docs/architecture.md`](docs/architecture.md) — module boundaries and request lifecycle.
4. The document for the area you are touching, from the index in §12.

## 3. Non-negotiable rules

These exist because breaking them has already caused real bugs or would cause real harm.

1. **Never expose secrets.** No key, token, connection string or password in source,
   tests, fixtures, logs, error messages, docs or commit messages. `AVALANCHE_DEPLOYER_PRIVATE_KEY`
   and `DEPLOYER_PRIVATE_KEY` are read from `.env` only. Never print a key — not even
   truncated, not even in a debug script.
2. **Never deploy a contract without explicit human approval.** `deploy:fuji` requires
   `CONFIRM_DEPLOY=fuji:43113` _and_ a person saying "deploy". Mainnet (43114) is refused
   by the validator and must stay refused. See
   [`docs/avalanche-fuji-deployment.md`](docs/avalanche-fuji-deployment.md).
3. **Never claim a validation you did not run.** If Docker is unavailable, say so. If a
   migration was only applied to PGlite, say "PGlite", never "PostgreSQL".
4. **Preserve existing tests.** Do not delete, skip, `.only`, or weaken an assertion to
   make a change pass. If a test is genuinely wrong, fix it in its own commit and explain
   why in the message.
5. **No unrelated refactoring.** A bug fix does not need surrounding cleanup. Do not
   reformat files you did not otherwise touch, rename things for taste, or "modernise"
   working code.
6. **Keep the module boundary.** A module exposes a service; nothing reaches into another
   module's tables. See [`docs/architecture.md`](docs/architecture.md).
7. **Never cross a tenant boundary.** Every query is scoped by `organizationId` taken from
   the verified token, never from a request parameter.
8. **Update the docs when behaviour changes.** Endpoints, env vars, state machines and
   test counts all appear in docs; a stale doc is a bug.
9. **Report what you did.** At the end of a task, list the files changed and the exact
   commands you ran with their real output.

## 4. Before you change code

1. Read `AGENTS.md` and `docs/current-status.md`.
2. Inspect the module you are about to touch — read it, do not guess its shape.
3. Write down the scope: which files, which behaviour, which tests.
4. Check `git status` — if the tree is dirty with someone else's work, do not overwrite it.
5. If the task is larger than three files, propose a plan before editing.

## 5. Repository map

```
apps/api/
  src/app.module.ts          root module graph
  src/app.setup.ts           prefix, validation pipe, exception filter (shared with tests)
  src/config/env.validation  fail-fast environment contract
  src/database/              PrismaService (global), error mapping
  src/auth/                  JWT, guards, roles
  src/invoices/              intake, XML parser, fingerprint, storage
  src/invoice-verification/  check engine, checks/, presenter
  src/financing-requests/    request read seam + lifecycle routes
  src/blockchain/            commitment, outbox, receipts, indexer, reconciler, quota
  src/blockchain-registry/   Phase 2 read seam over confirmed anchors
  src/trade/                 Phase 1 legacy, unauthenticated, kept for regression
  prisma/schema.prisma       18 models
  prisma/migrations/         4 migrations, committed SQL
  test/                      19 Vitest files
apps/web/src/app/            layout, page, api/health route
packages/contracts/
  contracts/VeriTradeInvoiceRegistry.sol   the registry (Phase 4)
  contracts/VeriTrade.sol                  Phase 1, unused by the API
  scripts/                                 deploy, roles, verify, env check, gas measurement + guards
  test/                                    Hardhat node:test suite
packages/config/             shared tsconfig presets (no build step)
docs/                        see §12
```

## 6. Commands (verified on this repo)

```bash
corepack enable && pnpm install     # Node 26 per .nvmrc, pnpm 12.16.1 per packageManager
pnpm dev                            # web :3000 + api :3001
pnpm build                          # turbo, dependency-ordered
pnpm lint                           # ESLint, api + web
pnpm typecheck                      # tsc --noEmit, all three packages
pnpm test                           # Vitest (api, PGlite) + Hardhat (contracts)
pnpm --filter @veritrade/api test:postgres   # the API suite on a real PostgreSQL (needs Docker)
pnpm format                         # Prettier write
pnpm format:check                   # Prettier check — CI gate
```

Scoped: `pnpm --filter @veritrade/api test`, `pnpm --filter @veritrade/contracts test`.

**Docker is optional.** `pnpm test` needs no database — the API suite runs against PGlite,
an in-process Postgres compiled to WASM, over the wire protocol. Docker (or any Postgres)
is required only for `db:migrate`, `db:seed`, `db:studio` and `db:reset`.

Full command reference and the Docker/no-Docker split:
[`docs/onboarding.md`](docs/onboarding.md).

## 7. Architecture conventions

- **Modular monolith.** One deployable, one database. Do not introduce a service, queue or
  second database without an ADR.
- **ESM everywhere in `apps/api`.** `"type": "module"`, `module: NodeNext`. **Relative
  imports must end in `.js`** — `./app.module.js` even though the file is `app.module.ts`.
  The only exception is Prisma's generated client, which the compiler rewrites.
- **One Prisma client per process**, owned by `PrismaService` and exported globally. Never
  construct a `PrismaClient` anywhere else.
- **Cross-cutting HTTP behaviour lives in `app.setup.ts`**, used by both `main.ts` and the
  e2e tests, so test and production behaviour cannot drift.
- **The chain is a commitment layer, not a storage layer.** Hashes and role tags only.
  See [`docs/blockchain-architecture.md`](docs/blockchain-architecture.md).
- **No database transaction spans PostgreSQL and Avalanche.** Intent is persisted in an
  outbox first; the chain call happens after. See
  [`docs/transaction-reconciliation.md`](docs/transaction-reconciliation.md).

## 8. Coding standards

- **TypeScript strict.** No `any` in new code; `unknown` plus a narrowing guard instead. No
  non-null assertions unless the invariant is proven on the previous line.
- **Money is never a JS number.** `Decimal(38,18)` in the database, a string in JSON, a
  `bigint` for wei. Never `parseFloat` an amount.
- **Prettier is the formatter** (single quotes, 100 columns, trailing commas). ESLint
  (`typescript-eslint` recommended + `eslint-config-next`) is the linter. Both are CI gates.
- **Comments explain why, not what.** If the code says it, do not repeat it. A comment that
  records a constraint, a bug avoided, or a threat considered is worth keeping.
- **Errors use the project envelope** (`statusCode`, `code`, `message`, `details`,
  `timestamp`, `path`). Throw `AppException` with a stable `code`; never return raw driver
  text to a client.
- **Validate at the boundary.** DTOs with `class-validator`; unknown fields are a `400`
  (`forbidNonWhitelisted`), not silently dropped.

## 9. Known gaps you must not paper over

- `apps/web` is a **shell**: a landing page and a health route. There is no invoice or
  financing UI. Do not describe the product as having a working frontend.
- `apps/api/src/trade/*` is **unauthenticated** and predates auth. It exists for the
  regression suite. Do not expose it, and do not "fix" it by adding auth without a task.
- `PASSED` verification is **unreachable by design** (the tax-authority check reports
  `UNSUPPORTED`). Anchoring accepts `PASSED` or `PARTIAL`. Do not make unimplemented checks
  pass.
- `FINANCING_DECLARED` is **not** `FUNDED`. The contract cannot see a bank transfer.
  `FUNDED` exists in the enum and nothing writes it.
- An `UNKNOWN` chain operation is **reconciled by hash lookup, never re-signed**.

The complete list, with severity: [`docs/current-status.md`](docs/current-status.md) §6.

## 10. Security constraints

- Secrets: `.env` only, git-ignored. `.env.example` holds placeholders and must stay
  placeholder-only. Only `NEXT_PUBLIC_*` reaches the browser.
- Never log a request body for an authenticated endpoint, an Authorization header, a raw
  XML document, or a document path.
- Never add an endpoint that accepts a private key, raw transaction, calldata or a
  destination address. The server decides which contract call to make.
- Never widen CORS, disable the validation pipe, or bypass a guard to make a test pass.
- Full threat models: [`docs/security-assumptions.md`](docs/security-assumptions.md),
  [`docs/blockchain-security.md`](docs/blockchain-security.md),
  [`docs/invoice-security.md`](docs/invoice-security.md).

## 11. Git collaboration rules

- Branches: `feat/*`, `fix/*`, `docs/*`, `test/*`, `chore/*`. Never commit to `main`.
- Commits follow Conventional Commits: `type(scope): summary`, imperative, ≤72 char
  subject, body explaining _why_.
- One logical change per commit. Do not mix a refactor with a behaviour change.
- Never `git push --force` to `main`. Never `git reset --hard` over someone's work.
- Never bypass hooks (`--no-verify`). If a hook fails, fix the cause.
- **Do not commit or push unless a human asked for it in this session.**
- Never commit: `.env`, `apps/api/src/generated/`, `var/`, `deployments/31337.json`,
  `artifacts/`, `cache/`, any file containing a key.
- Full workflow and PR requirements: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## 12. Definition of Done

A task is done when **all** of these are true:

- [ ] The change is scoped to the task; no unrelated edits.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm format:check` passes.
- [ ] `pnpm test` passes, and no existing test was weakened.
- [ ] New behaviour has a test that fails without the change.
- [ ] Docs updated if an endpoint, env var, state machine or limit changed.
- [ ] No secret, key or connection string added anywhere.
- [ ] The report states files changed, commands run, and results — including anything that
      could not be run, and why.

## 13. Documentation index

| Document                                                                   | Read it when                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| [`docs/current-status.md`](docs/current-status.md)                         | Always, before starting work                   |
| [`docs/project-context.md`](docs/project-context.md)                       | You need the product story or the domain terms |
| [`docs/onboarding.md`](docs/onboarding.md)                                 | Setting up a machine                           |
| [`docs/architecture.md`](docs/architecture.md)                             | Touching module boundaries or the request path |
| [`docs/decisions.md`](docs/decisions.md)                                   | You are about to change a past decision        |
| [`docs/roadmap.md`](docs/roadmap.md)                                       | Choosing what to work on next                  |
| [`docs/master-plan.md`](docs/master-plan.md)                               | Planning work against the UniHack deadline     |
| [`docs/phase-4.5-backlog.md`](docs/phase-4.5-backlog.md)                   | Picking up Phase 4.5 work                      |
| [`docs/database-design.md`](docs/database-design.md)                       | Changing the schema                            |
| [`docs/invoice-processing.md`](docs/invoice-processing.md)                 | Parsing, normalising or storing documents      |
| [`docs/invoice-verification.md`](docs/invoice-verification.md)             | Adding or changing a verification check        |
| [`docs/invoice-security.md`](docs/invoice-security.md)                     | Touching the upload path                       |
| [`docs/blockchain-architecture.md`](docs/blockchain-architecture.md)       | Touching `src/blockchain`                      |
| [`docs/invoice-commitment-spec.md`](docs/invoice-commitment-spec.md)       | Touching the commitment or its encoding        |
| [`docs/financing-state-machine.md`](docs/financing-state-machine.md)       | Touching claim transitions                     |
| [`docs/transaction-reconciliation.md`](docs/transaction-reconciliation.md) | Touching the outbox, retries or the indexer    |
| [`docs/blockchain-security.md`](docs/blockchain-security.md)               | Roles, admin powers, on-chain threat model     |
| [`docs/avalanche-fuji-deployment.md`](docs/avalanche-fuji-deployment.md)   | Deploying anything                             |
| [`docs/fuji-deployment-runbook.md`](docs/fuji-deployment-runbook.md)       | Step-by-step Fuji deploy + API wiring          |
| [`docs/security-assumptions.md`](docs/security-assumptions.md)             | Assessing risk before a demo                   |
| [`docs/development-setup.md`](docs/development-setup.md)                   | Troubleshooting a local environment            |
