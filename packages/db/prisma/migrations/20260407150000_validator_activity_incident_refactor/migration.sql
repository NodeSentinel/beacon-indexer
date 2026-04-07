-- Extend validator snapshot state with shared activity and reward cursors.
ALTER TABLE "public"."validators_snapshot_stats"
  ADD COLUMN "consecutive_missed_attestations" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_observed_slot" INTEGER,
  ADD COLUMN "last_attested_slot" INTEGER,
  ADD COLUMN "last_missed_attestation_slot" INTEGER,
  ADD COLUMN "rewards_processed_through_slot" INTEGER;

-- Store the incident tracker cursor separately from validator snapshot rows.
CREATE TABLE "public"."incident_processor_state" (
    "processor" VARCHAR(64) NOT NULL,
    "last_processed_slot" INTEGER NOT NULL,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_processor_state_pkey" PRIMARY KEY ("processor")
);

-- Record whether an incident's rewards have been finalized by the reward sync.
ALTER TABLE "public"."cluster_incident"
  ADD COLUMN "rewards_finalized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rewards_finalized_at" TIMESTAMP;
