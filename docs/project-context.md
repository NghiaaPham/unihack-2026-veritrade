# Project context

The product story and the vocabulary. Read this before your first task; it is the
shortest path to understanding what the code is _for_.

For the code layout see [architecture.md](architecture.md). For what actually works today
see [current-status.md](current-status.md).

## The problem

A supplier delivers goods, issues an invoice, and waits 30–90 days to be paid. To get cash
sooner it can sell that receivable to a financier at a discount. The market for this —
invoice financing, factoring, supply-chain finance — has one persistent failure mode:
**the same invoice gets financed twice.**

It is not a sophisticated attack. Print the invoice, take it to two lenders, borrow
against both. The fraud is discovered months later, by whoever is left holding the loss.
Detection today is manual, per-lender, and does not cross institutional boundaries.

Two things make the fraud hard to prevent with a normal database:

1. **Nobody shares a ledger.** A lender cannot see another lender's book, so a duplicate
   is invisible until it defaults.
2. **A shared ledger of invoice data is a privacy disaster.** Amounts, counterparties, tax
   ids and payment terms are commercially sensitive and, in the EU and Vietnam, personal
   data. Publishing them to prevent fraud trades one harm for another.

## What VeriTrade does

Three claims, each of which the code has to actually earn:

1. **Verify the document before anyone lends against it.** An uploaded e-invoice is parsed,
   normalised and run through a check engine. The result is a verdict with an explicit
   scope — what was checked, what was not, and why.
2. **Publish a commitment, not the invoice.** The identity of the invoice is reduced to a
   digest and then to a domain-separated, versioned commitment. That value goes on chain.
   The document, the parties, the amounts and the dates never do.
3. **Make the claim global and exclusive.** The registry contract is keyed by that
   commitment. The first party to reserve it holds it; a second party registering the same
   invoice is rejected by the contract, not by an application check that could be skipped.

The chain is used for exactly one thing: **an unforgeable, globally visible record that a
claim exists**. It is not a database, it does not hold documents, and it does not move
money.

## The lifecycle, in business terms

```
Invoice arrives  →  verified locally   →  commitment anchored  →  reserved by a financier
                                                                    │
                                                     ┌──────────────┴──────────────┐
                                                     ▼                             ▼
                                          financier declares the         reservation is released
                                          agreement (FINANCED)           (never financed)
                                                     │
                                                     ▼
                                              claim closed (CLOSED)
```

The word **financed** here means _a financier attested that they agreed to finance it_. It
does **not** mean money moved. The contract cannot see a bank transfer, and neither can the
API, so the system never claims a disbursement happened. See
[financing-state-machine.md](financing-state-machine.md).

## Who uses it

| Role                  | What they do                                                                | What they must not be able to do                  |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| **Supplier / seller** | Uploads invoices, requests financing                                        | See another organisation's invoices               |
| **Financier**         | Reviews verified invoices, reserves a claim, declares financing             | Reserve the same invoice twice, or someone else's |
| **Platform operator** | Runs the API, holds the registrar role, pauses the registry in an emergency | Forge a claim, or silently rewrite one            |
| **Auditor**           | Reads the chain and the append-only audit log                               | —                                                 |

Tenancy is the hard boundary. `Organization` is the tenant root; every tenant-owned row
carries `organization_id`, and the id always comes from the verified token.

## Vocabulary

Precision matters here — several of these words are deliberately _not_ synonyms.

| Term                      | Meaning in this codebase                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Invoice**               | A parsed, normalised document record. Not the file.                                                                           |
| **Document**              | The uploaded XML, stored content-addressed, never on chain.                                                                   |
| **Fingerprint**           | SHA-256 over the full identity tuple. Database-only, tenant-scoped duplicate detection. Never published.                      |
| **Identity digest**       | Keccak-256 over the narrower identity tuple (seller tax id, series, number, template). The preimage of the commitment.        |
| **Commitment**            | `keccak256(abi.encode(domain, schemaVersion, identityDigest))`. The only invoice-derived value that goes on chain.            |
| **Entity id**             | A domain-tagged hash of the organisation id. Lets the chain associate a claim with a submitter without publishing the org id. |
| **Reservation**           | The claim exists and is held by one party. No financing has been agreed.                                                      |
| **Financing declaration** | A financier attested that they agreed to finance the invoice. Not a payment.                                                  |
| **Disbursement**          | Money actually moving. **Out of scope.** Nothing in this repository does it.                                                  |
| **Verification**          | Local, deterministic checks over the document. Scope is always `LOCAL_CHECKS_ONLY`.                                           |
| **Anchor**                | The act of writing the commitment to the registry.                                                                            |
| **Outbox**                | The `blockchain_operations` table: durable intent to write to the chain, written before the RPC call.                         |
| **Reconciliation**        | Resolving an operation whose chain outcome is unknown, by looking up its hash. Never by re-sending.                           |

## Scope boundaries

In scope and built: invoice intake, local verification, duplicate detection within a
tenant, cross-tenant duplicate prevention via the registry, the claim lifecycle, the audit
trail.

Explicitly out of scope, and deliberately not stubbed to look finished:

- **Tax-authority verification.** No authorised integration exists, so the check reports
  `UNSUPPORTED`. That is why no invoice can reach `PASSED`.
- **Money movement.** No escrow, no payout, no settlement rail.
- **Credit decisioning.** `RiskAssessment` is modelled and unwritten.
- **A user interface.** `apps/web` is a shell.

## Why this is a hackathon-shaped product

The interesting claim is narrow and provable in a demo: _two organisations cannot reserve
the same invoice, and the refusal is enforced by a contract rather than by a policy._
Everything else — the verification engine, the document pipeline, the lifecycle — exists to
make that claim meaningful rather than a toy. The honest gaps are in
[current-status.md](current-status.md), and they are the right place to start a
conversation with a judge or a reviewer.
