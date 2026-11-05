# Blockchain architecture

VeriTrade anchors a **commitment to an invoice identity** on Avalanche so that two
financiers cannot both claim the same invoice. This document describes how the backend
talks to the chain, what the chain is allowed to know, and which failures are handled
where.

Read alongside:

- [`invoice-commitment-spec.md`](invoice-commitment-spec.md) — what exactly is hashed.
- [`financing-state-machine.md`](financing-state-machine.md) — the contract's states.
- [`transaction-reconciliation.md`](transaction-reconciliation.md) — what happens when a
  transaction's outcome is unknown.
- [`blockchain-security.md`](blockchain-security.md) — roles, keys and residual risk.

## Target

| Property       | Value                                                     |
| -------------- | --------------------------------------------------------- |
| Network        | Avalanche Fuji C-Chain (testnet)                          |
| Chain id       | `43113` (`0xa869`)                                        |
| Default RPC    | `https://api.avax-test.network/ext/bc/C/rpc`              |
| EVM version    | `cancun` (solc 0.8.28 default; confirmed at compile time) |
| Contract       | `VeriTradeInvoiceRegistry` (`contracts/`)                 |
| Client library | `viem` 2.57                                               |

Avalanche mainnet (chain `43114`) is rejected in three independent places: the deployment
scripts, the API environment validator, and the chain-id read from the node before any
transaction is signed.

## Shape

```
   HTTP request
        │
        ▼
 ┌─────────────────────────┐
 │ InvoiceAnchorService    │  validates verification status,
 │ FinancingClaimService   │  builds commitment, enqueues
 └───────────┬─────────────┘
             │  (one PostgreSQL transaction: intent + operation row)
             ▼
 ┌─────────────────────────┐
 │ BlockchainTransaction   │  simulate → nonce → sign → send
 │ Service   (outbox)      │  PENDING → SUBMITTING → SUBMITTED
 └───────────┬─────────────┘
             │
             ▼
 ┌─────────────────────────┐        ┌──────────────────────────┐
 │ TransactionConfirmation │◀───────│ Avalanche C-Chain        │
 │ Service                 │        │ VeriTradeInvoiceRegistry │
 └───────────┬─────────────┘        └────────────┬─────────────┘
             │ receipt + business projection      │ events
             ▼                                    ▼
 ┌─────────────────────────┐        ┌──────────────────────────┐
 │ blockchain_operations   │        │ BlockchainEventIndexer   │
 │ blockchain_receipts     │        │ (bounded ranges, reorg)  │
 │ blockchain_records      │        └──────────────────────────┘
 └─────────────────────────┘
```

The two arrows into the database are deliberate: a receipt is evidence written by the
confirmation path, while events are a re-derivable projection written by the indexer.
Neither can overwrite the other.

## Module layout

`apps/api/src/blockchain/`

| File                                  | Responsibility                                                    |
| ------------------------------------- | ----------------------------------------------------------------- |
| `avalanche-rpc.service.ts`            | Owns the viem clients and the signer. Only place the key is read. |
| `invoice-commitment.service.ts`       | Digest, commitment, entity and financing handles.                 |
| `blockchain-transaction.service.ts`   | Outbox: enqueue, idempotency, nonce, simulate, send, `drive()`.   |
| `transaction-confirmation.service.ts` | Receipt persistence, terminal status, business projection, audit. |
| `invoice-anchor.service.ts`           | Anchoring workflow + verification gate + anchor status.           |
| `financing-claim.service.ts`          | Reserve, declare financed, close, cancel reservation.             |
| `blockchain-event-indexer.service.ts` | `eth_getLogs` in bounded ranges, dedupe, reorg rewind.            |
| `registry-call.ts`                    | Calldata encoding per operation kind.                             |
| `blockchain.constants.ts`             | ABI slice, domain separator, status mapping, limits.              |
| `operation-status.ts`                 | Operation state → HTTP status, shared by both controllers.        |
| `blockchain.presenter.ts`             | API representations.                                              |

`blockchain-registry` (Phase 2) still exists and still serves
`BlockchainRecord` lookups by transaction hash. It is the tenant-scoped confirmed
projection; the outbox is the operational record.

## Three configuration states

The API boots in all three. This matters because a checkout with no deployment must
still serve invoices.

| State            | Condition                       | Effect                                                             |
| ---------------- | ------------------------------- | ------------------------------------------------------------------ |
| **unconfigured** | no `VERITRADE_CONTRACT_ADDRESS` | chain endpoints answer `503 BLOCKCHAIN_NOT_CONFIGURED`             |
| **read-only**    | address present, no key         | reads work, signing answers `503 BLOCKCHAIN_SIGNER_NOT_CONFIGURED` |
| **writable**     | address and key present         | full workflow                                                      |

There is no fallback to an unlocked node account. A missing key is an error, never an
invitation.

`AVALANCHE_RPC_URL` may be `http://` only when `AVALANCHE_CHAIN_ID` is `31337`; every
other combination must be `https://`.

## Request flow: anchoring

1. `POST /api/v1/invoices/:id/anchor`
2. The invoice is loaded **with** the caller's `organizationId`; a miss is a 404, never a
   cross-tenant read.
3. The latest verification run must be `PASSED` or `PARTIAL`. `PASSED` is unreachable by
   design (the tax-authority check is `UNSUPPORTED`), so `PARTIAL` is the realistic
   strongest verdict. Anything else is `409 INVOICE_NOT_VERIFIED`.
4. The commitment is derived from the invoice's identity fields and cross-checked against
   the stored fingerprint.
5. An outbox row is created with the key `INVOICE_ANCHOR:<contract>:<invoiceId>`.
6. `drive()` simulates the call, assigns a nonce, signs, sends, and waits up to 20 s for a
   receipt.
7. The response is `200` when confirmed, `202` when still in flight, `409` when the call
   was rejected on chain.

Repeating step 1 returns the same operation. The second call cannot produce a second
transaction, because the idempotency key already exists.

## Request flow: financing lifecycle

| Endpoint                                          | Contract call       | Guarded business state                           |
| ------------------------------------------------- | ------------------- | ------------------------------------------------ |
| `POST /financing-requests/:id/reserve`            | `register`          | `REQUESTED`/`UNDER_REVIEW`/`APPROVED`/`RESERVED` |
| `POST /financing-requests/:id/declare-financed`   | `declareFinanced`   | `RESERVED`                                       |
| `POST /financing-requests/:id/close`              | `closeClaim`        | `FINANCING_DECLARED`                             |
| `POST /financing-requests/:id/cancel-reservation` | `cancelReservation` | `RESERVED`                                       |

`reserve` is not a second on-chain action: the contract has one registration call and it
is what reserves. Reserving an already-anchored invoice therefore sends nothing.

## What never reaches the chain

Raw XML, seller and buyer names, tax ids, bank details, line items, document bytes,
document hashes, credentials, database ids in the clear. The contract stores a `bytes32`
commitment, an opaque entity handle, an opaque financing handle, timestamps, addresses and
an enum. See [`invoice-commitment-spec.md`](invoice-commitment-spec.md) for the derivation
and the residual leak it accepts.

## Deliberate omissions

- **No upgradeability.** A proxy would let an admin change the duplicate-detection rules
  after financiers relied on them. A new registry is a new deployment with a new address
  and a new idempotency key space.
- **No custody and no transfers.** The contract is not payable and has no token surface.
- **No `ReentrancyGuard`.** There are no external calls, no ETH transfers and no
  callbacks; a guard would be decoration. The checks-effects-interactions order is still
  followed so the code stays safe if that ever changes.
- **No batching.** One operation, one transaction. Batching would make a partial failure
  ambiguous for no benefit at this scale.
- **No on-chain role for organizations.** `entityId` is recorded, not enforced; the
  authoritative check that a caller may act for an organization lives in the API's
  tenant model.

## Event indexing

The indexer is off by default (`BLOCKCHAIN_INDEXER_INTERVAL_MS=0`). When enabled it:

- reads at most 2 000 blocks per call;
- stores events under the unique key `(chainId, txHash, logIndex)`, so a replay is a no-op;
- stores the hash of the last processed block and rewinds one block at a time when that
  hash is no longer canonical;
- ignores logs it cannot decode rather than writing a guess.

It is a projection, not a source of truth. The contract is the source of truth for claim
state, and `GET /invoices/:id/anchor-status` reads it live.

## Testing

- `packages/contracts/test/VeriTradeInvoiceRegistry.spec.ts` — 33 Hardhat tests, including
  a 240-step randomised state machine that asserts the model and the chain agree after
  every operation.
- `apps/api/test/blockchain-commitment.spec.ts` — encoding, golden vectors, ABI drift,
  configuration guards.
- `apps/api/test/blockchain.e2e-spec.ts` — 14 tests over HTTP against a real `hardhat node`
  and a real PostgreSQL engine (PGlite), covering anchoring, idempotency, cross-tenant
  isolation, the full financing lifecycle, cancellation, invalid transitions, event
  indexing, reorg rewind and OpenAPI generation.

No test claims anything about Fuji beyond the RPC being reachable; see
[`avalanche-fuji-deployment.md`](avalanche-fuji-deployment.md) for what has and has not
been deployed.
