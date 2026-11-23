import type { Locale } from '@sms/shared';

/**
 * Email texts per locale. Only English exists so far; si/ta fall back to English until the
 * translator supplies them (backlog: Sinhala and Tamil translations). Keep them short and
 * plain-text: they are read on basic phones and low bandwidth.
 */
interface Template {
  subject: (v: { school: string }) => string;
  text: (v: { school: string; name: string; link: string; hours: number }) => string;
}

const en: Record<'invite' | 'reset', Template> = {
  invite: {
    subject: ({ school }) => `Your ${school} account`,
    text: ({ school, name, link, hours }) =>
      `Hello ${name},\n\nAn account has been created for you at ${school}.\n` +
      `Open this link to choose your password (valid for ${hours} hours):\n\n${link}\n\n` +
      `If you did not expect this message, you can ignore it.`,
  },
  reset: {
    subject: ({ school }) => `Reset your ${school} password`,
    text: ({ school, name, link, hours }) =>
      `Hello ${name},\n\nSomeone asked to reset the password for your ${school} account.\n` +
      `Open this link to choose a new password (valid for ${hours} hour${hours === 1 ? '' : 's'}):\n\n${link}\n\n` +
      `If you did not ask for this, ignore this message; your password stays the same.`,
  },
};

const byLocale: Partial<Record<Locale, typeof en>> = { en };

export function emailTemplate(locale: string, kind: 'invite' | 'reset'): Template {
  return (byLocale[locale as Locale] ?? en)[kind];
}
