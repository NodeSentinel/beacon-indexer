import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatBlockProposalDate } from './blocks-tab-utils';

describe('formatBlockProposalDate', () => {
  it('formats block proposal timestamps as yyyy-mm-dd', () => {
    // Build a stable UTC timestamp so the date assertion is timezone-independent.
    const timestamp = Date.UTC(2026, 4, 12, 18, 30, 0);

    // Confirm collapsed block rows can show the requested compact date.
    assert.equal(formatBlockProposalDate(timestamp), '2026-05-12');
  });
});
