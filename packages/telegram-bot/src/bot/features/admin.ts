import { chatAction } from '@grammyjs/auto-chat-action';
import { Composer } from 'grammy';

import type { Context } from '@/src/bot/context.js';

import { isAdmin } from '@/src/bot/filters/is-admin.js';
import { setCommandsHandler } from '@/src/bot/handlers/commands/setcommands.js';
import { createCommunicationHandler } from '@/src/bot/handlers/communications/create.js';
import { listCommunicationsHandler } from '@/src/bot/handlers/communications/list.js';
import { sendCommunicationHandler } from '@/src/bot/handlers/communications/send.js';
import { logHandle } from '@/src/bot/helpers/logging.js';

const composer = new Composer<Context>();

const feature = composer.chatType('private').filter(isAdmin);

feature.command(
  'setcommands',
  logHandle('command-setcommands'),
  chatAction('typing'),
  setCommandsHandler,
);

feature.command(
  'create_communication',
  logHandle('command-create-communication'),
  chatAction('typing'),
  createCommunicationHandler,
);

feature.command(
  'list_communications',
  logHandle('command-list-communications'),
  chatAction('typing'),
  listCommunicationsHandler,
);

feature.command(
  'send_communication',
  logHandle('command-send-communication'),
  chatAction('typing'),
  sendCommunicationHandler,
);

export { composer as adminFeature };
