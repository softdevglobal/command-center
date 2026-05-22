import { supabase } from '@/integrations/supabase/client';
import { API_BASE, apiFetch, getAccessToken } from '@/lib/api';
import type { UserSession } from './types';

const SYSTEM_AUDIT_LOGS_API_URL =
  (import.meta.env.VITE_SYSTEM_AUDIT_LOGS_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  `${API_BASE}/system-audit-logs`;

export const SYSTEM_AUDIT_LOG_ACTIONS = [
  'auth.login',
  'attendance.clock_in',
  'attendance.clock_out',
  'message.viewed',
  'message.reply',
  'leave_request.create',
  'leave_request.update',
  'shift_schedule.create',
  'shift_schedule.update',
  'notification.viewed',
  'booking.create',
  'agent.register',
  'did_mapping.create',
  'did_mapping.update',
  'did_mapping.delete',
] as const;

export type SystemAuditLogAction = (typeof SYSTEM_AUDIT_LOG_ACTIONS)[number];

const SYSTEM_AUDIT_LOG_ACTION_SET = new Set<string>(SYSTEM_AUDIT_LOG_ACTIONS);

type SupabaseAuditQueryResult = {
  data: unknown;
  error: unknown;
};

type SupabaseAuditInsertResult = {
  error: unknown;
};

type SupabaseAuditQuery = PromiseLike<SupabaseAuditQueryResult> & {
  select(columns?: string): SupabaseAuditQuery;
  insert(values: unknown): PromiseLike<SupabaseAuditInsertResult>;
  eq(column: string, value: unknown): SupabaseAuditQuery;
  not(column: string, operator: string, value: unknown): SupabaseAuditQuery;
  order(column: string, options?: { ascending?: boolean }): SupabaseAuditQuery;
};

type SupabaseDynamicClient = {
  from(table: string): SupabaseAuditQuery;
};

export interface AuditLogEntry {
  id?: string;
  created_at?: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details?: Record<string, unknown>;
}

export interface SystemAuditLogPostInput {
  action: SystemAuditLogAction | string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
}

export const AUDIT_ACTION_AUTH_LOGIN = 'auth.login';
export const AUDIT_ACTION_ATTENDANCE_CLOCK_IN = 'attendance.clock_in';
export const AUDIT_ACTION_ATTENDANCE_CLOCK_OUT = 'attendance.clock_out';
export const AUDIT_ACTION_LEAVE_REQUEST_CREATE = 'leave_request.create';
export const AUDIT_ACTION_LEAVE_REQUEST_UPDATE = 'leave_request.update';
export const AUDIT_ACTION_SHIFT_SCHEDULE_CREATE = 'shift_schedule.create';
export const AUDIT_ACTION_SHIFT_SCHEDULE_UPDATE = 'shift_schedule.update';
export const AUDIT_ACTION_NOTIFICATION_VIEWED = 'notification.viewed';
export const AUDIT_ACTION_BOOKING_CREATE = 'booking.create';
export const AUDIT_ACTION_AGENT_REGISTER = 'agent.register';
export const AUDIT_ACTION_DID_MAPPING_CREATE = 'did_mapping.create';
export const AUDIT_ACTION_DID_MAPPING_UPDATE = 'did_mapping.update';
export const AUDIT_ACTION_DID_MAPPING_DELETE = 'did_mapping.delete';

/** Resource type recorded for support / BMS chat threads in {@link logSystemActivity}. */
export const AUDIT_RESOURCE_BMS_CHAT = 'bms_chat';

/** Emitted when an agent opens a BMS chat thread (read receipt posted). */
export const AUDIT_ACTION_CHAT_VIEWED = 'message.viewed';
/** Emitted when an agent sends a message in a BMS chat. */
export const AUDIT_ACTION_CHAT_REPLY = 'message.reply';

function parseAuditDetails(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function pickString(
  row: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

function auditLogsTable(): SupabaseAuditQuery {
  return (supabase as unknown as SupabaseDynamicClient).from('system_audit_logs');
}

function systemAuditLogsUrl(): string {
  return new URL(SYSTEM_AUDIT_LOGS_API_URL, window.location.origin).toString();
}

/** Normalize DB / client variants so UI matching stays stable. */
export function normalizeAuditLogEntry(raw: unknown): AuditLogEntry {
  const row = asRecord(raw);
  const user = asRecord(row.user);
  const actor = asRecord(row.actor);
  const details = parseAuditDetails(
    row.details ?? row.metadata ?? row.meta ?? row.data,
  );

  return {
    id: pickString(row, ['id', '_id']),
    created_at: pickString(row, ['created_at', 'createdAt', 'timestamp']),
    user_id:
      pickString(row, ['user_id', 'userId', 'actor_id', 'actorId']) ??
      pickString(user, ['id', 'uid']) ??
      pickString(actor, ['id', 'uid']) ??
      '',
    user_name:
      pickString(row, ['user_name', 'userName', 'actor_name', 'actorName']) ??
      pickString(user, ['name', 'displayName', 'email']) ??
      pickString(actor, ['name', 'displayName', 'email']) ??
      '',
    user_role:
      pickString(row, ['user_role', 'userRole', 'role']) ??
      pickString(user, ['role']) ??
      pickString(actor, ['role']) ??
      '',
    action: String(row.action ?? '').trim(),
    resource_type: String(
      row.resource_type ?? row.resourceType ?? row.resource ?? row.entityType ?? '',
    ).trim(),
    resource_id: pickString(row, [
      'resource_id',
      'resourceId',
      'entity_id',
      'entityId',
      'targetId',
    ]),
    details,
  };
}

function requireSuperAdminAuditAuth(): void {
  if (!getAccessToken()) {
    throw new Error('Sign in as super-admin to load audit logs.');
  }
}

function auditLogsUrl(limit: number): string {
  const url = new URL(SYSTEM_AUDIT_LOGS_API_URL, window.location.origin);
  if (limit > 0) {
    url.searchParams.set('limit', String(limit));
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

function extractAuditRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const body = asRecord(raw);
  for (const key of ['logs', 'auditLogs', 'data', 'items', 'results']) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normKey(s: string | undefined | null): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.-]/g, '_');
}

export function isAuditChatSupportEntry(log: AuditLogEntry): boolean {
  const a = normKey(log.action);
  const t = normKey(log.resource_type);
  if (!['chat_viewed', 'chat_reply', 'message_viewed', 'message_reply'].includes(a)) return false;
  return t === 'bms_chat' || t === 'support_chat';
}

function normalizeAuditLogAction(action: string): string {
  const key = action.trim().toLowerCase().replace(/[ .-]/g, '_');
  switch (key) {
    case 'login':
    case 'auth_login':
      return AUDIT_ACTION_AUTH_LOGIN;
    case 'create_booking':
    case 'booking_create':
      return AUDIT_ACTION_BOOKING_CREATE;
    case 'chat_viewed':
    case 'message_viewed':
      return AUDIT_ACTION_CHAT_VIEWED;
    case 'chat_reply':
    case 'message_reply':
      return AUDIT_ACTION_CHAT_REPLY;
    case 'notification_viewed':
    case 'notification_view':
      return AUDIT_ACTION_NOTIFICATION_VIEWED;
    default:
      return action.trim();
  }
}

function isSystemAuditLogAction(action: string): action is SystemAuditLogAction {
  return SYSTEM_AUDIT_LOG_ACTION_SET.has(action);
}

export async function postSystemAuditLog(input: SystemAuditLogPostInput): Promise<void> {
  const action = normalizeAuditLogAction(input.action);
  const resourceType = input.resourceType.trim();

  if (!action) throw new Error('Audit action is required.');
  if (!isSystemAuditLogAction(action)) {
    throw new Error(`Unsupported audit action: ${action}`);
  }
  if (!resourceType) throw new Error('Audit resourceType is required.');

  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });

  const res = await apiFetch(systemAuditLogsUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action,
      resourceType,
      resourceId: input.resourceId ?? null,
      details: input.details ?? {},
    }),
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `postSystemAuditLog failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }
}

/**
 * Logs a system activity for auditing and role-based tracking purposes.
 * Saves the action through the system audit log API.
 */
export async function logSystemActivity(
  session: UserSession | null | undefined,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  details?: Record<string, unknown>
) {
  if (!session) {
    // console.warn('[AuditLog] No session provided, skipping audit log for action:', action);
    return;
  }

  const normalizedAction = normalizeAuditLogAction(action);
  const auditDetails = {
    ...(details ?? {}),
    actorId: session.userId,
    actorName: session.displayName,
    actorRole: session.role,
    tenantId: session.tenantId,
  };

  try {
    if (!isSystemAuditLogAction(normalizedAction)) {
      throw new Error(`Unsupported audit action: ${normalizedAction}`);
    }
    await postSystemAuditLog({
      action: normalizedAction,
      resourceType,
      resourceId,
      details: auditDetails,
    });
  } catch {
    try {
      const { error } = await auditLogsTable().insert({
        user_id: session.userId,
        user_name: session.displayName,
        user_role: session.role,
        action: normalizedAction,
        resource_type: resourceType,
        resource_id: resourceId ?? null,
        details: auditDetails,
      });

      if (error) {
        // console.warn('[AuditLog] Failed to insert audit log. Ensure system_audit_logs table exists:', error);
      } else {
        // console.info(`[AuditLog] Logged ${action} by ${session.displayName} (${session.role})`);
      }
    } catch {
      // console.error('[AuditLog] Exception logging audit activity:', err);
    }
  }
}

/**
 * Fetches the notification IDs that a specific agent marked as "Customer Answered",
 * by querying audit logs for that agent's `notification_customer_answered` actions.
 */
export async function fetchAgentAnsweredNotificationIds(
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await auditLogsTable()
    .select('resource_id')
    .eq('user_id', userId)
    .eq('action', 'notification_customer_answered')
    .not('resource_id', 'is', null);

  if (error) {
    // console.error('[AuditLog] Error fetching agent answered notifications:', error);
    return new Set();
  }

  return new Set(
    (Array.isArray(data) ? data : [])
      .map((row) => pickString(asRecord(row), ['resource_id', 'resourceId']))
      .filter((resourceId): resourceId is string => Boolean(resourceId)),
  );
}

/**
 * Fetches a map of notification_id → agent display name for all
 * `notification_call_customer` audit log entries (i.e. who clicked "Call Customer").
 * When multiple agents called the same notification, the most recent caller wins.
 */
export async function fetchCallCustomerAgentMap(): Promise<Map<string, string>> {
  const { data, error } = await auditLogsTable()
    .select('resource_id, user_name, created_at')
    .eq('action', 'notification_call_customer')
    .not('resource_id', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    // console.error('[AuditLog] Error fetching call-customer agent map:', error);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const raw of Array.isArray(data) ? data : []) {
    const row = asRecord(raw);
    const resourceId = pickString(row, ['resource_id', 'resourceId']);
    const userName = pickString(row, ['user_name', 'userName']) ?? '';
    if (resourceId && !map.has(resourceId)) {
      map.set(resourceId, userName);
    }
  }
  return map;
}

/**
 * Fetches a map of notification_id → agent display name for all
 * `notification_customer_answered` audit log entries (i.e. who clicked "Customer Answered").
 * When multiple agents interacted, the most recent interaction wins.
 */
export async function fetchAnsweredCustomerAgentMap(): Promise<Map<string, string>> {
  const { data, error } = await auditLogsTable()
    .select('resource_id, user_name, created_at')
    .eq('action', 'notification_customer_answered')
    .not('resource_id', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    // console.error('[AuditLog] Error fetching answered agent map:', error);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const raw of Array.isArray(data) ? data : []) {
    const row = asRecord(raw);
    const resourceId = pickString(row, ['resource_id', 'resourceId']);
    const userName = pickString(row, ['user_name', 'userName']) ?? '';
    if (resourceId && !map.has(resourceId)) {
      map.set(resourceId, userName);
    }
  }
  return map;
}

/**
 * Fetches recent audit logs for the dashboard.
 */
export async function fetchSystemAuditLogs(limit: number = 100): Promise<AuditLogEntry[]> {
  requireSuperAdminAuditAuth();
  const res = await apiFetch(auditLogsUrl(limit), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `fetchSystemAuditLogs failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }

  const rows = extractAuditRows(await res.json());
  return rows.map(normalizeAuditLogEntry);
}
