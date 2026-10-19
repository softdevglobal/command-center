import { API_BASE, apiFetch } from '@/lib/api';

export type AiAgentActivityType = 'call_started' | 'call_answered' | 'call_ended' | 'mcp_tool' | 'usage_updated';

export interface AiAgentActivityEvent {
  id: string;
  call_id: string;
  event_type: AiAgentActivityType;
  mode: 'receptionist' | 'trade' | 'onboarding';
  brand: 'black' | 'trade' | 'onboarding';
  did: string;
  business_name: string | null;
  branch_name: string | null;
  model: string | null;
  tool_name: string | null;
  status: string | null;
  duration_ms: number | null;
  input_bytes: number | null;
  output_bytes: number | null;
  usage: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface AiAgentActivityFilters {
  limit?: number;
  offset?: number;
  brand?: string;
  mode?: string;
  did?: string;
  eventType?: string;
  from?: string;
  to?: string;
}

export interface AiAgentActivityPage {
  data: AiAgentActivityEvent[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchAiAgentActivity(filters: AiAgentActivityFilters = {}): Promise<AiAgentActivityPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const response = await apiFetch(`${API_BASE}/ai/agent-activity/events?${query.toString()}`, {
    headers: { Accept: 'application/json' },
    logoutOnUnauthorized: false,
    logoutOnSessionExpired: false,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Could not load AI agent activity (${response.status}).`);
  if (!body || !Array.isArray(body.data)) throw new Error('The backend returned an invalid AI activity response.');
  return body as AiAgentActivityPage;
}
