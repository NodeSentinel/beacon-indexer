BEGIN;

-- Abort before rewriting data unless every stored request resolves to exactly one validator.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."validator_request_withdrawals" wr
    LEFT JOIN "public"."validator" v ON v."pubkey" = wr."pub_key"
    GROUP BY wr."slot", wr."request_index"
    HAVING COUNT(v."id") <> 1
  ) THEN
    RAISE EXCEPTION
      'Cannot compact validator_request_withdrawals: every pubkey must resolve to exactly one validator';
  END IF;
END
$$;

-- Guard the integer conversion against malformed or out-of-range historical validator indexes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."validator_withdrawals"
    WHERE CASE
      WHEN "validator_index" ~ '^[0-9]+$'
        THEN "validator_index"::numeric > 2147483647
      ELSE TRUE
    END
  ) THEN
    RAISE EXCEPTION
      'Cannot compact validator_withdrawals: validator_index contains invalid integer values';
  END IF;
END
$$;

DROP INDEX "public"."validator_withdrawals_validator_index_slot_idx";

ALTER TABLE "public"."validator_withdrawals"
  ALTER COLUMN "validator_index" TYPE INTEGER
  USING "validator_index"::integer;

CREATE INDEX "validator_withdrawals_validator_index_slot_idx"
  ON "public"."validator_withdrawals"("validator_index", "slot");

-- Resolve the protocol pubkey while PostgreSQL rewrites the request table into its compact shape.
CREATE FUNCTION "public"."resolve_withdrawal_request_validator_index"("request_pubkey" VARCHAR)
RETURNS INTEGER
LANGUAGE SQL
STABLE
STRICT
AS $$
  SELECT "id"
  FROM "public"."validator"
  WHERE "pubkey" = "request_pubkey"
$$;

DROP INDEX "public"."validator_request_withdrawals_pub_key_slot_idx";

ALTER TABLE "public"."validator_request_withdrawals"
  RENAME COLUMN "pub_key" TO "validator_index";

ALTER TABLE "public"."validator_request_withdrawals"
  ALTER COLUMN "validator_index" TYPE INTEGER
  USING "public"."resolve_withdrawal_request_validator_index"("validator_index");

DROP FUNCTION "public"."resolve_withdrawal_request_validator_index"(VARCHAR);

CREATE INDEX "validator_request_withdrawals_validator_index_slot_idx"
  ON "public"."validator_request_withdrawals"("validator_index", "slot" DESC);

COMMIT;
