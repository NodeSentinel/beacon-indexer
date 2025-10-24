import { Committee } from '@beacon-indexer/db';

import { BeaconClient } from '@/src/services/consensus/beacon.js';
import { IdealReward, TotalReward } from '@/src/services/consensus/types.js';

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
    // TODO: unit-test this
    const _validatorBalance = BigInt(validatorBalance);
    const roundedBalance = (_validatorBalance / 1000000000n) * 1000000000n;
    return idealRewardsLookup.get(roundedBalance.toString()) || null;
  }

  /**
   * Process a batch of rewards and return formatted data
   *
   * - Calculates clRewards and clMissedRewards for aggregation
   * - Formats rewards string for HourlyValidatorData storage
   * - Returns data ready for storage layer
   *
   * @param rewards - Array of total rewards from beacon chain
   * @param validatorsBalancesMap - Map of validator balances for ideal reward calculation
   * @param idealRewardsLookup - Lookup map for ideal rewards by balance
   * @param epoch - The epoch number for the rewards string format
   * @returns Array of processed reward data ready for storage
   */
  protected processEpochReward(
    rewards: TotalReward[],
    validatorsBalancesMap: Map<string, string>,
    idealRewardsLookup: Map<string, IdealReward>,
    epoch: number,
  ): Array<{
    validatorIndex: number;
    clRewards: bigint;
    clMissedRewards: bigint;
    rewards: string; // Format: 'epoch:head:target:source:inactivity:missedHead:missedTarget:missedSource:missedInactivity'
  }> {
    return rewards.map((validatorInfo) => {
      const balance = validatorsBalancesMap.get(validatorInfo.validator_index) || '0';

      // Process validator reward data
      const head = BigInt(validatorInfo.head || '0');
      const target = BigInt(validatorInfo.target || '0');
      const source = BigInt(validatorInfo.source || '0');
      const inactivity = BigInt(validatorInfo.inactivity || '0');

      // Find ideal rewards for this validator's balance
      const idealReward = this.findIdealRewardsForBalance(balance, idealRewardsLookup);

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

      // Calculate aggregated values for storage
      const clRewards = head + target + source + inactivity;
      const clMissedRewards = missedHead + missedTarget + missedSource + missedInactivity;

      // Format rewards string for HourlyValidatorData storage
      const rewardsString = `${epoch}:${head}:${target}:${source}:${inactivity}:${missedHead}:${missedTarget}:${missedSource}:${missedInactivity}`;

      return {
        validatorIndex: Number(validatorInfo.validator_index),
        clRewards,
        clMissedRewards,
        rewards: rewardsString,
      };
    });
  }

  /**
   * Prepare committee data for storage
   */
  protected prepareCommitteeData(
    committees: Awaited<ReturnType<BeaconClient['getCommittees']>>,
    slotStartIndexing: number,
  ) {
    const newCommittees: Committee[] = [];
    // Map to track committee counts per committee index per slot (for Slot table's committeesCountInSlot)
    const committeesCountInSlot = new Map<number, number[]>();
    // Set to collect unique slots
    const newSlotsSet = new Set<number>();

    committees.forEach((committee) => {
      // Convert slot string to number
      const slot = +committee.slot;

      // Skip committees from slots before our indexing start point
      if (slot < slotStartIndexing) {
        return;
      }

      // Add this slot to our new slots set (automatically handles uniqueness)
      newSlotsSet.add(slot);

      // Initialize committee count array for this slot if it doesn't exist
      if (!committeesCountInSlot.has(slot)) {
        committeesCountInSlot.set(slot, []);
      }

      // Process each validator in this committee
      committee.validators.forEach((validatorIndex, index) => {
        // Create committee record for database insertion
        newCommittees.push({
          slot,
          index: +committee.index,
          aggregationBitsIndex: index,
          validatorIndex: +validatorIndex,
          attestationDelay: null,
        });

        // Count committees per committee index for the Slot table's committeesCountInSlot field
        const committeeCountsInSlot = committeesCountInSlot.get(slot)!;
        committeeCountsInSlot[+committee.index] =
          (committeeCountsInSlot[+committee.index] || 0) + 1;
      });
    });

    // Validate that we have data to process
    if (newSlotsSet.size === 0 || newCommittees.length === 0) {
      throw new Error('No new slots or committees to save');
    }

    // Return processed data for storage
    return {
      newSlots: Array.from(newSlotsSet),
      newCommittees,
      committeesCountInSlot,
    };
  }
}
