import type { Config } from '@/src/config.js';
import type { Logger } from '@/src/logger.js';
import type { AutoChatActionFlavor } from '@grammyjs/auto-chat-action';
import type { HydrateFlavor } from '@grammyjs/hydrate';
import type { I18nFlavor } from '@grammyjs/i18n';
import type { ParseModeFlavor } from '@grammyjs/parse-mode';
import type { Context as DefaultContext, SessionFlavor } from 'grammy';

export type SessionData = Record<string, unknown>;

interface ExtendedContextFlavor {
  logger: Logger;
  config: Config;
}

export type Context = ParseModeFlavor<
  HydrateFlavor<
    DefaultContext &
      ExtendedContextFlavor &
      SessionFlavor<SessionData> &
      I18nFlavor &
      AutoChatActionFlavor
  >
>;
