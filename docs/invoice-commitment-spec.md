# Invoice commitment specification

This is the normative description of the value VeriTrade writes to
`VeriTradeInvoiceRegistry`. It has to be exact: two parties that disagree by one byte
derive different commitments and the duplicate check silently stops working.

Version: **schema 1**, contract `VeriTradeInvoiceRegistry` 1.0.0.

## 1. Inputs

The identity is the same tuple Phase 3 already fingerprints
(`apps/api/src/invoices/invoice-fingerprint.ts`):

| Field          | Database column  | Example      |
| -------------- | ---------------- | ------------ |
| `sellerTaxId`  | `issuer_tax_id`  | `0101234567` |
| `series`       | `invoice_series` | `C25TAA`     |
| `number`       | `invoice_number` | `123`        |
| `templateCode` | `invoice_type`   | `1`          |

All four are normalised before hashing (tax id keeps its dashes, series loses `/`,
numeric-only numbers lose leading zeros, template codes are trimmed). Empty components are
rejected with `INCOMPLETE_INVOICE_IDENTITY`.

Deliberately excluded: issue date, buyer, amounts, line items, due date, database ids,
organization ids, upload time. Including any of them would let a re-issued invoice with a
changed amount look like a new invoice — the exact fraud the registry exists to stop.

## 2. Canonical string

```
vt-invoice-identity-v2|<sellerTaxId>|<series>|<number>|<templateCode>
```

Literal `|` separators, no escaping, no whitespace. The prefix is part of the hash: a
normalisation change without a prefix bump would silently change every identity.

## 3. Identity digest

```
identityDigest = SHA-256(UTF-8(canonicalString))
```

64 lowercase hex characters, sent to the contract as a `bytes32` with a `0x` prefix.

This value is **identical to the `invoices.fingerprint` column**. The API recomputes it
from the row on every anchor and refuses with `500 INVOICE_FINGERPRINT_MISMATCH` if the
stored column disagrees, so a row written by anything other than this codebase cannot be
anchored.

## 4. Commitment

```
commitment = keccak256(abi.encode(
    bytes32 COMMITMENT_DOMAIN,
    uint16  SCHEMA_VERSION,
    bytes32 identityDigest
))
```

| Constant            | Value                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `COMMITMENT_DOMAIN` | `keccak256("vt-invoice-commitment-v1")` = `0x6a10b7f10cf6b56bfb7a4df8349afe719b56801a461215723f1701389e588d59` |
| `SCHEMA_VERSION`    | `1`                                                                                                            |

`abi.encode` (not `abi.encodePacked`): every argument is fixed-width so the two are
equivalent today, but the non-packed form stays unambiguous if a later version adds a
dynamic field.

The contract exposes the same derivation as `commitmentFor(bytes32 identityDigest)`, so a
client never has to reimplement it. `docs` and the TypeScript implementation are checked
against each other by a test.

### Golden vector

```
canonical       vt-invoice-identity-v2|0101234567|C25TAA|123|1
identityDigest  29998ac48aaff1d3dc87b20184e2e87ad2c7cd1731107c481757da7326337d3e
commitment      0x3583e5de82256c927d1d69598a5d6baff387dd3aa75765f857571c54f7741692
```

Any change to this vector is a schema version bump with a migration plan, not a refactor.

## 5. Opaque handles

Two more values go on chain. Both are hashes of a database id, so no raw identifier is
published.

```
entityId     = keccak256("vt-entity-v1|<organizationId>")
financingRef = keccak256("vt-financing-ref-v1|<financingRequestId>")
```

They are namespaced separately from the commitment and from each other, so the same uuid
cannot collide across domains. `entityId` is recorded on the registration for auditability;
it is **not** an authorization check (see `blockchain-security.md`).

## 6. Cross-party matching

Two organizations holding the same invoice derive the same commitment because the input is
the invoice itself, not the row:

1. both canonicalise the four identity fields with the same rules;
2. both SHA-256 the same string;
3. both wrap it with the same domain and version.

The second party's `register` reverts with `ClaimAlreadyActive`. No coordination, no shared
secret, no registry of organizations is needed.

**Trust assumption:** both parties normalise identically. If one strips the dash from a tax
id and the other does not, the commitments differ and the duplicate is missed. That is why
normalisation is versioned and shared, and why the registry is a backstop rather than the
only duplicate check — the tenant-scoped fingerprint still catches re-uploads inside one
organization.

## 7. Privacy

### What is published

A 32-byte commitment, an opaque entity handle, an opaque financing handle, an enum, two
addresses and timestamps. Nothing else. No amount, party, date, line item or document.

### Dictionary attack

The identity space is enumerable for anyone who knows the seller's tax code and template:
series and invoice numbers are short and sequential. An attacker with those inputs can
compute candidate commitments and test membership with `statusOf`.

This leak is **accepted**, and it is inherent to the product: a registry that refuses
duplicate financing must be able to answer "is this invoice already claimed?" for anyone
who can present the invoice. Options considered and rejected:

| Alternative                       | Why rejected                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyed HMAC with a platform secret | Breaks cross-party matching; every participant needs the secret, and whoever holds it can enumerate anyway.                                  |
| Per-registration random salt      | Destroys determinism: the same invoice would never collide, which is the entire point.                                                       |
| Zero-knowledge set membership     | Would work, but puts a proving system between a financier and a decision they must be able to audit themselves. Out of scope for this phase. |
| Encrypt the commitment            | Anyone who can decrypt can enumerate; anyone who cannot cannot verify.                                                                       |

### What the domain separator buys

The commitment is not the database fingerprint. An observer who obtains a `fingerprint`
value (it is returned to the owning organization) cannot query the chain with it directly;
they must first re-derive it from the invoice fields. That does not stop an attacker who
already has the fields — nothing would — but it does stop accidental correlation between a
database export and on-chain data, and it gives a clean place to rotate the scheme.

### Versioning

`SCHEMA_VERSION` and the domain label are both inside the hash. Changing either produces a
new commitment for every invoice, which means:

- the old registry keeps answering for old commitments;
- the new one starts empty;
- both must be consulted during a transition.

That is a deliberate cost, not an accident. There is no in-place migration of an on-chain
commitment, and pretending otherwise would break every existing claim.

## 8. Verification

The specification is checked by tests rather than by review:

- `apps/api/test/blockchain-commitment.spec.ts` pins the golden vector, the domain
  separator, the handle derivations and the ABI slice against the compiled artifact.
- `packages/contracts/test/VeriTradeInvoiceRegistry.spec.ts` asserts that
  `commitmentFor` matches an independent `abi.encode` computation.
