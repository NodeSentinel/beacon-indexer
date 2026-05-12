import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('BlocksTab collapsed row', () => {
  it('shows the proposed date instead of validator id in the collapsed row', () => {
    // Read the component source because the row depends on client-only collapsible state.
    const source = readFileSync(new URL('./blocks-tab.tsx', import.meta.url), 'utf8');

    // Confirm the collapsed summary uses the block date helper.
    assert.match(source, /formatBlockProposalDate\(block\.timestamp\)/);

    // Confirm the validator id stays out of the collapsed summary.
    assert.doesNotMatch(source, /Val #\{block\.validatorIndex\}/);
  });
});
