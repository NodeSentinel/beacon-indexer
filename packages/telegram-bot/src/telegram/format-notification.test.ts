import assert from 'node:assert/strict';
import test from 'node:test';

import { formatNotificationMessage } from './format-notification.js';

test('formatNotificationMessage formats opened incident notifications with truncated validators', () => {
  // This payload exercises the opened incident notification formatter.
  const message = formatNotificationMessage('incident_opened', {
    clusterName: 'Main validators',
    openedAt: '2026-04-21T12:00:00.000Z',
    openedSlot: 123,
    validatorIndexes: Array.from({ length: 55 }, (_, index) => index + 1),
  });

  // This assertion verifies the alert is readable and stays below Telegram message limits.
  assert.equal(
    message,
    [
      'Cluster incident opened',
      'Cluster: Main validators',
      'Started slot: 123',
      'Started at: 2026-04-21T12:00:00.000Z',
      'Affected validators: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50 ... and 5 more',
    ].join('\n'),
  );
});

test('formatNotificationMessage formats closed incident rewards from token values', () => {
  // This payload exercises the closed incident notification formatter.
  const message = formatNotificationMessage('incident_closed', {
    clusterName: 'Main validators',
    closedAt: '2026-04-21T13:00:00.000Z',
    closedSlot: 153,
    durationSeconds: 3600,
    durationSlots: 30,
    missedConsensusRewards: { token: '0.123', wei: '123000000000000000' },
    validatorIndexes: [10],
  });

  // This assertion verifies the human-readable reward value is used in Telegram copy.
  assert.match(message, /Missed rewards: 0\.123/);
});
