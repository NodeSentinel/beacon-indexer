import type { Metadata } from 'next';
import { Roboto_Mono } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import type React from 'react';

import { TelegramProvider } from '@/components/telegram/TelegramProvider';
import ValidatorHeader from '@/components/validators/validator-header';
import { V0Provider } from '@/lib/v0-context';

const robotoMono = Roboto_Mono({
  variable: '--font-roboto-mono',
  subsets: ['latin'],
});

const rebelGrotesk = localFont({
  src: '../public/fonts/Rebels-Fett.woff2',
  variable: '--font-rebels',
  display: 'swap',
});

const isV0 = process.env['VERCEL_URL']?.includes('vusercontent.net') ?? false;

export const metadata: Metadata = {
  title: {
    template: '%s – Validator Monitor',
    default: 'Validator Monitor',
  },
  description: 'Beacon Chain validator monitoring dashboard',
  generator: 'v0.app',
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
        <TelegramProvider>
          <V0Provider isV0={isV0}>
            <ValidatorHeader />
            <div className="w-full max-w-7xl mx-auto px-4 lg:px-8">{children}</div>
          </V0Provider>
        </TelegramProvider>
      </body>
    </html>
  );
}
