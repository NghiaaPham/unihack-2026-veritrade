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

A nonce is a one-shot claim on a slot in the signer's sequence. Two transactions with the
same nonce are not both mined: the second replaces the first, and the replacement looks
exactly like a transaction that vanished. Allocation therefore has to be exclusive across
every process sharing the key.

1. `getTransactionCount(address, 'pending')` from the node, read **before** any lock is
   taken — an RPC call inside a transaction would hold a row lock across the network.
2. Inside a transaction: `SELECT next_nonce FROM blockchain_signer_nonces
WHERE chain_id = ? AND address = ? FOR UPDATE`.
3. `allocated = max(nodePending, stored)`; write `stored + 1` back before releasing.
4. The operation row records the nonce **before** the send call.

Both sources are needed. `stored` covers transactions we reserved but have not broadcast, so
the node cannot see them. `nodePending` covers transactions the node knows about that we
never recorded — a database restored from an older backup, or a manual send from the same
key.

`FOR UPDATE` is the whole mechanism. Two instances queue on that row, each sees the other's
write, and the sequence stays contiguous. A process-local mutex is still used as a fast
path, but it is an optimisation: correctness does not depend on it.

### Why the nonce is reused, not replaced

If a broadcast fails before a hash is recorded, the operation sits in `SUBMITTING` with a
nonce and no hash. The worker resolves it by asking the chain:

- **mined nonce count ≤ reserved nonce** — the slot was never used. Re-broadcasting at the
  _same_ nonce is safe: a nonce can only be spent once, so this cannot create a second
  transaction. It also fills the hole. Allocating a fresh nonce here would leave the reserved
  one permanently unspent, and every later transaction from that signer would queue behind
  it in the mempool, forever.
- **mined nonce count > reserved nonce** — the slot was used, so a transaction exists. It is
  found by scanning recent blocks for `(from, nonce)` and adopted. Signing another one would
  be a second transaction for the same invoice.

## 6. The reconciliation worker

The worker that finishes what a request could not.

`BlockchainReconciliationService` runs on an interval (`BLOCKCHAIN_RECONCILE_INTERVAL_MS`,
default 30 s, `0` disables it) and sweeps operations in `SUBMITTING`, `SUBMITTED` and
`UNKNOWN` whose `next_attempt_at` has passed.

### Claiming work

A pass selects up to 20 due rows, then claims each one with a conditional update:

```sql
UPDATE blockchain_operations
   SET lease_owner = $worker, lease_expires_at = now() + interval '120 seconds'
 WHERE id = $id
   AND status = $observed_status
   AND (lease_expires_at IS NULL OR lease_expires_at < now())
```

`count = 1` means this worker owns the row; `0` means another instance won. A worker that
crashes leaves a lease that expires after two minutes, so its rows are picked up without an
operator. Two instances therefore process disjoint sets — asserted by a test that runs two
claimers against ten rows and checks the intersection is empty and the union is everything.

The select is only a hint. The claim re-asserts both the status and the lease, so a row that
changed between the read and the claim cannot be taken on stale information.

### What happens to each state

| State        | Hash known? | Action                                                                |
| ------------ | ----------- | --------------------------------------------------------------------- |
| `SUBMITTED`  | yes         | One `getTransactionReceipt`. Found → confirm. Not found → reschedule. |
| `UNKNOWN`    | yes         | Same. Never re-signed.                                                |
| `UNKNOWN`    | no          | Resolve by nonce (§5). Re-broadcast at the reserved nonce, or adopt.  |
| `SUBMITTING` | no          | Resolve by nonce (§5).                                                |

The worker never waits for a receipt. `settle()` on the request path waits up to 20 s because
a client is waiting; the worker polls once and moves on, so a slow chain cannot stall the
batch.

### Outcome counters

Each pass reports `confirmed`, `resubmitted`, `adopted` and `rescheduled`. `resubmitted` and
`adopted` are counted separately on purpose: the first means a transaction was signed and
broadcast at a reserved nonce, the second means a transaction that already existed was found
by nonce and attached to the row. Collapsing them would make the log read as if a duplicate
had been sent when none was.

### Backoff

`backoffDelay(attempt) = min(300 s, 15 s × 2^attempt) + up to 20 % jitter`.

The ceiling is the important part. Without it, an operation whose RPC is unreachable is
retried in a tight loop; with no backoff at all it is retried every pass forever. The jitter
stops every instance from retrying the same batch at the same instant after an outage.

The delay is written to `next_attempt_at`, so it survives a restart. `attempt_count` is
incremented on each submission attempt, not each pass.

### Shutdown

`onModuleDestroy` clears the timer, refuses to start a new pass, and awaits the pass in
flight — bounded at 10 s. Waiting matters: a pass interrupted between signing and persisting
the hash is exactly the state the worker exists to clean up.

### What the worker will not do

- Re-sign an operation whose nonce is already spent on chain.
- Mark anything `FAILED` because an RPC call failed. Only a receipt with status `reverted`,
  or a simulation revert, is a failure.
- Touch a row another instance holds a live lease on.
- Run at all without a configured registry address; it logs once and stays idle.

## 7. Failure classification

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

## 8. Receipts as evidence

`blockchain_transaction_receipts` is 1:1 with an operation and stores the chain's facts:
chain id, hash, block number, block hash, status, `gasUsed`, `effectiveGasPrice`, log count,
observation time.

It is written in the same database transaction as the operation's terminal status, the
`BlockchainRecord` projection and the business-status projection. Either all of them land or
none do.

Receipts are immutable. The `upsert` update branch exists only to heal a row written by an
interrupted attempt, never to revise history.

## 9. Operator runbook

Most rows resolve on their own. These are the states that still need a person, and what to
check first.

| State                                   | Meaning                                                                  | What to do                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PENDING` older than minutes            | No transaction exists, and the worker will not submit (it only settles). | Re-issue the API call. It submits the same row; no duplicate is created.                                                                                 |
| `SUBMITTING`, no hash                   | The process died between reserving a nonce and recording a hash.         | Nothing, usually — the worker resolves it by nonce. Investigate only if `attempt_count` keeps climbing.                                                  |
| `SUBMITTED`, no receipt                 | Broadcast, not yet mined.                                                | Wait. `GET /blockchain/transactions/:id` polls once per call; the worker also polls.                                                                     |
| `UNKNOWN` with `BROADCAST_UNCERTAIN`    | The send threw. The transaction may exist.                               | Nothing. The worker resolves by nonce and never re-signs.                                                                                                |
| `UNKNOWN`, `NONCE_SPENT_TX_NOT_FOUND`   | The nonce was used but the transaction is outside the 64-block scan.     | Find it by hash on a block explorer, or wait — the worker keeps looking on later passes. Do **not** resend.                                              |
| `FAILED`                                | Deterministic rejection.                                                 | Read `last_error_code`. `SIMULATION_REVERTED:ClaimAlreadyActive` means another claim won — correct behaviour, not a bug.                                 |
| `CONFIRMED`, business state wrong       | The projection did not apply.                                            | Re-run confirmation for the operation. It is idempotent; the receipt upsert and the status update both tolerate replay.                                  |
| Row stuck with a lease from a dead host | A worker died mid-pass.                                                  | Nothing. The lease expires in 120 s and the next pass takes over. To force it: `UPDATE blockchain_operations SET lease_expires_at = now() WHERE id = …`. |

### Recovering a genuinely stuck transaction

If an operation has been `UNKNOWN` for longer than the backoff ceiling and the worker keeps
rescheduling it, the diagnosis is almost always one of two things:

1. **The transaction was never mined and the nonce was never used.** The worker should have
   re-broadcast it. If it has not, check that the deployment is writable — a read-only
   instance logs `SIGNER_NOT_CONFIGURED` and deliberately does not send.
2. **The transaction was mined outside the scan window.** Compare the signer's
   `getTransactionCount` with the operation's `nonce`. If the count is higher, a transaction
   spent that nonce. Find it on an explorer, then reconcile it by hand:

```sql
UPDATE blockchain_operations
   SET tx_hash = '0x…', status = 'SUBMITTED', next_attempt_at = now()
 WHERE id = '…';
```

The worker picks it up on the next pass and settles it. This is the only manual repair that
is safe; editing a status to `CONFIRMED` without a receipt creates a record that claims a
transaction nobody verified.

### After a chain reset (local development)

Restarting `hardhat node` wipes chain state but not this database. The signer's persisted
counter still holds the old high-water mark, so `max(pending, stored)` allocates a nonce the
fresh chain will never mine: the transaction sits in the node's queued pool forever and the
worker keeps rescheduling it.

The allocator cannot detect this safely on its own — "the node's pending count is lower than
our stored counter" is also what a dropped mempool transaction looks like, and resetting the
counter there would reuse a nonce that might still be mined. So the reset is an operator
step, not a guess:

```sql
TRUNCATE blockchain_signer_nonces;
TRUNCATE blockchain_operations, blockchain_records CASCADE;
```

`CASCADE` clears the dependent receipts and events. Do this only against a disposable local
database whose chain you have just reset. On a real network the counter is correct and must
be left alone.

## 10. Known limits

- **One signer, serialised.** The nonce allocator makes concurrent writers correct, not fast.
  Throughput is bounded by the block time of a single account. More instances do not mean
  more transactions per second.
- **Reconciliation is polling.** Each instance runs its own timer. The lease makes that safe;
  it does not make it efficient. N instances issue N queries per interval.
- **The nonce scan is bounded at 64 blocks.** Deliberate: the alternative is up to 256
  `eth_getBlockByNumber` calls for a rare recovery. Beyond the window the operation stays
  `UNKNOWN` and is reported as `NONCE_SPENT_TX_NOT_FOUND`.
- **Receipt wait is bounded (20 s) on the request path.** Beyond that the caller gets `202`
  and must poll. This is the honest answer: the transaction is in flight, not failed.
- **Reorg handling is one block per pass.** A deep reorg is walked back over several indexer
  runs rather than in one destructive delete.
- **Confirmations default to 1.** `BLOCKCHAIN_CONFIRMATIONS` can be raised; the indexer then
  waits that many blocks behind the head.
- **No cross-chain reconciliation.** One registry, one chain id per deployment record.
- **A reorg does not un-confirm a receipt.** See §11.
- **A chain reset leaves the nonce counter high.** The persisted high-water mark outlives
  the chain it was written for; see the reset procedure in §9.

## 11. Reorg handling

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
