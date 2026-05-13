import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('next.config', () => {
  it('hides the Next development indicator', () => {
    // Read the config source so the dev indicator stays disabled in local development.
    const source = readFileSync(new URL('./next.config.mjs', import.meta.url), 'utf8');

    // Confirm the bottom-left Next development indicator is disabled.
    assert.match(source, /devIndicators:\s*false/);
  });
});
