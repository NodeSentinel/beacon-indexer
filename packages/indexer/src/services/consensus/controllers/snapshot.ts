import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import ms from 'ms';

import { SnapshotStorage } from '../storage/snapshot.js';

import createLogger from '@/src/lib/pino.js';

/**
 * SnapshotController - Business logic layer for validator snapshot operations.
 */
export class SnapshotController {
  private readonly logger = createLogger('SnapshotController');

  constructor(
    private readonly snapshotStorage: SnapshotStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  getCurrentEpoch(): number {
    const currentSlot = this.beaconTime.getSlotNumberFromTimestamp(Date.now());
    return this.beaconTime.getEpochFromSlot(currentSlot);
  }

  /**
   * Update balance fields from the validator table.
   */
  async updateBalances() {
    try {
      await this.snapshotStorage.updateBalances();
      this.logger.info('Updated validator balances in snapshot');
    } catch (error) {
      this.logger.error('Error updating validator balances', error);
      throw error;
    }
  }

  /**
   * Update h performance metrics from raw data.
   *
   * @param maxAttestationDelay Largest attestation delay still treated as a
   * successful inclusion before the hourly snapshot counts the duty as missed.
   * @param validatorIndexes Optional subset of validators to refresh. When
   * omitted, the hourly snapshot is recomputed for every validator row.
   */
  async updatePerformanceH(maxAttestationDelay: number, validatorIndexes?: number[]) {
    const currentTimestamp = Date.now();
    // Exclude slots where attestations may still be pending inclusion.
    // A validator at slot S has until S + maxAttestationDelay to be included.
    // We have data up to rawSlot - delaySlotsToHead. So the safe upper bound is:
    // rawSlot - delaySlotsToHead - maxAttestationDelay
    const maxSlot = this.beaconTime.getChainCurrentSlot() - maxAttestationDelay;
    const oneHourAgoSlot = this.beaconTime.getSlotNumberFromTimestamp(currentTimestamp - ms('1h'));
    const minEpoch = this.beaconTime.getEpochFromSlot(oneHourAgoSlot);
    const maxEpoch = this.beaconTime.getEpochFromSlot(maxSlot);

    try {
      await this.snapshotStorage.updatePerformanceH({
        minSlot: oneHourAgoSlot,
        maxSlot,
        minEpoch,
        maxEpoch,
        maxAttestationDelay,
        validatorIndexes,
      });
      this.logger.info('Updated h performance metrics');
    } catch (error) {
      this.logger.error('Error updating h performance', error);
      throw error;
    }
  }

  /**
   * Update d performance metrics combining hourly archives + live data.
   *
   * @param maxAttestationDelay Largest attestation delay still treated as a
   * successful inclusion in the live, non-archived portion of the daily window.
   * @param validatorIndexes Optional subset of validators to refresh. When
   * omitted, the daily snapshot is recomputed for every validator row.
   */
  async updatePerformanceD(maxAttestationDelay: number, validatorIndexes?: number[]) {
    const genesisTimeSec = Math.floor(this.beaconTime.getTimestampFromSlotNumber(0) / 1000);
    const secPerSlot = Math.floor(
      (this.beaconTime.getTimestampFromSlotNumber(1) -
        this.beaconTime.getTimestampFromSlotNumber(0)) /
        1000,
    );
    const slotsPerEpoch = this.beaconTime.getEpochSlots(0).endSlot + 1;

    try {
      await this.snapshotStorage.updatePerformanceD({
        genesisTimeSec,
        secPerSlot,
        slotsPerEpoch,
        maxAttestationDelay,
        validatorIndexes,
      });
      this.logger.info('Updated d performance metrics');
    } catch (error) {
      this.logger.error('Error updating d performance', error);
      throw error;
    }
  }

  /**
   * Update w performance metrics from daily archives.
   *
   * @param validatorIndexes Optional subset of validators to refresh. When
   * omitted, the weekly snapshot is recomputed for every validator row.
   */
  async updatePerformanceW(validatorIndexes?: number[]) {
    try {
      await this.snapshotStorage.updatePerformanceW(
        validatorIndexes ? { validatorIndexes } : undefined,
      );
      this.logger.info('Updated w performance metrics');
    } catch (error) {
      this.logger.error('Error updating w performance', error);
      throw error;
    }
  }

  /**
   * Update m performance metrics from daily archives.
   *
   * @param validatorIndexes Optional subset of validators to refresh. When
   * omitted, the monthly snapshot is recomputed for every validator row.
   */
  async updatePerformanceM(validatorIndexes?: number[]) {
    try {
      await this.snapshotStorage.updatePerformanceM(
        validatorIndexes ? { validatorIndexes } : undefined,
      );
      this.logger.info('Updated m performance metrics');
    } catch (error) {
      this.logger.error('Error updating m performance', error);
      throw error;
    }
  }

  /**
   * Detect validators in clusters that don't have snapshot rows yet,
   * insert base rows, and backfill all performance metrics for them.
   *
   * @param maxAttestationDelay Largest attestation delay still treated as a
   * successful inclusion while backfilling hourly and daily snapshot metrics.
   */
  async detectAndBackfillNewValidators(maxAttestationDelay: number): Promise<number> {
    const newIndexes = await this.snapshotStorage.findNewValidators();

    if (newIndexes.length === 0) return 0;

    this.logger.info(`Detected ${newIndexes.length} new validators, backfilling snapshots`);

    await this.snapshotStorage.insertNewValidatorSnapshots(newIndexes);
    await this.updatePerformanceH(maxAttestationDelay, newIndexes);
    await this.updatePerformanceD(maxAttestationDelay, newIndexes);
    await this.updatePerformanceW(newIndexes);
    await this.updatePerformanceM(newIndexes);

    this.logger.info(`Backfilled ${newIndexes.length} new validators`);
    return newIndexes.length;
  }
}
