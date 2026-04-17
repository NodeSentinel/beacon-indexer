import { describe, expect, it } from 'vitest';

import { resolveCommunicationRecipients } from './bot-communications.js';

const users = [
  { id: 'user-1', telegramId: 1n, username: 'alpha' },
  { id: 'user-2', telegramId: 2n, username: 'beta' },
  { id: 'user-3', telegramId: 3n, username: 'gamma' },
];

describe('resolveCommunicationRecipients', () => {
  it('returns all users when onlyTo and exclude are empty', () => {
    // This case verifies the default broadcast behavior.
    const recipients = resolveCommunicationRecipients(users, {
      exclude: [],
      onlyTo: [],
    });

    expect(recipients.map((user) => user.id)).toEqual(['user-1', 'user-2', 'user-3']);
  });

  it('returns only the users listed in onlyTo', () => {
    // This case verifies the targeted-send behavior.
    const recipients = resolveCommunicationRecipients(users, {
      exclude: [],
      onlyTo: ['user-2', 'user-3'],
    });

    expect(recipients.map((user) => user.id)).toEqual(['user-2', 'user-3']);
  });

  it('removes excluded users even when they also appear in onlyTo', () => {
    // This case verifies the precedence rule agreed for the feature.
    const recipients = resolveCommunicationRecipients(users, {
      exclude: ['user-2'],
      onlyTo: ['user-1', 'user-2'],
    });

    expect(recipients.map((user) => user.id)).toEqual(['user-1']);
  });
});
