import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, UserRound, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useResource } from '../lib/data';
import { NAV_GROUPS } from '../routes/nav';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Avatar, DropdownMenu, IconButton } from './ui';

const COLLAPSE_KEY = 'sms.sidebarCollapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

/** School mark: initials on the brand colour (no uploaded logo yet). */
function SchoolMark({ name }: { name: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter((w) => /^\p{L}/u.test(w))
      .slice(0, 2)
      .map((w) => [...w][0])
      .join('')
      .toUpperCase() || 'S';
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-[0.8125rem] font-semibold text-white"
    >
      {initials}
    </span>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  return (
    <nav aria-label={t('common.mainNavigation')} className="flex-1 overflow-y-auto px-3 py-3">
      {NAV_GROUPS.map((g) => {
        const items = g.items.filter((n) => n.anyOf.length === 0 || n.anyOf.some(can));
        if (items.length === 0) return null;
        return (
          <div key={g.labelKey} className="mb-4 last:mb-0">
            {!collapsed && <p className="px-2.5 pb-1.5 text-xs font-medium text-fg-faint">{t(g.labelKey)}</p>}
            <ul className="space-y-0.5">
              {items.map((n) => {
                const Icon = n.icon;
                return (
                  <li key={n.path}>
                    <NavLink
                      to={n.path}
                      end={n.path === '/'}
                      onClick={onNavigate}
                      title={collapsed ? t(n.labelKey) : undefined}
                      className={({ isActive }) =>
                        `relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-colors ${collapsed ? 'justify-center' : ''} ${
                          isActive
                            ? 'bg-brand-50 font-medium text-brand-700 before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r before:bg-brand-600'
                            : 'text-fg-muted hover:bg-subtle hover:text-fg'
                        }`
                      }
                    >
                      <Icon aria-hidden className="size-[1.125rem] shrink-0" />
                      {collapsed ? (
                        <span className="sr-only">{t(n.labelKey)}</span>
                      ) : (
                        <>
                          <span className="truncate">{t(n.labelKey)}</span>
                          {n.soon && (
                            <span className="ml-auto rounded bg-subtle px-1.5 py-px text-[0.6875rem] font-medium text-fg-faint">
                              {t('common.soon')}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const school = useResource<{ name: string; shortName: string | null }>('/school');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  const schoolName = school.data?.name ?? t('app.name');
  const user = session?.user;
  const roleNames = user?.roles.map((r) => t(`roles.${r}`)).join(', ') ?? '';

  const brand = (compact: boolean) => (
    <div className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-line ${compact ? 'justify-center px-2' : 'px-4'}`}>
      <SchoolMark name={schoolName} />
      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-sm leading-tight font-semibold text-fg" title={schoolName}>
            {school.data?.shortName || schoolName}
          </p>
          <p className="truncate text-xs text-fg-faint">{t('app.name')}</p>
        </div>
      )}
    </div>
  );

  return (
    // --sidebar-w lets fixed bars (e.g. unsaved changes) line up with the content area.
    <div className="min-h-screen" style={{ ['--sidebar-w' as string]: collapsed ? '4rem' : '15rem' }}>
      <a href="#main" className="sr-only z-50 rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        {t('common.skipToContent')}
      </a>

      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface md:flex ${collapsed ? 'w-16' : 'w-60'}`}
        aria-label={t('common.sidebar')}
      >
        {brand(collapsed)}
        <SidebarNav collapsed={collapsed} />
        <div className={`border-t border-line p-2 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
            title={collapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
            className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[0.8125rem] text-fg-muted hover:bg-subtle hover:text-fg"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && t('common.collapseSidebar')}
          </button>
        </div>
      </aside>

      {/* Mobile off-canvas sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t('common.mainNavigation')}>
          <div className="absolute inset-0 bg-fg/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-[var(--shadow-pop)]">
            <div className="flex items-center justify-between pr-2">
              {brand(false)}
              <IconButton label={t('common.close')} onClick={() => setMobileOpen(false)} autoFocus>
                <X className="size-5" />
              </IconButton>
            </div>
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className={collapsed ? 'md:pl-16' : 'md:pl-60'}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-6">
          <IconButton label={t('common.openMenu')} className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </IconButton>
          <p className="truncate text-sm font-semibold md:hidden">{school.data?.shortName || schoolName}</p>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            {user && (
              <DropdownMenu
                label={t('common.accountMenu')}
                trigger={
                  <>
                    <Avatar name={user.displayName} size="sm" />
                    <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{user.displayName}</span>
                    <ChevronDown aria-hidden className="hidden size-4 text-fg-faint sm:inline" />
                  </>
                }
                header={
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{user.displayName}</p>
                    <p className="truncate text-xs text-fg-muted">{roleNames}</p>
                  </div>
                }
                items={[
                  { label: t('account.title'), icon: <UserRound className="size-4" />, onSelect: () => navigate('/account') },
                  { label: t('auth.logout'), icon: <LogOut className="size-4" />, onSelect: () => void logout() },
                ]}
              />
            )}
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
