ALTER TABLE "public"."validator_request_consolidations"
  ADD COLUMN "request_index" INTEGER,
  ADD COLUMN "source_address" VARCHAR(42);

WITH numbered_consolidations AS (
  SELECT
    "slot",
    "source_pubkey",
    "target_pubkey",
    ROW_NUMBER() OVER (
      PARTITION BY "slot"
      ORDER BY "source_pubkey", "target_pubkey"
    ) - 1 AS "backfilled_request_index"
  FROM "public"."validator_request_consolidations"
)
UPDATE "public"."validator_request_consolidations" target
SET "request_index" = numbered_consolidations."backfilled_request_index"::integer
FROM numbered_consolidations
WHERE target."slot" = numbered_consolidations."slot"
  AND target."source_pubkey" = numbered_consolidations."source_pubkey"
  AND target."target_pubkey" = numbered_consolidations."target_pubkey"
  AND target."request_index" IS NULL;

ALTER TABLE "public"."validator_request_consolidations"
  ALTER COLUMN "request_index" SET NOT NULL,
  DROP CONSTRAINT "validator_request_consolidations_pkey",
  ADD CONSTRAINT "validator_request_consolidations_pkey" PRIMARY KEY ("slot", "request_index");

CREATE INDEX "validator_request_consolidations_source_pubkey_slot_idx"
  ON "public"."validator_request_consolidations"("source_pubkey", "slot" DESC);
