import { describe, expect, test } from 'vitest';

import { env } from '@/src/lib/env.js';

describe('env', () => {
  test('uses beacon retry defaults when retry env vars are not provided', () => {
    // Scenario: deployments can omit explicit beacon retry settings and still receive
    // the current bounded retry policy used by the indexer.
    expect(env.CONSENSUS_FULL_API_RETRIES).toBe(1);
    expect(env.CONSENSUS_ARCHIVE_API_RETRIES).toBe(2);
  });
});
