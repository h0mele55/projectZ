import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

import { ThemeProvider } from '@/components/theme/ThemeProvider';

import './globals.css';

export const metadata: Metadata = {
  title: 'playerz.bg',
  description: 'Book a court. Find a game. Multi-sport booking across Bulgaria.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    // Installed to the home screen, the app should not render the browser's
    // status-bar chrome over its own header.
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'playerz',
  },
};

export const viewport: Viewport = {
  /**
   * THE OS/BROWSER CHROME COLOUR.
   *
   * It was not set at all — and that bites NOW, because we ship a PWA (P22) and
   * two themes (P23). Installed to a home screen, the status bar and the address
   * bar were rendering in the browser's default grey, matching NEITHER theme. The
   * app looked like a web page in a frame rather than an app.
   *
   * A single colour would be no better: it would be right in one theme and wrong
   * in the other. So it is a PAIR, keyed on the same media query the design system
   * uses, and the values are the actual `--bg-page` tokens — not approximations.
   * A chrome colour that is *nearly* the page background is more obviously wrong
   * than one that is completely different, because the seam is visible.
   */
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0d110e' },
    { media: '(prefers-color-scheme: light)', color: '#f4f2ed' },
  ],

  // `viewport-fit=cover` is what makes env(safe-area-inset-*) return anything
  // other than 0. Without it the safe-area utilities added in globals.css are
  // silently no-ops and the notch still eats the header.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
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
