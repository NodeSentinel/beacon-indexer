import { describe, expect, it } from 'vitest';

import { resolveCommunicationRecipients } from './bot-communication-recipients.js';

const broadcastTelegramIds = ['1001', '1002', '1003'];

describe('resolveCommunicationRecipients', () => {
  it('returns all broadcast telegram ids when onlyTo and exclude are empty', () => {
    // This case verifies the default broadcast behavior.
    const recipients = resolveCommunicationRecipients(broadcastTelegramIds, {
      exclude: [],
      onlyTo: [],
    });

    expect(recipients).toEqual(['1001', '1002', '1003']);
  });

  it('returns the telegram ids listed in onlyTo even when they are not in the broadcast list', () => {
    // This case verifies the targeted-send behavior without a database lookup.
    const recipients = resolveCommunicationRecipients(broadcastTelegramIds, {
      exclude: [],
      onlyTo: ['2001', '2002'],
    });

    expect(recipients).toEqual(['2001', '2002']);
  });

  it('removes excluded telegram ids from the final send list', () => {
    // This case verifies the precedence rule agreed for the feature.
    const recipients = resolveCommunicationRecipients(broadcastTelegramIds, {
      exclude: ['2002'],
      onlyTo: ['2001', '2002'],
    });

    expect(recipients).toEqual(['2001']);
  });
});
