# Security assumptions

This document states what the system assumes, what it guarantees, and what it does not.
It is written to be uncomfortable to read: the gaps are the useful part.

## Status

Phase 2 delivered the data model and module skeleton. Phase 3 added real
authentication, tenant enforcement and the invoice pipeline. Phase 4 added the
Avalanche registry, the chain outbox and the financing lifecycle endpoints.

**The invoice endpoints are genuinely protected.** `JwtAuthGuard` verifies a
signed token and then re-reads the membership row on every request, so a revoked
membership takes effect on the next call rather than when the token expires.
The organisation id used for every query comes from that lookup, never from the
request.

**The chain endpoints inherit that protection and add nothing to it.** They take the
same bearer token, look the invoice or financing request up _with_ the organisation id,
and then submit a contract call the server chose. No endpoint accepts a key, a
destination or raw calldata, so a compromised token can move a claim but cannot make the
server sign for something else.

| Control                        | State                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Input validation               | Implemented — global `ValidationPipe`, whitelist + reject unknown               |
| Tenant isolation (data model)  | Implemented — `organization_id` on every tenant-owned row                       |
| Tenant isolation (enforcement) | Implemented for invoices — guard resolves the tenant per request                |
| Authentication                 | Implemented — JWT + scrypt, membership re-read per request                      |
| Authorisation / RBAC           | Implemented for invoice writes — `OWNER`/`ADMIN`/`MEMBER` write, `VIEWER` reads |
| Secrets handling               | Implemented — env only, `.env` git-ignored                                      |
| Error hygiene                  | Implemented — one envelope, 5xx generic, no driver text returned                |
| Rate limiting                  | **Not implemented**                                                             |
| Encryption at rest             | Delegated to PostgreSQL / the hosting platform                                  |
| Audit trail                    | Implemented for invoice create/verify — append-only by convention               |
| Chain authorisation            | Implemented — contract RBAC; the API holds one signer, never exposed            |
| Chain operation durability     | Implemented — outbox with a unique idempotency key, `UNKNOWN` never re-signed   |

The invoice-specific controls — XML parsing, document storage, upload limits —
are described in [invoice-security.md](./invoice-security.md). The chain-specific
controls — roles, admin powers, what the contract does not defend against — are in
[blockchain-security.md](./blockchain-security.md).

## Trust boundaries

```
[ untrusted ]  Browser / API client
      │  HTTPS (assumed; terminated at the proxy — this app does not do TLS)
      ▼
[ trusted ]    apps/api process
      │  DATABASE_URL over the network (TLS optional, see below)
      ▼
[ trusted ]    PostgreSQL
      │
      ▼
[ untrusted ]  Avalanche C-Chain  ← public, adversarial, irreversible
```

The chain sits on the **untrusted** side. Anything read from it must be treated as
attacker-controlled input: a `txHash` is a claim, not a fact, until it is confirmed and
matched against the expected event.

That has two concrete consequences in the code. First, a receipt is not trusted because
the RPC returned it — the transaction is looked up by hash and the logs are re-decoded
against the local ABI, and only events whose `commitment` matches the one this server
derived are projected into business state. Second, the RPC URL itself is a trust
boundary input: a malicious node could withhold blocks or serve a forged receipt, so
`AVALANCHE_RPC_URL` must be an endpoint the operator chose, and `https://` is enforced
except on local chain 31337.

## What may and may not go on-chain

The chain is a commitment layer. It stores hashes and pointers; it does not store data.

**Never on-chain:**

- Invoice documents, line items, descriptions, attachments.
- Counterparty names, tax ids, addresses, email addresses, phone numbers.
- Amounts _in combination with_ identifying data. An amount plus a timestamp plus a
  participant is often enough to re-identify a transaction from public records.
- Any credential, token or key.

**May go on-chain:**

- A hash of a canonical payload (`blockchain_records.payload_hash`).
- A record kind, a chain id, a contract address, a block number, a log index.
- A transaction hash.
- The **invoice commitment** — a domain-separated, versioned Keccak-256 of a canonical
  identity digest, plus a role tag and a generation counter. Not the fingerprint, not a
  database id.

The reasoning is that chain data is permanent and public. There is no delete, no
rectification, and no way to comply with a data-subject erasure request after the fact.
Once a value is on-chain, the only remedy is to stop referencing it — which is not a
remedy. Anything that might ever need to be removed must stay off-chain, which means the
on-chain commitment must be one-way: a hash, never the preimage.

`payload_hash` therefore has to be computed over data that is already non-identifying, or
over data whose disclosure is acceptable. A hash of a full invoice PDF is still a
fingerprint of that document: if the document ever leaks, the hash confirms a match.
Treat the choice of payload as a privacy decision, not a technical one.

The commitment is a separate case and a harder one. An invoice number plus a tax id is
_guessable_ — the space is small enough that an attacker holding a candidate invoice can
test whether it was registered. The domain string and schema version do not make the hash
unpredictable; they only stop the value from being reusable as a fingerprint in another
system. So the honest statement is: **the registry reveals whether a specific invoice is
financed to anyone who already suspects it.** It does not reveal amounts, parties or
documents, and it does not let someone enumerate the registry from scratch without
candidate invoices. That trade — global duplicate prevention in exchange for
confirmability — is argued in full in
[invoice-commitment-spec.md](./invoice-commitment-spec.md), including the mitigations
that were considered and rejected.

## Personal data

| Field                                     | Classification        | Handling                             |
| ----------------------------------------- | --------------------- | ------------------------------------ |
| `users.email`                             | PII                   | Off-chain, unique, lowercased        |
| `users.display_name`                      | PII                   | Off-chain                            |
| `users.password_hash`                     | Secret (hashed)       | Off-chain, scrypt, nullable          |
| `invoices.issuer_tax_id`, `debtor_tax_id` | Business-confidential | Off-chain only                       |
| `invoices.seller_name`, `buyer_name`      | Business-confidential | Off-chain only                       |
| `invoice_documents.*`                     | Metadata only         | No document body in the database     |
| `audit_logs.ip_hash`                      | Pseudonymous          | Salted hash, never the raw address   |
| `audit_logs.metadata`                     | Varies                | Must not contain raw PII — see below |

`users.password_hash` is scrypt, not Argon2id. scrypt is memory-hard, ships with
Node, and needs no native build step; adding an Argon2id binding solely for this
would enlarge the supply chain for no practical gain. Parameters (N=16384, r=8,
p=1, 16 MiB) are stored in the hash string, so raising them later keeps old
hashes verifiable. Verification is constant-time, and a login for an unknown
email burns the same work as a real one so latency does not reveal which
addresses are registered.

`audit_logs.metadata` is `JSONB` and therefore unconstrained by the schema. The rule is
that it carries identifiers and before/after _state names_, never document contents or
personal data. That rule is enforced by review, not by the database — a gap worth
knowing about.

## Secrets

- All secrets arrive through environment variables. `DATABASE_URL`,
  `DEPLOYER_PRIVATE_KEY` and anything else with a credential never appear in code.
- `.env` and `.env.local` are git-ignored; only `.env.example` is committed, and it
  contains no real values.
- `prisma.config.ts` falls back to the docker-compose default when `DATABASE_URL` is
  absent. That fallback exists so `prisma validate` and `prisma generate` work with no
  environment; it is a development convenience, and a deployment that relies on it is
  misconfigured.
- `DEPLOYER_PRIVATE_KEY` belongs to `packages/contracts` only. The API has no reason to
  hold a signing key, and giving it one would turn an API compromise into a custody
  compromise.
- **No key management.** There is no HSM, no KMS, no envelope encryption. The private key
  lives in an environment variable on the deploy machine. That is acceptable for a Fuji
  testnet and unacceptable for mainnet value.

## Transport

- The app does not terminate TLS. It assumes a proxy in front of it does. Running it
  directly on a public interface sends credentials and tokens in clear text.
- `DATABASE_URL` may specify `sslmode`. Nothing forces TLS to Postgres; a deployment that
  crosses a network boundary must set it explicitly. Prisma 7 rejects self-signed
  certificates by default (`P1010`), which is the correct default and should not be
  disabled to "make it work".
- `CORS_ORIGIN` is a comma-separated allowlist, validated at boot. CORS is a
  **browser** control. It is not authentication and it does not stop a server-side
  client, `curl`, or anything else that ignores it.

## Error hygiene

- The global `ValidationPipe` returns field-level messages for `400`s. Those messages
  describe the caller's own input, which is safe.
- `GET /api/v1/health/db` logs the driver error and returns the constant string
  `database unreachable`. Prisma connection failures can echo the connection string, and
  an unauthenticated endpoint must not become a credential leak. A test asserts this.
- Duplicate-key conflicts are mapped to `409` with the offending reference in the
  message. That is an intentional information disclosure to the caller who supplied it.
- Unhandled exceptions return Nest's generic `500` in production. Stack traces are not
  returned.

## Audit trail

`audit_logs` is designed append-only: no update or delete path exists in the application.
That is a **convention, not a guarantee** — anyone with database credentials can rewrite
history. Real tamper-evidence needs either an append-only store, a hash chain, or
periodic anchoring of the log root on-chain. None of that is implemented.

## Supply chain

- pnpm blocks lifecycle scripts by default; `pnpm-workspace.yaml` lists the exact
  packages allowed to run them (`allowBuilds`). A new dependency that needs a postinstall
  is a deliberate decision, not a silent one.
- `pnpm-lock.yaml` is committed and exact versions are pinned (`save-exact=true`).
- `minimumReleaseAge` is not configured. The `minimumReleaseAgeExclude` block in
  `pnpm-workspace.yaml` is therefore inert; it was written when a release-age policy was
  in effect and has no effect today.

## Known gaps, ranked

1. **No rate limiting.** An authenticated client can submit invoices as fast as
   the database allows — and now also as fast as the chain allows, which costs testnet
   AVAX per call. This is the highest-value missing control after Phase 4.
2. **The commitment is confirmable.** Cross-tenant duplicate _detection_ now works, but
   an observer who already holds a candidate invoice can test whether it is registered.
   This is inherent to a public global registry and is documented rather than fixed —
   see [invoice-commitment-spec.md](./invoice-commitment-spec.md).
3. **No key management** for the deployer key. It is a plain environment variable, held
   by one process, with no HSM, no rotation and no separation between the deployer and
   the runtime signer. Production needs a KMS or a signing service.
4. **The registry admin can pause everything and close any financed claim.** Both are
   deliberate recovery paths; both are also a centralisation point. See
   [blockchain-security.md](./blockchain-security.md).
5. **No automated reconciler.** An `UNKNOWN` operation is resolved when a client polls
   it. If the client never comes back, the row stays `UNKNOWN` until someone looks. The
   hash is preserved, so nothing is lost — it is just not automatic.
6. **The indexer assumes one instance.** No lease on the cursor row, so two pollers
   would race. A reorg deeper than one block per pass takes several passes to rewind.
7. **Audit log is not tamper-evident.**
8. **No PII retention policy.** Nothing expires, anonymises or deletes user data. This
    matters more now: the on-chain commitment is permanent, so "delete the invoice"
    cannot mean "delete the trace that it was financed".
9. **No document integrity check on read.** `content_sha256` is stored but not
    re-verified when the blob is read back, so a modified file would be verified
    as if it were the original.
