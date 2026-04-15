import { describe, expect, it } from 'vitest';

import { getActivityLookbackSlots } from './activityLookback.js';

// This suite locks the slot lookback formula used by activity-related storage queries.
describe('getActivityLookbackSlots', () => {
  it('should keep one extra epoch as a safety buffer on Gnosis', () => {
    // Use the current inactivity threshold for the scenario under discussion.
    const inactiveMissedCount = 3;

    // Gnosis validators attest once per 16-slot epoch.
    const slotsPerEpoch = 16;

    // Expect 3 epochs for the inactivity threshold plus 1 extra epoch because
    // the current epoch may not contain the validator's duty yet.
    expect(getActivityLookbackSlots(slotsPerEpoch, inactiveMissedCount)).toBe(64);
  });

  it('should scale the same extra-epoch rule on mainnet', () => {
    // Keep the same inactivity threshold to isolate the chain-size effect.
    const inactiveMissedCount = 3;

    // Ethereum mainnet validators attest once per 32-slot epoch.
    const slotsPerEpoch = 32;

    // Expect 3 epochs for the inactivity threshold plus 1 extra epoch for the
    // same worst-case alignment.
    expect(getActivityLookbackSlots(slotsPerEpoch, inactiveMissedCount)).toBe(128);
  });
});
