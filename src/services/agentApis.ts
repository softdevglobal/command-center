/**
 * agentApis.ts — Agents directory REST API (super-admin only)
 *
 * Backed by the Node API on `VITE_AGENTS_API_URL` (defaults to
 * `http://127.0.0.1:5050/api/agents`). The endpoints require an authenticated
 * super-admin session (Bearer token).
 *
 *  GET    /api/agents               → list agents
 *  GET    /api/agents/performance   → aggregated call-handling metrics per agent
 *  GET    /api/agents/:id           → fetch a single agent
 *  PATCH  /api/agents/:id           → update agent fields (name, queues, role, …)
 *  DELETE /api/agents/:id           → remove an agent (cascade onboarding rows)
 */

import { apiFetch, getAccessToken } from '@/lib/api';
import type { Agent, AgentStatus, WorkshopUserRole } from './types';

const AGENTS_API_URL =
  (import.meta.env.VITE_AGENTS_API_URL as string | undefined)?.trim() ||
  'http://127.0.0.1:5050/api/agents';

/* ─── Types ───────────────────────────────────────────────────────────── */

/** Editable fields on the `/agents/:id` PATCH endpoint. */
export interface AgentUpdateInput {
  name?: string;
  extension?: string;
  email?: string | null;
  phone?: string | null;
  tenantId?: string | null;
  queueIds?: string[];
  role?: Agent['role'];
  notes?: string | null;
  bmsOwnerUid?: string | null;
  bmsBranchId?: string | null;
  workshopUserRole?: WorkshopUserRole | null;
}

/** Optional filters supported by `GET /api/agents`. */
export interface AgentListQuery {
  tenantId?: string | null;
  queueId?: string | null;
  search?: string | null;
}

/** Row returned by `GET /api/agents/performance`. */
export interface AgentPerformanceRow {
  agentId: string;
  agentName: string;
  extension: string;
  tenantId: string | null;
  tenantName: string | null;
  status: AgentStatus | null;
  totalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  totalDurationSeconds: number;
  avgDurationSeconds: number;
  answerRate: number;
  listAttempted: number;
  listConfirmed: number;
  listRejected: number;
}

/** Optional date filters supported by `/agents/performance`. */
export interface AgentPerformanceQuery {
  tenantId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/* ─── Low-level helpers ───────────────────────────────────────────────── */

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function pickString(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function pickNullableString(
  row: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  const text = pickString(row, keys);
  return text || null;
}

function pickStringArray(
  row: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) {
      return value
        .map((v) => String(v ?? '').trim())
        .filter((v) => Boolean(v));
    }
  }
  return [];
}

function pickNumber(row: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function pickNullableNumber(
  row: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function parseAgentRole(raw: unknown): Agent['role'] {
  const v = String(raw ?? '').trim();
  if (v === 'senior-agent' || v === 'team-lead') return v;
  return 'agent';
}

function parseWorkshopUserRole(raw: unknown): WorkshopUserRole | null {
  const v = String(raw ?? '').trim();
  if (v === 'owner' || v === 'branch_admin' || v === 'staff') return v;
  return null;
}

function parseAgentStatus(raw: unknown): AgentStatus {
  const v = String(raw ?? '').trim();
  const allowed: AgentStatus[] = [
    'available',
    'on-call',
    'ringing',
    'away',
    'busy',
    'offline',
  ];
  return (allowed as string[]).includes(v) ? (v as AgentStatus) : 'offline';
}

/**
 * Convert a backend agent row to the dashboard `Agent` shape.
 * Tolerates both `snake_case` (Supabase) and `camelCase` (REST) field names.
 */
function rowToAgent(raw: unknown): Agent {
  const row = asRecord(raw);
  const tenants = asRecord(row.tenants);

  return {
    id: pickString(row, ['id', 'agent_id', 'agentId']),
    userId: pickNullableString(row, ['user_id', 'userId']),
    tenantId: pickString(row, ['tenant_id', 'tenantId']),
    queueIds: pickStringArray(row, ['queue_ids', 'queueIds']),
    name: pickString(row, ['name', 'display_name', 'displayName']),
    extension: pickString(row, ['extension', 'ext']),
    email: pickString(row, ['email']) || undefined,
    phone:
      pickString(row, ['phone_number', 'phoneNumber', 'phone']) || undefined,
    notes: pickString(row, ['notes']) || undefined,
    bmsOwnerUid: pickNullableString(row, [
      'bms_owner_uid',
      'bmsOwnerUid',
      'ownerUid',
    ]),
    bmsBranchId: pickNullableString(row, [
      'bms_branch_id',
      'bmsBranchId',
      'branchId',
    ]),
    workshopUserRole: parseWorkshopUserRole(
      row.workshop_user_role ?? row.workshopUserRole,
    ),
    role: parseAgentRole(row.role),
    status: parseAgentStatus(row.status),
    currentCaller: pickNullableString(row, [
      'current_caller',
      'currentCaller',
    ]),
    callStartTime: pickNullableNumber(row, ['call_start_time', 'callStartTime']),
    allowedQueueIds: pickStringArray(row, [
      'allowed_queue_ids',
      'allowedQueueIds',
    ]),
    assignedTenantIds: pickStringArray(row, [
      'assigned_tenant_ids',
      'assignedTenantIds',
    ]),
    groupIds: pickStringArray(row, ['group_ids', 'groupIds']),
    tenantName:
      pickString(tenants, ['name']) ||
      pickString(row, ['tenant_name', 'tenantName']) ||
      undefined,
  };
}

function rowToPerformance(raw: unknown): AgentPerformanceRow {
  const row = asRecord(raw);
  const answered = pickNumber(row, ['answeredCalls', 'answered_calls']);
  const total = pickNumber(row, ['totalCalls', 'total_calls']);
  const missed =
    pickNullableNumber(row, ['missedCalls', 'missed_calls']) ??
    Math.max(0, total - answered);
  const answerRate =
    pickNullableNumber(row, ['answerRate', 'answer_rate']) ??
    (total > 0 ? Math.round((answered / total) * 100) : 0);
  const totalDuration = pickNumber(row, [
    'totalDurationSeconds',
    'total_duration_seconds',
    'totalDuration',
    'total_duration',
  ]);
  const avgDuration =
    pickNullableNumber(row, [
      'avgDurationSeconds',
      'avg_duration_seconds',
      'avgDuration',
      'avg_duration',
    ]) ?? (answered > 0 ? Math.round(totalDuration / answered) : 0);

  return {
    agentId: pickString(row, ['agentId', 'agent_id', 'id']),
    agentName: pickString(row, ['agentName', 'agent_name', 'name']),
    extension: pickString(row, ['extension', 'ext']),
    tenantId: pickNullableString(row, ['tenantId', 'tenant_id']),
    tenantName: pickNullableString(row, ['tenantName', 'tenant_name']),
    status: row.status ? parseAgentStatus(row.status) : null,
    totalCalls: total,
    answeredCalls: answered,
    missedCalls: missed,
    totalDurationSeconds: totalDuration,
    avgDurationSeconds: avgDuration,
    answerRate,
    listAttempted: pickNumber(row, ['listAttempted', 'list_attempted']),
    listConfirmed: pickNumber(row, ['listConfirmed', 'list_confirmed']),
    listRejected: pickNumber(row, ['listRejected', 'list_rejected']),
  };
}

function toUpdatePayload(patch: AgentUpdateInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.extension !== undefined) body.extension = patch.extension;
  if (patch.email !== undefined) body.email = patch.email;
  if (patch.phone !== undefined) body.phone_number = patch.phone;
  if (patch.tenantId !== undefined) body.tenant_id = patch.tenantId;
  if (patch.queueIds !== undefined) body.queue_ids = patch.queueIds;
  if (patch.role !== undefined) body.role = patch.role;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.bmsOwnerUid !== undefined) body.bms_owner_uid = patch.bmsOwnerUid;
  if (patch.bmsBranchId !== undefined) body.bms_branch_id = patch.bmsBranchId;
  if (patch.workshopUserRole !== undefined) {
    body.workshop_user_role = patch.workshopUserRole;
  }
  return body;
}

/* ─── HTTP plumbing ────────────────────────────────────────────────────── */

function requireAgentsAuth(): void {
  if (!getAccessToken()) {
    throw new Error('Sign in as super-admin to manage agents.');
  }
}

function agentsUrl(
  pathOrId?: string,
  params?: Record<string, string | null | undefined>,
): string {
  const base = AGENTS_API_URL.replace(/\/+$/, '');
  const suffix = pathOrId?.trim()
    ? `/${encodeURIComponent(pathOrId.trim()).replace('%2F', '/')}`
    : '';
  const url = new URL(`${base}${suffix}`, window.location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    const text = value?.trim();
    if (text) url.searchParams.set(key, text);
  }
  return url.toString();
}

async function readHttpErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  if (!text.trim()) return '';
  try {
    const parsed = JSON.parse(text) as unknown;
    const body = asRecord(parsed);
    const detail = body.message ?? body.error ?? body.detail;
    return typeof detail === 'string' ? detail : text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as unknown) : null;
}

function extractRows(raw: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  const body = asRecord(raw);
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }
  const data = asRecord(body.data);
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function extractSingle(raw: unknown, keys: readonly string[]): unknown {
  const body = asRecord(raw);
  for (const key of keys) {
    const value = body[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }
  }
  return body;
}

async function requestAgents(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  options: {
    pathOrId?: string;
    params?: Record<string, string | null | undefined>;
    body?: unknown;
  } = {},
): Promise<unknown> {
  requireAgentsAuth();
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });

  const res = await apiFetch(agentsUrl(options.pathOrId, options.params), {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `Agents API ${method} ${options.pathOrId ?? ''} failed: ${res.status}${
        detail ? ` - ${detail}` : ''
      }`,
    );
  }

  return parseJsonBody(res);
}

/* ─── Public API ──────────────────────────────────────────────────────── */

/** `GET /api/agents` — list every agent visible to the caller. */
export async function fetchAgentsList(query?: AgentListQuery): Promise<Agent[]> {
  const raw = await requestAgents('GET', {
    params: {
      tenantId: query?.tenantId ?? undefined,
      queueId: query?.queueId ?? undefined,
      search: query?.search ?? undefined,
    },
  });
  return extractRows(raw, ['agents', 'items', 'results', 'data'])
    .map(rowToAgent)
    .filter((a) => Boolean(a.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `GET /api/agents/:id` — fetch a single agent (returns `null` on 404). */
export async function fetchAgentById(agentId: string): Promise<Agent | null> {
  const id = agentId.trim();
  if (!id) return null;

  try {
    const raw = await requestAgents('GET', { pathOrId: id });
    if (!raw) return null;
    const single = extractSingle(raw, ['agent', 'data', 'item', 'result']);
    const agent = rowToAgent(single);
    return agent.id ? agent : null;
  } catch (err) {
    if (err instanceof Error && /\b404\b/.test(err.message)) return null;
    throw err;
  }
}

/** `GET /api/agents/performance` — aggregated call-handling metrics. */
export async function fetchAgentsPerformance(
  query?: AgentPerformanceQuery,
): Promise<AgentPerformanceRow[]> {
  const raw = await requestAgents('GET', {
    pathOrId: 'performance',
    params: {
      tenantId: query?.tenantId ?? undefined,
      startDate: query?.startDate ?? undefined,
      endDate: query?.endDate ?? undefined,
    },
  });
  return extractRows(raw, ['performance', 'items', 'results', 'data'])
    .map(rowToPerformance)
    .filter((row) => Boolean(row.agentId));
}

/** `PATCH /api/agents/:id` — update editable fields on an existing agent. */
export async function updateAgent(
  agentId: string,
  patch: AgentUpdateInput,
): Promise<Agent> {
  const id = agentId.trim();
  if (!id) throw new Error('updateAgent: agentId is required.');

  const raw = await requestAgents('PATCH', {
    pathOrId: id,
    body: toUpdatePayload(patch),
  });
  const single = extractSingle(raw, ['agent', 'data', 'item', 'result']);
  const agent = rowToAgent(single);
  return agent.id ? agent : { ...agent, id };
}

/** `DELETE /api/agents/:id` — remove the agent (cascades onboarding rows). */
export async function deleteAgent(agentId: string): Promise<void> {
  const id = agentId.trim();
  if (!id) throw new Error('deleteAgent: agentId is required.');

  await requestAgents('DELETE', { pathOrId: id });
}
