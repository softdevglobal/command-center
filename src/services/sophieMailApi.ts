import { API_BASE, apiFetch } from '@/lib/api';

export interface SophieMailThread {
  messageId: string;
  threadId: string;
  folderId: string;
  mailboxFolder: 'inbox' | 'sent';
  fromAddress: string;
  toAddress: string;
  subject: string;
  summary: string;
  receivedTime: string | null;
  control: { state: 'sophie' | 'human'; ownerId: string | null };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE}/super-admin/sophie-mail${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    logoutOnUnauthorized: false,
    logoutOnSessionExpired: false,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Sophie Mail request failed (${response.status}).`);
  return body as T;
}

export async function fetchSophieInbox(folder: 'inbox' | 'sent' = 'inbox'): Promise<SophieMailThread[]> {
  const result = await request<{ data: SophieMailThread[] }>(`/threads?folder=${folder}&limit=100`);
  return result.data;
}

export async function fetchSophieMessage(message: SophieMailThread): Promise<string> {
  const query = new URLSearchParams({ folderId: message.folderId });
  const result = await request<{ content: string }>(`/messages/${encodeURIComponent(message.messageId)}/content?${query}`);
  return result.content;
}

export async function setSophieThreadControl(threadId: string, state: 'sophie' | 'human'): Promise<void> {
  await request(`/threads/${encodeURIComponent(threadId)}/control`, { method: 'PUT', body: JSON.stringify({ state }) });
}

export async function sendSophieReply(messageId: string, content: string): Promise<void> {
  await request(`/messages/${encodeURIComponent(messageId)}/reply`, { method: 'POST', body: JSON.stringify({ content }) });
}

export interface SophieBusinessKnowledgeInput {
  scope: 'bms_pros' | 'business';
  product: 'all' | 'black' | 'trade';
  businessName: string;
  title: string;
  content: string;
  published: boolean;
}

export interface SophieBusinessKnowledge {
  id: string;
  scope: SophieBusinessKnowledgeInput['scope'];
  product: SophieBusinessKnowledgeInput['product'];
  business_name: string;
  title: string;
  content: string;
  published: boolean;
  updated_at: string;
}

export async function fetchSophieBusinessKnowledge(): Promise<SophieBusinessKnowledge[]> {
  return (await request<{ data: SophieBusinessKnowledge[] }>('/knowledge')).data;
}

export async function saveSophieBusinessKnowledge(id: string | null, input: SophieBusinessKnowledgeInput): Promise<SophieBusinessKnowledge> {
  const path = id ? `/knowledge/${encodeURIComponent(id)}` : '/knowledge';
  return (await request<{ data: SophieBusinessKnowledge }>(path, { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) })).data;
}
