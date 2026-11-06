-- AlterTable
ALTER TABLE "chain_sync_cursor" ADD COLUMN     "lease_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "lease_owner" VARCHAR(80);

-- AlterTable
ALTER TABLE "blockchain_operations" ADD COLUMN     "lease_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "lease_owner" VARCHAR(80);

-- CreateTable
CREATE TABLE "blockchain_rate_limits" (
    "organization_id" UUID NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blockchain_rate_limits_pkey" PRIMARY KEY ("organization_id","window_start")
);

-- CreateTable
CREATE TABLE "blockchain_signer_nonces" (
    "chain_id" INTEGER NOT NULL,
    "address" CHAR(42) NOT NULL,
    "next_nonce" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blockchain_signer_nonces_pkey" PRIMARY KEY ("chain_id","address")
);

-- AddForeignKey
ALTER TABLE "blockchain_rate_limits" ADD CONSTRAINT "blockchain_rate_limits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

