import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';

/** Frame for signed-out pages (sign in, reset password, accept invitation, forced change). */
export function PublicLayout({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col">
      <div className="h-2 bg-spine" aria-hidden />
      <div className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-ink-soft">{t('app.name')}</p>
              <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">{title}</h1>
              {intro && <p className="mt-2 text-sm text-ink-soft">{intro}</p>}
            </div>
            <LanguageSwitcher />
          </div>
          <div className="rounded-lg border border-rule border-l-4 border-l-spine bg-sheet p-5 sm:p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
