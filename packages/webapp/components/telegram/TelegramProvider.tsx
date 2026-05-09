'use client';

import { init, miniApp, swipeBehavior, themeParams, viewport } from '@telegram-apps/sdk';
import { useLaunchParams, useRawInitData } from '@telegram-apps/sdk-react';
import { type PropsWithChildren, useEffect, useState } from 'react';

import { BackButtonBinder } from './BackButtonBinder';

import { env } from '@/env';
import { initializeAnonymousAuth, initializeTelegramAuth } from '@/lib/auth-session';

/**
 * Mount viewport, expand to full height, and bind CSS variables
 * for --tg-viewport-height, --tg-viewport-stable-height, theme colors, etc.
 */
async function setupViewportAndTheme() {
  try {
    // Mount and bind theme CSS vars (--tg-theme-bg-color, --tg-theme-text-color, etc.)
    if (miniApp.mount.isAvailable()) {
      miniApp.mount();
      if (miniApp.bindCssVars.isAvailable()) {
        miniApp.bindCssVars();
      }
    }

    if (themeParams.mount.isAvailable()) {
      themeParams.mount();
      if (themeParams.bindCssVars.isAvailable()) {
        themeParams.bindCssVars();
      }
    }

    // Mount viewport, expand, and bind CSS vars (--tg-viewport-height, --tg-viewport-stable-height)
    if (viewport.mount.isAvailable()) {
      await viewport.mount();
      if (viewport.bindCssVars.isAvailable()) {
        viewport.bindCssVars();
      }

      if (viewport.expand.isAvailable()) {
        viewport.expand();
      }
    }

    // Disable vertical swipe-to-close to prevent accidental dismissal while scrolling
    if (swipeBehavior.mount.isAvailable()) {
      swipeBehavior.mount();
      if (swipeBehavior.disableVertical.isAvailable()) {
        swipeBehavior.disableVertical();
      }
    }
  } catch (err) {
    console.warn('Telegram viewport/theme setup failed:', err);
  }
}

/**
 * Inner component that handles post-SDK initialization
 */
function TelegramAppInitializer({ children }: PropsWithChildren) {
  const lp = useLaunchParams();
  const rawInitData = useRawInitData();
  const [isTelegramReady, setIsTelegramReady] = useState(false);

  useEffect(() => {
    if (rawInitData) {
      initializeTelegramAuth(rawInitData);
      setIsTelegramReady(true);
    }
  }, [rawInitData]);

  useEffect(() => {
    // Setup viewport, theme CSS vars, and swipe behavior
    setupViewportAndTheme();
  }, []);

  useEffect(() => {
    // Log launch params in development
    if (env.NODE_ENV === 'development') {
      console.log('Telegram Mini App initialized', {
        platform: lp.platform,
        version: lp.version,
        initData: lp.initData,
      });
    }
  }, [lp]);

  // Telegram sessions must not fall back to anonymous auth.
  if (!isTelegramReady) {
    return null;
  }

  return (
    <>
      <BackButtonBinder />
      {children}
    </>
  );
}

/**
 * Telegram SDK Provider
 * Wraps the app with Telegram Mini Apps SDK functionality
 *
 * Features:
 * - Auto-detects Telegram environment
 * - Provides launch params access
 * - Expands viewport to full height and binds CSS variables
 * - Disables vertical swipe-to-close gesture
 */
export function TelegramProvider({ children }: PropsWithChildren) {
  const [isMounted, setIsMounted] = useState(false);
  const [isTelegramEnvironment, setIsTelegramEnvironment] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    // Initialize Telegram Mini Apps SDK
    let cleanup: VoidFunction | undefined;
    try {
      cleanup = init();
      setIsTelegramEnvironment(true);
    } catch (err) {
      // Non-Telegram webapp sessions use anonymous auth from the start.
      initializeAnonymousAuth();
      setIsAuthReady(true);
      console.warn('Telegram SDK init failed or unavailable:', err);
    }

    return () => {
      try {
        cleanup?.();
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [isMounted]);

  // Don't render SDK components on server
  if (!isMounted) {
    return null;
  }

  // Wait until anonymous web auth is initialized when Telegram SDK is absent.
  if (!isTelegramEnvironment && !isAuthReady) {
    return null;
  }

  if (!isTelegramEnvironment) {
    return <div>{children}</div>;
  }

  return <TelegramAppInitializer>{children}</TelegramAppInitializer>;
}
