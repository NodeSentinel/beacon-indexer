import { describe, expect, test } from 'vitest';

import { consensusApiRetryConfig } from '@/src/lib/env.js';

describe('env', () => {
  test('keeps beacon retry defaults out of deployment env vars', () => {
    // Scenario: retry counts are runtime config owned by the indexer code, not new .env keys
    // that deployments must define or accidentally override.
    expect(consensusApiRetryConfig).toEqual({
      fullNodeRetries: 1,
      archiveNodeRetries: 2,
    });
  });
});
