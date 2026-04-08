import { describe, expect, it } from 'vitest';

import { getActivityLookbackSlots } from './activityLookback.js';

// This suite locks the slot lookback formula used by activity-related storage queries.
describe('getActivityLookbackSlots', () => {
  it('should cover the required epochs plus a per-epoch boundary buffer on Gnosis', () => {
    // Use the current inactivity threshold for the scenario under discussion.
    const inactiveMissedCount = 3;

    // Gnosis validators attest once per 16-slot epoch.
    const slotsPerEpoch = 16;

    // Expect 3 full epochs plus a 1-slot-per-epoch boundary buffer.
    expect(getActivityLookbackSlots(slotsPerEpoch, inactiveMissedCount)).toBe(51);
  });

  it('should scale the lookback window with the larger mainnet epoch size', () => {
    // Keep the same inactivity threshold to isolate the chain-size effect.
    const inactiveMissedCount = 3;

    // Ethereum mainnet validators attest once per 32-slot epoch.
    const slotsPerEpoch = 32;

    // Expect 3 full epochs plus the same per-epoch boundary buffer.
    expect(getActivityLookbackSlots(slotsPerEpoch, inactiveMissedCount)).toBe(99);
  });
});
