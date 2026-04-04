-- CreateEnum
CREATE TYPE "public"."ValidatorExitEvent" AS ENUM ('voluntary', 'slashed');

-- CreateEnum
CREATE TYPE "public"."ClusterVisibility" AS ENUM ('private', 'shared');

-- CreateTable
CREATE TABLE "public"."validator" (
    "id" INTEGER NOT NULL,
    "status" INTEGER,
    "balance" BIGINT NOT NULL,
    "effective_balance" BIGINT,
    "activation_epoch" INTEGER,
    "pubkey" VARCHAR(98),
    "withdrawal_address" VARCHAR(42),

    CONSTRAINT "validator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."validator_withdrawals" (
    "slot" INTEGER NOT NULL,
    "validator_index" VARCHAR(98) NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "validator_withdrawals_pkey" PRIMARY KEY ("slot","validator_index")
);

-- CreateTable
CREATE TABLE "public"."validator_deposits" (
    "slot" INTEGER NOT NULL,
    "pubkey" VARCHAR(98) NOT NULL,
    "withdrawal_credentials" VARCHAR(66) NOT NULL,
    "amount" BIGINT NOT NULL,
    "index" INTEGER,

    CONSTRAINT "validator_deposits_pkey" PRIMARY KEY ("slot","pubkey")
);

-- CreateTable
CREATE TABLE "public"."validator_voluntary_exits" (
    "index" INTEGER NOT NULL,
    "epoch" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "event" "public"."ValidatorExitEvent" NOT NULL,

    CONSTRAINT "validator_voluntary_exits_pkey" PRIMARY KEY ("index")
);

-- CreateTable
CREATE TABLE "public"."validator_request_withdrawals" (
    "slot" INTEGER NOT NULL,
    "pub_key" VARCHAR(98) NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "validator_request_withdrawals_pkey" PRIMARY KEY ("slot","pub_key")
);

-- CreateTable
CREATE TABLE "public"."validator_request_consolidations" (
    "slot" INTEGER NOT NULL,
    "source_pubkey" VARCHAR(98) NOT NULL,
    "target_pubkey" VARCHAR(98) NOT NULL,

    CONSTRAINT "validator_request_consolidations_pkey" PRIMARY KEY ("slot","source_pubkey","target_pubkey")
);

-- CreateTable
CREATE TABLE "public"."validator_sync_rewards" (
    "slot" INTEGER NOT NULL,
    "validator_index" INTEGER NOT NULL,
    "sync_committee" BIGINT NOT NULL,

    CONSTRAINT "validator_sync_rewards_pkey" PRIMARY KEY ("slot","validator_index")
);

-- CreateTable
CREATE TABLE "public"."epoch" (
    "epoch" INTEGER NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "all_slots_processed" BOOLEAN NOT NULL DEFAULT false,
    "committees_fetched" BOOLEAN NOT NULL DEFAULT false,
    "sync_committees_fetched" BOOLEAN NOT NULL DEFAULT false,
    "validator_proposer_duties_fetched" BOOLEAN NOT NULL DEFAULT false,
    "validators_balances_fetched" BOOLEAN NOT NULL DEFAULT false,
    "validators_activation_fetched" BOOLEAN NOT NULL DEFAULT false,
    "rewards_fetched" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "epoch_pkey" PRIMARY KEY ("epoch")
);

-- CreateTable
CREATE TABLE "public"."indexer_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "chain" VARCHAR(20) NOT NULL,
    "lookback_slot" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexer_config_pkey" PRIMARY KEY ("id")
);
-- CreateTable (Partitioned by slot range)
-- Committee table is partitioned by slot number to improve query performance
-- Partitions are created dynamically per hour when processing epochs
CREATE TABLE "public"."committee" (
    "slot" INTEGER NOT NULL,
    "index" SMALLINT NOT NULL,
    "validator_index" INTEGER NOT NULL,
    "aggregation_bits_index" SMALLINT NOT NULL,
    "attestation_delay" SMALLINT,

    CONSTRAINT "committee_pkey" PRIMARY KEY ("slot","index","aggregation_bits_index")
) PARTITION BY RANGE ("slot");

-- CreateTable
CREATE TABLE "public"."slot" (
    "slot" INTEGER NOT NULL,
    "proposer_index" INTEGER,
    "block_number" INTEGER,
    "consensus_reward" BIGINT,
    "execution_reward" NUMERIC(78, 0),
    "fee_recipient_address" VARCHAR(42),
    "committees_count_in_slot" JSONB,
    "attestations_fetched" BOOLEAN NOT NULL DEFAULT false,
    "sync_rewards_fetched" BOOLEAN NOT NULL DEFAULT false,
    "consensus_rewards_fetched" BOOLEAN NOT NULL DEFAULT false,
    "execution_rewards_fetched" BOOLEAN NOT NULL DEFAULT false,
    "proposer_slashings_fetched" BOOLEAN NOT NULL DEFAULT false,
    "attester_slashings_fetched" BOOLEAN NOT NULL DEFAULT false,
    "deposits_fetched" BOOLEAN NOT NULL DEFAULT false,
    "voluntary_exits_fetched" BOOLEAN NOT NULL DEFAULT false,
    "ep_withdrawals_fetched" BOOLEAN NOT NULL DEFAULT false,
    "er_deposits_fetched" BOOLEAN NOT NULL DEFAULT false,
    "er_withdrawals_fetched" BOOLEAN NOT NULL DEFAULT false,
    "er_consolidations_fetched" BOOLEAN NOT NULL DEFAULT false,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "slot_pkey" PRIMARY KEY ("slot")
);

-- CreateTable
CREATE TABLE "public"."sync_committee" (
    "from_epoch" INTEGER NOT NULL,
    "to_epoch" INTEGER NOT NULL,
    "validators" JSONB NOT NULL,
    "validator_aggregates" JSONB NOT NULL,

    CONSTRAINT "sync_committee_pkey" PRIMARY KEY ("from_epoch","to_epoch")
);

-- CreateTable (Partitioned by epoch range)
-- Epoch rewards table is partitioned by epoch number to improve query performance
-- Partitions are created dynamically per hour when processing epochs
CREATE TABLE "public"."epoch_rewards" (
    "epoch" INTEGER NOT NULL,
    "validator_index" INTEGER NOT NULL,
    "head" BIGINT NOT NULL,
    "target" BIGINT NOT NULL,
    "source" BIGINT NOT NULL,
    "inactivity" BIGINT NOT NULL,
    "missed_head" BIGINT NOT NULL,
    "missed_target" BIGINT NOT NULL,
    "missed_source" BIGINT NOT NULL,
    "missed_inactivity" BIGINT NOT NULL,

    CONSTRAINT "epoch_rewards_pkey" PRIMARY KEY ("epoch","validator_index")
) PARTITION BY RANGE ("epoch");

-- CreateTable (Partitioned by timestamp range)
-- ValidatorHourlyArchive stores per-validator aggregated data for each UTC hour.
-- This table archives detailed slot/epoch data in compact JSON format, enabling
-- efficient historical queries while allowing raw tables (committee, epoch_rewards) to be pruned.
-- Partitions are created dynamically per hour by the hourly archive service.
-- Partition naming: validator_hourly_archive_YYYYMMDDHH
CREATE TABLE "public"."validator_hourly_archive" (
    "timestamp" TIMESTAMP NOT NULL,
    "validator_index" INTEGER NOT NULL,
    "data_by_slot" JSONB NOT NULL,
    "data_by_epoch" JSONB NOT NULL,
    "attestation_count" SMALLINT NOT NULL DEFAULT 0,
    "missed_attestation_count" SMALLINT,
    "sync_reward_total" BIGINT NOT NULL DEFAULT 0,
    "sync_missed_reward_total" BIGINT NOT NULL DEFAULT 0,
    "exec_reward_total" NUMERIC(78, 0),
    "block_reward_total" BIGINT,
    "cl_reward_total" BIGINT NOT NULL DEFAULT 0,
    "cl_missed_reward_total" BIGINT NOT NULL DEFAULT 0,
    "avg_attestation_delay" REAL,
    "attestation_efficiency" REAL,

    CONSTRAINT "validator_hourly_archive_pkey" PRIMARY KEY ("timestamp","validator_index")
) PARTITION BY RANGE ("timestamp");

-- CreateTable (Partitioned by timestamp range)
-- ValidatorDailyArchive stores per-validator aggregated data for each UTC day.
-- Aggregated from hourly archives (24 hourly records → 1 daily record).
-- Partitions are created dynamically by the daily archive service.
-- Partition naming: validator_daily_archive_YYYYMMDD
CREATE TABLE "public"."validator_daily_archive" (
    "timestamp" TIMESTAMP NOT NULL,
    "validator_index" INTEGER NOT NULL,
    "data_by_slot" JSONB,
    "data_by_epoch" JSONB,
    "attestation_count" SMALLINT NOT NULL DEFAULT 0,
    "missed_attestation_count" SMALLINT,
    "sync_reward_total" BIGINT NOT NULL DEFAULT 0,
    "sync_missed_reward_total" BIGINT NOT NULL DEFAULT 0,
    "exec_reward_total" NUMERIC(78, 0),
    "block_reward_total" BIGINT,
    "cl_reward_total" BIGINT NOT NULL DEFAULT 0,
    "cl_missed_reward_total" BIGINT NOT NULL DEFAULT 0,
    "avg_attestation_delay" REAL,
    "attestation_efficiency" REAL,

    CONSTRAINT "validator_daily_archive_pkey" PRIMARY KEY ("timestamp","validator_index")
) PARTITION BY RANGE ("timestamp");

-- CreateTable (Partitioned by timestamp range)
-- ValidatorMonthlyArchive stores per-validator aggregated data for each UTC month.
-- Aggregated from daily archives (~28-31 daily records → 1 monthly record).
-- Partitions are created dynamically by the monthly archive service.
-- Partition naming: validator_monthly_archive_YYYYMM
CREATE TABLE "public"."validator_monthly_archive" (
    "timestamp" TIMESTAMP NOT NULL,
    "validator_index" INTEGER NOT NULL,
    "data_by_slot" JSONB NOT NULL,
    "data_by_epoch" JSONB NOT NULL,
    "attestation_count" SMALLINT NOT NULL DEFAULT 0,
    "missed_attestation_count" SMALLINT,
    "sync_reward_total" BIGINT NOT NULL DEFAULT 0,
    "sync_missed_reward_total" BIGINT NOT NULL DEFAULT 0,
    "exec_reward_total" NUMERIC(78, 0),
    "block_reward_total" BIGINT,
    "cl_reward_total" BIGINT NOT NULL DEFAULT 0,
    "cl_missed_reward_total" BIGINT NOT NULL DEFAULT 0,
    "avg_attestation_delay" REAL,
    "attestation_efficiency" REAL,

    CONSTRAINT "validator_monthly_archive_pkey" PRIMARY KEY ("timestamp","validator_index")
) PARTITION BY RANGE ("timestamp");

-- CreateTable
-- Archive master table: single-row table tracking last archived timestamps for each aggregation level.
-- This serves as the source of truth for what has been archived, avoiding expensive queries on validator_hourly_archive.
CREATE TABLE "public"."archive" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_hour" TIMESTAMP,
    "last_day" TIMESTAMP,
    "last_month" TIMESTAMP,

    CONSTRAINT "archive_pkey" PRIMARY KEY ("id")
);

-- Insert initial archive row (single row, id=1)
INSERT INTO "public"."archive" ("id", "last_hour", "last_day", "last_month")
VALUES (1, NULL, NULL, NULL);

-- CreateTable
CREATE TABLE "public"."validators_snapshot_stats" (
    "validator_index" INTEGER NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "attestations_total" INTEGER NOT NULL,
    "attestations_missed" INTEGER NOT NULL,
    "attestation_count_h" SMALLINT NOT NULL DEFAULT 0,
    "missed_attestation_count_h" SMALLINT NOT NULL DEFAULT 0,
    "attestation_count_d" SMALLINT NOT NULL DEFAULT 0,
    "missed_attestation_count_d" SMALLINT NOT NULL DEFAULT 0,
    "attestation_count_w" SMALLINT NOT NULL DEFAULT 0,
    "missed_attestation_count_w" SMALLINT NOT NULL DEFAULT 0,
    "attestation_count_m" SMALLINT NOT NULL DEFAULT 0,
    "missed_attestation_count_m" SMALLINT NOT NULL DEFAULT 0,
    "missed_attestation_slots_h" INTEGER[] NOT NULL DEFAULT '{}',
    "is_inactive" BOOLEAN NOT NULL DEFAULT false,
    "effective_balance" BIGINT NOT NULL DEFAULT 0,
    "performance_h" DECIMAL,
    "performance_d" DECIMAL,
    "performance_w" DECIMAL,
    "performance_m" DECIMAL,
    "apy_h" DECIMAL,
    "apy_d" DECIMAL,
    "apy_w" DECIMAL,
    "apy_m" DECIMAL,
    "consensus_reward_h" BIGINT,
    "consensus_reward_d" BIGINT,
    "consensus_reward_w" BIGINT,
    "consensus_reward_m" BIGINT,
    "missed_reward_h" BIGINT,
    "missed_reward_d" BIGINT,
    "missed_reward_w" BIGINT,
    "missed_reward_m" BIGINT,
    "execution_reward_h" DECIMAL(78, 0),
    "execution_reward_d" DECIMAL(78, 0),
    "execution_reward_w" DECIMAL(78, 0),
    "execution_reward_m" DECIMAL(78, 0),
    "attestation_efficiency_d" REAL,
    "attestation_efficiency_w" REAL,
    "attestation_efficiency_m" REAL,
    "avg_attestation_delay_d" REAL,
    "avg_attestation_delay_w" REAL,
    "avg_attestation_delay_m" REAL,
    "beacon_status" INTEGER,
    "balance" BIGINT NOT NULL,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validators_snapshot_stats_pkey" PRIMARY KEY ("validator_index")
);

-- CreateTable
CREATE TABLE "public"."chain_epoch_stats" (
    "epoch" INTEGER NOT NULL,
    "total_active_validators" INTEGER NOT NULL,
    "total_staked" BIGINT NOT NULL,
    "validators_entering" INTEGER NOT NULL,
    "entering_staked" BIGINT NOT NULL DEFAULT 0,
    "validators_exiting" INTEGER NOT NULL,
    "validators_consolidating" INTEGER NOT NULL,

    CONSTRAINT "chain_epoch_stats_pkey" PRIMARY KEY ("epoch")
);

-- CreateTable
CREATE TABLE "public"."user" (
    "id" TEXT NOT NULL,
    "telegram_id" BIGINT,
    "username" TEXT NOT NULL,
    "message_id" BIGINT,
    "last_claimed" TIMESTAMP(3),
    "has_blocked_bot" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_queue" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "notification_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."fee_reward_address" (
    "address" TEXT NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "fee_reward_address_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "public"."cluster" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "visibility" "public"."ClusterVisibility" NOT NULL DEFAULT 'private',
    "fee_recipient_address" VARCHAR(42),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cluster_validator" (
    "cluster_id" TEXT NOT NULL,
    "validator_index" INTEGER NOT NULL,

    CONSTRAINT "cluster_validator_pkey" PRIMARY KEY ("cluster_id","validator_index")
);

-- CreateTable
CREATE TABLE "public"."_user_to_fee_reward_address" (
    "address" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "_user_to_fee_reward_address_pkey" PRIMARY KEY ("address","user_id")
);

-- CreateIndex
CREATE INDEX "validator_status_idx" ON "public"."validator"("status");

-- CreateIndex
CREATE INDEX "validator_pubkey_idx" ON "public"."validator"("pubkey");

-- CreateIndex
CREATE INDEX "committee_validator_index_slot_attestation_delay_idx" ON "public"."committee"("validator_index", "slot" DESC, "attestation_delay");

-- CreateIndex
CREATE INDEX "slot_slot_processed_idx" ON "public"."slot"("slot", "processed");

-- CreateIndex
CREATE INDEX "slot_proposer_index_slot_idx" ON "public"."slot"("proposer_index", "slot" DESC);

-- CreateIndex (for validator_hourly_archive - query validator history newest-first)
CREATE INDEX "validator_hourly_archive_validator_timestamp_idx" ON "public"."validator_hourly_archive"("validator_index", "timestamp" DESC);

-- CreateIndex (for validator_hourly_archive - query all validators for a specific hour)
CREATE INDEX "validator_hourly_archive_timestamp_idx" ON "public"."validator_hourly_archive"("timestamp");

-- CreateIndex (for validator_daily_archive)
CREATE INDEX "validator_daily_archive_validator_timestamp_idx" ON "public"."validator_daily_archive"("validator_index", "timestamp" DESC);
CREATE INDEX "validator_daily_archive_timestamp_idx" ON "public"."validator_daily_archive"("timestamp");

-- CreateIndex (for validator_monthly_archive)
CREATE INDEX "validator_monthly_archive_validator_timestamp_idx" ON "public"."validator_monthly_archive"("validator_index", "timestamp" DESC);
CREATE INDEX "validator_monthly_archive_timestamp_idx" ON "public"."validator_monthly_archive"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "user_telegram_id_key" ON "public"."user"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "public"."user"("username");

-- CreateIndex
CREATE INDEX "cluster_validator_validator_index_idx" ON "public"."cluster_validator"("validator_index");

-- CreateIndex
CREATE INDEX "notification_queue_user_id_delivered_idx" ON "public"."notification_queue"("user_id", "delivered");

-- CreateIndex
CREATE INDEX "_user_to_fee_reward_address_user_id_idx" ON "public"."_user_to_fee_reward_address"("user_id");

-- AddForeignKey
ALTER TABLE "public"."cluster" ADD CONSTRAINT "cluster_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cluster_validator" ADD CONSTRAINT "cluster_validator_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "public"."cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cluster_validator" ADD CONSTRAINT "cluster_validator_validator_index_fkey" FOREIGN KEY ("validator_index") REFERENCES "public"."validator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_queue" ADD CONSTRAINT "notification_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_user_to_fee_reward_address" ADD CONSTRAINT "_user_to_fee_reward_address_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_user_to_fee_reward_address" ADD CONSTRAINT "_user_to_fee_reward_address_address_fkey" FOREIGN KEY ("address") REFERENCES "public"."fee_reward_address"("address") ON DELETE CASCADE ON UPDATE CASCADE;
