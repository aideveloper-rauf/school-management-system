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

/** Absence notice to a guardian. Names and the date only — no reasons, marks or other records. */
const absenceEn = (v: { school: string; guardian: string; student: string; date: string }) => ({
  subject: `${v.school}: absence on ${v.date}`,
  text:
    `Dear ${v.guardian},\n\n${v.student} was marked absent at ${v.school} on ${v.date}.\n` +
    `If you were not expecting this, please contact the school.\n\n` +
    `You receive this because the school has your email address for attendance notices.`,
});
const absenceByLocale: Partial<Record<Locale, typeof absenceEn>> = { en: absenceEn };

export function absenceEmail(locale: string, v: { school: string; guardian: string; student: string; date: string }) {
  return (absenceByLocale[locale as Locale] ?? absenceEn)(v);
}

/** Short SMS versions (one SMS segment where possible). Names and date only. */
const smsEn = {
  absence: (v: { school: string; student: string; date: string }) =>
    `${v.school}: ${v.student} was absent on ${v.date}. Please contact the school if unexpected.`,
  announcement: (v: { school: string; title: string }) => `${v.school}: ${v.title}. Read the full notice in the school app.`,
};
const smsByLocale: Partial<Record<Locale, typeof smsEn>> = { en: smsEn };
export const absenceSms = (locale: string, v: { school: string; student: string; date: string }) =>
  (smsByLocale[locale as Locale] ?? smsEn).absence(v);
export const announcementSms = (locale: string, v: { school: string; title: string }) =>
  (smsByLocale[locale as Locale] ?? smsEn).announcement(v);

/** Email copy of an announcement for guardians who asked for email notices. */
export function announcementEmail(locale: string, v: { school: string; guardian: string; title: string; body: string }) {
  void locale; // si/ta texts fall back to English until translated
  return {
    subject: `${v.school}: ${v.title}`,
    text: `Dear ${v.guardian},\n\n${v.title}\n\n${v.body}\n\nYou receive this because the school has your email address for notices.`,
  };
}
