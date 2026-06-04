import { useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { getI18n } from './index';
import type { SupportedLocale } from './config';

const instance = getI18n();

export function LocaleProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}

/**
 * Sync `<html lang>` with the active i18next language after hydration.
 * Mount once near the root.
 */
export function HtmlLangSync() {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState<string>(i18n.language || 'en-US');

  useEffect(() => {
    const handler = (next: string) => setLang(next);
    i18n.on('languageChanged', handler);
    setLang(i18n.language || 'en-US');
    return () => {
      i18n.off('languageChanged', handler);
    };
  }, [i18n]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  return null;
}

export function useCurrentLocale(): SupportedLocale {
  const { i18n } = useTranslation();
  return ((i18n.language as SupportedLocale) || 'en-US');
}
