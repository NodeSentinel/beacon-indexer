import { env, chainConfig } from '@/src/lib/env.js';
import { getSlotNumberFromTimestamp } from '@/src/services/consensus/utils/time.deprecated.js';

export function getOldestLookbackSlot() {
  return env.CONSENSUS_LOOKBACK_SLOT;
}

// function getCurrentSlot() {
//   const currentTimestamp = Date.now();
//   return Math.floor(
//     (currentTimestamp - env.BEACON_GENESIS_TIMESTAMP) /
//       (env.BEACON_SLOT_DURATION_IN_SECONDS * 1000),
//   );
// }

export const getEpochSlots = (epoch: number) => {
  const slotsPerEpoch = Number(chainConfig.beacon.slotsPerEpoch);
  return {
    startSlot: epoch * slotsPerEpoch,
    endSlot: (epoch + 1) * slotsPerEpoch - 1,
  };
};

export const getEpochFromSlot = (slot: number) => {
  return Math.floor(slot / Number(chainConfig.beacon.slotsPerEpoch));
};

export function calculateSlotRange(startTime: Date, endTime: Date) {
  const startSlot = getSlotNumberFromTimestamp(startTime.getTime());
  const endSlot = getSlotNumberFromTimestamp(endTime.getTime());
  return { startSlot, endSlot };
}
