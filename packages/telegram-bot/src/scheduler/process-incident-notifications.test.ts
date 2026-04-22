import assert from 'node:assert/strict';
import test from 'node:test';

import type { InlineKeyboardMarkup } from 'grammy/types';

import { buildIncidentNotificationSendOptions } from './process-incident-notifications.js';

/** Gets the inline keyboard from send options for assertions. */
function getInlineKeyboardMarkup(
  type: 'incident_opened' | 'incident_closed',
): InlineKeyboardMarkup {
  const options = buildIncidentNotificationSendOptions(type);
  assert.ok(options);
  assert.ok(options.reply_markup);
  assert.ok('inline_keyboard' in options.reply_markup);

  return options.reply_markup;
}

test('buildIncidentNotificationSendOptions adds a dismiss button to opened incident notifications', () => {
  // This case builds the Telegram send options for an opened incident alert.
  const replyMarkup = getInlineKeyboardMarkup('incident_opened');

  // This assertion verifies users can dismiss opened incident alerts from Telegram.
  assert.deepEqual(replyMarkup.inline_keyboard, [
    [{ text: 'Dismiss', callback_data: 'remove_message' }],
  ]);
});

test('buildIncidentNotificationSendOptions adds a dismiss button to closed incident notifications', () => {
  // This case builds the Telegram send options for a closed incident alert.
  const replyMarkup = getInlineKeyboardMarkup('incident_closed');

  // This assertion verifies users can dismiss closed incident alerts from Telegram.
  assert.deepEqual(replyMarkup.inline_keyboard, [
    [{ text: 'Dismiss', callback_data: 'remove_message' }],
  ]);
});
