# Development database cleanup plan (pre-Fuji)

This is a **plan, not an executed change**. Nothing here has been run against the
development database. It exists so the cleanup can be reviewed and run by a human
with an explicit go-ahead, in one deliberate transaction.

## 1. What is wrong

Two pre-Fuji data hazards were identified before the first real Fuji deployment:

1. `prisma/seed.ts` used to fabricate a `CONFIRMED` `BlockchainRecord` on
   `chain_id = 43113` (Fuji). That code has been **removed** (see
   `docs/current-status.md` and the Pre-Fuji remediation commit). Any such row
   already written to a development database still needs deleting, because the
   API would otherwise present a demo invoice as "confirmed on Fuji".
2. The development PostgreSQL contains rows left over from the local Hardhat
   chain (`chain_id = 31337`). Restarting `hardhat node` wipes chain state but
   not this database, so these rows are stale: their transaction hashes point at
   a chain that no longer exists.

## 2. Current counts (read-only, measured before this plan)

Measured against `DATABASE_URL` in `apps/api/.env` (the running `veritrade`
database, `postgres:17-alpine` on `localhost:5432`):

| Table                             | chain_id = 31337 | chain_id = 43113 |
| --------------------------------- | ---------------- | ---------------- |
| `blockchain_operations`           | 3                | 0                |
| `blockchain_records`              | 3                | 1                |
| `blockchain_transaction_receipts` | 3                | 0                |
| `trade`                           | 0                | 1                |

The single `43113` `blockchain_records` row is the fabricated Fuji confirmation
from issue #1. The `43113` `trade` row is the legacy demo trade, also
Fuji-tagged; the seed now writes it as `31337`, so a re-seed will not recreate
it, but the existing row should be retagged rather than deleted (it is harmless
demo data, not an on-chain confirmation).

## 3. Foreign-key reality

The only foreign key targeting these tables is:

```
blockchain_transaction_receipts.operation_id -> blockchain_operations.id
```

`blockchain_records` and `trade` are not referenced by any other table. So the
delete order must be: receipts first, then the operations and records, lastly the
trade retag.

## 4. The script (review only — do not run without approval)

```sql
BEGIN;

-- 1. Receipts reference operations, so they go first.
DELETE FROM blockchain_transaction_receipts WHERE chain_id = 31337;

-- 2. Stale local-chain operations and their confirmed projections.
--    Only the local dev chain (31337). Nothing on 43113 is touched here.
DELETE FROM blockchain_operations      WHERE chain_id = 31337;
DELETE FROM blockchain_records         WHERE chain_id = 31337;

-- 3. The fabricated Fuji confirmation (issue #1). Targeted by its hash so a
--    genuine 43113 row — there is none today, but defensively — is never hit.
DELETE FROM blockchain_records
 WHERE chain_id = 43113
   AND tx_hash = '0xabababababababababababababababababababababababababababababababab';

-- 4. Retag the legacy demo trade from Fuji to the local dev chain. It is demo
--    data, not an on-chain confirmation, so it is corrected rather than deleted.
UPDATE trade SET chain_id = 31337 WHERE chain_id = 43113;

COMMIT;
```

If anything above looks wrong, run `ROLLBACK;` instead of `COMMIT;`.

## 5. Before / after verification

Run these **before** the transaction to confirm the scope, and **after** (on a
fresh connection) to confirm the result:

```sql
-- Before, and again after:
SELECT chain_id, count(*) FROM blockchain_operations      GROUP BY chain_id ORDER BY 1;
SELECT chain_id, count(*) FROM blockchain_records         GROUP BY chain_id ORDER BY 1;
SELECT chain_id, count(*) FROM blockchain_transaction_receipts GROUP BY chain_id ORDER BY 1;
SELECT chain_id, count(*) FROM trade                      GROUP BY chain_id ORDER BY 1;

-- Targeted confirmation that the fabricated Fuji row is gone:
SELECT count(*) FROM blockchain_records WHERE chain_id = 43113;
-- Expected after: 0
```

## 6. What is deliberately NOT touched

- Any `blockchain_*` row with `chain_id = 43113` **other than** the fabricated
  `0xab…ab` record. There are none today, but the `WHERE` clause is exact so a
  future legitimate Fuji row is safe.
- `chain_sync_cursor`, `blockchain_signer_nonces`, `blockchain_events`,
  `blockchain_rate_limits` — these do not carry the stale 31337/43113 hazard
  described above and are out of scope for this cleanup.
- Real Fuji state. This plan only ever runs against the **development**
  database. It must never be pointed at a production or shared Fuji-backed
  database.

## 7. After cleanup, re-seed is clean

`pnpm db:seed` now writes **zero** `blockchain_records` and tags the demo trade
`31337` (see the seed-safety test). So after this cleanup a fresh seed converges
and no Fuji confirmation is ever fabricated.
