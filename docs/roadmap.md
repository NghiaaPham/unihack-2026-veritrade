# Roadmap

What is done, what is next, and in what order. Status details live in
[current-status.md](current-status.md); the work items live in
[phase-4.5-backlog.md](phase-4.5-backlog.md).

---

## Where we are

```
Phase 1  ██████████  Monorepo, health, trade slice
Phase 2  ██████████  Prisma model, domain module skeletons
Phase 3  ██████████  Auth, tenancy, invoice pipeline, verification
Phase 4  █████████░  Registry, outbox, claim lifecycle   (code done, never deployed)
Phase 4.5 ░░░░░░░░░░  Production hardening               (not started)
Phase 5  ░░░░░░░░░░  Product surface                     (not started)
```

The gap in Phase 4 is not code. It is that the deployment half of the phase — a real
database, a real testnet, a real reconciliation loop — has never been executed.

## Phase 4.5 — make it trustworthy

**Goal:** the system can survive a demo that is not on your laptop.

| Track                                      | Why it is first                               | Blocking?            |
| ------------------------------------------ | --------------------------------------------- | -------------------- |
| Real PostgreSQL 17                         | every database claim is currently PGlite-only | blocks FUJI-1        |
| Remove the unauthenticated `trade` surface | it is an open write path                      | independent          |
| Rate limiting                              | unlimited spend and unlimited login attempts  | independent          |
| Reconciliation worker                      | `UNKNOWN` operations never resolve themselves | blocks FUJI-1        |
| Multi-instance safety                      | the indexer assumes one process               | blocks any scale-out |
| Gas measurement                            | a deployment needs a budget                   | blocks FUJI-1        |
| Fuji deployment                            | the last step, not the first                  | blocked by the above |

Parallelism: the PostgreSQL track, the security track (trade + rate limiting) and the gas
measurement track touch disjoint files and can run simultaneously. The reconciliation worker
and the indexer lease both touch `src/blockchain` and should be sequenced or done by one
person.

## Phase 5 — make it a product

Not scoped yet, and deliberately not started. The likely shape:

- **Web UI**: upload → verification result → anchor → reserve. Today `apps/web` is a shell.
- **Risk assessment**: `RiskAssessment` is modelled and unwritten; there is no scoring.
- **Approval workflow**: a financing request is created and reserved, but nothing approves
  or rejects it on business grounds.
- **Tax-authority integration**: the check that would make `PASSED` reachable.
- **Object storage**: replace `LocalDocumentStorage` with an S3-compatible backend.

None of these should start before Phase 4.5's first four tracks land. A UI over an
unhardened API is a demo that breaks in front of a judge.

## Sequencing rule

One rule for ordering work: **anything that changes a claim's correctness comes before
anything that displays it.** The registry is the only part of this system where a mistake is
permanent, so hardening it is worth more than another screen.

## Explicitly out of scope

- Mainnet. The validator refuses chain 43114 and must keep refusing it.
- Real money movement. There is no escrow, no payout, no settlement rail.
- Multi-chain. One chain, one registry, one deployment.
- A microservice split. See [architecture.md](architecture.md) for why the modular monolith
  is the right shape at this size.
