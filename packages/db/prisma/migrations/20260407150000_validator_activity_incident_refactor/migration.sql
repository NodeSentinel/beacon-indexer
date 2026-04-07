-- Extend validator snapshot state with shared activity and reward cursors.
ALTER TABLE "public"."validators_snapshot_stats"
  DROP COLUMN "is_inactive",
  DROP COLUMN "inactive_since_slot",
  DROP COLUMN "active_since_slot",
  ADD COLUMN "consecutive_missed_attestations" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "current_missed_streak_start_slot" INTEGER,
  ADD COLUMN "last_observed_slot" INTEGER,
  ADD COLUMN "last_attested_slot" INTEGER,
  ADD COLUMN "last_missed_attestation_slot" INTEGER,
  ADD COLUMN "rewards_processed_through_slot" INTEGER,
  ADD COLUMN "missed_consensus_rewards_total" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "missed_sync_rewards_total" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "missed_attestations_rewards_total" BIGINT NOT NULL DEFAULT 0;

-- Move missed-attestation threshold ownership to clusters.
ALTER TABLE "public"."cluster"
  ADD COLUMN "missed_attestation_threshold" INTEGER NOT NULL DEFAULT 3;

-- Store the incident tracker cursor separately from validator snapshot rows.
CREATE TABLE "public"."incident_processor_state" (
    "processor" VARCHAR(64) NOT NULL,
    "last_processed_slot" INTEGER NOT NULL,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_processor_state_pkey" PRIMARY KEY ("processor")
);

-- Record whether an incident's rewards have been finalized by the reward sync.
ALTER TABLE "public"."cluster_incident"
  ADD COLUMN "opened_validator_reward_totals" JSONB,
  ADD COLUMN "closed_validator_reward_totals" JSONB,
  ADD COLUMN "rewards_finalized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rewards_finalized_at" TIMESTAMP;
