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

type ApiErrorBody = {
  error?: string;
  message?: string;
  detail?: string;
};

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
  localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, response.access_token);
  localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, response.refresh_token);
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

export function clearAuthStorage(): void {
  Object.values(AUTH_STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  void supabase.auth.signOut();
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
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(await readApiError(res));
  }

  return (await res.json()) as MeResponse;
}

export function logout(options: { redirect?: boolean } = {}): void {
  clearAuthStorage();
  window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));

  if (options.redirect !== false && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url =
    typeof input === 'string' && shouldPrefixApiBase(input)
      ? authUrl(input)
      : input;

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    logout();
  }
  return res;
}
