export const SUPPORTED_LOCALES = ['en-US', 'zh-CN'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en-US';
export const FALLBACK_LOCALE: SupportedLocale = 'en-US';

export const NAMESPACES = ['common', 'auth', 'home'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const LOCALE_STORAGE_KEY = 'dnd_locale';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Normalize an arbitrary BCP-47 / two-letter code into a SupportedLocale.
 * Falls back to DEFAULT_LOCALE if no reasonable match is found.
 */
export function normalizeLocale(raw: string | null | undefined): SupportedLocale {
  if (!raw) return DEFAULT_LOCALE;
  const lower = raw.toLowerCase();
  if (isSupportedLocale(raw)) return raw;
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en-US';
  return DEFAULT_LOCALE;
}
