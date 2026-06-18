import assert from 'node:assert/strict';
import test from 'node:test';

import { formatNotificationMessage } from './format-notification.js';

test('formatNotificationMessage formats opened incident notifications without validator details', () => {
  // This payload exercises the opened incident notification formatter.
  const message = formatNotificationMessage('incident_opened', {
    clusterName: 'Main validators',
    openedAt: '2026-04-21T12:00:00.000Z',
    openedSlot: 123,
  });

  // This assertion verifies the alert only states the incident status and cluster.
  assert.equal(
    message,
    [
      'Cluster incident opened',
      'Cluster: Main validators',
      'Started slot: 123',
      'Started at: 2026-04-21 12:00:00 UTC',
    ].join('\n'),
  );
});

test('formatNotificationMessage formats open incident reminders with elapsed duration', () => {
  // This payload exercises a repeat alert for an incident that is still open.
  const message = formatNotificationMessage('incident_opened', {
    clusterName: 'Main validators',
    isReminder: true,
    now: '2026-04-21T15:30:00.000Z',
    openedAt: '2026-04-21T12:00:00.000Z',
  });

  // This assertion verifies reminders include a dynamic elapsed duration.
  assert.equal(
    message,
    'There is an incident for cluster Main validators, it has been opened for 3 hours.',
  );
});

test('formatNotificationMessage formats closed incident notifications without reward details', () => {
  // This payload exercises the closed incident notification formatter.
  const message = formatNotificationMessage('incident_closed', {
    clusterName: 'Main validators',
    closedAt: '2026-04-21T13:00:00.000Z',
    closedSlot: 153,
  });

  // This assertion verifies close notifications only state the incident status and cluster.
  assert.equal(
    message,
    [
      'Cluster incident resolved',
      'Cluster: Main validators',
      'Closed slot: 153',
      'Closed at: 2026-04-21 13:00:00 UTC',
    ].join('\n'),
  );
});
