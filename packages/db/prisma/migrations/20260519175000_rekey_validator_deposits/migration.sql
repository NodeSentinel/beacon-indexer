ALTER TABLE "public"."validator_deposits"
  ADD COLUMN "source" CHAR(1);

UPDATE "public"."validator_deposits"
SET "source" = CASE
  WHEN "index" IS NULL THEN 'd'
  ELSE 'e'
END;

WITH numbered_deposits AS (
  SELECT
    "slot",
    "pubkey",
    ROW_NUMBER() OVER (
      PARTITION BY "slot"
      ORDER BY "pubkey", "withdrawal_credentials", "amount"
    ) - 1 AS "backfilled_index"
  FROM "public"."validator_deposits"
  WHERE "index" IS NULL
)
UPDATE "public"."validator_deposits" target
SET "index" = numbered_deposits."backfilled_index"::integer
FROM numbered_deposits
WHERE target."slot" = numbered_deposits."slot"
  AND target."pubkey" = numbered_deposits."pubkey"
  AND target."index" IS NULL;

ALTER TABLE "public"."validator_deposits"
  ALTER COLUMN "source" SET NOT NULL,
  ALTER COLUMN "index" SET NOT NULL,
  DROP CONSTRAINT "validator_deposits_pkey",
  ADD CONSTRAINT "validator_deposits_source_check" CHECK ("source" IN ('d', 'e')),
  ADD CONSTRAINT "validator_deposits_pkey" PRIMARY KEY ("slot", "source", "index");

CREATE INDEX "validator_deposits_pubkey_slot_idx"
  ON "public"."validator_deposits"("pubkey", "slot" DESC);
