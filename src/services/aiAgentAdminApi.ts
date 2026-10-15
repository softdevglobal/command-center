import { API_BASE, apiFetch } from '@/lib/api';

export interface AiAgentOption {
  did: string;
  workshopName: string;
  branchName: string;
  account: { firebaseBlackUid: string; name: string } | null;
}

export interface AiAgentResult {
  firebaseBlackUid: string;
  did: string;
  name: string;
  created: boolean;
}

const endpoint = `${API_BASE}/super-admin/ai-agents`;

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await apiFetch(endpoint, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    logoutOnUnauthorized: false,
    logoutOnSessionExpired: false,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || `AI account request failed (${response.status}).`);
  }
  if (!body) throw new Error('The backend returned an invalid AI account response.');
  return body as T;
}

export async function fetchAiAgentOptions(): Promise<AiAgentOption[]> {
  const result = await request<{ options: AiAgentOption[] }>();
  return result.options;
}

export function createAiAgent(input: { did: string; name: string }): Promise<AiAgentResult> {
  return request({ method: 'POST', body: JSON.stringify(input) });
}
