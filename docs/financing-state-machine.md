# Financing state machine

The registry tracks one thing: **which invoice is claimed, by whom, and how far the claim
got.** This document is the contract's transition table and the business status it maps to.

Source of truth: `packages/contracts/contracts/VeriTradeInvoiceRegistry.sol`.

## 1. States

| Value | Name           | Meaning                                                                       |
| ----- | -------------- | ----------------------------------------------------------------------------- |
| `0`   | `UNREGISTERED` | No claim. The invoice is available.                                           |
| `1`   | `RESERVED`     | A registrar reserved the invoice for financing. No financing declared.        |
| `2`   | `FINANCED`     | A financier **declared** that financing was agreed. Funds may not have moved. |
| `3`   | `CLOSED`       | The financed claim was closed. Terminal.                                      |

A commitment with no row in storage reads as `UNREGISTERED`; there is no separate null
state and no way to distinguish "never seen" from "cancelled" on chain. The cancellation
event is what preserves that history.

## 2. Transitions

| From           | To             | Function            | Role required                                | Emits                  |
| -------------- | -------------- | ------------------- | -------------------------------------------- | ---------------------- |
| `UNREGISTERED` | `RESERVED`     | `register`          | `REGISTRAR_ROLE`                             | `InvoiceReserved`      |
| `RESERVED`     | `FINANCED`     | `declareFinanced`   | `FINANCIER_ROLE`                             | `FinancingDeclared`    |
| `RESERVED`     | `UNREGISTERED` | `cancelReservation` | `REGISTRAR_ROLE`                             | `ReservationCancelled` |
| `FINANCED`     | `CLOSED`       | `closeClaim`        | declaring financier, or `DEFAULT_ADMIN_ROLE` | `ClaimClosed`          |

Everything else reverts:

| Attempt                                   | Error                                                |
| ----------------------------------------- | ---------------------------------------------------- |
| `register` while `RESERVED` or `FINANCED` | `ClaimAlreadyActive`                                 |
| `register` while `CLOSED`                 | `ClaimIsTerminal`                                    |
| `declareFinanced` when not `RESERVED`     | `NotReserved`                                        |
| `cancelReservation` when not `RESERVED`   | `NotReserved`                                        |
| `closeClaim` when not `FINANCED`          | `NotFinanced`                                        |
| `closeClaim` by another financier         | `NotDeclaringFinancier`                              |
| any transition while paused               | `EnforcedPause`                                      |
| zero commitment / entity / financing ref  | `ZeroCommitment`, `ZeroEntityId`, `ZeroFinancingRef` |

There is no `RESERVED → CLOSED` path. A reservation that was never financed is
**cancelled**, not closed, so the two outcomes stay distinguishable in the event log.

## 3. Why `FINANCED` is not a disbursement

The contract has no visibility into bank transfers and holds no funds. `FINANCED` records
that a holder of `FINANCIER_ROLE` asserted financing was agreed. Treating it as proof of
payment would turn a registry into a settlement system it is not.

The API mirrors that care:

| On-chain state | `FinancingStatus`    |
| -------------- | -------------------- |
| `RESERVED`     | `RESERVED`           |
| `FINANCED`     | `FINANCING_DECLARED` |
| `CLOSED`       | `CLOSED`             |
| cancelled      | `CANCELLED`          |

`FUNDED` exists in the business enum and is **never** set by the registry workflow. It
remains reserved for a future disbursement integration that can actually observe money
moving.

## 4. Re-registration and generations

A cancelled reservation returns the commitment to `UNREGISTERED`, so the invoice can be
claimed again. Each reservation increments `generation`, a `uint32` that survives
cancellation and is emitted with every event. That is what lets an indexer order successive
attempts without trusting timestamps.

A `CLOSED` claim is terminal. It cannot be re-registered, which prevents laundering a
financed invoice into a fresh claim. The only way past it is a new registry deployment.

## 5. Duplicate detection is global

The commitment is the storage key and carries no organization scope. Two organizations that
submit the same invoice collide on the same slot, and the second `register` reverts. This is
enforced by the data structure, not by a check that could be forgotten:

```
mapping(bytes32 commitment => Claim) private _claims;
```

The off-chain analogue is `FinancingRequest.activeKey` (`'ACTIVE'` while live, `NULL` when
terminal, unique per invoice). The two are independent: the database stops a second live
request inside one tenant, the registry stops it across all tenants.

## 6. Worked sequences

### Happy path

```
register(c, org)            → RESERVED     InvoiceReserved(c, org, registrar, gen=1)
declareFinanced(c, ref)     → FINANCED     FinancingDeclared(c, financier, ref, gen=1)
closeClaim(c)               → CLOSED       ClaimClosed(c, closedBy, financier, gen=1)
```

### Abandoned reservation, then a second attempt

```
register(c, orgA)           → RESERVED     gen=1
cancelReservation(c)        → UNREGISTERED ReservationCancelled(c, orgA, ..., gen=1)
register(c, orgB)           → RESERVED     InvoiceReserved(c, orgB, ..., gen=2)
```

### Double financing, refused

```
register(c, orgA)           → RESERVED
register(c, orgB)           → revert ClaimAlreadyActive(c, RESERVED)
```

The second call never reaches storage, so `orgA` keeps the claim and the event log contains
no trace of the attempt. That is intentional: a rejected call costs the caller gas and
changes nothing.

### Closing from the wrong actor

```
register(c, orgA)
declareFinanced(c, ref)     by financier1 → FINANCED
closeClaim(c)               by financier2 → revert NotDeclaringFinancier(c, financier2)
closeClaim(c)               by admin      → CLOSED   (recovery path)
```

The admin path exists because an offboarded financier key must not strand a claim forever.
It grants no new power: `DEFAULT_ADMIN_ROLE` can already grant itself any role.

## 7. Pause

`pause()` / `unpause()` are `DEFAULT_ADMIN_ROLE` only and stop every transition, including
cancellation and closing. Pausing does not alter any stored claim; it only refuses new
writes. It exists for an incident, not for maintenance, and the security document records
it as a centralisation point.

## 8. Off-chain workflow guards

The API refuses a transition before it ever reaches the contract, so the common mistake
gets a readable 409 instead of a decoded revert:

| Endpoint             | Required business status                            |
| -------------------- | --------------------------------------------------- |
| `reserve`            | `REQUESTED`, `UNDER_REVIEW`, `APPROVED`, `RESERVED` |
| `declare-financed`   | `RESERVED`                                          |
| `close`              | `FINANCING_DECLARED`                                |
| `cancel-reservation` | `RESERVED`                                          |

These guards are a convenience and a clearer error. They are **not** the security boundary:
the contract enforces the same rules, and a direct call that bypasses the API still cannot
skip a state.

## 9. Invariants

Asserted by the contract test suite, including a 240-step randomised sequence:

1. At most one active claim (`RESERVED` or `FINANCED`) exists per commitment.
2. An address without the required role cannot change any state.
3. Every accepted transition emits exactly one event.
4. Closing never erases `reservedAt`, `financedAt`, `financier` or `financingRef`.
5. A rejected transition leaves the stored claim byte-identical.
6. `generation` never decreases and never repeats for a commitment.
