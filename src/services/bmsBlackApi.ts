import { API_BASE, apiFetch, getAccessToken } from '@/lib/api';

export {
  BMS_BLACK_API_BASE,
  BmsBlackApiError,
  type BmsBlackHttpMethod,
  type BmsBlackRequestOptions,
} from '@/lib/bms-black-api';

export function bmsBlackHeaders(
  tenantId?: string | null,
  initHeaders?: HeadersInit,
): Headers {
  const headers = new Headers(initHeaders);
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json');

  const token = getAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const tenant = tenantId?.trim();
  if (tenant) headers.set('X-Tenant-Id', tenant);

  return headers;
}

export function bmsBlackFetch(
  input: string,
  init: RequestInit = {},
  tenantId?: string | null,
): Promise<Response> {
  return apiFetch(input, {
    ...init,
    headers: bmsBlackHeaders(tenantId, init.headers),
  });
}

export const BMS_BLACK_API_URL = `${API_BASE}/bms-black`;
