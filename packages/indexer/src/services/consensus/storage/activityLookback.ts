/**
 * Returns the slot window needed to guarantee that each validator has had at
 * least `inactiveMissedCount` attestation opportunities available in the query.
 *
 * Validators attest once per epoch, so the main term is:
 * `slotsPerEpoch * inactiveMissedCount`.
 *
 * We then add `inactiveMissedCount` extra slots as a boundary buffer. Without
 * that buffer, a validator assigned at the very start of the oldest epoch in the
 * window can lose one attestation opportunity right at the edge of the range.
 */
export function getActivityLookbackSlots(
  slotsPerEpoch: number,
  inactiveMissedCount: number,
): number {
  return slotsPerEpoch * inactiveMissedCount + inactiveMissedCount;
}
