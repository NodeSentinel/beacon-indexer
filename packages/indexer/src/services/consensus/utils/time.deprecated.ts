import { chainConfig } from '@/src/lib/env.js';

const GENESIS_TIMESTAMP = chainConfig.beacon.genesisTimestamp;
const SLOT_DURATION_MS = chainConfig.beacon.slotDuration;
const SLOTS_PER_EPOCH = chainConfig.beacon.slotsPerEpoch;
/**
 * Given a timestamp, determine the slot number.
 * @param timestamp - The timestamp in milliseconds.
 * @returns The corresponding slot number.
 */
export function getSlotNumberFromTimestamp(timestamp: number): number {
  if (timestamp < GENESIS_TIMESTAMP) {
    throw new Error('Timestamp is before genesis');
  }
  return Math.floor((timestamp - GENESIS_TIMESTAMP) / SLOT_DURATION_MS);
}

/**
 * Given a slot number, determine the timestamp.
 * @param slotNumber - The slot number.
 * @returns The corresponding timestamp in milliseconds.
 */
export function getTimestampFromSlotNumber(slotNumber: number): number {
  if (slotNumber < 0) {
    throw new Error('Slot number cannot be negative');
  }
  return GENESIS_TIMESTAMP + slotNumber * SLOT_DURATION_MS;
}

/**
 * Given a timestamp, determine the epoch number.
 * @param timestamp - The timestamp in milliseconds.
 * @returns The corresponding epoch number.
 */
export function getEpochNumberFromTimestamp(timestamp: number): number {
  const slotNumber = getSlotNumberFromTimestamp(timestamp);
  return Math.floor(slotNumber / SLOTS_PER_EPOCH);
}

/**
 * Given an epoch number, determine the timestamp.
 * @param epochNumber - The epoch number.
 * @returns The corresponding timestamp in milliseconds.
 */
export function getTimestampFromEpochNumber(epochNumber: number): number {
  if (epochNumber < 0) {
    throw new Error('Epoch number cannot be negative');
  }

  const slotDuration = SLOT_DURATION_MS * SLOTS_PER_EPOCH;

  return GENESIS_TIMESTAMP + epochNumber * slotDuration;
}

/**
 * Calculates the start epoch of the sync committee period that contains the given epoch
 * @param epoch The epoch to find the sync committee period start for
 * @returns The start epoch of the sync committee period
 */
export function getSyncCommitteePeriodStartEpoch(epoch: number): number {
  const periodsPerEpoch = chainConfig.beacon.epochsPerSyncCommitteePeriod;
  return Math.floor(epoch / periodsPerEpoch) * periodsPerEpoch;
}
