import { getRequestConfig } from 'next-intl/server';

// Bulgarian is playerz.bg's primary locale; English is the fallback.
// P06 wires real locale negotiation (cookie / Accept-Language / URL).
export const LOCALES = ['bg', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'bg';

export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../../messages/${locale}.json`)).default,
  };
});
