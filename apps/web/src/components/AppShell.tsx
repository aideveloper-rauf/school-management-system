import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { useResource } from '../lib/data';
import { NAV } from '../routes/nav';
import { LanguageSwitcher } from './LanguageSwitcher';

/**
 * The sidebar is the "spine" of the school register: the one bold element of the design.
 * On phones it collapses behind a menu button so content gets the full width.
 */
export function AppShell() {
  const { t } = useTranslation();
  const { session, can, logout } = useAuth();
  const school = useResource<{ name: string; shortName: string | null }>('/school');
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const items = NAV.filter((n) => n.anyOf.length === 0 || n.anyOf.some(can));
  const schoolName = school.data?.name ?? t('app.name');

  return (
    <div className="min-h-screen md:flex">
      <aside className="bg-spine text-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:border-r-4 md:border-spine-dark">
        <div className="flex items-center justify-between gap-2 px-5 py-4 md:block md:py-6">
          <div>
            <p className="text-[1.05rem] leading-snug font-semibold">{schoolName}</p>
            <p className="text-xs text-white/70">{t('app.name')}</p>
          </div>
          <button
            type="button"
            className="min-h-10 rounded-md border border-white/30 px-3 text-sm md:hidden"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {t('common.menu')}
          </button>
        </div>
        <nav
          id="main-nav"
          aria-label={t('common.mainNavigation')}
          className={`${menuOpen ? 'block' : 'hidden'} border-t border-white/15 px-3 pb-4 md:block md:flex-1 md:overflow-y-auto md:border-t-0`}
        >
          <ul className="space-y-0.5 pt-2">
            {items.map((n) => (
              <li key={n.path}>
                <NavLink
                  to={n.path}
                  end={n.path === '/'}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2.5 text-[0.95rem] ${
                      isActive ? 'bg-white font-medium text-spine' : 'text-white/90 hover:bg-white/10'
                    }`
                  }
                >
                  {t(n.labelKey)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-rule bg-sheet px-4 py-3 md:px-8">
          <NavLink to="/account" className="text-sm text-ink hover:underline">
            {session?.user.displayName}
          </NavLink>
          <LanguageSwitcher />
          <button
            type="button"
            onClick={() => void logout()}
            className="min-h-10 rounded-md border border-rule px-3 text-sm hover:border-ink-soft"
          >
            {t('auth.logout')}
          </button>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
