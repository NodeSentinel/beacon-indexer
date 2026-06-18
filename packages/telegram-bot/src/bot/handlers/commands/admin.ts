import type { CommandContext } from 'grammy';

import type { Context } from '@/src/bot/context.js';

/**
 * Builds the hidden admin command helper message.
 */
export function getAdminHelpMessage() {
  return [
    '<b>Admin commands</b>',
    '/create_communication &lt;description&gt; &gt;&gt; &lt;message&gt; - create pending communication',
    '/list_communications - show pending previews',
    '/send_communication &lt;id&gt; - send pending communication',
    '/setcommands - refresh public commands',
  ].join('\n');
}

/**
 * Replies with the hidden admin command helper.
 */
export function adminHelpHandler(ctx: CommandContext<Context>) {
  return ctx.reply(getAdminHelpMessage());
}
