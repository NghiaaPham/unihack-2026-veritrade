# Invoice verification

What each check proves, what it does not, and why the summary status is not a
legal determination.

## The rule the whole design follows

> A check that did not run never counts as a pass.

Every non-passing outcome — `SKIPPED`, `UNSUPPORTED`, `NOT_CHECKED`, `ERROR` —
pulls the summary down to `PARTIAL`. Only a run where every check actually ran
and passed produces `PASSED`.

That has a consequence worth stating plainly: **no invoice can currently reach
`PASSED`.** Tax-authority verification is not implemented, so `authority.tax`
always reports `UNSUPPORTED`. This is by design, not by accident. Reporting
`PASSED` on a locally valid invoice would claim a guarantee the system cannot
make.

## The checks

Each check is an independent class implementing `VerificationCheck`. The engine
runs them all against the same input and aggregates. A check that throws is
recorded as `ERROR` and does not abort the run — one broken check must not hide
the verdict of the others.

### `xml.structure` — XML structural validity

**Proves:** the document was decoded as strict UTF-8, contained no DOCTYPE,
ENTITY, stylesheet or XInclude construct, was well-formed XML, stayed within
the depth and node limits, and matched a supported profile.

**Does not prove:** that the invoice is correct, that the fields are
meaningful, or that anyone approved it. Well-formed XML is a precondition for
reading the document, not a statement about it.

Reports `SKIPPED` for an invoice created from structured metadata — there is no
document to parse, and pretending otherwise would be a fabrication.

### `fields.required` — required business fields

**Proves:** the fields financing depends on are present and well-shaped:
series, number, template code, both parties' names and tax ids, currency, issue
date, and a positive amount.

Runs against the **persisted row**, not the parsed document. Whatever bug let a
bad value reach the database is exactly the bug worth catching here.

### `arithmetic.totals` — financial arithmetic

Three independent relations, each skipped when its inputs are absent rather
than assumed to hold:

```
subtotal + tax          = total
sum(line totals)        = subtotal
quantity × price − discount = line total      (per line)
```

Tolerance is one cent (`0.01`). Vietnamese invoices are normally whole dong, so
this only absorbs line-level rounding; it is far too small to hide a real
discrepancy.

If nothing could be evaluated the check reports `SKIPPED`, never `PASSED`.

### `duplicate.detection` — duplicates and conflicts

Two different questions:

1. **Same identity.** Exactly one row in the organisation must carry this
   fingerprint. The unique constraint makes more than one impossible, so a
   count above one means inconsistent backups or a fingerprint written by an
   older version — an integrity failure worth failing on.
2. **Same content, different identity.** Another invoice with identical buyer,
   amounts and issue date but a different series or number is the classic
   double-financing pattern: re-key the same receivable to get a second loan.

The second rule is a heuristic, not proof. Two genuinely distinct invoices can
coincide. It errs towards a manual review because the cost of a false positive
is a review, and the cost of a false negative is lending twice against one
receivable.

A matching invoice number alone is **not** duplication: it is only meaningful
together with the seller and the series.

### `signature.xmldsig` — XML digital signature

**Proves** (when it passes): the signed element's digest matches the document,
and the signature over that digest validates against the certificate embedded
in the document.

**Does not prove:** that the certificate belongs to the seller, that it was
valid at signing time, that it has not been revoked, or that the tax authority
approved anything. Those are `signature.trust` and `authority.tax`, both of
which report that they are not performed.

Outcomes:

| Situation                                 | Status        |
| ----------------------------------------- | ------------- |
| No source document                        | `NOT_CHECKED` |
| Document with no `<Signature>`            | `NOT_CHECKED` |
| More than 5 signatures                    | `UNSUPPORTED` |
| Signature without an embedded certificate | `UNSUPPORTED` |
| Signature does not match the document     | `FAILED`      |
| Signature could not be processed          | `ERROR`       |
| Every signature validates                 | `PASSED`      |

A `PASSED` result still carries `trustChain: 'NOT_CHECKED'` in its details, so a
client cannot mistake a cryptographic pass for a statement about who the signer
is.

**Parsing XML is not signature verification.** They are separate checks on
purpose: a document can be perfectly well-formed and completely unsigned, which
is the normal case for an invoice exported from an accounting system.

### `signature.trust` — certificate trust chain

Always `NOT_CHECKED`, reason `NO_TRUST_STORE`.

Answering it needs a trust store of Vietnamese certificate authorities plus
revocation checking (OCSP or CRL). Neither is configured. A cryptographically
valid signature only says "whoever holds this private key signed this document".

### `authority.tax` — tax-authority approval

Always `UNSUPPORTED`, reason `NO_AUTHORIZED_INTEGRATION`.

There is no authorized integration with the tax authority's invoice lookup
service. The check is reported on every run rather than omitted, because an
absent check is indistinguishable from a passed one to a client that only reads
the summary.

**A valid signature is not proof that the tax authority has approved the
invoice.** Those are independent facts and the system keeps them independent.

## Aggregation

```
any FAILED or ERROR                       → FAILED
else any SKIPPED / UNSUPPORTED / NOT_CHECKED → PARTIAL
else                                      → PASSED
```

`FAILED` wins over everything: one broken relation is enough, regardless of how
many other checks passed.

## Response shape

```json
{
  "id": "0193…",
  "status": "PARTIAL",
  "scope": "LOCAL_CHECKS_ONLY",
  "provider": "local-checks-v1",
  "score": null,
  "checkedAt": "2026-11-05T13:51:02.114Z",
  "limitations": [
    "XML digital signature: The document carries no XML digital signature",
    "Tax authority verification: No authorized tax-authority integration is configured; …"
  ],
  "checks": [
    {
      "key": "xml.structure",
      "label": "XML structural validity",
      "status": "PASSED",
      "message": "…",
      "details": {},
      "durationMs": 1
    }
  ]
}
```

- **`scope`** is always `LOCAL_CHECKS_ONLY`. It is a literal, not a column,
  precisely so a client cannot read `status` as a legal determination.
- **`score`** is always `null`. No scoring model exists, and `0` or `100` would
  be an invented number.
- **`limitations`** is derived from the checks that did not pass, not
  hard-coded, so a new check cannot silently omit its own limitation.
- **`checks`** is returned in the canonical execution order, not database
  order.

## History

Runs are append-only. A re-run adds a row; it never overwrites the previous
verdict. The record of what was believed at a point in time is the evidence,
and a re-run that replaced it would erase the fact that the earlier verdict
differed.

`GET /api/v1/invoices/:id/history` returns every run plus the audit events, all
newest first. `POST /api/v1/invoices/:id/verify` starts a new run.

## What verification is not

- It is **not** a legal determination that the invoice is valid.
- It is **not** proof the tax authority issued or approved it.
- It is **not** proof the seller is who the document says.
- It is **not** proof the receivable has not already been financed elsewhere.
  It only sees invoices in this organisation's database.

## Adding a check

1. Implement `VerificationCheck` in `src/invoice-verification/checks/`.
2. Add its stable key to `CHECK_KEYS` in `checks/check.types.ts`.
3. Add the class to `VERIFICATION_CHECK_CLASSES` in
   `src/invoice-verification/invoice-verification.module.ts`.

Removing a check is not symmetric. Invoices verified before the removal keep
their recorded result, but new runs would silently lose a dimension — so a
removal changes what the verdict means and belongs in this document as well as
in the diff.

## Testing

`test/verification-checks.spec.ts` covers each check's pass, fail, skip and
unsupported paths. `test/verification-engine.spec.ts` covers aggregation,
including a check that throws (the database-failure case) and the guarantee
that a driver error message never reaches the stored result.
