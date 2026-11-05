CREATE TYPE "public"."trade_status" AS ENUM('draft', 'pending', 'settled', 'disputed', 'cancelled');--> statement-breakpoint
CREATE TABLE "trade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(64) NOT NULL,
	"buyer_address" varchar(42) NOT NULL,
	"seller_address" varchar(42) NOT NULL,
	"asset" varchar(16) NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"status" "trade_status" DEFAULT 'draft' NOT NULL,
	"chain_id" integer NOT NULL,
	"settlement_tx_hash" varchar(66),
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE INDEX "trade_status_created_at_idx" ON "trade" USING btree ("status","created_at" DESC NULLS LAST);