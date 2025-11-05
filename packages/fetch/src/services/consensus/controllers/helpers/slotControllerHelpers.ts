import type {
  SyncCommitteeRewards,
  BlockRewards,
  Attestation,
} from '@/src/services/consensus/types.js';
import {
  convertVariableBitsToString,
  convertFixedBitsToString,
  convertHexStringToByteArray,
} from '@/src/services/consensus/utils/bitlist.js';

/**
 * Committee update interface for attestation processing
 */
interface CommitteeUpdate {
  slot: number;
  index: number;
  aggregationBitsIndex: number;
  attestationDelay: number;
  // validatorIndex is not included here as it matches the old implementation
  // It can be calculated later if needed
}

/**
 * Sync reward data item interface
 */
interface SyncRewardDataItem {
  reward: string | number;
  validator_index?: string;
}

/**
 * Committee data interface for formatting
 */
interface CommitteeDataItem {
  slot: number;
  index: number;
  aggregationBitsIndex: number;
  attestationDelay: number;
}

/**
 * SlotControllerHelpers - Helper methods for slot processing
 *
 * This class contains helper methods that support the business logic
 * in SlotController. These methods handle complex calculations,
 * data transformations, and utility functions.
 */
export class SlotControllerHelpers {
  /**
   * Calculate the validator index from committee position
   */
  protected calculateValidatorIndex(
    slot: number,
    committeeIndex: number,
    committeeBit: number,
    slotCommitteesValidatorsAmounts: Record<number, number[]>,
  ): number | null {
    const committeesInSlot = slotCommitteesValidatorsAmounts[slot];
    if (!committeesInSlot || !committeesInSlot[committeeIndex]) {
      return null;
    }

    const validatorsInCommittee = committeesInSlot[committeeIndex];
    if (committeeBit >= validatorsInCommittee) {
      return null;
    }

    // Calculate the starting validator index for this committee
    let startingIndex = 0;
    for (let i = 0; i < committeeIndex; i++) {
      startingIndex += committeesInSlot[i] || 0;
    }

    return startingIndex + committeeBit;
  }

  /**
   * Process a single attestation and return updates
   */
  protected processAttestation(
    slotNumber: number,
    attestation: Attestation,
    slotCommitteesValidatorsAmounts: Record<number, number[]>,
  ): CommitteeUpdate[] {
    const slotFromAttestations = Number(attestation.data.slot);

    // aggregation_bits come in a hexadecimal format. we convert it to a binary string.
    // each bit represents if the validator on a committee attested or not.
    // First bit represents the first validator in the committee.
    const aggregationBits = convertVariableBitsToString(
      convertHexStringToByteArray(attestation.aggregation_bits),
    );

    // committee_bits also comes in a hexadecimal format. we convert it to a binary string.
    // each bit represents if the bits bring data for a committee or not.
    const committeeBits = convertFixedBitsToString(
      convertHexStringToByteArray(attestation.committee_bits),
    );

    // we need to know how many validators are in the committee for the slot.
    // so we can extract the correct bits from the aggregation_bits.
    const slotCommitteeValidatorsAmount = slotCommitteesValidatorsAmounts[slotFromAttestations];
    if (!slotCommitteeValidatorsAmount) {
      throw new Error(`No validator count found for slot ${slotFromAttestations}`);
    }

    const attestationsWithDelays: CommitteeUpdate[] = [];

    // Process each committee
    // Note: aggregation_bits only contains bits from committees that participate
    // (those with '1' in committee_bits). We iterate through all committee bits,
    // but only advance aggregationBitsOffset when we process a participating committee.
    let aggregationBitsOffset = 0;
    for (let committeeBit = 0; committeeBit < committeeBits.length; committeeBit++) {
      // Skip committees that didn't contribute to aggregation_bits
      if (committeeBits[committeeBit] === '0') {
        continue;
      }

      const validatorsInCommittee = slotCommitteeValidatorsAmount[committeeBit];

      // Get the section of aggregation_bits for this committee
      const committeeAggregationBits = aggregationBits.slice(
        aggregationBitsOffset,
        aggregationBitsOffset + validatorsInCommittee,
      );

      // Process each validator's attestation in this committee
      for (let i = 0; i < committeeAggregationBits.length; i++) {
        if (committeeAggregationBits[i] === '1') {
          attestationsWithDelays.push({
            slot: slotFromAttestations,
            index: committeeBit,
            aggregationBitsIndex: i,
            attestationDelay: slotNumber - slotFromAttestations - 1,
          });
        }
      }

      // Advance the offset after processing this committee
      aggregationBitsOffset += validatorsInCommittee;
    }

    return attestationsWithDelays;
  }

  /**
   * Remove duplicate attestations and keep the one with minimum delay
   */
  protected deduplicateAttestations(attestations: CommitteeUpdate[]): CommitteeUpdate[] {
    const uniqueAttestations = new Map<string, CommitteeUpdate>();

    for (const attestation of attestations) {
      const key = `${attestation.slot}-${attestation.index}-${attestation.aggregationBitsIndex}`;
      const existing = uniqueAttestations.get(key);

      if (!existing || attestation.attestationDelay < existing.attestationDelay) {
        uniqueAttestations.set(key, attestation);
      }
    }

    return Array.from(uniqueAttestations.values());
  }

  /**
   * Calculate total sync rewards from rewards data
   */
  protected calculateTotalSyncRewards(syncRewardsData: SyncRewardDataItem[]): number {
    return syncRewardsData.reduce((sum, reward) => sum + Number(reward.reward), 0);
  }

  /**
   * Format withdrawal rewards for storage
   */
  protected formatWithdrawalRewards(
    withdrawals: Array<{ validator_index: string; amount: string }>,
  ): string[] {
    return withdrawals.map((withdrawal) => `${withdrawal.validator_index}:${withdrawal.amount}`);
  }

  /**
   * Generate mock data for testing purposes
   */
  protected generateMockValidatorData(slot: number, count: number = 1) {
    return Array.from({ length: count }, (_, index) => ({
      validatorIndex: Math.floor(Math.random() * 1000) + index,
    }));
  }

  /**
   * Generate mock withdrawal data for testing purposes
   */
  protected generateMockWithdrawalData(slot: number, count: number = 1) {
    return Array.from({ length: count }, (_, index) => ({
      validatorIndex: Math.floor(Math.random() * 1000) + index,
      amount: Math.random() * 32,
    }));
  }

  /**
   * Generate mock validator status data for testing purposes
   */
  protected generateMockValidatorStatusData(slot: number, count: number = 1) {
    const statuses = ['active', 'pending', 'exited', 'slashed'];
    return Array.from({ length: count }, (_, index) => ({
      validatorIndex: Math.floor(Math.random() * 1000) + index,
      status: statuses[Math.floor(Math.random() * statuses.length)],
    }));
  }

  /**
   * Validate slot number
   */
  protected validateSlotNumber(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 0;
  }

  /**
   * Validate epoch number
   */
  protected validateEpochNumber(epoch: number): boolean {
    return Number.isInteger(epoch) && epoch >= 0;
  }

  /**
   * Check if slot is within valid range
   */
  protected isSlotInValidRange(slot: number, currentSlot: number, maxLookback: number): boolean {
    return slot >= currentSlot - maxLookback && slot <= currentSlot;
  }

  /**
   * Calculate slot delay
   */
  protected calculateSlotDelay(processedSlot: number, currentSlot: number): number {
    return currentSlot - processedSlot;
  }

  /**
   * Format committee data for storage
   */
  protected formatCommitteeData(committees: CommitteeDataItem[]): Array<{
    slot: number;
    index: number;
    aggregationBitsIndex: number;
    attestationDelay: number;
  }> {
    return committees.map((committee) => ({
      slot: committee.slot,
      index: committee.index,
      aggregationBitsIndex: committee.aggregationBitsIndex,
      attestationDelay: committee.attestationDelay,
    }));
  }

  /**
   * Prepare sync committee rewards for processing
   * Following the same pattern as epoch rewards
   */
  protected prepareSyncCommitteeRewards(
    syncCommitteeRewards: SyncCommitteeRewards | 'SLOT MISSED',
    slot: number,
  ): Array<{
    validatorIndex: number;
    syncCommitteeReward: bigint;
    rewards: string;
  }> {
    if (
      syncCommitteeRewards === 'SLOT MISSED' ||
      !syncCommitteeRewards.data ||
      syncCommitteeRewards.data.length === 0
    ) {
      return [];
    }

    return syncCommitteeRewards.data.map((reward) => ({
      validatorIndex: Number(reward.validator_index),
      syncCommitteeReward: BigInt(reward.reward),
      rewards: `${slot}:${reward.reward}`,
    }));
  }

  /**
   * Prepare block rewards for processing
   * Following the same pattern as epoch rewards
   */
  protected prepareBlockRewards(blockRewards: BlockRewards | 'SLOT MISSED'): {
    proposerIndex: number;
    blockReward: bigint;
  } | null {
    if (blockRewards === 'SLOT MISSED' || !blockRewards.data) {
      return null;
    }

    return {
      proposerIndex: Number(blockRewards.data.proposer_index),
      blockReward: BigInt(blockRewards.data.total),
    };
  }
}
