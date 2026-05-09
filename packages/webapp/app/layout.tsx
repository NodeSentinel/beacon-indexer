import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import { Roboto_Mono } from 'next/font/google';
import localFont from 'next/font/local';

import './globals.css';

import type React from 'react';

import ValidatorHeader from '@/components/cluster/validator-header';
import { TelegramProvider } from '@/components/telegram/TelegramProvider';
import { QueryProvider } from '@/lib/query-provider';

const robotoMono = Roboto_Mono({
  variable: '--font-roboto-mono',
  subsets: ['latin'],
});

const rebelGrotesk = localFont({
  src: '../public/fonts/Rebels-Fett.woff2',
  variable: '--font-rebels',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    template: '%s – NodeSentinel',
    default: 'NodeSentinel',
  },
  description: 'Beacon Chain validator monitoring dashboard',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icon.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/Rebels-Fett.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const saved = localStorage.getItem('theme');
                const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
                document.documentElement.classList.remove('light','dark');
                document.documentElement.classList.add(theme);
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className={`${rebelGrotesk.variable} ${robotoMono.variable} antialiased`}>
        <QueryProvider>
          <TelegramProvider>
            <ValidatorHeader />
            <div className="w-full max-w-7xl mx-auto px-4 lg:px-8">{children}</div>
            {/* Mounts Vercel traffic analytics for the full app. */}
            <Analytics />
            {/* Mounts Vercel performance insights for the full app. */}
            <SpeedInsights />
          </TelegramProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
