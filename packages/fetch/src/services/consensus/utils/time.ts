/**
 * Time utilities class for beacon chain time calculations
 * All methods are pure functions that use the configuration provided in the constructor
 */
export class BeaconTime {
  private readonly genesisTimestamp: number;
  private readonly slotDurationMs: number;
  private readonly slotsPerEpoch: number;
  private readonly epochsPerSyncCommitteePeriod: number;
  private readonly slotStartIndexing: number;

  constructor(config: {
    genesisTimestamp: number;
    slotDurationMs: number;
    slotsPerEpoch: number;
    epochsPerSyncCommitteePeriod: number;
    slotStartIndexing: number;
  }) {
    this.genesisTimestamp = config.genesisTimestamp;
    this.slotDurationMs = config.slotDurationMs;
    this.slotsPerEpoch = config.slotsPerEpoch;
    this.epochsPerSyncCommitteePeriod = config.epochsPerSyncCommitteePeriod;
    this.slotStartIndexing = config.slotStartIndexing;
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
  getSlotStartIndexing(): number {
    return this.slotStartIndexing;
  }
}
