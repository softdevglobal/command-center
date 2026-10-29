import { API_BASE, apiFetch } from '@/lib/api';

export type TextTestBrand = 'black' | 'trade' | 'pink';
export type TextTestMode = 'receptionist' | 'onboarding';
export interface TextToolTrace { name: string; status: string; result: unknown }
export interface TextTestReply { text: string; tools: TextToolTrace[]; usage: { requests: number; inputTokens: number; outputTokens: number } }
export interface TextTestSession extends TextTestReply {
  id: string; mode: TextTestMode; did: string; brand: TextTestBrand | null; label: string; model: string; expiresAt: number; realActions: true;
}
export interface TextTestOptions {
  receptionist: Array<{ did: string; brand: TextTestBrand; name: string; branch: string }>;
  onboarding: string[]; realActions: true;
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(`${API_BASE}/ai/text-test${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', ...init.headers }, logoutOnUnauthorized: false, logoutOnSessionExpired: false,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error || `Text test request failed (${response.status}).`);
  return body as T;
}
export const fetchTextTestOptions = () => request<TextTestOptions>('/options');
export const startTextTest = (input: { mode: TextTestMode; did: string; brand?: TextTestBrand; acknowledgeRealActions: true }, signal: AbortSignal) =>
  request<TextTestSession>('/sessions', { method: 'POST', body: JSON.stringify(input), signal });
export const sendTextTestMessage = (id: string, text: string, messageId: string, signal: AbortSignal) =>
  request<TextTestReply>(`/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ text, messageId }), signal });
export const endTextTest = (id: string) => request<{ status: string }>(`/sessions/${encodeURIComponent(id)}/end`, { method: 'POST', keepalive: true });
