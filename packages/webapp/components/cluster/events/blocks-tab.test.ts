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

describe('BlocksTab reward token labels', () => {
  it('does not render hardcoded consensus or execution token labels', () => {
    // Read the component source to catch token labels that bypass chain-derived helpers.
    const source = readFileSync(new URL('./blocks-tab.tsx', import.meta.url), 'utf8');

    // Confirm block reward labels come from chain token config instead of fixed Gnosis labels.
    assert.doesNotMatch(source, /\}\s+GNO/);
    assert.match(source, /tokenSymbol/);
    assert.match(source, /executionTokenSymbol/);
  });
});
