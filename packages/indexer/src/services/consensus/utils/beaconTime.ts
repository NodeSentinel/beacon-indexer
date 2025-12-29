/**
 * Time utilities class for beacon chain time calculations
 * All methods are pure functions that use the configuration provided in the constructor
 */
export class BeaconTime {
  private readonly genesisTimestamp: number;
  private readonly slotDurationMs: number;
  private readonly slotsPerEpoch: number;
  private readonly epochsPerSyncCommitteePeriod: number;
  private readonly lookbackSlot: number;
  private readonly delaySlotsToHead: number;

  constructor(config: {
    genesisTimestamp: number;
    slotDurationMs: number;
    slotsPerEpoch: number;
    epochsPerSyncCommitteePeriod: number;
    lookbackSlot: number;
    delaySlotsToHead?: number;
  }) {
    this.genesisTimestamp = config.genesisTimestamp;
    this.slotDurationMs = config.slotDurationMs;
    this.slotsPerEpoch = config.slotsPerEpoch;
    this.epochsPerSyncCommitteePeriod = config.epochsPerSyncCommitteePeriod;
    this.lookbackSlot = config.lookbackSlot;
    this.delaySlotsToHead = config.delaySlotsToHead ?? 0;
  }

  /**
   * Given a timestamp, determine the slot number.
   * @param timestamp - The timestamp in milliseconds.
   * @returns The corresponding slot number.
   */
  getSlotNumberFromTimestamp(timestamp: number): number {
    if (timestamp < this.genesisTimestamp) {
      throw new Error('Timestamp is before genesis');
    }
    return Math.floor((timestamp - this.genesisTimestamp) / this.slotDurationMs);
  }

  /**
   * Given a slot number, determine the timestamp.
   * @param slotNumber - The slot number.
   * @returns The corresponding timestamp in milliseconds.
   */
  getTimestampFromSlotNumber(slotNumber: number): number {
    if (slotNumber < 0) {
      throw new Error('Slot number cannot be negative');
    }
    return this.genesisTimestamp + slotNumber * this.slotDurationMs;
  }

  /**
   * Given a timestamp, determine the epoch number.
   * @param timestamp - The timestamp in milliseconds.
   * @returns The corresponding epoch number.
   */
  getEpochNumberFromTimestamp(timestamp: number): number {
    const slotNumber = this.getSlotNumberFromTimestamp(timestamp);
    return Math.floor(slotNumber / this.slotsPerEpoch);
  }

  /**
   * Given an epoch number, determine the timestamp.
   * @param epochNumber - The epoch number.
   * @returns The corresponding timestamp in milliseconds.
   */
  getTimestampFromEpochNumber(epochNumber: number): number {
    if (epochNumber < 0) {
      throw new Error('Epoch number cannot be negative');
    }

    const slotDuration = this.slotDurationMs * this.slotsPerEpoch;

    return this.genesisTimestamp + epochNumber * slotDuration;
  }

  /**
   * Calculates the start epoch of the sync committee period that contains the given epoch
   * @param epoch The epoch to find the sync committee period start for
   * @returns The start epoch of the sync committee period
   */
  // TODO: add unit tests
  getSyncCommitteePeriodStartEpoch(epoch: number): number {
    return (
      Math.floor(epoch / this.epochsPerSyncCommitteePeriod) * this.epochsPerSyncCommitteePeriod
    );
  }

  getEpochSlots(epoch: number) {
    const slotsPerEpoch = Number(this.slotsPerEpoch);
    return {
      startSlot: epoch * slotsPerEpoch,
      endSlot: (epoch + 1) * slotsPerEpoch - 1,
    };
  }

  getEpochFromSlot = (slot: number) => {
    return Math.floor(slot / Number(this.slotsPerEpoch));
  };

  calculateSlotRange(startTime: Date, endTime: Date) {
    const startSlot = this.getSlotNumberFromTimestamp(startTime.getTime());
    const endSlot = this.getSlotNumberFromTimestamp(endTime.getTime());
    return { startSlot, endSlot };
  }

  /**
   * Get the oldest lookback slot for indexing
   * @returns The slot start indexing value
   */
  getLookbackSlot(): number {
    return this.lookbackSlot;
  }

  // TODO: add delaySlotsToHead only when slotNumber is >=  currentSlot - delaySlotsToHead
  // I think is already done, but check anyway

  /**
   * Check if a given slot is considered started for querying, including delaySlotsToHead.
   * A slot S is "started" when currentSlot >= S + delaySlotsToHead.
   * @param slotNumber Slot to check
   */
  hasSlotStarted(slotNumber: number): boolean {
    const effectiveStartSlot = slotNumber + this.delaySlotsToHead;
    const slotStartTimestamp = this.getTimestampFromSlotNumber(effectiveStartSlot);
    return Date.now() >= slotStartTimestamp;
  }

  /**
   * Check if a given epoch has ended, meaning the last slot of the epoch has passed
   * (including delaySlotsToHead).
   * @param epochNumber Epoch to check
   */
  hasEpochEnded(epochNumber: number): boolean {
    const { endSlot } = this.getEpochSlots(epochNumber);
    // The epoch has ended when the slot after the last slot has started
    return this.hasSlotStarted(endSlot + 1);
  }

  /**
   * Resolve once the provided slot is considered started for querying, including delaySlotsToHead.
   * If the slot already started, resolves immediately.
   * @param slotNumber Slot to wait for the start
   */
  async waitUntilSlotStart(slotNumber: number): Promise<void> {
    const effectiveStartSlot = slotNumber + this.delaySlotsToHead;
    const slotStartTimestamp = this.getTimestampFromSlotNumber(effectiveStartSlot);
    const delayMs = Math.max(0, slotStartTimestamp - Date.now());
    if (delayMs === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * Calculate the number of slots per hour based on slot duration.
   * @returns The number of slots in one hour
   */
  getSlotsPerHour(): number {
    const secondsPerHour = 3600;
    const slotDurationSeconds = this.slotDurationMs / 1000;
    return Math.floor(secondsPerHour / slotDurationSeconds);
  }

  /**
   * Given a slot number, returns the slot number at the start of its partition.
   * Partitions are based on fixed slot ranges (equivalent to one hour of slots),
   * aligned to lookbackSlot as the starting point.
   * @param slot - The slot number to find the partition start for
   * @returns The slot number at the start of the partition containing the given slot
   */
  getPartitionStartSlot(slot: number): number {
    const offsetFromLookback = slot - this.lookbackSlot;
    const slotsPerHour = this.getSlotsPerHour();
    const partitionIndex = Math.floor(offsetFromLookback / slotsPerHour);
    return this.lookbackSlot + partitionIndex * slotsPerHour;
  }

  /**
   * Given a partition start slot, returns the last slot in that partition.
   * @param partitionStartSlot - The slot number at the start of a partition
   * @returns The slot number at the end of the partition (last slot before next partition starts)
   */
  getPartitionEndSlot(partitionStartSlot: number): number {
    const slotsPerHour = this.getSlotsPerHour();
    return partitionStartSlot + slotsPerHour - 1;
  }

  /**
   * Calculate the first slot of the UTC hour that contains the given slot.
   * Partitions are aligned to UTC hour boundaries (e.g., 10:00, 11:00, 12:00).
   *
   * @param slot - The slot number
   * @returns The first slot of the UTC hour containing this slot
   */
  getSlotAtStartOfUTCHourContaining(slot: number): number {
    const ts = this.getTimestampFromSlotNumber(slot);
    const hourStartTs = Math.floor(ts / 3_600_000) * 3_600_000; // floor to UTC hour
    return this.getSlotNumberFromTimestamp(hourStartTs);
  }

  /**
   * Returns the first epoch that STARTS at or after the given timestamp.
   * If the epoch containing the timestamp started before it, returns the next epoch.
   *
   * @param timestamp - The timestamp in milliseconds
   * @returns The first epoch number starting at or after the timestamp
   */
  getFirstEpochStartingAtOrAfter(timestamp: number): number {
    const epoch = this.getEpochNumberFromTimestamp(timestamp);
    const epochStartTimestamp = this.getTimestampFromEpochNumber(epoch);
    return epochStartTimestamp < timestamp ? epoch + 1 : epoch;
  }
}
