import {
  bigint,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Indexer progress per (chain, contract).
 *
 * Infrastructure, not domain: it records how far on-chain events have been
 * consumed so a restart or replay does not double-process them.
 */
export const chainSyncCursor = pgTable(
  'chain_sync_cursor',
  {
    chainId: integer('chain_id').notNull(),
    contractAddress: varchar('contract_address', { length: 42 }).notNull(),
    lastProcessedBlock: bigint('last_processed_block', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.chainId, table.contractAddress] })],
);

export const tradeStatus = pgEnum('trade_status', [
  'draft',
  'pending',
  'settled',
  'disputed',
  'cancelled',
]);

/**
 * A settlement agreement between two on-chain parties.
 *
 * `reference` is the caller-supplied idempotency key: an off-chain system or a
 * retried request must not create a second row for the same trade. Settlement
 * columns stay null until the on-chain transaction is confirmed.
 */
export const trade = pgTable(
  'trade',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: varchar('reference', { length: 64 }).notNull().unique(),
    buyerAddress: varchar('buyer_address', { length: 42 }).notNull(),
    sellerAddress: varchar('seller_address', { length: 42 }).notNull(),
    asset: varchar('asset', { length: 16 }).notNull(),
    // Exact token amount, 18 decimals. Drizzle returns numeric as a string so
    // precision never round-trips through a JS float.
    amount: numeric('amount', { precision: 38, scale: 18 }).notNull(),
    status: tradeStatus('status').notNull().default('draft'),
    chainId: integer('chain_id').notNull(),
    settlementTxHash: varchar('settlement_tx_hash', { length: 66 }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('trade_status_created_at_idx').on(table.status, table.createdAt.desc())],
);

export type TradeStatus = (typeof tradeStatus.enumValues)[number];
export type Trade = typeof trade.$inferSelect;
export type NewTrade = typeof trade.$inferInsert;
