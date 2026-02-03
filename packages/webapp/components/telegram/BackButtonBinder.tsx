'use client';

import { backButton } from '@tma.js/sdk-react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * BackButton integration with Next.js router.
 *
 * This component is responsible for:
 * - Mounting / unmounting Telegram back button safely.
 * - Toggling visibility depending on the current route.
 * - Wiring Telegram back button click to Next.js navigation.
 */
export function BackButtonBinder() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Ensure the Telegram back button is mounted only when supported
    // and ignore errors in non-Telegram environments.
    try {
      if (backButton.isSupported()) {
        backButton.mount();
      }
    } catch (err) {
      // In non-Telegram or misconfigured environments, just noop so the app still works.
      console.warn('Telegram back button mount failed:', err);
    }

    return () => {
      try {
        backButton.unmount();
      } catch {
        // Ignore unmount errors (for example, when it was never mounted).
      }
    };
  }, []);

  useEffect(() => {
    // Hide back button on home page, show on other pages
    const isHomePage = pathname === '/';

    try {
      if (isHomePage) {
        backButton.hide();
      } else {
        backButton.show();
      }
    } catch (err) {
      // If the back button is not mounted or not available, do not break the UI.
      console.warn('Telegram back button visibility change failed:', err);
    }
  }, [pathname]);

  useEffect(() => {
    // Handle back button clicks
    const handleClick = () => {
      router.back();
    };

    let unsubscribe: VoidFunction | undefined;

    try {
      unsubscribe = backButton.onClick(handleClick);
    } catch (err) {
      // If we cannot subscribe to click events, just log it and continue.
      console.warn('Telegram back button onClick binding failed:', err);
    }

    return () => {
      if (!unsubscribe) return;

      try {
        unsubscribe();
      } catch {
        // Ignore unsubscribe errors.
      }
    };
  }, [router]);

  return null;
}
