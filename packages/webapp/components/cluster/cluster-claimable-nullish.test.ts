import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('cluster claimable reward fallback', () => {
  // This suite verifies legacy cluster components normalize nullable claimable reward values.
  it('normalizes nullable claimable rewards before rendering legacy cluster components', () => {
    // This scenario protects Gnosis legacy components from nullable API claimable rewards.
    const cardSource = readFileSync(new URL('./cluster-card.tsx', import.meta.url), 'utf8');
    const overviewSource = readFileSync(new URL('./cluster-overview.tsx', import.meta.url), 'utf8');

    // Confirm each component creates a numeric fallback before USD and token formatting.
    assert.match(cardSource, /const claimableRewards = cluster\.claimableRewards \?\? 0/);
    assert.match(overviewSource, /const claimableRewards = cluster\.claimableRewards \?\? 0/);
    // Confirm each component avoids direct toFixed calls on nullable cluster.claimableRewards.
    assert.doesNotMatch(cardSource, /cluster\.claimableRewards\.toFixed/);
    assert.doesNotMatch(overviewSource, /cluster\.claimableRewards\.toFixed/);
  });
});
