# Contributing

Thanks for helping. This file is the process; [AGENTS.md](AGENTS.md) is the rules for
changing code, and [docs/current-status.md](docs/current-status.md) is what currently works.

New here? Start with [docs/onboarding.md](docs/onboarding.md) — it gets you from a clean
machine to a running stack.

---

## 1. Before you start

1. Read [AGENTS.md](AGENTS.md) and [docs/current-status.md](docs/current-status.md).
2. Check [docs/phase-4.5-backlog.md](docs/phase-4.5-backlog.md) for something unclaimed.
3. Open an issue (or comment on one) describing what you intend to change. This is not
   bureaucracy: it is how two people avoid implementing the same task twice in one weekend.
4. Create a branch.

If the change touches a decision in [docs/decisions.md](docs/decisions.md), say so in the
issue before writing code.

## 2. Branch naming

| Prefix   | Use for                          | Example                    |
| -------- | -------------------------------- | -------------------------- |
| `feat/`  | new behaviour                    | `feat/pg1-real-postgres`   |
| `fix/`   | correcting a defect              | `fix/nonce-gap-on-retry`   |
| `docs/`  | documentation only               | `docs/onboarding-refresh`  |
| `test/`  | tests only, no production change | `test/indexer-reorg-depth` |
| `chore/` | tooling, dependencies, CI        | `chore/pin-node-26`        |

Rules:

- Never commit directly to `main`.
- One branch, one task. A branch that fixes a bug and renames a module is two PRs.
- Rebase on `main` before opening the PR; do not merge `main` into a feature branch to
  "catch up" unless the conflict is genuinely large.

## 3. Commits — Conventional Commits

```
type(scope): imperative summary in lower case, no full stop

Why this change exists. What was wrong, what the constraint is, what was
considered and rejected. The diff already says *what* changed.
```

| Type       | Meaning                                   |
| ---------- | ----------------------------------------- |
| `feat`     | new user-visible or API-visible behaviour |
| `fix`      | a defect fix                              |
| `docs`     | documentation only                        |
| `test`     | tests only                                |
| `refactor` | no behaviour change                       |
| `perf`     | performance                               |
| `build`    | build system, dependencies                |
| `ci`       | workflows                                 |
| `chore`    | everything else                           |

Scopes in use: `api`, `web`, `contracts`, `db`, `docs`, `ci`.

Good:

```
fix(api): reconcile UNKNOWN operations by hash instead of re-signing

A timeout after broadcast was being treated as a failure and retried,
which could produce two transactions for one intent. The operation now
keeps its signed hash and reconciliation looks it up.
```

Bad:

```
fix stuff
```

Rules:

- Subject ≤ 72 characters, imperative mood ("add", not "added").
- One logical change per commit. Do not mix a refactor with a behaviour change.
- Never commit generated files: `apps/api/src/generated/`, `artifacts/`, `cache/`, `dist/`,
  `.next/`, `var/`.
- Never commit a `.env`, a key, or a deployment record for chain 31337.

## 4. Pull requests

Every PR must contain the sections in
[`.github/pull_request_template.md`](.github/pull_request_template.md):

| Section                       | Why it is required                                 |
| ----------------------------- | -------------------------------------------------- |
| **Related issue**             | ties the change to an agreed task                  |
| **Summary**                   | what changed and why, in prose                     |
| **Files or modules affected** | makes the blast radius visible to a reviewer       |
| **Test evidence**             | the commands you ran and their actual output       |
| **Security considerations**   | secrets, tenancy, chain writes, auth — even "none" |
| **Documentation updates**     | which doc changed, or why none was needed          |
| **Known limitations**         | what this PR does **not** do                       |

A PR without test evidence will be sent back. "Tests pass" is not evidence; the command and
its output are.

### Size

Aim for under ~400 changed lines. A larger PR is acceptable when the change is mechanical
(a rename, a migration) — say so in the description so the reviewer reads it differently.

### Review

- One approving review is enough to merge.
- The reviewer checks: scope, tests, security, and whether the docs match the behaviour.
- Do not merge your own PR without a review, except for a docs-only typo fix.
- Do not force-push a branch under review. Add commits; squash on merge.

## 5. What reviewers look for

1. **Scope.** Does the diff contain anything the description does not mention?
2. **Tests.** Does the new test fail without the change? Was an existing assertion weakened?
3. **Tenancy.** Every query scoped by `organizationId` from the token?
4. **Secrets.** Any key, token or connection string in code, tests, fixtures, logs or docs?
5. **Chain writes.** Does this add a path that submits a transaction? Is it idempotent, and
   does a timeout become `UNKNOWN` rather than a retry?
6. **Docs.** Endpoint, env var, state machine or test count changed — was the doc updated?
7. **Honesty.** Does the PR claim something it did not verify?

## 6. Code standards

Full list in [AGENTS.md §8](AGENTS.md#8-coding-standards). The four that come up most:

- **TypeScript strict.** No `any`; `unknown` plus a narrowing guard.
- **Money is never a JS number.** `Decimal` in the database, string in JSON, `bigint` for wei.
- **Relative imports in `apps/api` end in `.js`.** ESM with `module: NodeNext`; TypeScript
  does not rewrite specifiers.
- **Errors use the project envelope.** Throw `AppException` with a stable `code`.

Formatting and linting are not opinions here — they are CI gates:

```bash
pnpm format
pnpm lint
```

## 7. Testing

```bash
pnpm test                              # everything
pnpm --filter @veritrade/api test      # Vitest, 13 files
pnpm --filter @veritrade/contracts test # Hardhat, 1 file
```

Rules:

- New behaviour needs a test that fails without the change.
- Do not delete, skip or weaken an existing test to make a change pass. If a test is wrong,
  fix it in its own commit and explain why.
- Do not use `.only` or `.skip` in a merged PR.
- Prefer a real dependency over a mock: the API suite runs a real Nest app, real PGlite and,
  for chain work, a real Hardhat node. Keep it that way.

Writing a test that needs the chain? Follow `apps/api/test/blockchain.e2e-spec.ts` — it
spawns `hardhat node` and imports `AppModule` **dynamically**, after setting the chain env
vars. A static import freezes the configuration at module evaluation and every transaction is
signed for the wrong chain.

## 8. Security

- **Never commit a secret.** Not a private key, not a JWT secret, not a connection string with
  credentials, not a Fuji key "just for testing".
- **Never deploy a contract without explicit approval** from the Tech Lead, recorded in the
  PR. `deploy:fuji` requires `CONFIRM_DEPLOY=fuji:43113` and that guard must not be relaxed.
- **Never expose a signing capability through the API.** No endpoint accepts a key, a raw
  transaction, calldata or a destination address.
- **Never widen a boundary to make a test pass** — no disabled guards, no relaxed validation
  pipe, no `CORS_ORIGIN=*`.
- Report a vulnerability privately to the Tech Lead rather than in a public issue.

## 9. Documentation

A behaviour change is not done until the doc matches it. The mapping:

| You changed                          | Update                                         |
| ------------------------------------ | ---------------------------------------------- |
| An endpoint or its status codes      | `README.md`, and the relevant module doc       |
| An env var                           | `.env.example` **and** `docs/onboarding.md` §3 |
| The Prisma schema                    | `docs/database-design.md`                      |
| A verification check                 | `docs/invoice-verification.md`                 |
| A claim transition                   | `docs/financing-state-machine.md`              |
| The commitment encoding              | `docs/invoice-commitment-spec.md`              |
| Retry, reconciliation or the indexer | `docs/transaction-reconciliation.md`           |
| What works, or what was verified     | `docs/current-status.md`                       |
| An architectural decision            | `docs/decisions.md` (new ADR)                  |

Docs are lowercase kebab-case. Do not create `docs/NEW_DOC.md`; see
[ADR-014](docs/decisions.md#adr-014--documentation-filenames-stay-lowercase-kebab-case).

## 10. Definition of Done

Copy this into the PR description and tick it:

```markdown
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm format:check` passes
- [ ] `pnpm test` passes; no existing test weakened
- [ ] New behaviour has a test that fails without this change
- [ ] Docs updated where behaviour changed
- [ ] No secret, key or connection string added
- [ ] Security section filled in
```

## 11. Working with AI agents

Several people here use CodeBuddy CLI, Claude Code, Codex or Cursor. The rules are the same,
with three additions:

1. **The agent must read `AGENTS.md` and `docs/current-status.md` first.** Point it there
   explicitly; do not assume it will.
2. **Review every line it writes.** An agent that cannot run the tests will describe them as
   passing. Demand the command output.
3. **Do not let an agent push, deploy or force-push.** Those stay human actions.

A useful prompt shape:

> Read AGENTS.md and docs/current-status.md. Then read
> `apps/api/src/blockchain/blockchain-transaction.service.ts`,
> `transaction-confirmation.service.ts` and `docs/transaction-reconciliation.md`.
> Implement BC-1 from `docs/phase-4.5-backlog.md`. No unrelated changes.
> Run `pnpm typecheck`, `pnpm lint` and `pnpm --filter @veritrade/api test`.
> Report files changed and the real output of each command.

## 12. Getting unstuck

- Environment problems: [docs/development-setup.md](docs/development-setup.md#troubleshooting)
- Why something is the way it is: [docs/decisions.md](docs/decisions.md)
- What is broken or unfinished: [docs/current-status.md](docs/current-status.md)
- Anything else: ask in the team channel before spending an hour alone. Someone has probably
  hit it already.
