# Transaction reconciliation

How VeriTrade avoids sending the same registry call twice, and what an operator does when a
transaction's outcome is unknown.

## 1. The constraint

PostgreSQL and Avalanche cannot share a transaction. Any design that says "commit the
invoice and the chain write together" is lying about one of them. The registry workflow
therefore splits the problem:

- the **decision** to act is a database write, committed before anything is sent;
- the **act** is a chain write, recorded afterwards;
- the **reconciliation** between the two is the outbox.

The consequence is a window where the database says "this should be anchored" and the chain
does not know yet. That window is explicit (`PENDING`), not hidden inside a request handler.

## 2. The outbox

`blockchain_operations` — one row per intended transaction.

| Column                                                | Why it exists                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `idempotency_key`                                     | Unique. The only thing that stops a retried HTTP call from sending twice. |
| `status`                                              | The state machine below.                                                  |
| `tx_hash`                                             | **Nullable**: a transaction that was never broadcast has no hash.         |
| `nonce`, `from_address`                               | Nonce safety across restarts and concurrent requests.                     |
| `attempt_count`, `last_attempt_at`, `next_attempt_at` | Retry bookkeeping.                                                        |
| `last_error_code`, `last_error_message`               | The decoded failure, bounded to 500 chars.                                |
| `commitment`, `entity_id`, `financing_ref`            | Exactly what will be (or was) sent.                                       |
| `invoice_id`, `financing_request_id`                  | The business link used to apply the projection.                           |

The old `BlockchainRecord` could not carry this: its `tx_hash` is `NOT NULL`, it has no
idempotency key and no retry state, so it cannot represent "we decided to send this and the
send failed". It remains the confirmed, tenant-scoped projection; the outbox is the
operational record.

## 3. States

```
                 ┌──────────────┐
                 │   PENDING    │  row written, nothing sent
                 └──────┬───────┘
                        │ simulate + sign + send
                        ▼
                 ┌──────────────┐   send threw
                 │  SUBMITTING  │──────────────┐
                 └──────┬───────┘              │
                        │ hash returned        ▼
                        ▼               ┌──────────────┐
                 ┌──────────────┐       │   UNKNOWN    │
                 │  SUBMITTED   │       └──────┬───────┘
                 └──────┬───────┘              │ found by hash
                        │ receipt              │
          ┌─────────────┴─────────────┐        │
          ▼                           ▼        ▼
   ┌──────────────┐            ┌──────────────┐
   │  CONFIRMED   │            │    FAILED    │
   └──────────────┘            └──────────────┘

  PENDING / SUBMITTING ──► CANCELLED   (superseded before broadcast)
```

| State        | Meaning                                                                  | Terminal |
| ------------ | ------------------------------------------------------------------------ | -------- |
| `PENDING`    | Intent recorded, no transaction sent.                                    | no       |
| `SUBMITTING` | Nonce reserved, send in progress (or interrupted).                       | no       |
| `SUBMITTED`  | Hash known, waiting for a receipt.                                       | no       |
| `CONFIRMED`  | Receipt status `success`.                                                | yes      |
| `FAILED`     | Deterministic rejection (simulation) or a reverted receipt.              | yes      |
| `UNKNOWN`    | The send threw after it may have reached the mempool. **Not** a failure. | no       |
| `CANCELLED`  | Superseded before broadcast.                                             | yes      |

## 4. Idempotency keys

```
<kind>:<contractAddress>:<businessId>
```

| Operation            | Business id          | Example                               |
| -------------------- | -------------------- | ------------------------------------- |
| `INVOICE_ANCHOR`     | invoice id           | `INVOICE_ANCHOR:0xabc...:0193...`     |
| `RESERVATION_CANCEL` | financing request id | `RESERVATION_CANCEL:0xabc...:0193...` |
| `FINANCING_DECLARE`  | financing request id | `FINANCING_DECLARE:0xabc...:0193...`  |
| `FINANCING_CLOSE`    | financing request id | `FINANCING_CLOSE:0xabc...:0193...`    |

Properties that matter:

- **Derived, not random.** The same intent always produces the same key, including after a
  restart.
- **Contract-scoped.** A redeployed registry has a new address and therefore a new key space;
  old operations are not inherited.
- **Enforced by the database.** `enqueue` reads first for a clean answer, but the unique
  index is the real guard: two concurrent requests race to insert, one loses with `P2002`,
  and it re-reads the winner's row.

A repeated `POST /invoices/:id/anchor` therefore returns the first operation, whatever its
state. It never creates a second transaction.

## 5. Nonce policy

1. `getTransactionCount(address, 'pending')` from the node.
2. The highest nonce among our `SUBMITTING`/`SUBMITTED`/`UNKNOWN` rows for the same signer.
3. `nonce = max(nodePending, ours + 1)`.

Both sources are needed. The node forgets about a transaction once it is mined, so our own
highest nonce covers the gap between "mined" and "receipt persisted". The node covers
transactions we did not send.

Submissions are serialised in-process by a promise queue. Two concurrent requests cannot
pick the same nonce, which would look exactly like a dropped transaction. This is an
in-process lock, not a distributed one — see §9.

## 6. Failure classification

The single most important rule: **an error after the send call is not a failure.**

| When the error happens          | Classification | Status      | Action                                               |
| ------------------------------- | -------------- | ----------- | ---------------------------------------------------- |
| Simulation reverts              | Deterministic  | `FAILED`    | Terminal. Fix the cause, then a new business action. |
| Signing fails (bad key, etc.)   | Deterministic  | `FAILED`    | Terminal for this attempt.                           |
| `eth_sendRawTransaction` throws | **Uncertain**  | `UNKNOWN`   | Reconcile by hash. Never resend.                     |
| Receipt timeout                 | Uncertain      | `SUBMITTED` | Poll again.                                          |
| Receipt status `reverted`       | Deterministic  | `FAILED`    | Terminal.                                            |

Why `UNKNOWN` exists: a timeout, a dropped connection or a 500 from the RPC provider can
all happen _after_ the node accepted the transaction. Marking that `FAILED` and retrying is
how a second registration gets sent for the same invoice. `UNKNOWN` says "we do not know",
and the only safe response to "we do not know" is to look the hash up.

The simulation step exists to make most rejections deterministic **before** gas is spent.
A duplicate claim or a wrong lifecycle state is caught there, with the custom error name
recovered from the 4-byte selector when the node truncates the revert data.

## 7. Receipts as evidence

`blockchain_transaction_receipts` is 1:1 with an operation and stores the chain's facts:
chain id, hash, block number, block hash, status, `gasUsed`, `effectiveGasPrice`, log count,
observation time.

It is written in the same database transaction as the operation's terminal status, the
`BlockchainRecord` projection and the business-status projection. Either all of them land or
none do.

Receipts are immutable. The `upsert` update branch exists only to heal a row written by an
interrupted attempt, never to revise history.

## 8. Operator runbook

| State                             | What to do                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PENDING` older than minutes      | No transaction exists. Re-issue the API call; it will submit the same row.                                                                                                                                                |
| `SUBMITTING`, no hash             | The process died between reserving a nonce and getting a hash. The nonce may be consumed. Reconcile by checking the signer's transaction count; if it advanced, a transaction exists and must be found before any resend. |
| `SUBMITTED`, no receipt           | Poll. `GET /blockchain/transactions/:id` polls once per call.                                                                                                                                                             |
| `UNKNOWN`                         | Look the hash up. `reconcile()` does this on the next read. If the hash is not found and the nonce is still unused, the transaction never landed; a resend requires a new nonce.                                          |
| `FAILED`                          | Read `last_error_code`. `SIMULATION_REVERTED:ClaimAlreadyActive` means another claim won — correct behaviour, not a bug.                                                                                                  |
| `CONFIRMED`, business state wrong | The projection failed to apply. Re-run the confirmation for the operation; it is idempotent.                                                                                                                              |

There is no automated reconciler process. `drive()` runs on the request path and on reads,
and the indexer handles events. A scheduled sweep of stale `PENDING`/`UNKNOWN` rows is the
obvious next step and is **not implemented**.

## 9. Known limits

- **Single-process lock.** Nonce serialisation is a promise queue inside one Node process.
  Two API instances signing with the same key can still collide. A production deployment
  needs a database advisory lock or a dedicated signer service.
- **No automatic retry of `UNKNOWN`.** Deliberate. A wrong retry costs a duplicate
  registration; a delayed reconciliation costs time.
- **Receipt wait is bounded (20 s).** Beyond that the caller gets `202` and must poll. This
  is the honest answer: the transaction is in flight, not failed.
- **Reorg handling is one block per pass.** A deep reorg is walked back over several indexer
  runs rather than in one destructive delete.
- **Confirmations default to 1.** `BLOCKCHAIN_CONFIRMATIONS` can be raised; the indexer then
  waits that many blocks behind the head.
- **No cross-chain reconciliation.** One registry, one chain id per deployment record.

## 10. Reorg handling

`chain_sync_cursor` stores `last_processed_block` and the hash of that block.

On each pass the indexer re-reads that block. If the hash differs — or the block no longer
exists — the chain has reorged below the cursor:

1. delete events at or above that height for this contract;
2. move the cursor back one block and clear the stored hash;
3. return `reorged: true` and do not index new blocks in the same pass.

Repeating the pass walks back further if needed. Events are re-derived from canonical blocks
on the next successful pass, and the unique key `(chainId, txHash, logIndex)` keeps the
replay idempotent.

Receipts already written are **not** deleted by a reorg. A receipt records that a
transaction was mined at a height; if that block is orphaned, the operation's status is
still `CONFIRMED` and the business projection still applied. Handling that properly requires
a re-org-aware settlement policy (revert the business state and re-drive) which is out of
scope and is recorded here as a known gap rather than hidden.
