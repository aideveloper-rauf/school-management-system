import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { NAV } from '../routes/nav';
import { LanguageSwitcher } from './LanguageSwitcher';

export function AppShell() {
  const { t } = useTranslation();
  const { session, can, logout } = useAuth();
  const items = NAV.filter((n) => n.anyOf.length === 0 || n.anyOf.some(can));

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:w-64 md:border-b-0 md:border-r">
        <div className="px-4 py-4 text-lg font-semibold text-brand-700">{t('app.name')}</div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {items.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              end={n.path === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`
              }
            >
              {t(n.labelKey)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <span className="text-sm text-slate-600">{session?.user.displayName}</span>
          <LanguageSwitcher />
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
          >
            {t('auth.logout')}
          </button>
        </header>
        <main className="p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
