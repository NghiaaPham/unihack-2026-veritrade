# Invoice processing

How a document becomes an invoice row: the supported formats, the extraction
rules, the identity fingerprint, and what is deliberately thrown away.

## Pipeline

```
                    ┌──────────────────────────────────────────┐
 structured JSON ──►│ validation (class-validator)             │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
 XML upload ───────►│ size → UTF-8 → construct check →         │
                    │ well-formedness → depth/nodes → profile  │
                    │ → field extraction → normalisation       │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │ identity fingerprint + content hash      │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │ duplicate / conflict decision            │
                    │ (pre-check, then unique constraint)      │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │ invoice + document metadata + audit row  │
                    │ committed in one transaction             │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │ verification run (see                      │
                    │ docs/invoice-verification.md)             │
                    └──────────────────────────────────────────┘
```

## Supported formats

"Vietnamese e-invoice XML" is not one schema. Two circulars are supported, and
they differ structurally even though they share field names:

| Profile     | Circular                | Body location | Recognised by              |
| ----------- | ----------------------- | ------------- | -------------------------- |
| `TT78_2021` | Thông tư 78/2021/TT-BTC | `HDon/DLHDon` | a `DLHDon` child of `HDon` |
| `TT32_2011` | Thông tư 32/2011/TT-BTC | `HDon`        | `HDon` with no `DLHDon`    |

Anything else is rejected with `422 UNSUPPORTED_INVOICE_FORMAT` and the
supported list in `details`. It is **not** force-fitted into the nearest
profile: a parser that guesses produces wrong money in a financial record,
which is worse than a rejection.

### The extracted subset

Only these elements are read. Everything else in the document is ignored.

| Field          | Element                  | Required |
| -------------- | ------------------------ | -------- |
| Invoice series | `TTChung/KHHDon`         | yes      |
| Invoice number | `TTChung/SHDon`          | yes      |
| Template code  | `TTChung/KHMSHDon`       | yes      |
| Template name  | `TTChung/THDon`          | no       |
| Issue date     | `TTChung/NLap`           | yes      |
| Currency       | `TTChung/DVTTe`          | yes      |
| Payment method | `TTChung/HTTToan`        | no       |
| Seller name    | `NDHDon/NBan/Ten`        | yes      |
| Seller tax id  | `NDHDon/NBan/MST`        | yes      |
| Buyer name     | `NDHDon/NMua/Ten`        | yes      |
| Buyer tax id   | `NDHDon/NMua/MST`        | yes      |
| Subtotal       | `NDHDon/TToan/TgTCThue`  | no       |
| Tax total      | `NDHDon/TToan/TgTThue`   | no       |
| Grand total    | `NDHDon/TToan/TgTTTBSo`  | yes      |
| Total in words | `NDHDon/TToan/TgTTTBChu` | no       |
| Line items     | `NDHDon/DSHHDVu/HHDVu`   | no       |

Line-item fields: `STT`, `THHDVu`, `DVTinh`, `SLuong`, `DGia`, `TLCK`,
`ThTien`, `TSuat`.

Names are matched **namespace-agnostically**: prefixes are stripped before
matching, so `ns:HDon` and `HDon` are the same element. This is what lets one
profile cover more than one vendor's serialisation, and it is also a limitation
— two schemas that happen to use the same local names cannot be told apart.

### Addresses, bank details and payment terms are not extracted

An invoice XML can carry bank account numbers, addresses and contact details.
None of it is needed to identify an invoice, price a receivable, or verify a
signature, so none of it is read. The document itself is kept (see
`docs/invoice-security.md`), but the database row does not become a second copy
of the customer's personal data.

## Normalisation

Normalisation runs once, in `src/invoices/invoice-normalization.ts`, and is
imported by the parser, the fingerprint and the verifier. Three implementations
of the same rule would eventually disagree, and a disagreement here means the
same invoice uploaded twice produces two identities.

| Field         | Rule                                                                | Why                                                                                         |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Tax id        | uppercase, strip whitespace and dots, keep dashes                   | `0101234567` and `0101234567-001` are a head office and a branch — different legal entities |
| Series        | uppercase, strip whitespace, `-`, `_`, `.`; keep alphanumerics      | `AA/25E` and `AA25E` are the same series                                                    |
| Number        | uppercase; leading zeros dropped for numeric-only values            | `0000123` and `123` are the same invoice; providers pad differently                         |
| Template code | uppercase, strip whitespace                                         | `1` and `1C` are different templates                                                        |
| Currency      | uppercase                                                           | ISO 4217                                                                                    |
| Amount        | plain decimal only; thousands separators **rejected**               | `1.100.000` is ambiguous between locales; guessing is not acceptable                        |
| Date          | `YYYY-MM-DD` or a `YYYY-MM-DDTHH:mm:ss` prefix; must be a real date | `2026-02-31` matches the shape and is not a day                                             |
| Text          | whitespace collapsed and trimmed                                    | display only                                                                                |

Amounts are stored as `Decimal(38,18)` and never pass through a JS float.

## Identity versus content

Two different hashes are stored, and confusing them is the failure mode this
design exists to prevent.

**`fingerprint` — identity.** SHA-256 over
`vt-invoice-identity-v2|<sellerTaxId>|<series>|<number>|<templateCode>`.

Those four fields are what legally identify an invoice. Deliberately excluded:
the issue date, the buyer and the amounts. Those are _content_. Including them
in the identity would let a re-issued invoice with a corrected amount pass
duplicate detection as if it were a new document.

**`contentHash` — content.** SHA-256 over
`vt-invoice-content-v1|<buyerTaxId>|<buyerName>|<currency>|<issueDate>|<subtotal>|<tax>|<total>`.

Line items are excluded: the structured-create path has none, so including them
would make the same invoice submitted two ways look like a conflict. `dueDate`
is excluded because an e-invoice states no payment terms — it is application
metadata.

Both prefixes are versioned and are _inside_ the hash. Changing a normalisation
rule without bumping the prefix would silently change the identity of every
stored invoice, so a re-upload would look brand new.

## Duplicates and conflicts

| Situation                                 | Outcome                                                  |
| ----------------------------------------- | -------------------------------------------------------- |
| Same identity, same content               | `409 DUPLICATE_INVOICE`                                  |
| Same identity, different content          | `409 CONFLICTING_INVOICE`                                |
| Different identity, same content          | `201`, then `duplicate.detection` **FAILS** verification |
| Same identity in a different organisation | `201` — organisations are separate tenants               |

The database enforces `@@unique([organizationId, fingerprint])`. The service
checks first for a clean message, but two concurrent requests can both pass
that check, so the constraint is the real guard and a `P2002` is translated
into the same 409. Without that second path a concurrent double-submit would
surface as a 500.

A matching invoice number on its own is **not** treated as duplication. It is
only meaningful together with the seller and the series.

## What is persisted

`invoices` holds the normalised business view. `invoice_documents` holds
metadata about the uploaded file — filename, declared MIME type, byte size,
SHA-256 of the raw bytes, storage key, parser profile and parser version.

There is no column for the document body. The bytes live in content-addressed
storage, addressed by their SHA-256, which makes `put` idempotent: writing the
same bytes twice is the same operation.

`parser_version` is recorded per document so a fix to the extraction logic can
be scoped to the rows that predate it.

## Limits

| Limit                   | Default | Configured by                                |
| ----------------------- | ------- | -------------------------------------------- |
| Upload size             | 2 MiB   | `INVOICE_MAX_UPLOAD_BYTES` (1024 – 20971520) |
| XML nesting depth       | 32      | constant in the parser                       |
| XML element count       | 20 000  | constant in the parser                       |
| Signatures per document | 5       | constant in the signature check              |
| Page size               | 20      | `limit`, capped at 100                       |

## Endpoints

All under `/api/v1/invoices`, all requiring a bearer token, all scoped to the
organisation in the token.

| Method | Path                | Purpose                                          |
| ------ | ------------------- | ------------------------------------------------ |
| `POST` | `/`                 | Create from structured metadata                  |
| `POST` | `/upload`           | Upload an XML document (multipart, field `file`) |
| `GET`  | `/`                 | List with pagination, filters and sorting        |
| `GET`  | `/:id`              | One invoice with its latest verification         |
| `GET`  | `/:id/verification` | Latest verification result                       |
| `GET`  | `/:id/history`      | Every verification run plus audit events         |
| `POST` | `/:id/verify`       | Re-run verification, appending a new run         |

An invoice belonging to another organisation returns `404`, not `403`. A `403`
would confirm that the id exists, which is exactly what an id-enumerating
attacker wants to learn.

### Errors

| Status | Code                         | Meaning                                                        |
| ------ | ---------------------------- | -------------------------------------------------------------- |
| 400    | `INVALID_REQUEST`            | Semantically wrong request (bad date, inverted range, no file) |
| 401    | `UNAUTHORIZED`               | Missing, invalid or revoked token                              |
| 403    | `FORBIDDEN`                  | Role may not write (e.g. `VIEWER`)                             |
| 404    | `NOT_FOUND`                  | No such invoice in this organisation                           |
| 409    | `DUPLICATE_INVOICE`          | Same identity and content already on file                      |
| 409    | `CONFLICTING_INVOICE`        | Same identity, different content                               |
| 413    | `DOCUMENT_TOO_LARGE`         | Upload above the configured limit                              |
| 422    | `INVALID_INVOICE_DOCUMENT`   | Malformed, unsupported constructs, or missing required fields  |
| 422    | `UNSUPPORTED_INVOICE_FORMAT` | Well-formed XML in a format no profile recognises              |
| 500    | `DOCUMENT_UNAVAILABLE`       | The stored document could not be read back                     |

## Not supported

- PDF invoices, scanned images, and any non-XML attachment.
- Digitally signed **PDFs** — only XMLDSig inside XML is examined.
- Formats other than TT78/2021 and TT32/2011, including OASIS UBL, Peppol BIS
  and every vendor-specific dialect not covered by the two profiles.
- Multi-document archives (ZIP, TAR).
- Revising an invoice. A re-issue with the same identity is a conflict, not a
  new version; supporting revisions needs an explicit version chain in the
  data model.
- Batch submission. One document per request.
