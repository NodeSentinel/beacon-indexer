import { emitEvent, mockTelegramEnv } from '@tma.js/sdk-react';

/**
 * Mocks the Telegram Mini Apps environment for development
 * This allows testing outside of the Telegram client
 *
 * IMPORTANT: Only call this in development mode
 */
export function setupTelegramMock(): void {
  const themeParams = {
    accent_text_color: '#6ab2f2',
    bg_color: '#17212b',
    button_color: '#5288c1',
    button_text_color: '#ffffff',
    destructive_text_color: '#ec3942',
    header_bg_color: '#17212b',
    hint_color: '#708499',
    link_color: '#6ab3f3',
    secondary_bg_color: '#232e3c',
    section_bg_color: '#17212b',
    section_header_text_color: '#6ab3f3',
    subtitle_text_color: '#708499',
    text_color: '#f5f5f5',
  } as const;

  const noInsets = { left: 0, top: 0, bottom: 0, right: 0 } as const;

  mockTelegramEnv({
    onEvent(e) {
      // Handle Telegram Mini Apps methods
      // https://docs.telegram-mini-apps.com/platform/methods
      if (e.name === 'web_app_request_theme') {
        return emitEvent('theme_changed', { theme_params: themeParams });
      }
      if (e.name === 'web_app_request_viewport') {
        return emitEvent('viewport_changed', {
          height: window.innerHeight,
          width: window.innerWidth,
          is_expanded: true,
          is_state_stable: true,
        });
      }
      if (e.name === 'web_app_request_content_safe_area') {
        return emitEvent('content_safe_area_changed', noInsets);
      }
      if (e.name === 'web_app_request_safe_area') {
        return emitEvent('safe_area_changed', noInsets);
      }
    },
    launchParams: new URLSearchParams([
      ['tgWebAppThemeParams', JSON.stringify(themeParams)],
      [
        'tgWebAppData',
        new URLSearchParams([
          ['auth_date', ((new Date().getTime() / 1000) | 0).toString()],
          ['hash', 'dev-mock-hash'],
          [
            'user',
            JSON.stringify({
              id: 99281932,
              first_name: 'Dev',
              last_name: 'User',
              username: 'devuser',
              language_code: 'en',
            }),
          ],
        ]).toString(),
      ],
      ['tgWebAppVersion', '8.4'],
      ['tgWebAppPlatform', 'tdesktop'],
    ]),
  });

  console.info(
    '⚠️ Telegram environment mocked for development. This should not happen in production.',
  );
}

/**
 * Check if we should mock the Telegram environment
 * Only mock in development and when explicitly enabled
 */
export function shouldMockTelegram(): boolean {
  // Only run on client side
  if (typeof window === 'undefined') {
    return false;
  }

  // Check if we're in development
  if (process.env.NODE_ENV !== 'development') {
    return false;
  }

  // Check if already in Telegram environment
  if ('Telegram' in window) {
    return false;
  }

  // Check if mock is explicitly enabled (from env.ts)
  return process.env.NEXT_PUBLIC_TG_MOCK === 'true';
}
