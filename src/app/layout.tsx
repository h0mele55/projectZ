import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

import { ThemeProvider } from '@/components/theme/ThemeProvider';

import './globals.css';

export const metadata: Metadata = {
  title: 'playerz.bg',
  description: 'Book a court. Find a game. Multi-sport booking across Bulgaria.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The ported primitives call useTranslations(), so the provider has to
  // wrap the whole tree — without it every one of them throws during
  // prerender.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    // ThemeProvider starts in dark (the SSR default) and rehydrates from
    // storage on mount, so suppressHydrationWarning keeps the data-theme
    // flip from tripping React's mismatch check.
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
