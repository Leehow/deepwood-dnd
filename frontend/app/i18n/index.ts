import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALE_STORAGE_KEY,
  NAMESPACES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  normalizeLocale,
} from './config';
import { resources } from './resources';

function detectInitialLocale(): SupportedLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) return normalizeLocale(stored);
  } catch {
    /* localStorage unavailable */
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalizeLocale(navigator.language);
  }
  return DEFAULT_LOCALE;
}

let initialized = false;

export function getI18n() {
  if (!initialized) {
    const isBrowser = typeof window !== 'undefined';
    const chain = isBrowser
      ? i18n.use(LanguageDetector).use(initReactI18next)
      : i18n.use(initReactI18next);

    chain.init({
      resources,
      // On SSR we pin to DEFAULT_LOCALE; in the browser LanguageDetector picks it up
      // from localStorage / navigator, falling back to the value we computed.
      lng: isBrowser ? detectInitialLocale() : DEFAULT_LOCALE,
      fallbackLng: FALLBACK_LOCALE,
      supportedLngs: SUPPORTED_LOCALES as unknown as string[],
      ns: NAMESPACES as unknown as string[],
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      returnNull: false,
      react: { useSuspense: false },
      detection: {
        order: ['localStorage', 'navigator', 'htmlTag'],
        lookupLocalStorage: LOCALE_STORAGE_KEY,
        caches: ['localStorage'],
      },
    });
    initialized = true;
  }
  return i18n;
}

export async function setLocale(next: SupportedLocale) {
  const instance = getI18n();
  await instance.changeLanguage(next);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next;
    }
  }
}

export { default as i18nInstance } from 'i18next';
export * from './config';
