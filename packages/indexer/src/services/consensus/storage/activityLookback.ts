/**
 * Gets the slot lookback needed to rebuild the inactivity streak safely.
 *
 * A validator attests once per epoch, so we need `inactiveMissedCount` full
 * epochs for the missed-duty threshold.
 *
 * We keep 1 extra epoch because the current epoch may still be missing that
 * validator's duty slot.
 *
 * Example: with `slotsPerEpoch = 32` and `inactiveMissedCount = 3`, the
 * lookback is `32 * (3 + 1) = 128` slots.
 */
export function getActivityLookbackSlots(
  slotsPerEpoch: number,
  inactiveMissedCount: number,
): number {
  return slotsPerEpoch * (inactiveMissedCount + 1);
}
