import { Command, CommandGroup } from '@grammyjs/commands';

import type { LanguageCode } from '@grammyjs/types';
import type { CommandContext } from 'grammy';
import type { Context } from '@/src/bot/context.js';

import { i18n } from '@/src/bot/i18n.js';

function addCommandLocalizations(command: Command) {
  i18n.locales.forEach((locale) => {
    command.localize(
      locale as LanguageCode,
      command.name,
      i18n.t(locale, `${command.name}.description`),
    );
  });
  return command;
}

export async function setCommandsHandler(ctx: CommandContext<Context>) {
  // const start = new Command('start', i18n.t('en', 'start.description')).addToScope({
  //   type: 'all_private_chats',
  // });
  // addCommandLocalizations(start);

  const dashboard = new Command('dashboard', i18n.t('en', 'dashboard.description')).addToScope({
    type: 'all_private_chats',
  });
  addCommandLocalizations(dashboard);

  // const setcommands = new Command('setcommands', i18n.t('en', 'setcommands.description'));
  // addCommandToChats(setcommands, ctx.config.botAdmins);

  const commands = new CommandGroup()
    // .add(start)
    //.add(language)
    .add(dashboard);
  //.add(setcommands);

  await commands.setCommands(ctx);

  return ctx.reply(ctx.t('admin-commands-updated'));
}
