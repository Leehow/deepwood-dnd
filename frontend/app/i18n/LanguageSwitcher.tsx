import { useTranslation } from 'react-i18next';
import { setLocale, SUPPORTED_LOCALES, type SupportedLocale } from './index';

interface Props {
  className?: string;
  /** Optional callback fired after locale change resolves. */
  onChange?: (next: SupportedLocale) => void;
}

export function LanguageSwitcher({ className, onChange }: Props) {
  const { i18n, t } = useTranslation('common');
  const current = (i18n.language as SupportedLocale) || 'en-US';

  return (
    <select
      aria-label={t('language.label')}
      value={current}
      onChange={async (e) => {
        const next = e.target.value as SupportedLocale;
        await setLocale(next);
        onChange?.(next);
      }}
      className={
        className ??
        'bg-transparent border border-amber-700/40 text-amber-200 text-xs rounded px-2 py-1 hover:border-amber-500/60 focus:outline-none cursor-pointer'
      }
    >
      {SUPPORTED_LOCALES.map((locale) => (
        <option key={locale} value={locale} className="bg-[#1a1d24] text-amber-100">
          {t(`language.${locale}`)}
        </option>
      ))}
    </select>
  );
}
