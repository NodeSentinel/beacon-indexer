-- Add performance fields (1h, 1d, 1w, 1m)
ALTER TABLE "validators_status_summary" ADD COLUMN "performance_1h" DECIMAL(5,4);
ALTER TABLE "validators_status_summary" ADD COLUMN "performance_1d" DECIMAL(5,4);
ALTER TABLE "validators_status_summary" ADD COLUMN "performance_1w" DECIMAL(5,4);
ALTER TABLE "validators_status_summary" ADD COLUMN "performance_1m" DECIMAL(5,4);

-- Add APY fields (1h, 1d, 1w, 1m)
ALTER TABLE "validators_status_summary" ADD COLUMN "apy_1h" DECIMAL(5,2);
ALTER TABLE "validators_status_summary" ADD COLUMN "apy_1d" DECIMAL(5,2);
ALTER TABLE "validators_status_summary" ADD COLUMN "apy_1w" DECIMAL(5,2);
ALTER TABLE "validators_status_summary" ADD COLUMN "apy_1m" DECIMAL(5,2);

-- Add consensus reward fields (1h, 1d, 1w, 1m)
ALTER TABLE "validators_status_summary" ADD COLUMN "consensus_reward_1h" BIGINT;
ALTER TABLE "validators_status_summary" ADD COLUMN "consensus_reward_1d" BIGINT;
ALTER TABLE "validators_status_summary" ADD COLUMN "consensus_reward_1w" BIGINT;
ALTER TABLE "validators_status_summary" ADD COLUMN "consensus_reward_1m" BIGINT;

-- Add missed reward fields (1h, 1d, 1w, 1m)
ALTER TABLE "validators_status_summary" ADD COLUMN "missed_reward_1h" BIGINT;
ALTER TABLE "validators_status_summary" ADD COLUMN "missed_reward_1d" BIGINT;
ALTER TABLE "validators_status_summary" ADD COLUMN "missed_reward_1w" BIGINT;
ALTER TABLE "validators_status_summary" ADD COLUMN "missed_reward_1m" BIGINT;

-- Add execution reward fields (1h, 1d, 1w, 1m)
ALTER TABLE "validators_status_summary" ADD COLUMN "execution_reward_1h" DECIMAL(78,0);
ALTER TABLE "validators_status_summary" ADD COLUMN "execution_reward_1d" DECIMAL(78,0);
ALTER TABLE "validators_status_summary" ADD COLUMN "execution_reward_1w" DECIMAL(78,0);
ALTER TABLE "validators_status_summary" ADD COLUMN "execution_reward_1m" DECIMAL(78,0);
