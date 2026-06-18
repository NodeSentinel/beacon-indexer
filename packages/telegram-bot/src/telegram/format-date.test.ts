import assert from 'node:assert/strict';
import test from 'node:test';

import { formatUtcDateTime } from './format-date.js';

test('formatUtcDateTime formats ISO timestamps in UTC', () => {
  // This timestamp includes a non-UTC offset to verify the output is normalized.
  const timestamp = '2026-04-21T09:00:00.000-03:00';

  // This assertion verifies the visible time is UTC and omits ISO separators.
  assert.equal(formatUtcDateTime(timestamp), '2026-04-21 12:00:00 UTC');
});

test('formatUtcDateTime returns a dash for missing timestamps', () => {
  // This assertion verifies optional incident timestamps render as empty fields.
  assert.equal(formatUtcDateTime(undefined), '-');
});
