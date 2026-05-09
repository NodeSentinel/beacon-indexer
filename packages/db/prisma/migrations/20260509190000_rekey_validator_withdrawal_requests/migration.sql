ALTER TABLE "public"."validator_request_withdrawals"
  ADD COLUMN "request_index" INTEGER,
  ADD COLUMN "source_address" VARCHAR(42);

WITH numbered_requests AS (
  SELECT
    "slot",
    "pub_key",
    ROW_NUMBER() OVER (
      PARTITION BY "slot"
      ORDER BY "pub_key"
    ) - 1 AS "request_index"
  FROM "public"."validator_request_withdrawals"
)
UPDATE "public"."validator_request_withdrawals" target
SET "request_index" = numbered_requests."request_index"
FROM numbered_requests
WHERE target."slot" = numbered_requests."slot"
  AND target."pub_key" = numbered_requests."pub_key";

ALTER TABLE "public"."validator_request_withdrawals"
  ALTER COLUMN "request_index" SET NOT NULL,
  DROP CONSTRAINT "validator_request_withdrawals_pkey",
  ADD CONSTRAINT "validator_request_withdrawals_pkey" PRIMARY KEY ("slot", "request_index");

CREATE INDEX "validator_request_withdrawals_pub_key_slot_idx"
  ON "public"."validator_request_withdrawals"("pub_key", "slot" DESC);
