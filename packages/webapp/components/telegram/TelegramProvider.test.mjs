import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Reads the Telegram provider source for static client-boundary checks.
 */
function readTelegramProviderSource() {
  // Load the client component source from the same directory as this test.
  return readFileSync(new URL('./TelegramProvider.tsx', import.meta.url), 'utf8');
}

describe('TelegramProvider client environment access', () => {
  // This scenario protects Telegram Mini App startup from browser-side server env access.
  it('does not access the server-only env helper from the client component', () => {
    // Read the provider source so the test can inspect the client component boundary.
    const source = readTelegramProviderSource();

    // Confirm the client component does not import the server/client env proxy.
    assert.doesNotMatch(source, /from ['"]@\/env['"]/);

    // Confirm launch params are logged without depending on runtime env access.
    assert.match(source, /console\.log\(['"]Telegram Mini App initialized['"]/);

    // Confirm the client component does not branch on NODE_ENV for logging.
    assert.doesNotMatch(source, /NODE_ENV/);
  });
});
