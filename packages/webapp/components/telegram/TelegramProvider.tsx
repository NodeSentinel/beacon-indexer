'use client';

import { init } from '@tma.js/sdk';
import { useLaunchParams } from '@tma.js/sdk-react';
import { type PropsWithChildren, useEffect, useState } from 'react';

import { BackButtonBinder } from './BackButtonBinder';

import { shouldMockTelegram, setupTelegramMock } from '@/lib/mockTelegramEnv';

/**
 * Inner component that handles post-SDK initialization
 */
function TelegramAppInitializer({ children }: PropsWithChildren) {
  const lp = useLaunchParams();

  useEffect(() => {
    // Log launch params in development
    if (process.env.NODE_ENV === 'development') {
      console.log('🚀 Telegram Mini App initialized', {
        platform: lp.platform,
        version: lp.version,
        initData: lp.initData,
      });
    }
  }, [lp]);

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
 * - Mocks environment in development (if NEXT_PUBLIC_TG_MOCK=true)
 * - Provides launch params access
 */
export function TelegramProvider({ children }: PropsWithChildren) {
  const [isMounted, setIsMounted] = useState(false);
  const [isSdkReady, setIsSdkReady] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    // Setup mock if needed (client-side only)
    if (shouldMockTelegram()) {
      console.log('🎭 Mocking Telegram environment for development');
      setupTelegramMock();
    }

    // Initialize Telegram Mini Apps SDK
    let cleanup: VoidFunction | undefined;
    try {
      cleanup = init();
      setIsSdkReady(true);
    } catch (err) {
      // Avoid breaking the app if init fails in non-Telegram environments
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
    return <>{children}</>;
  }

  // Render Telegram-dependent parts only after SDK is ready
  if (!isSdkReady) {
    return <>{children}</>;
  }

  return <TelegramAppInitializer>{children}</TelegramAppInitializer>;
}
