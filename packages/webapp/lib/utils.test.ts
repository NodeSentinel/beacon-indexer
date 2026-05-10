import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatSlotSyncStatus } from './utils';

describe('formatSlotSyncStatus', () => {
  it('formats synced slots with thousand separators', () => {
    // Show both slots when the indexer is within the accepted sync range.
    const result = formatSlotSyncStatus({
      currentSlot: 12_345_678,
      isSynced: true,
      lastIndexedSlot: 12_345_670,
    });

    assert.equal(result, '12,345,678/12,345,670');
  });

  it('formats delayed slots with head difference and elapsed time', () => {
    // Show the last indexed slot, head difference, and elapsed time when delayed.
    const result = formatSlotSyncStatus({
      currentSlot: 12_345_678,
      isSynced: false,
      lastIndexedSlot: 12_222_222,
      slotDurationSeconds: 5,
    });

    assert.equal(result, '12,222,222 (-123,456) 7d:3h:28m');
  });

  it('omits duration parts that do not add value', () => {
    // Hide zero days and hours for short delayed windows.
    const result = formatSlotSyncStatus({
      currentSlot: 1_020,
      isSynced: false,
      lastIndexedSlot: 1_000,
      slotDurationSeconds: 12,
    });

    assert.equal(result, '1,000 (-20) 4m');
  });
});
