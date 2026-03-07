import { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';

import { HourlyArchiveStorage } from '../storage/hourlyArchive.js';

import { getHourlyArchivePartitionName } from '@/src/services/consensus/controllers/helpers/partitionNaming.js';
import {
  PartitionController,
  HourArchiveCandidate,
} from '@/src/services/consensus/controllers/partition.js';

/**
 * HourlyArchiveController - Business logic for hourly archive aggregation.
 *
 * This controller orchestrates the process of archiving hourly validator data:
 * 1. Scans active partitions to find the oldest eligible hour
 * 2. Checks readiness conditions (all slots/epochs processed)
 * 3. Executes archive + partition drops atomically
 *
 * Triggering: Called on each EPOCH_COMPLETED event (not polling).
 * Archives only 1 hour per call (the oldest eligible).
 *
 * Following the architecture pattern:
 * - Controller contains all business logic
 * - Storage handles database persistence
 * - PartitionController manages partition discovery and naming
 */
export class HourlyArchiveController {
  constructor(
    private readonly storage: HourlyArchiveStorage,
    private readonly partitionController: PartitionController,
    private readonly beaconTime: BeaconTime,
    private readonly maxAttestationDelay: number,
  ) {}

  /**
   * Main entry point: triggered on each EPOCH_COMPLETED event.
   *
   * This method:
   * 1. Discovers the oldest eligible hour from active partitions
   * 2. Runs readiness checks
   * 3. Executes archive + partition drops atomically
   *
   * Only archives 1 hour per call (the oldest). If archive fails,
   * the next epoch will retry the same hour.
   *
   * @returns The archived hour timestamp, or null if no eligible hour found
   * @throws Error if archive fails or readiness checks fail
   */
  async archive(): Promise<Date | null> {
    // Discover oldest eligible hour from active partitions
    const candidate = await this.partitionController.getHourToArchive();

    if (!candidate) {
      return null;
    }

    // Check readiness using the candidate's ranges (from partition names)
    const isReady = await this.checkReadinessForCandidate(candidate);
    if (!isReady) {
      return null;
    }

    // Execute atomic archive: create partition + aggregate + drop partitions
    // Generate hourly archive partition name
    const hourlyArchivePartitionName = getHourlyArchivePartitionName(
      'validator_hourly_archive',
      candidate.hourStart,
    );

    // Throws exception on error (handled by XState machine's onError)
    await this.storage.archiveHourAtomically(
      candidate.hourStart,
      candidate.startSlot,
      candidate.endSlot,
      candidate.startEpoch,
      candidate.endEpoch,
      this.maxAttestationDelay,
      hourlyArchivePartitionName,
      candidate.committeePartitionName,
      candidate.epochRewardsPartitionName,
    );

    return candidate.hourStart;
  }

  /**
   * Check if a candidate hour is ready to be archived.
   * Uses the slot/epoch ranges derived from the partition names.
   * @returns true if ready, false if not yet ready (expected condition)
   * @throws Error only on unexpected failures
   */
  private async checkReadinessForCandidate(candidate: HourArchiveCandidate): Promise<boolean> {
    // Check if already archived
    const alreadyArchived = await this.storage.archiveExistsForHour(candidate.hourStart);
    if (alreadyArchived) {
      return false;
    }

    // Check if all slots are processed
    // If the last slot is processed, it means data exists (no need for separate existence check)
    const slotsReady = await this.storage.allSlotsProcessed(candidate.startSlot, candidate.endSlot);
    if (!slotsReady) {
      return false;
    }

    // Check if all epochs are processed
    const epochsReady = await this.storage.allEpochsProcessed(
      candidate.startEpoch,
      candidate.endEpoch,
    );
    if (!epochsReady) {
      return false;
    }

    return true;
  }
}
