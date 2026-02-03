import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import ms from 'ms';

import { SummaryStorage } from '../storage/summary.js';

import createLogger from '@/src/lib/pino.js';

/**
 * SummaryController - Business logic layer for summary-related operations
 */
export class SummaryController {
  private readonly logger = createLogger('SummaryController');

  constructor(
    private readonly summaryStorage: SummaryStorage,
    private readonly beaconTime: BeaconTime,
  ) {}

  /**
   * Get validator inactivity status for the last hour
   * Calculates slots considering delaySlotsToHead and queries the database
   * Saves the results to validators_status_summary table
   *
   * @param params - Configuration parameters
   * @param params.slotsPerEpoch - Number of slots per epoch
   * @param params.maxAttestationDelay - Maximum delay threshold for attestations
   * @param params.delaySlotsToHead - Delay slots to head
   * @param params.missedAttestationsForInactivity - Number of missed attestations to mark as inactive
   */
  async getValidatorInactivityStatus(params: {
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

    // Calculate current slot from timestamp
    const currentTimestamp = Date.now();
    const currentSlot = this.beaconTime.getSlotNumberFromTimestamp(currentTimestamp);

    // Max slot we can query is currentSlot - delaySlotsToHead
    const maxQueryableSlot = currentSlot - delaySlotsToHead - missedAttestationsForInactivity;

    // Calculate slot from 1 hour ago
    const oneHourAgoTimestamp = currentTimestamp - ms('1h');
    const slotFromOneHourAgo = this.beaconTime.getSlotNumberFromTimestamp(oneHourAgoTimestamp);

    // maxSlotToQuery is the max queryable slot (currentSlot - delaySlotsToHead)
    const maxSlotToQuery = maxQueryableSlot;

    const inactivityCheckStartSlot =
      maxSlotToQuery -
      missedAttestationsForInactivity -
      slotsPerEpoch * missedAttestationsForInactivity;

    try {
      // Calculate and save validator inactivity status in a single efficient query
      await this.summaryStorage.validatorsStatusSummary({
        minSlotHour: slotFromOneHourAgo,
        maxSlotToQuery: maxSlotToQuery,
        inactivityCheckStartSlot: inactivityCheckStartSlot,
        maxAttestationDelay,
        inactiveMissedCount: missedAttestationsForInactivity,
      });

      this.logger.info('Calculated and saved validator status summary');
    } catch (error) {
      this.logger.error('Error calculating and saving validator inactivity status', error);
      throw error;
    }
  }
}
