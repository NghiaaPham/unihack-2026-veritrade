CREATE TABLE "chain_sync_cursor" (
	"chain_id" integer NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"last_processed_block" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_sync_cursor_chain_id_contract_address_pk" PRIMARY KEY("chain_id","contract_address")
);
