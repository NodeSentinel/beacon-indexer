import { IdealReward, TotalReward, ProcessedReward } from '@/src/services/consensus/types.js';

export abstract class EpochControllerHelpers {
  /**
   * Calculate which epochs need to be created based on unprocessed count
   */
  protected getEpochsToCreate(
    unprocessedCount: number,
    lastEpoch: number | null,
    slotStartIndexing: number,
    maxUnprocessedEpochs: number = 5,
  ): number[] {
    // If we already have 5 or more unprocessed epochs, don't create new ones
    if (unprocessedCount >= maxUnprocessedEpochs) {
      return [];
    }

    // Calculate how many epochs we need to create
    const epochsNeeded = maxUnprocessedEpochs - unprocessedCount;

    // Get the starting epoch for creation using slotStartIndexing
    const startEpoch = lastEpoch ? lastEpoch + 1 : Math.floor(slotStartIndexing / 32);

    // Create array of epochs to create
    const epochsToCreate = [];
    for (let i = 0; i < epochsNeeded; i++) {
      epochsToCreate.push(startEpoch + i);
    }

    return epochsToCreate;
  }

  /**
   * Create a lookup map for O(1) access to ideal rewards
   */
  protected createIdealRewardsLookup(idealRewards: IdealReward[]): Map<string, IdealReward> {
    const lookup = new Map<string, IdealReward>();

    for (const reward of idealRewards) {
      const effectiveBalance = reward.effective_balance;
      lookup.set(effectiveBalance, reward);
    }

    return lookup;
  }

  /**
   * Find the appropriate ideal rewards based on effective balance - O(1) lookup
   */
  protected findIdealRewardsForBalance(
    validatorBalance: string,
    idealRewardsLookup: Map<string, IdealReward>,
  ): IdealReward | null {
    const _validatorBalance = BigInt(validatorBalance);
    const roundedBalance = (_validatorBalance / 1000000000n) * 1000000000n;
    return idealRewardsLookup.get(roundedBalance.toString()) || null;
  }

  /**
   * Process a batch of rewards and return formatted data
   */
  protected processRewardBatch(
    rewards: TotalReward[],
    validatorsBalancesMap: Map<string, string>,
    idealRewardsLookup: Map<string, IdealReward>,
    date: string,
    hour: number,
  ): ProcessedReward[] {
    return rewards.map((validatorInfo) => {
      const balance = validatorsBalancesMap.get(validatorInfo.validator_index) || '0';
      return this.formatValidatorReward(validatorInfo, balance, idealRewardsLookup, date, hour);
    });
  }

  /**
   * Format validator reward data
   */
  protected formatValidatorReward(
    validatorInfo: TotalReward,
    validatorBalance: string,
    idealRewardsLookup: Map<string, IdealReward>,
    date: string,
    hour: number,
  ): ProcessedReward {
    if (validatorBalance === '0') {
      return {
        validatorIndex: Number(validatorInfo.validator_index),
        date,
        hour,
        head: '0',
        target: '0',
        source: '0',
        inactivity: '0',
        missedHead: '0',
        missedTarget: '0',
        missedSource: '0',
        missedInactivity: '0',
      };
    }

    const head = BigInt(validatorInfo.head || '0');
    const target = BigInt(validatorInfo.target || '0');
    const source = BigInt(validatorInfo.source || '0');
    const inactivity = BigInt(validatorInfo.inactivity || '0');

    // Find ideal rewards for this validator's balance
    const idealReward = this.findIdealRewardsForBalance(validatorBalance, idealRewardsLookup);

    let missedHead = 0n;
    let missedTarget = 0n;
    let missedSource = 0n;
    let missedInactivity = 0n;

    if (idealReward) {
      // Calculate missed rewards (ideal - received)
      missedHead = BigInt(idealReward.head || '0') - head;
      missedTarget = BigInt(idealReward.target || '0') - target;
      missedSource = BigInt(idealReward.source || '0') - source;
      missedInactivity = BigInt(idealReward.inactivity || '0') - inactivity;
    }

    return {
      validatorIndex: Number(validatorInfo.validator_index),
      date,
      hour,
      head: head.toString(),
      target: target.toString(),
      source: source.toString(),
      inactivity: inactivity.toString(),
      missedHead: missedHead.toString(),
      missedTarget: missedTarget.toString(),
      missedSource: missedSource.toString(),
      missedInactivity: missedInactivity.toString(),
    };
  }
}
