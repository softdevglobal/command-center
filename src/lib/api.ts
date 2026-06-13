import { supabase } from '@/integrations/supabase/client';

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
  roles: string[];
  agentType: string;
}

export interface MeResponse {
  uid: string;
  email: string;
  displayName: string;
  roles: string[];
  role: string;
  agentType: string;
}

export const DEFAULT_API_BASE = '/api';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.trim().replace(/\/+$/, '') ||
  DEFAULT_API_BASE;

export function apiUrl(path = ''): string {
  const suffix = path.trim() ? (path.startsWith('/') ? path : `/${path}`) : '';
  return `${API_BASE}${suffix}`;
}

export const AUTH_STORAGE_KEYS = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
  user: 'user',
  roles: 'roles',
  agentType: 'agentType',
} as const;

export const AUTH_LOGOUT_EVENT = 'command-centre-auth:logout';
export const AUTH_SESSION_EXPIRED_STORAGE_KEY = 'command-centre-auth:session-expired';
export const AUTH_SESSION_EXPIRED_MESSAGE =
  'Your auth session has expired. Please logout and login again.';

export type AuthLogoutReason = 'manual' | 'session-expired';
export type AuthLogoutEventDetail = {
  reason: AuthLogoutReason;
  redirect: boolean;
};

type ApiErrorBody = {
  error?: string;
  message?: string;
  detail?: string;
};

type ApiFetchInit = RequestInit & {
  logoutOnUnauthorized?: boolean;
  logoutOnSessionExpired?: boolean;
};

const SESSION_EXPIRED_STATUS_CODES = new Set([401, 403, 404]);

function authUrl(path: string): string {
  return apiUrl(path);
}

function shouldPrefixApiBase(input: string): boolean {
  if (!input.startsWith('/')) return false;
  return !(
    API_BASE.startsWith('/') &&
    (input === API_BASE || input.startsWith(`${API_BASE}/`))
  );
}

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function readApiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text.trim()) return res.statusText || 'Request failed';

  try {
    const body = JSON.parse(text) as ApiErrorBody;
    return body.error || body.message || body.detail || text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
}

function storeAuthTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, accessToken);
  localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, refreshToken);
}

export function getStoredUser(): LoginResponse['user'] | null {
  return safeJsonParse<LoginResponse['user']>(localStorage.getItem(AUTH_STORAGE_KEYS.user));
}

export function getStoredRoles(): string[] {
  const roles = safeJsonParse<string[]>(localStorage.getItem(AUTH_STORAGE_KEYS.roles));
  return Array.isArray(roles) ? roles : [];
}

export function getStoredAgentType(): string | null {
  return localStorage.getItem(AUTH_STORAGE_KEYS.agentType);
}

export function storeAuthSession(response: LoginResponse): void {
  storeAuthTokens(response.access_token, response.refresh_token);
  localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(response.user));
  localStorage.setItem(AUTH_STORAGE_KEYS.roles, JSON.stringify(response.roles ?? []));
  localStorage.setItem(AUTH_STORAGE_KEYS.agentType, response.agentType ?? '');
}

export async function syncSupabaseAuthSession(
  tokens: { accessToken?: string | null; refreshToken?: string | null } = {},
): Promise<void> {
  const accessToken = tokens.accessToken ?? localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  const refreshToken = tokens.refreshToken ?? localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken);

  if (!accessToken || !refreshToken) return;

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    console.warn('[api] Could not sync Supabase auth session:', error.message);
  }
}

async function refreshStoredAuthSession(): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error || !session?.access_token || !session.refresh_token) {
    return false;
  }

  storeAuthTokens(session.access_token, session.refresh_token);
  return true;
}

export function clearAuthStorage(): void {
  Object.values(AUTH_STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  void supabase.auth.signOut();
}

function setSessionExpiredNotice(shouldShow: boolean): void {
  try {
    if (shouldShow) {
      sessionStorage.setItem(AUTH_SESSION_EXPIRED_STORAGE_KEY, '1');
    } else {
      sessionStorage.removeItem(AUTH_SESSION_EXPIRED_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures; logout still needs to continue.
  }
}

export function consumeSessionExpiredNotice(): boolean {
  try {
    const shouldShow = sessionStorage.getItem(AUTH_SESSION_EXPIRED_STORAGE_KEY) === '1';
    if (shouldShow) {
      sessionStorage.removeItem(AUTH_SESSION_EXPIRED_STORAGE_KEY);
    }
    return shouldShow;
  } catch {
    return false;
  }
}

export function authHeaders(): HeadersInit {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(authUrl('/auth/login'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    throw new Error(await readApiError(res));
  }

  const body = (await res.json()) as LoginResponse;
  storeAuthSession(body);
  await syncSupabaseAuthSession({
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
  });
  return body;
}

export async function getMe(): Promise<MeResponse> {
  const res = await apiFetch('/auth/me', {
    logoutOnUnauthorized: true,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(await readApiError(res));
  }

  return (await res.json()) as MeResponse;
}

export function logout(
  options: { redirect?: boolean; reason?: AuthLogoutReason } = {},
): void {
  const reason = options.reason ?? 'manual';
  const shouldRedirect = options.redirect !== false && window.location.pathname !== '/login';

  setSessionExpiredNotice(reason === 'session-expired');
  clearAuthStorage();
  window.dispatchEvent(
    new CustomEvent<AuthLogoutEventDetail>(AUTH_LOGOUT_EVENT, {
      detail: { reason, redirect: shouldRedirect },
    }),
  );

  if (shouldRedirect) {
    window.location.assign('/login');
  }
}

export async function apiFetch(input: RequestInfo | URL, init: ApiFetchInit = {}): Promise<Response> {
  const {
    logoutOnUnauthorized = false,
    logoutOnSessionExpired = true,
    ...fetchInit
  } = init;
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  const hadAuthToken = Boolean(token);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url =
    typeof input === 'string' && shouldPrefixApiBase(input)
      ? authUrl(input)
      : input;

  let res = await fetch(url, { ...fetchInit, headers });
  if (res.status === 401) {
    const refreshed = await refreshStoredAuthSession();
    if (refreshed) {
      const retryHeaders = new Headers(fetchInit.headers);
      const refreshedToken = getAccessToken();
      if (refreshedToken && !retryHeaders.has('Authorization')) {
        retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
      }
      res = await fetch(url, { ...fetchInit, headers: retryHeaders });
    }
  }

  const shouldLogoutForStatus =
    logoutOnSessionExpired &&
    (SESSION_EXPIRED_STATUS_CODES.has(res.status) ||
      (logoutOnUnauthorized && res.status === 401));

  if (hadAuthToken && shouldLogoutForStatus) {
    logout({ reason: 'session-expired' });
  }
  return res;
}
