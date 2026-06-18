DROP INDEX IF EXISTS "public"."committee_validator_index_slot_attestation_delay_idx";

CREATE INDEX "committee_validator_index_slot_idx"
  ON "public"."committee"("validator_index", "slot" DESC);
