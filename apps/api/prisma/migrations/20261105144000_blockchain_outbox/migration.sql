-- CreateEnum
CREATE TYPE "BlockchainOperationType" AS ENUM ('INVOICE_ANCHOR', 'RESERVATION_CANCEL', 'FINANCING_DECLARE', 'FINANCING_CLOSE');

-- CreateEnum
CREATE TYPE "BlockchainOperationStatus" AS ENUM ('PENDING', 'SUBMITTING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'UNKNOWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BlockchainReceiptStatus" AS ENUM ('SUCCESS', 'REVERTED');

-- CreateEnum
CREATE TYPE "BlockchainEventType" AS ENUM ('INVOICE_RESERVED', 'FINANCING_DECLARED', 'RESERVATION_CANCELLED', 'CLAIM_CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FinancingStatus" ADD VALUE 'RESERVED';
ALTER TYPE "FinancingStatus" ADD VALUE 'FINANCING_DECLARED';
ALTER TYPE "FinancingStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "chain_sync_cursor" ADD COLUMN     "last_processed_block_hash" CHAR(66);

-- CreateTable
CREATE TABLE "blockchain_operations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "BlockchainOperationType" NOT NULL,
    "status" "BlockchainOperationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(200) NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "contract_address" CHAR(42) NOT NULL,
    "commitment" CHAR(66) NOT NULL,
    "entity_id" CHAR(66),
    "financing_ref" CHAR(66),
    "invoice_id" UUID,
    "financing_request_id" UUID,
    "tx_hash" CHAR(66),
    "from_address" CHAR(42),
    "nonce" INTEGER,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "next_attempt_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(64),
    "last_error_message" VARCHAR(500),
    "submitted_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blockchain_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_transaction_receipts" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "tx_hash" CHAR(66) NOT NULL,
    "block_number" INTEGER NOT NULL,
    "block_hash" CHAR(66) NOT NULL,
    "status" "BlockchainReceiptStatus" NOT NULL,
    "gas_used" BIGINT NOT NULL,
    "effective_gas_price" BIGINT NOT NULL,
    "log_count" INTEGER NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blockchain_transaction_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_events" (
    "id" UUID NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "contract_address" CHAR(42) NOT NULL,
    "tx_hash" CHAR(66) NOT NULL,
    "log_index" INTEGER NOT NULL,
    "block_number" INTEGER NOT NULL,
    "block_hash" CHAR(66) NOT NULL,
    "event_type" "BlockchainEventType" NOT NULL,
    "commitment" CHAR(66) NOT NULL,
    "entity_id" CHAR(66),
    "financing_ref" CHAR(66),
    "actor" CHAR(42) NOT NULL,
    "generation" INTEGER,
    "payload" JSONB NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blockchain_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_operations_idempotency_key_key" ON "blockchain_operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "blockchain_operations_organization_id_created_at_idx" ON "blockchain_operations"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "blockchain_operations_status_next_attempt_at_idx" ON "blockchain_operations"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "blockchain_operations_invoice_id_idx" ON "blockchain_operations"("invoice_id");

-- CreateIndex
CREATE INDEX "blockchain_operations_financing_request_id_idx" ON "blockchain_operations"("financing_request_id");

-- CreateIndex
CREATE INDEX "blockchain_operations_tx_hash_idx" ON "blockchain_operations"("tx_hash");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_transaction_receipts_operation_id_key" ON "blockchain_transaction_receipts"("operation_id");

-- CreateIndex
CREATE INDEX "blockchain_transaction_receipts_block_number_idx" ON "blockchain_transaction_receipts"("block_number");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_transaction_receipts_chain_id_tx_hash_key" ON "blockchain_transaction_receipts"("chain_id", "tx_hash");

-- CreateIndex
CREATE INDEX "blockchain_events_commitment_idx" ON "blockchain_events"("commitment");

-- CreateIndex
CREATE INDEX "blockchain_events_block_number_idx" ON "blockchain_events"("block_number");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_events_chain_id_tx_hash_log_index_key" ON "blockchain_events"("chain_id", "tx_hash", "log_index");

-- AddForeignKey
ALTER TABLE "blockchain_operations" ADD CONSTRAINT "blockchain_operations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_operations" ADD CONSTRAINT "blockchain_operations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_operations" ADD CONSTRAINT "blockchain_operations_financing_request_id_fkey" FOREIGN KEY ("financing_request_id") REFERENCES "financing_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_transaction_receipts" ADD CONSTRAINT "blockchain_transaction_receipts_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "blockchain_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

