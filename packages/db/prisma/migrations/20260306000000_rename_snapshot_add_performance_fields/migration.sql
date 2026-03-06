-- Rename table from validators_status_summary to validators_snapshot_stats
ALTER TABLE "validators_status_summary" RENAME TO "validators_snapshot_stats";

-- Drop old performance column (replaced by per-timeframe fields)
ALTER TABLE "validators_snapshot_stats" DROP COLUMN "performance";

-- Add new state fields
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "is_inactive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "consecutive_missed_attestations" INTEGER NOT NULL DEFAULT 0;

-- Add effective_balance (non-nullable, default 0 for existing rows)
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "effective_balance" BIGINT NOT NULL DEFAULT 0;

-- Performance per timeframe (ratio 0.0000 - 1.0000)
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "performance_1h" DECIMAL(5, 4);
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "performance_1d" DECIMAL(5, 4);
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "performance_1w" DECIMAL(5, 4);
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "performance_1m" DECIMAL(5, 4);

-- APY per timeframe
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "apy_1h" DECIMAL(5, 2);
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "apy_1d" DECIMAL(5, 2);
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "apy_w" DECIMAL(5, 2);
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "apy_1m" DECIMAL(5, 2);

-- Consensus rewards per timeframe
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "consensus_reward_1h" BIGINT;
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "consensus_reward_1d" BIGINT;
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "consensus_reward_1w" BIGINT;
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "consensus_reward_1m" BIGINT;

-- Missed rewards per timeframe
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "missed_reward_1h" BIGINT;
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "missed_reward_1d" BIGINT;
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "missed_reward_1w" BIGINT;
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "missed_reward_1m" BIGINT;

-- Execution rewards per timeframe
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "execution_reward_1h" DECIMAL(78, 0);
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "execution_reward_1d" DECIMAL(78, 0);
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "execution_reward_1w" DECIMAL(78, 0);
ALTER TABLE "validators_snapshot_stats" ADD COLUMN "execution_reward_1m" DECIMAL(78, 0);
