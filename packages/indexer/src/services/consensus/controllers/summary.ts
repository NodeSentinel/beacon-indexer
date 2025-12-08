import ms from 'ms';

import { SummaryStorage } from '../storage/summary.js';
import { BeaconTime } from '../utils/beaconTime.js';

import createLogger from '@/src/lib/pino.js';

/**
 * SummaryController - Business logic layer for summary-related operations
 */
export class SummaryController {
  private readonly logger = createLogger('SummaryController');

  constructor(
    private readonly summaryStorage: SummaryStorage,
    private readonly beaconTime: BeaconTime,
    private readonly maxAttestationDelay: number,
    private readonly delaySlotsToHead: number,
  ) {}

  /**
   * Get validator inactivity status for the last hour
   * Calculates slots considering delaySlotsToHead and queries the database
   */
  async getValidatorInactivityStatus() {
    // statusSlots is 3 as per requirements
    const statusSlots = 3;

    // Calculate current slot from timestamp
    const currentTimestamp = Date.now();
    const currentSlot = this.beaconTime.getSlotNumberFromTimestamp(currentTimestamp);

    // Max slot we can query is currentSlot - delaySlotsToHead
    const maxQueryableSlot = currentSlot - this.delaySlotsToHead - statusSlots;

    // Calculate slot from 1 hour ago
    const oneHourAgoTimestamp = currentTimestamp - ms('1h');
    const slotFromOneHourAgo = this.beaconTime.getSlotNumberFromTimestamp(oneHourAgoTimestamp);

    // maxSlotHour is the max queryable slot (currentSlot - delaySlotsToHead)
    const maxSlotHour = maxQueryableSlot;

    this.logger.info('Calculated slot range', {
      currentSlot,
      maxQueryableSlot,
      slotFromOneHourAgo,
      maxSlotHour,
      statusSlots,
      maxAttestationDelay: this.maxAttestationDelay,
    });

    try {
      await this.summaryStorage.getValidatorInactivityStatus(
        slotFromOneHourAgo,
        maxSlotHour,
        this.maxAttestationDelay,
        statusSlots,
      );
    } catch (error) {
      this.logger.error('Error getting validator inactivity status', error);
      throw error;
    }
  }
}
