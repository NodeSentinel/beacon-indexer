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

  /**
   * Update attestation stats and inactivity status.
   *
   * Only evaluates attestations up to maxSlotToQuery, which accounts for
   * delaySlotsToHead and missedAttestationsForInactivity to avoid false
   * positives on slots that haven't been fully processed yet.
   */
  async updateAttestationsAndStatus(params: {
    slotsPerEpoch: number;
    maxAttestationDelay: number;
    delaySlotsToHead: number;
    missedAttestationsForInactivity: number;
  }) {
    const {
      slotsPerEpoch,
      maxAttestationDelay,
      delaySlotsToHead,
      missedAttestationsForInactivity,
    } = params;

    const currentTimestamp = Date.now();
    const currentSlot = this.beaconTime.getSlotNumberFromTimestamp(currentTimestamp);
    const maxQueryableSlot = currentSlot - delaySlotsToHead - missedAttestationsForInactivity;
    const slotFromOneHourAgo = this.beaconTime.getSlotNumberFromTimestamp(
      currentTimestamp - ms('1h'),
    );
    const maxSlotToQuery = maxQueryableSlot;

    const inactivityCheckStartSlot =
      maxSlotToQuery -
      missedAttestationsForInactivity -
      slotsPerEpoch * missedAttestationsForInactivity;

    try {
      await this.snapshotStorage.updateAttestationsAndStatus({
        minSlotHour: slotFromOneHourAgo,
        maxSlotToQuery,
        inactivityCheckStartSlot,
        maxAttestationDelay,
        inactiveMissedCount: missedAttestationsForInactivity,
      });
      this.logger.info('Updated attestations and status snapshot');
    } catch (error) {
      this.logger.error('Error updating attestations and status', error);
      throw error;
    }
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
   * Update 1h performance metrics from raw data.
   */
  async updatePerformance1h(maxAttestationDelay: number, validatorIndexes?: number[]) {
    const currentTimestamp = Date.now();
    const currentSlot = this.beaconTime.getSlotNumberFromTimestamp(currentTimestamp);
    const oneHourAgoSlot = this.beaconTime.getSlotNumberFromTimestamp(currentTimestamp - ms('1h'));
    const minEpoch = this.beaconTime.getEpochFromSlot(oneHourAgoSlot);
    const maxEpoch = this.beaconTime.getEpochFromSlot(currentSlot);

    try {
      await this.snapshotStorage.updatePerformance1h({
        minSlot: oneHourAgoSlot,
        maxSlot: currentSlot,
        minEpoch,
        maxEpoch,
        maxAttestationDelay,
        validatorIndexes,
      });
      this.logger.info('Updated 1h performance metrics');
    } catch (error) {
      this.logger.error('Error updating 1h performance', error);
      throw error;
    }
  }

  /**
   * Update 1d performance metrics from hourly archives.
   */
  async updatePerformance1d(validatorIndexes?: number[]) {
    try {
      await this.snapshotStorage.updatePerformance1d(
        validatorIndexes ? { validatorIndexes } : undefined,
      );
      this.logger.info('Updated 1d performance metrics');
    } catch (error) {
      this.logger.error('Error updating 1d performance', error);
      throw error;
    }
  }

  /**
   * Update 1w performance metrics from daily archives.
   */
  async updatePerformance1w(validatorIndexes?: number[]) {
    try {
      await this.snapshotStorage.updatePerformance1w(
        validatorIndexes ? { validatorIndexes } : undefined,
      );
      this.logger.info('Updated 1w performance metrics');
    } catch (error) {
      this.logger.error('Error updating 1w performance', error);
      throw error;
    }
  }

  /**
   * Update 1m performance metrics from daily archives.
   */
  async updatePerformance1m(validatorIndexes?: number[]) {
    try {
      await this.snapshotStorage.updatePerformance1m(
        validatorIndexes ? { validatorIndexes } : undefined,
      );
      this.logger.info('Updated 1m performance metrics');
    } catch (error) {
      this.logger.error('Error updating 1m performance', error);
      throw error;
    }
  }

  /**
   * Detect validators in clusters that don't have snapshot rows yet,
   * insert base rows, and backfill all performance metrics for them.
   */
  async detectAndBackfillNewValidators(maxAttestationDelay: number): Promise<number> {
    const newIndexes = await this.snapshotStorage.findNewValidators();

    if (newIndexes.length === 0) return 0;

    this.logger.info(`Detected ${newIndexes.length} new validators, backfilling snapshots`);

    await this.snapshotStorage.insertNewValidatorSnapshots(newIndexes);
    await this.updatePerformance1h(maxAttestationDelay, newIndexes);
    await this.updatePerformance1d(newIndexes);
    await this.updatePerformance1w(newIndexes);
    await this.updatePerformance1m(newIndexes);

    this.logger.info(`Backfilled ${newIndexes.length} new validators`);
    return newIndexes.length;
  }
}
