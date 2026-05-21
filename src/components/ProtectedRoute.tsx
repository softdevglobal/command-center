import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  requireSuperAdmin?: boolean;
  children?: ReactNode;
}

function isSuperAdminRole(role: string): boolean {
  const normalized = role.trim().toLowerCase().replace(/_/g, '-');
  return normalized === 'super-admin' || normalized === 'admin';
}

export function ProtectedRoute({ requireSuperAdmin = false, children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, roles, session } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div style={{ fontFamily: 'monospace', fontSize: 14, color: '#8a99ad' }}>Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const hasSuperAdminRole =
    roles.some(isSuperAdminRole) || session?.role === 'super-admin';
  if (requireSuperAdmin && !hasSuperAdminRole) {
    return <Navigate to="/" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
