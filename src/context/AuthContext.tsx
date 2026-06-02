import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AUTH_LOGOUT_EVENT,
  clearAuthStorage,
  getAccessToken,
  getMe,
  getStoredAgentType,
  getStoredRoles,
  getStoredUser,
  login as backendLogin,
  logout as clientLogout,
  syncSupabaseAuthSession,
  type LoginResponse,
  type MeResponse,
} from '@/lib/api';
import type { Permissions, UserRole, UserSession } from '@/services/types';
import { derivePermissions } from '@/utils/permissions';

type AuthUser = LoginResponse['user'];

interface AuthContextValue {
  user: AuthUser | null;
  roles: string[];
  agentType: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  session: UserSession | null;
  permissions: Permissions;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const EMPTY_PERMISSIONS: Permissions = {
  canViewAllTenants: false,
  canSwitchTenant: false,
  canViewSipInfrastructure: false,
  canViewTenantNames: false,
  canViewCallsTab: false,
  canViewBookingsTab: false,
  canViewAgentsTab: false,
  canViewChatTab: false,
  canViewSmsTab: false,
  canViewInternalChat: false,
  canViewOverviewTab: false,
  canViewSipTab: false,
  canViewClientsTab: false,
  canSignUpClients: false,
  canAdvanceOnboarding: false,
  canEditClientDetails: false,
  canApproveGoLive: false,
  canRegressStage: false,
  canViewShiftPanel: false,
  canViewAttendanceTab: false,
  canOnboardAgents: false,
  canViewAgentOnboarding: false,
  canViewAgentOnboardingTab: false,
  canViewAuditLogs: false,
  canViewCallRecordings: false,
  canManageAgents: false,
  canManageDIDMappings: false,
  canViewSalesAdminSuite: false,
  canViewSalesAgentSuite: false,
  allowedTenantId: null,
  allowedQueueIds: [],
};

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeRole(rawRoles: string[]): UserRole {
  const normalized = rawRoles.map((role) => role.trim().toLowerCase().replace(/_/g, '-'));

  if (normalized.some((role) => role === 'super-admin' || role === 'admin')) {
    return 'super-admin';
  }
  if (normalized.includes('client-admin')) return 'client-admin';
  if (normalized.includes('supervisor')) return 'supervisor';
  return 'agent';
}

function displayNameFromUser(user: AuthUser): string {
  const metadata = user.user_metadata ?? {};
  const displayName = metadata.displayName ?? metadata.display_name ?? metadata.name;
  return String(displayName || user.email || user.id);
}

function sessionFromAuth(user: AuthUser | null, roles: string[]): UserSession | null {
  if (!user) return null;

  return {
    userId: user.id,
    role: normalizeRole(roles),
    tenantId: null,
    allowedQueueIds: [],
    displayName: displayNameFromUser(user),
    authEmail: user.email ?? null,
  };
}

function userFromMe(me: MeResponse): AuthUser {
  return {
    id: me.uid,
    email: me.email,
    user_metadata: {
      displayName: me.displayName,
    },
  };
}

function rolesFromMe(me: MeResponse): string[] {
  return me.roles?.length ? me.roles : me.role ? [me.role] : [];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [roles, setRoles] = useState<string[]>(() => getStoredRoles());
  const [agentType, setAgentType] = useState<string | null>(() => getStoredAgentType());
  const [isLoading, setIsLoading] = useState(true);

  const resetAuthState = useCallback(() => {
    setUser(null);
    setRoles([]);
    setAgentType(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!getAccessToken()) {
        clearAuthStorage();
        resetAuthState();
        setIsLoading(false);
        return;
      }

      try {
        await syncSupabaseAuthSession();
        const me = await getMe();
        if (cancelled) return;
        const nextUser = userFromMe(me);
        const nextRoles = rolesFromMe(me);
        setUser(nextUser);
        setRoles(nextRoles);
        setAgentType(me.agentType || null);
        localStorage.setItem('user', JSON.stringify(nextUser));
        localStorage.setItem('roles', JSON.stringify(nextRoles));
        localStorage.setItem('agentType', me.agentType ?? '');
      } catch {
        if (!cancelled) {
          clearAuthStorage();
          resetAuthState();
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [resetAuthState]);

  useEffect(() => {
    const onLogout = () => resetAuthState();
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
  }, [resetAuthState]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await backendLogin(email, password);
    setUser(response.user);
    setRoles(response.roles ?? []);
    setAgentType(response.agentType || null);
    return response;
  }, []);

  const logout = useCallback(async () => {
    clientLogout();
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        await login(email, password);
        return { error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';
        return { error: message };
      }
    },
    [login],
  );

  const session = useMemo(() => sessionFromAuth(user, roles), [user, roles]);
  const permissions = useMemo(
    () => (session ? derivePermissions(session) : EMPTY_PERMISSIONS),
    [session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      roles,
      agentType,
      isAuthenticated: Boolean(user && getAccessToken()),
      isLoading,
      login,
      logout,
      session,
      permissions,
      loading: isLoading,
      signIn,
      signOut: logout,
    }),
    [agentType, isLoading, login, logout, permissions, roles, session, signIn, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
