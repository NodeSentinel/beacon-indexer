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
   * Update h performance metrics from raw data.
   */
  async updatePerformanceH(maxAttestationDelay: number, validatorIndexes?: number[]) {
    const currentTimestamp = Date.now();
    const currentSlot = this.beaconTime.getSlotNumberFromTimestamp(currentTimestamp);
    const oneHourAgoSlot = this.beaconTime.getSlotNumberFromTimestamp(currentTimestamp - ms('1h'));
    const minEpoch = this.beaconTime.getEpochFromSlot(oneHourAgoSlot);
    const maxEpoch = this.beaconTime.getEpochFromSlot(currentSlot);

    try {
      await this.snapshotStorage.updatePerformanceH({
        minSlot: oneHourAgoSlot,
        maxSlot: currentSlot,
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
   * Update d performance metrics from hourly archives.
   */
  async updatePerformanceD(validatorIndexes?: number[]) {
    try {
      await this.snapshotStorage.updatePerformanceD(
        validatorIndexes ? { validatorIndexes } : undefined,
      );
      this.logger.info('Updated d performance metrics');
    } catch (error) {
      this.logger.error('Error updating d performance', error);
      throw error;
    }
  }

  /**
   * Update w performance metrics from daily archives.
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
   */
  async detectAndBackfillNewValidators(maxAttestationDelay: number): Promise<number> {
    const newIndexes = await this.snapshotStorage.findNewValidators();

    if (newIndexes.length === 0) return 0;

    this.logger.info(`Detected ${newIndexes.length} new validators, backfilling snapshots`);

    await this.snapshotStorage.insertNewValidatorSnapshots(newIndexes);
    await this.updatePerformanceH(maxAttestationDelay, newIndexes);
    await this.updatePerformanceD(newIndexes);
    await this.updatePerformanceW(newIndexes);
    await this.updatePerformanceM(newIndexes);

    this.logger.info(`Backfilled ${newIndexes.length} new validators`);
    return newIndexes.length;
  }
}
