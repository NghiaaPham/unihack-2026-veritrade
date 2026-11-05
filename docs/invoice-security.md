# Invoice security

The threat model for the document pipeline, what is defended, and what is not.

## Why XML needs its own document

An uploaded invoice is the only place in VeriTrade where a third party supplies
a structured document that the server parses. XML parsing has a long history of
turning "read this file" into "read this file on the server's disk", "allocate
unbounded memory", or "make an outbound request from inside the firewall".
Every one of those is reachable from a single upload endpoint.

## Attack surface

| Vector                               | Defence                                                                           | Where           |
| ------------------------------------ | --------------------------------------------------------------------------------- | --------------- |
| External entity (XXE)                | `DOCTYPE`/`ENTITY` rejected by pattern before parsing; entity processing disabled | parser          |
| Billion laughs / entity expansion    | Same — any entity declaration is rejected                                         | parser          |
| XInclude / external stylesheet       | Rejected by pattern                                                               | parser          |
| Oversized upload                     | Multer byte limit + parser byte ceiling, same number                              | module + parser |
| Deeply nested XML (stack exhaustion) | Depth ceiling of 32                                                               | parser          |
| Huge element count                   | Ceiling of 20 000 nodes                                                           | parser          |
| Invalid UTF-8                        | Strict decode; invalid sequences are an error, not replacement characters         | parser          |
| Path traversal via storage key       | Keys are derived from the content hash and matched against a strict pattern       | storage         |
| Signature-flooding                   | At most 5 signatures processed                                                    | signature check |
| Cross-tenant read                    | Every query carries `organizationId` from a verified token                        | service         |
| Duplicate submission race            | Unique constraint, not a read-then-write check                                    | database        |

### Order of application

```
1. byte ceiling          — before touching the content
2. strict UTF-8 decode   — a mangled tax id is worse than a rejection
3. forbidden constructs  — DOCTYPE, ENTITY, xml-stylesheet, xi:include
4. well-formedness       — XMLValidator, before any field access
5. depth and node count  — before the deep traversals
6. profile detection     — unknown formats rejected, not guessed
7. field extraction      — required fields, then normalisation
```

Steps 1–3 happen before the parser is invoked at all. `fast-xml-parser` already
refuses external entities and does not expand internal ones, but a document
with a DOCTYPE is not an invoice regardless of what the parser does with it, so
it is rejected on its own merits.

## What is never logged

- **Document contents.** No element text, no attribute value, no raw body.
- **Parser messages.** `fast-xml-parser` and `xml-crypto` both quote document
  content in their error messages, so their messages are discarded and replaced
  with a generic reason. The line and column are kept — they help a user fix
  their export and reveal nothing.
- **Driver errors on 5xx.** A connection string or a query can appear in one.
  The stack is logged server-side; the client gets `Internal server error`.
- **File paths.** `DOCUMENT_UNAVAILABLE` does not name the storage location.

What _is_ logged: the check key that failed, the invoice id, and the stack for
a genuine 5xx.

## Storage

Documents are content-addressed: the SHA-256 of the bytes is the storage key,
fanned out two hex characters deep to keep directories small. Two properties
follow:

- **`put` is idempotent.** Re-writing identical bytes is the same operation, so
  a retried upload cannot corrupt anything or leave two copies.
- **Keys are derived, never supplied.** `LocalDocumentStorage` computes the key
  from the hash and refuses to resolve any key that does not match
  `^[0-9a-f]{2}/[0-9a-f]{64}\.xml$`. There is no code path where a
  caller-controlled string reaches `path.join`.

The bytes are written **before** the row is inserted. A blob with no row is an
unreferenced file the next upload of the same content reuses; a row with no
blob is an invoice that can never be re-verified.

### `LocalDocumentStorage` is not a production store

It has no encryption at rest, no retention policy, no replication, no access
control beyond the process's own file permissions, and no audit of reads. It
exists so the development and test paths are real rather than mocked.

A production implementation must provide:

1. **Encryption at rest** with keys held outside the application's config.
2. **Per-tenant authorisation on read**, so a leaked storage key is not
   sufficient on its own.
3. **Immutability or versioning**, so an overwrite cannot silently change what
   an invoice's verification was based on.
4. **A retention and deletion policy** aligned with Vietnamese accounting
   record-keeping requirements — which are likely longer than a default
   lifecycle rule.
5. **Access logging** for reads as well as writes.

Swapping implementations is a change to `DocumentStorageModule` only; the
interface is `put` / `get` / `exists`.

## Data minimisation

The database does not hold the document body. `invoice_documents` stores only
metadata. The reason is not storage cost: an invoice XML contains buyer and
seller names, tax ids and addresses, and the cheapest way to avoid leaking them
through a query, a backup or a replica is not to put them there.

Only a narrow business view is extracted — no addresses, no bank details, no
contact information. Those fields exist in real documents and are deliberately
ignored.

## Tenant isolation

`Organization` is the tenant root. Every tenant-owned row carries
`organizationId`, and every index that serves a query leads with it, so a query
without a tenant filter is a visible omission rather than a silent cross-tenant
read.

The tenant id used for a query comes from a verified token plus a live
membership lookup — never from a request body, a query parameter or a header.
There is no code path that accepts an organisation id from a client.

**A resource belonging to another tenant returns `404`, not `403`.** A `403`
confirms the id exists; that is precisely what an id-enumerating attacker is
trying to learn.

Malformed ids are also `404`, checked before the database sees them: Postgres
would reject the cast and Prisma would surface it as a 500.

## Audit trail

`invoice.created` and `invoice.verified` are written inside the same transaction
as the change they describe, so a create that succeeds cannot leave an action
nobody can account for.

Each entry records the organisation, the actor, a dotted verb, the entity and a
small metadata object (source, fingerprint, format, verification id and
status). It contains no document contents and no personal data beyond the
identifiers already stored on the invoice.

The table is append-only: there is no update or delete path in the application.
A correction is a new row.

## Known gaps

| Gap                                 | Consequence                                                                       | Mitigation                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| No rate limiting                    | An authenticated client can submit invoices as fast as the database allows        | Deploy behind a gateway with per-token limits; add `@nestjs/throttler`                |
| No malware scanning                 | An uploaded file is parsed, never executed, so the risk is limited to parser bugs | Run an AV scanner on the object store in production                                   |
| No antivirus on stored blobs        | A user downloading their own document could receive something hostile             | Serve with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`    |
| MIME type is advisory               | A client can declare any type                                                     | It is recorded for forensics only; the parser is the real gate                        |
| No request signing on the API       | Anything with a token can act                                                     | Out of scope for MVP; tokens are short-lived and revocable                            |
| No encryption at rest               | Delegated to PostgreSQL and the host                                              | Enable disk encryption and encrypted backups                                          |
| No document integrity check on read | A modified blob would be verified as if it were the original                      | `contentSha256` is stored; a re-hash on read would detect tampering — not implemented |
| Audit log is not tamper-evident     | A database administrator could edit it                                            | Phase 4 anchors verification commitments on-chain                                     |

## Reporting a problem

If you find a vulnerability in the parsing pipeline, do not open a public
issue with a working payload. Report it privately to the maintainers.
