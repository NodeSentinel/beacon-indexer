-- Reorder epoch_rewards primary key for validator-batched archive reads.
ALTER TABLE "epoch_rewards" DROP CONSTRAINT "epoch_rewards_pkey";
ALTER TABLE "epoch_rewards"
ADD CONSTRAINT "epoch_rewards_pkey" PRIMARY KEY ("validator_index", "epoch");
