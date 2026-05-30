import { describe, expect, it, vi } from 'vitest';

import { EPOCH_REWARDS_FETCH_BATCH_SIZE, EpochController } from './epoch.js';

// This suite verifies epoch-level reward fetching before storage aggregation.
describe('EpochController', () => {
  // This test covers reward fetches that cross one full provider-safe batch. The
  // controller should request complete batches first, then process the final
  // partial batch without depending on a specific production batch-size value.
  it('fetches attestation rewards in configured-size batches', async () => {
    // This value creates exactly one full batch plus one final validator. That
    // shape proves the controller uses the configured batch size and carries the
    // remainder through the same reward pipeline.
    const attestingValidatorIndexes = Array.from(
      { length: EPOCH_REWARDS_FETCH_BATCH_SIZE + 1 },
      (_, i) => i,
    );

    // This epoch storage mock marks rewards as pending and captures the final
    // aggregate write, which should only happen after all batches are processed.
    const epochStorage = {
      getEpochByNumber: vi.fn().mockResolvedValue({ rewardsFetched: false }),
      processEpochRewardsAndAggregate: vi.fn().mockResolvedValue(undefined),
    };

    // This validator storage mock returns a balance for each requested validator
    // so reward processing can calculate missed rewards for every batch.
    const validatorsStorage = {
      getAttestingValidatorIndexes: vi.fn().mockResolvedValue(attestingValidatorIndexes),
      getValidatorsBalances: vi.fn(async (validatorIndexes: number[]) =>
        validatorIndexes.map((id) => ({ id, balance: 32_000_000_000n })),
      ),
    };

    const requestedRewardBatchSizes: number[] = [];

    // This Beacon client mock records reward request sizes and returns one total
    // reward per requested validator plus a single ideal reward entry shared by
    // all batches in the epoch.
    const beaconClient = {
      getAttestationRewards: vi.fn(async (_epoch: number, validatorIndexes: number[]) => {
        requestedRewardBatchSizes.push(validatorIndexes.length);

        return {
          data: {
            ideal_rewards: [
              {
                effective_balance: '32000000000',
                head: '1',
                target: '2',
                source: '3',
                inactivity: '0',
              },
            ],
            total_rewards: validatorIndexes.map((id) => ({
              validator_index: id.toString(),
              head: '1',
              target: '2',
              source: '3',
              inactivity: '0',
            })),
          },
        };
      }),
    };

    // This controller only needs Beacon, epoch, and validator storage for reward
    // fetching; beacon time is not used in this path.
    const controller = new EpochController(
      beaconClient as never,
      epochStorage as never,
      validatorsStorage as never,
      {} as never,
    );

    // This action fetches and aggregates rewards for one epoch.
    await controller.fetchEpochRewards(3_858);

    // This assertion verifies the reward endpoint receives configured-size
    // batches, followed by the remainder batch.
    expect(requestedRewardBatchSizes).toEqual([EPOCH_REWARDS_FETCH_BATCH_SIZE, 1]);

    // This assertion verifies balance lookups use the same batch boundaries as
    // reward fetches, keeping DB and Beacon request sizes aligned.
    expect(validatorsStorage.getValidatorsBalances).toHaveBeenNthCalledWith(
      1,
      attestingValidatorIndexes.slice(0, EPOCH_REWARDS_FETCH_BATCH_SIZE),
    );
    expect(validatorsStorage.getValidatorsBalances).toHaveBeenNthCalledWith(
      2,
      attestingValidatorIndexes.slice(EPOCH_REWARDS_FETCH_BATCH_SIZE),
    );

    // This assertion verifies all batch results are aggregated into one final
    // epoch write rather than marking rewards fetched per partial batch.
    expect(epochStorage.processEpochRewardsAndAggregate).toHaveBeenCalledTimes(1);
    expect(epochStorage.processEpochRewardsAndAggregate).toHaveBeenCalledWith(
      3_858,
      expect.arrayContaining([
        expect.objectContaining({ validatorIndex: 0 }),
        expect.objectContaining({ validatorIndex: EPOCH_REWARDS_FETCH_BATCH_SIZE }),
      ]),
    );
  });
});
