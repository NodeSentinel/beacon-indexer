import { Composer } from 'grammy';

import type { Context } from '@/src/bot/context.js';

import { logHandle } from '@/src/bot/helpers/logging.js';

const composer = new Composer<Context>();

/**
 * Deletes one broadcast message when the user taps the dismiss button.
 */
composer.callbackQuery('remove_message', logHandle('callback-remove-message'), async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.deleteMessage();
});

export { composer as removeMessageFeature };
