-- CreateTable
CREATE TABLE "public"."withdrawal_address_claimable_snapshot" (
    "withdrawal_address" VARCHAR(42) NOT NULL,
    "amount_wei" DECIMAL(78,0) NOT NULL,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_address_claimable_snapshot_pkey" PRIMARY KEY ("withdrawal_address")
);
