import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LOCALES } from '@sms/shared';

/** Compact language picker (names shown in their own script). */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <label className="relative flex items-center">
      <span className="sr-only">{t('language.label')}</span>
      <Languages aria-hidden className="pointer-events-none absolute left-2.5 size-4 text-fg-faint" />
      <select
        className="h-8 rounded-md border border-line bg-surface pr-2 pl-8 text-[0.8125rem] text-fg hover:border-line-strong"
        value={i18n.resolvedLanguage}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`language.${l}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
