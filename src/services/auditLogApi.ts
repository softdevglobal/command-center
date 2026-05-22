import { supabase } from '@/integrations/supabase/client';
import type { UserSession } from './types';

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
  limit(count: number): SupabaseAuditQuery;
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

/** Resource type recorded for support / BMS chat threads in {@link logSystemActivity}. */
export const AUDIT_RESOURCE_BMS_CHAT = 'bms_chat';

/** Emitted when an agent opens a BMS chat thread (read receipt posted). */
export const AUDIT_ACTION_CHAT_VIEWED = 'chat_viewed';
/** Emitted when an agent sends a message in a BMS chat. */
export const AUDIT_ACTION_CHAT_REPLY = 'chat_reply';

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

function supabaseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  const row = asRecord(error);
  const parts = [
    pickString(row, ['message']),
    pickString(row, ['details']),
    pickString(row, ['hint']),
    pickString(row, ['code']),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' - ') : fallback;
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

function normKey(s: string | undefined | null): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
}

export function isAuditChatSupportEntry(log: AuditLogEntry): boolean {
  const a = normKey(log.action);
  const t = normKey(log.resource_type);
  if (!['chat_viewed', 'chat_reply'].includes(a)) return false;
  return t === 'bms_chat' || t === 'support_chat';
}

/**
 * Logs a system activity for auditing and role-based tracking purposes.
 * Saves the action along with the user's role and details to the Supabase database.
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
  
  try {
    const { error } = await auditLogsTable().insert({
      user_id: session.userId,
      user_name: session.displayName,
      user_role: session.role,
      action,
      resource_type: resourceType,
      resource_id: resourceId ?? null,
      details: details ?? {}
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
  const lim = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const { data, error } = await auditLogsTable()
    .select('*')
    .order('created_at', { ascending: false })
    .limit(lim);

  if (error) {
    throw new Error(
      `fetchSystemAuditLogs failed: ${supabaseErrorMessage(
        error,
        'Could not load system audit logs from Supabase',
      )}`,
    );
  }

  const rows = Array.isArray(data) ? data : [];
  return rows.map(normalizeAuditLogEntry);
}
