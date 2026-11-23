import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';
import { Loading } from '../components/ui';
import { ForcedPasswordChangePage } from '../pages/account/ForcedPasswordChangePage';

export function RequireAuth() {
  const { session, loading, signedOut } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="p-8">
        <Loading />
      </div>
    );
  // Remember where they were going, so sign-in returns them there — unless they signed out on purpose.
  if (!session) return <Navigate to="/login" replace state={signedOut ? null : { from: `${location.pathname}${location.search}` }} />;
  // The API refuses everything else until a temporary password is replaced, so show only that.
  if (session.mustChangePassword) return <ForcedPasswordChangePage />;
  return <Outlet />;
}
