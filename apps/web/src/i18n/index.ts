import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES } from '@sms/shared';
import en from './locales/en.json';
import si from './locales/si.json';
import ta from './locales/ta.json';

const stored = (() => { try { return localStorage.getItem('sms.locale'); } catch { return null; } })();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, si: { translation: si }, ta: { translation: ta } },
  lng: stored && (LOCALES as readonly string[]).includes(stored) ? stored : DEFAULT_LOCALE,
  // Missing Sinhala/Tamil strings fall back to English until translations are supplied.
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...LOCALES],
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try { localStorage.setItem('sms.locale', lng); } catch { /* storage unavailable */ }
});

export default i18n;
