import { lazy, Suspense, type ComponentType } from 'react';
import { HashRouter, Route, Routes } from 'react-router';
import { AuthProvider } from './lib/auth';
import { AppShell } from './components/AppShell';
import { Loading, ToastProvider } from './components/ui';
import { RequireAuth } from './routes/RequireAuth';
import { RequirePermission } from './routes/RequirePermission';
import { LoginPage } from './pages/LoginPage';
import { NAV } from './routes/nav';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Route-level code splitting keeps the first load small on slow connections:
// admin-only screens are never downloaded by students or guardians.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const AccountPage = lazy(() => import('./pages/account/AccountPage'));
const ResetPasswordPage = lazy(() => import('./pages/account/ResetPasswordPage'));
const AcceptInvitePage = lazy(() => import('./pages/account/AcceptInvitePage'));
const UsersPage = lazy(() => import('./pages/users/UsersPage'));
const AcademicPage = lazy(() => import('./pages/academic/AcademicPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const StudentsPage = lazy(() => import('./pages/students/StudentsPage'));
const StaffPage = lazy(() => import('./pages/staff/StaffPage'));
const GuardiansPage = lazy(() => import('./pages/guardians/GuardiansPage'));
const ImportsPage = lazy(() => import('./pages/imports/ImportsPage'));
const AttendancePage = lazy(() => import('./pages/attendance/AttendancePage'));

/** Built screens by nav path; the rest show a "not available yet" placeholder. */
const PAGES: Record<string, ComponentType> = {
  '/users': UsersPage,
  '/academic': AcademicPage,
  '/settings': SettingsPage,
  '/audit': AuditPage,
  '/status': StatusPage,
  '/students': StudentsPage,
  '/staff': StaffPage,
  '/guardians': GuardiansPage,
  '/imports': ImportsPage,
  '/attendance': AttendancePage,
};

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        {/* HashRouter works on any static host; switch to BrowserRouter once .htaccess rewrites are confirmed. */}
        <HashRouter>
          <Suspense
            fallback={
              <div className="p-8">
                <Loading />
              </div>
            }
          >
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/accept-invite" element={<AcceptInvitePage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="account" element={<AccountPage />} />
                  {NAV.filter((n) => n.path !== '/').map((n) => {
                    const Page = PAGES[n.path];
                    return (
                      <Route
                        key={n.path}
                        path={n.path.slice(1)}
                        element={
                          <RequirePermission anyOf={n.anyOf}>
                            {Page ? <Page /> : <PlaceholderPage titleKey={n.labelKey} />}
                          </RequirePermission>
                        }
                      />
                    );
                  })}
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </HashRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
