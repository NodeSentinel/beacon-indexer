import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('Cluster analytics token labels', () => {
  it('does not render hardcoded consensus or execution token labels', () => {
    // Read both analytics components because the dashboard has legacy and current analytics views.
    const sources = [
      readFileSync(new URL('./analytics.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('./analytics-content.tsx', import.meta.url), 'utf8'),
    ].join('\n');

    // Confirm rendered token labels come from chain-derived variables instead of fixed Gnosis labels.
    assert.doesNotMatch(sources, /\}\s+GNO/);
    assert.doesNotMatch(sources, /\}\s+xDAI/);
    assert.doesNotMatch(sources, /token="GNO"/);
    assert.doesNotMatch(sources, /token="xDAI"/);
  });
});
