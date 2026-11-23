import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages, ShieldCheck, Smartphone } from 'lucide-react';
import { useResource } from '../lib/data';
import { LanguageSwitcher } from './LanguageSwitcher';

interface Branding {
  name: string | null;
  shortName: string | null;
}

/** Split-screen frame for signed-out pages: school brand panel (wide screens) + form. */
export function PublicLayout({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const { t } = useTranslation();
  const branding = useResource<Branding>('/school/branding');
  const school = branding.data?.name ?? t('app.name');
  const initials =
    school
      .split(/\s+/)
      .filter((w) => /^\p{L}/u.test(w))
      .slice(0, 2)
      .map((w) => [...w][0])
      .join('')
      .toUpperCase() || 'S';

  const facts = [
    { icon: ShieldCheck, text: t('public.factData') },
    { icon: Languages, text: t('public.factLanguages') },
    { icon: Smartphone, text: t('public.factDevices') },
  ];

  return (
    <div className="grid min-h-screen bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-900 p-10 text-white lg:flex">
        {/* Quiet grid texture, purely decorative. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:40px_40px]"
        />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-white/15 text-sm font-semibold ring-1 ring-white/25">
            {initials}
          </span>
          <span className="text-sm text-white/80">{t('app.name')}</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-[-0.015em]">{school}</h2>
          <p className="mt-3 text-[0.9375rem] text-white/75">{t('public.tagline')}</p>
          <ul className="mt-10 space-y-4">
            {facts.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/85">
                <Icon aria-hidden className="mt-0.5 size-4.5 shrink-0 text-brand-200" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/50">
          © {new Date().getFullYear()} {school}
        </p>
      </aside>

      <div className="flex flex-col">
        <div className="flex h-14 items-center justify-between gap-3 border-b border-line px-4 sm:px-6 lg:border-b-0">
          <div className="flex min-w-0 items-center gap-2.5 lg:invisible">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-[0.8125rem] font-semibold text-white"
            >
              {initials}
            </span>
            <span className="truncate text-sm font-semibold">{school}</span>
          </div>
          <LanguageSwitcher />
        </div>
        <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:px-6">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
            {intro && <p className="mt-2 text-sm text-fg-muted">{intro}</p>}
            <div className="mt-7">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
