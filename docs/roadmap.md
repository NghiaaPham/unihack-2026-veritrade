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
Phase 4.5 ████████░░  Production hardening               (code done, not deployed)
Phase 5  ░░░░░░░░░░  Product surface                     (not started)
```

Phase 4.5 closed the loop that made the Phase 4 claim defensible: real PostgreSQL instead of
PGlite, a reconciliation worker instead of a client that has to keep polling, database-backed
leases instead of a single-process assumption, and a per-organization quota instead of
unlimited spend. The remaining gap is the same one Phase 4 had — a real testnet. The
unauthenticated `trade` surface was deleted on 2026-11-08 (SEC-0).

## Phase 4.5 — make it trustworthy

**Goal:** the system can survive a demo that is not on your laptop.

| Track                                      | Why it mattered                                | Status       |
| ------------------------------------------ | ---------------------------------------------- | ------------ |
| Real PostgreSQL 17                         | every database claim was PGlite-only           | done         |
| Rate limiting (chain writes)               | unlimited spend per authenticated client       | done         |
| Reconciliation worker                      | `UNKNOWN` operations never resolved themselves | done         |
| Multi-instance safety                      | the indexer assumed one process                | done         |
| Gas measurement                            | a deployment needs a budget                    | done         |
| Remove the unauthenticated `trade` surface | it was an open write path                      | done         |
| Fuji deployment                            | the last step, not the first                   | **not done** |

Parallelism: the PostgreSQL track, the security track (rate limiting) and the gas
measurement track touch disjoint files and can run simultaneously. The reconciliation worker
and the indexer lease both touch `src/blockchain` and should be sequenced or done by one
person.

## Phase 5 — make it a product

Not scoped yet, and deliberately not started. The likely shape:

- **Web UI**: upload → verification result → anchor → reserve. Demo UI landed 2026-11-08 (see current-status §3.4).
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
