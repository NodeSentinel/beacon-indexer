import { InlineKeyboard } from 'grammy';
import ISO6391 from 'iso-639-1';

import { changeLanguageData } from '@/src/bot/callback-data/change-language.js';
import type { Context } from '@/src/bot/context.js';

import { chunk } from '@/src/bot/helpers/keyboard.js';
import { i18n } from '@/src/bot/i18n.js';

export async function createChangeLanguageKeyboard(ctx: Context) {
  const currentLocaleCode = await ctx.i18n.getLocale();

  const getLabel = (code: string) => {
    const isActive = code === currentLocaleCode;

    return `${isActive ? '✅ ' : ''}${ISO6391.getNativeName(code)}`;
  };

  return InlineKeyboard.from(
    chunk(
      i18n.locales.map((localeCode) => ({
        text: getLabel(localeCode),
        callback_data: changeLanguageData.pack({
          code: localeCode,
        }),
      })),
      2,
    ),
  );
}
