/**
 * Locale constants — SERVER-SAFE.
 *
 * Mirrors `src/lib/theme-constants.ts`: this module MUST NOT carry a
 * `'use client'` directive and MUST NOT import any client-only module. It is
 * read by SERVER surfaces — the next-intl request config (`src/i18n.ts`) and
 * the `<html lang>` in the root layout — as well as by the client
 * `<LocaleSwitcher>`. Keeping the literal values here (not in a `'use client'`
 * module) avoids the client-reference-proxy trap documented in
 * `theme-constants.ts`, where a server component importing from a client module
 * receives a function proxy instead of the string value.
 *
 * The UI locale is a per-browser preference persisted in a first-party cookie
 * (`inflect_locale`), read server-side in `getRequestConfig` so the FIRST SSR
 * byte is already in the chosen language — no client round-trip, no flash.
 */

/** Every locale the UI ships a message catalog for (`messages/<locale>.json`). */
export const SUPPORTED_LOCALES = ['en', 'bg'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Fallback when no cookie is set or the cookie value is unrecognised. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Cookie name — the server-readable channel that drives `getRequestConfig`.
 * RFC6265 token (no `:`), matching the `inflect_theme` convention.
 */
export const LOCALE_COOKIE = 'inflect_locale';

/**
 * Display names shown in the language switcher. Endonyms — each language is
 * labelled in its OWN language (standard i18n practice), so these are NOT
 * translated through the catalog.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  bg: 'Български',
};

/** Type guard: is `value` one of the supported locales? */
export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Coerce an arbitrary cookie/input value to a supported locale (default fallback). */
export function resolveLocale(value: unknown): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}
