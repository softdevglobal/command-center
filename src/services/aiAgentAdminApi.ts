import { API_BASE, apiFetch } from '@/lib/api';

export interface AiAgentOption {
  did: string;
  workshopName: string;
  branchName: string;
  account: { firebaseBlackUid?: string; firebaseBlueUid?: string; firebasePinkUid?: string; name: string } | null;
}

export interface AiAgentResult {
  firebaseBlackUid?: string;
  firebaseBlueUid?: string;
  firebasePinkUid?: string;
  did: string;
  name: string;
  created: boolean;
}

const endpoints = {
  black: `${API_BASE}/bms-black/ai-reception`,
  trade: `${API_BASE}/bms-blue/ai-reception`,
  pink: `${API_BASE}/bms-pink/ai-reception`,
} as const;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, {
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

export async function fetchAiAgentOptions(brand: 'black' | 'trade' | 'pink' = 'black'): Promise<AiAgentOption[]> {
  const result = await request<{ options: AiAgentOption[] }>(endpoints[brand]);
  return result.options;
}

export function createAiAgent(input: { did: string; name: string; brand?: 'black' | 'trade' | 'pink' }): Promise<AiAgentResult> {
  const brand = input.brand ?? 'black';
  return request(endpoints[brand], { method: 'POST', body: JSON.stringify({ did: input.did, name: input.name }) });
}

export interface PinkWorkshopOption {
  ownerUid: string;
  name: string;
  branches: Array<{ id: string; name: string }>;
}

export async function fetchPinkWorkshopOptions(): Promise<PinkWorkshopOption[]> {
  const result = await request<{ options: PinkWorkshopOption[] }>(`${endpoints.pink}/salons`);
  return result.options;
}
