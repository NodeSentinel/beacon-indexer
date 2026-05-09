import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('ClusterOverviewContent', () => {
  it('does not render hardcoded consensus or execution token labels', () => {
    // Read the component source to catch token labels that bypass chain-derived helpers.
    const source = readFileSync(new URL('./cluster-overview-content.tsx', import.meta.url), 'utf8');

    // Confirm rendered token labels come from variables instead of fixed Gnosis strings.
    assert.doesNotMatch(source, /\}\s+GNO/);
    assert.doesNotMatch(source, /\}\s+xDAI/);
  });
});
