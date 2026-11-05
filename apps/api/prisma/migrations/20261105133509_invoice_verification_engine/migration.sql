-- Phase 3: invoice identity, document metadata and per-check verification results.
--
-- Prisma generated the column additions below as plain `NOT NULL` without a
-- default, which would abort on any table that already holds rows. The
-- defaults are therefore added temporarily, existing rows are backfilled, and
-- the defaults are dropped again — so future inserts must supply real values.
--
-- `due_date` becomes nullable because a Vietnamese e-invoice states its issue
-- date but not its payment terms. The alternative was to invent a due date,
-- which would write fabricated data into a financial record.

-- CreateEnum
CREATE TYPE "VerificationCheckStatus" AS ENUM ('PASSED', 'FAILED', 'SKIPPED', 'UNSUPPORTED', 'NOT_CHECKED', 'ERROR');

-- AlterEnum
ALTER TYPE "VerificationStatus" ADD VALUE 'PARTIAL';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "buyer_name" VARCHAR(255) NOT NULL DEFAULT '',
ADD COLUMN     "content_hash" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "invoice_series" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "invoice_type" VARCHAR(16) NOT NULL DEFAULT '',
ADD COLUMN     "invoice_type_name" VARCHAR(160),
ADD COLUMN     "last_verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "seller_name" VARCHAR(255) NOT NULL DEFAULT '',
ADD COLUMN     "subtotal_amount" DECIMAL(38,18),
ADD COLUMN     "tax_amount" DECIMAL(38,18);

ALTER TABLE "invoices" ALTER COLUMN "due_date" DROP NOT NULL;

-- Backfill invoices that predate the identity scheme.
--
-- Their series and template code were never captured, so they are marked
-- UNKNOWN rather than guessed: a wrong series would silently merge two
-- different invoices into one identity. `content_hash` is derived from the
-- fields that do exist, so it is deterministic and a re-upload of the same
-- document still compares equal.
UPDATE "invoices"
SET "seller_name"   = "issuer_tax_id",
    "buyer_name"    = "debtor_tax_id",
    "invoice_series" = 'UNKNOWN',
    "invoice_type"   = 'UNKNOWN',
    "content_hash"   = encode(
      sha256(convert_to(
        'vt-invoice-content-v1|' || "issuer_tax_id" || '|' || "debtor_tax_id" || '|' ||
        "currency" || '|' || "amount"::text || '|' ||
        to_char("issue_date", 'YYYY-MM-DD'),
        'UTF8'
      )),
      'hex'
    )
WHERE "invoice_series" = '';

ALTER TABLE "invoices"
  ALTER COLUMN "buyer_name" DROP DEFAULT,
  ALTER COLUMN "content_hash" DROP DEFAULT,
  ALTER COLUMN "invoice_series" DROP DEFAULT,
  ALTER COLUMN "invoice_type" DROP DEFAULT,
  ALTER COLUMN "seller_name" DROP DEFAULT;

-- CreateTable
CREATE TABLE "invoice_documents" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "content_sha256" VARCHAR(64) NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "format" VARCHAR(32) NOT NULL,
    "parser_version" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_checks" (
    "id" UUID NOT NULL,
    "verification_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "status" "VerificationCheckStatus" NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "details" JSONB,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_documents_invoice_id_key" ON "invoice_documents"("invoice_id");

-- CreateIndex
CREATE INDEX "verification_checks_key_status_idx" ON "verification_checks"("key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "verification_checks_verification_id_key_key" ON "verification_checks"("verification_id", "key");

-- CreateIndex
CREATE INDEX "invoices_organization_id_created_at_idx" ON "invoices"("organization_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_verification_id_fkey" FOREIGN KEY ("verification_id") REFERENCES "invoice_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
