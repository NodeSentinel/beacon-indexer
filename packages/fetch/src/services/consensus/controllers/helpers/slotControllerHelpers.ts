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
    attestation: any,
    slotCommitteesValidatorsAmounts: Record<number, number[]>,
  ) {
    const attestationSlot = parseInt(attestation.data.slot);
    const committeeIndex = parseInt(attestation.data.index);
    const aggregationBits = attestation.aggregation_bits;
    const committeeBits = aggregationBits.split('').map((bit: string) => bit === '1');

    const updates = [];
    const attestationDelay = slotNumber - attestationSlot;

    for (let committeeBit = 0; committeeBit < committeeBits.length; committeeBit++) {
      if (committeeBits[committeeBit]) {
        const validatorIndex = this.calculateValidatorIndex(
          attestationSlot,
          committeeIndex,
          committeeBit,
          slotCommitteesValidatorsAmounts,
        );

        if (validatorIndex !== null) {
          updates.push({
            slot: attestationSlot,
            index: committeeIndex,
            aggregationBitsIndex: committeeBit,
            attestationDelay,
            validatorIndex,
          });
        }
      }
    }

    return updates;
  }

  /**
   * Remove duplicate attestations and keep the one with minimum delay
   */
  protected deduplicateAttestations(attestations: any[]) {
    const uniqueAttestations = new Map<string, any>();

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
   * Filter attestations by oldest lookback slot
   */
  protected filterAttestationsByLookbackSlot(attestations: any[], oldestLookbackSlot: number) {
    return attestations.filter((attestation) => +attestation.data.slot >= oldestLookbackSlot);
  }

  /**
   * Prepare sync committee rewards data for storage
   */
  protected prepareSyncRewards(syncRewardsData: any[], hour: number, date: string) {
    return syncRewardsData.map((syncReward) => ({
      validatorIndex: Number(syncReward.validator_index),
      date: new Date(date),
      hour: hour,
      syncCommittee: BigInt(syncReward.reward),
    }));
  }

  /**
   * Prepare block rewards data for storage
   */
  protected prepareBlockRewards(blockRewards: 'SLOT MISSED' | any, hour: number, date: string) {
    if (blockRewards === 'SLOT MISSED') return null;

    return {
      validatorIndex: Number(blockRewards.data.proposer_index),
      date: new Date(date),
      hour: hour,
      blockReward: BigInt(blockRewards.data.total),
    };
  }

  /**
   * Calculate total sync rewards from rewards data
   */
  protected calculateTotalSyncRewards(syncRewardsData: any[]): number {
    return syncRewardsData.reduce((sum, reward) => sum + Number(reward.reward), 0);
  }

  /**
   * Format withdrawal rewards for storage
   */
  protected formatWithdrawalRewards(withdrawals: any[]): string[] {
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
  protected formatCommitteeData(committees: any[]) {
    return committees.map((committee) => ({
      slot: committee.slot,
      index: committee.index,
      aggregationBitsIndex: committee.aggregationBitsIndex,
      attestationDelay: committee.attestationDelay,
    }));
  }
}
