import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router';
import { AuthProvider } from './lib/auth';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './routes/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { NAV } from './routes/nav';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Route-level code splitting keeps the first load small on slow connections.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));

export function App() {
  return (
    <AuthProvider>
      {/* HashRouter works on any static host; switch to BrowserRouter once .htaccess rewrites are confirmed. */}
      <HashRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                {NAV.filter((n) => n.path !== '/').map((n) => (
                  <Route key={n.path} path={n.path.slice(1)} element={<PlaceholderPage titleKey={n.labelKey} />} />
                ))}
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  );
}
