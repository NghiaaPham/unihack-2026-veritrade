# Blockchain security

What the registry protects, who can do what, and what is left exposed. This is a threat
model for the on-chain layer and the API surface that drives it — not a general security
document for the whole application.

## 1. What is at stake

| Asset                            | Consequence of compromise                                          |
| -------------------------------- | ------------------------------------------------------------------ |
| Integrity of duplicate detection | Two financiers fund the same invoice. This is the loss case.       |
| The registrar / financier key    | An attacker can reserve any invoice, or declare financing on one.  |
| The admin key                    | Full control: role changes, pause, closing stranded claims.        |
| Tenant isolation                 | One organization reads or acts on another's invoices.              |
| Invoice privacy                  | Correlation of an invoice identity with a claim on a public chain. |

## 2. Actors

| Actor                | Holds                              | Trusted for                                                    |
| -------------------- | ---------------------------------- | -------------------------------------------------------------- |
| API signer           | `REGISTRAR_ROLE`, `FINANCIER_ROLE` | Submitting correctly formed calls only.                        |
| Admin                | `DEFAULT_ADMIN_ROLE`               | Role hygiene, pause, recovery. Assumed honest-but-accountable. |
| Organization member  | a JWT for one tenant               | Acting for that tenant, no more.                               |
| Anonymous chain user | nothing                            | Reading everything.                                            |

The contract trusts the API signer to submit honest calls. It does **not** trust the API to
enforce state rules — every rule is re-checked on chain, so a compromised backend cannot
skip a transition, only spam valid ones (bounded by pause and role revocation).

## 3. Contract controls

| Control                    | Where                         | Effect                                           |
| -------------------------- | ----------------------------- | ------------------------------------------------ |
| Global commitment key      | `mapping(bytes32 => Claim)`   | Cross-tenant duplicates collide by construction  |
| Active-claim rejection     | `register`                    | `ClaimAlreadyActive` while `RESERVED`/`FINANCED` |
| Terminal-state rejection   | `register`                    | `ClaimIsTerminal` after `CLOSED`                 |
| Explicit transition checks | every mutator                 | No implicit state change                         |
| Role-gated mutators        | OpenZeppelin `AccessControl`  | Unauthorized callers revert                      |
| Declaring-financier check  | `closeClaim`                  | A different financier cannot close the claim     |
| Emergency pause            | `Pausable`                    | Stops all writes; alters no stored claim         |
| Structured events          | all four transitions          | Every accepted change is externally observable   |
| No external calls          | by construction               | Nothing to reenter                               |
| No upgradeability          | by construction               | Rules cannot change under existing claims        |
| No custody                 | not payable, no token surface | Nothing to steal from the contract               |

### Why there is no `ReentrancyGuard`

The contract makes no external calls, sends no value and has no callbacks. A guard would add
gas and imply a risk that does not exist. The code still follows
checks-effects-interactions so the ordering stays correct if a future version adds an
external call — and that future version must add the guard at the same time.

### Why there is no proxy

A proxy would let an admin rewrite duplicate-detection rules after financiers relied on
them, with existing claims silently reinterpreted. A new rule set is a new deployment with a
new address and an empty claim set, which is visible to everyone.

### Why pause exists

The justified failure mode is a discovered logic bug while the registry is live. Pause stops
new claims without rewriting any existing one. It is a centralisation point and is listed as
such in §6.

## 4. Admin powers

`DEFAULT_ADMIN_ROLE` can:

- grant and revoke `REGISTRAR_ROLE` and `FINANCIER_ROLE`;
- pause and unpause;
- close any `FINANCED` claim (recovery for an offboarded financier key).

It cannot:

- move funds (there are none);
- change a stored commitment, entity handle or financing reference;
- re-open a `CLOSED` claim or re-register it;
- erase an event.

The admin is trusted to use pause and recovery honestly. Both actions are on chain and
therefore auditable, but neither is preventable. For anything beyond a hackathon,
`DEFAULT_ADMIN_ROLE` belongs on a multisig with a timelock, not on the API's hot key.

## 5. Key management

- The signer key is read once at construction in `AvalancheRpcService`, held in a private
  field, and never exposed by a getter, a log line or a serialiser.
- There is no fallback to an unlocked node account. A missing key produces
  `503 BLOCKCHAIN_SIGNER_NOT_CONFIGURED`.
- The deployment scripts never print the key and never print the full RPC URL.
- `packages/contracts/.env` is git-ignored; `.env.example` ships empty values.
- A test key appears in `test/blockchain.e2e-spec.ts`. It is Hardhat's documented account
  #0, derived from the default public mnemonic, and only works against the in-process node.

**Residual risk:** a single hot key holds both `REGISTRAR_ROLE` and `FINANCIER_ROLE`. The
split exists in the contract so it can be separated in deployment; the reference setup
assigns both to one key for convenience. A production deployment should give the registrar
key to the intake service and the financier key to the underwriting service, so compromising
one does not grant the other.

## 6. API authorization

- Every route is behind `JwtAuthGuard`; the guard re-reads the membership row per request,
  so a revoked membership stops working immediately.
- The tenant id comes from the verified token, never from a path, body or header.
- Every query is `where: { id, organizationId }`. A guessed UUID belonging to another
  tenant is a 404, not a 403 — the existence of the row is not disclosed.
- Write routes require `OWNER`, `ADMIN` or `MEMBER`; `VIEWER` is read-only.
- No endpoint accepts a destination address, a private key, a raw transaction or an
  arbitrary calldata blob. A caller can only drive the four fixed operations.

Verified end to end: `test/blockchain.e2e-spec.ts` asserts that a second organization gets
404 for another tenant's operation id and 409 (with `ClaimAlreadyActive`) when it tries to
anchor an invoice the first organization already claimed.

## 7. Input validation

- The commitment is derived server-side from stored fields; a client cannot supply one.
- Identity components are normalised and non-empty; an incomplete identity is
  `422 INCOMPLETE_INVOICE_IDENTITY`.
- The stored fingerprint is recomputed and compared; a mismatch is
  `500 INVOICE_FINGERPRINT_MISMATCH` and blocks the anchor.
- Zero commitment, zero entity and zero financing reference are rejected by the contract.
- Amounts are never sent on chain, so there is no amount-injection surface.

## 8. Privacy

Published on chain: a 32-byte commitment, two opaque handles, an enum, two addresses, two
timestamps.

Not published: raw XML, party names, tax ids, bank details, line items, document bytes,
document hashes, amounts, database ids in the clear, credentials.

The commitment is deterministic, so anyone holding the invoice identity fields can test
membership. That is analysed and accepted in
[`invoice-commitment-spec.md`](invoice-commitment-spec.md) §7, together with the
alternatives that were rejected.

**Residual risk:** the `entityId` handle is stable per organization. Two registrations by the
same organization are linkable to each other on chain. They are not linkable to the
organization's real-world identity without off-chain information, but a chain observer can
build a per-entity history. Accepted: the registry needs to attribute claims to _some_
submitting entity for auditability, and a per-invoice handle would make that impossible.

## 9. Availability and griefing

| Scenario                       | Effect                                   | Mitigation                                                           |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------- |
| Registrar key compromised      | Attacker reserves arbitrary invoices     | Pause + revoke; reservations can be cancelled                        |
| Admin key compromised          | Full control                             | Multisig + timelock in production                                    |
| RPC provider down              | Reads fail, writes queue in `PENDING`    | Outbox survives; retry when the RPC returns                          |
| RPC returns a wrong chain      | Deployment scripts refuse before signing | Chain id read from the node, not the config                          |
| Gas price spike                | Transactions stall in `SUBMITTED`        | `202` + polling; no automatic re-send                                |
| Malicious tenant spams anchors | Gas cost, no correctness impact          | Role-gated signer, per-request cost, rate limiting (not implemented) |

Rate limiting is **not implemented**. A tenant with write access can create as many anchor
operations as it has invoices. Each costs gas and each is globally visible. This is
acceptable for a testnet demo and is called out as a gap.

## 10. Out of scope

- Smart-contract formal verification.
- On-chain governance.
- Tokenised financing or any custody of value.
- Cross-chain messaging.
- Zero-knowledge proofs of invoice validity.
- Protection against a compromised admin key.
- Source verification on Snowtrace (manual, not performed).
