/**
 * Care Plus live human support — agent inbox client.
 *
 * Browser → Supabase edge BFF (`careplus-support`) → Care Plus admin REST.
 * Never reads/writes `careplus_support_*` via Supabase anon/publishable keys.
 */

import { getAccessToken, syncSupabaseAuthSession } from '@/lib/api';

export type CarePlusThreadStatus = 'open' | 'closed';

export type CarePlusSupportThread = {
  id: string;
  providerId: string;
  providerName: string;
  requesterUid: string;
  requesterEmail: string;
  requesterName: string;
  status: CarePlusThreadStatus;
  createdAt: string;
  updatedAt: string;
};

export type CarePlusSenderRole = 'provider' | 'agent';

export type CarePlusSupportMessage = {
  id: string;
  threadId: string;
  senderRole: CarePlusSenderRole;
  senderName: string;
  body: string;
  createdAt: string;
};

export type CarePlusThreadsResponse = {
  configured: boolean;
  threads: CarePlusSupportThread[];
};

export type CarePlusMessagesResponse = {
  configured: boolean;
  thread: CarePlusSupportThread | null;
  messages: CarePlusSupportMessage[];
};

export class CarePlusSupportApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CarePlusSupportApiError';
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(raw: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return fallback;
}

function toThread(raw: unknown): CarePlusSupportThread {
  const row = asRecord(raw);
  const statusRaw = pickString(row, ['status'], 'open').toLowerCase();
  return {
    id: pickString(row, ['id']),
    providerId: pickString(row, ['providerId', 'provider_id']),
    providerName: pickString(row, ['providerName', 'provider_name'], 'Provider'),
    requesterUid: pickString(row, ['requesterUid', 'requester_uid']),
    requesterEmail: pickString(row, ['requesterEmail', 'requester_email']),
    requesterName: pickString(row, ['requesterName', 'requester_name'], 'Requester'),
    status: statusRaw === 'closed' ? 'closed' : 'open',
    createdAt: pickString(row, ['createdAt', 'created_at']),
    updatedAt: pickString(row, ['updatedAt', 'updated_at']),
  };
}

function toMessage(raw: unknown): CarePlusSupportMessage {
  const row = asRecord(raw);
  const roleRaw = pickString(row, ['senderRole', 'sender_role'], 'provider').toLowerCase();
  return {
    id: pickString(row, ['id']),
    threadId: pickString(row, ['threadId', 'thread_id']),
    senderRole: roleRaw === 'agent' ? 'agent' : 'provider',
    senderName: pickString(row, ['senderName', 'sender_name'], roleRaw === 'agent' ? 'Agent' : 'Provider'),
    body: pickString(row, ['body', 'message', 'text']),
    createdAt: pickString(row, ['createdAt', 'created_at']),
  };
}

async function invokeCarePlus(body: Record<string, unknown>): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  await syncSupabaseAuthSession();
  const token = getAccessToken();
  if (!token) {
    throw new CarePlusSupportApiError(401, 'Sign in to use Care Plus support.');
  }

  // Direct fetch so we preserve upstream HTTP status (403/409/503) from the BFF.
  // `functions.invoke` collapses non-2xx into a generic FunctionsHttpError.
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
  const anonKey =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ||
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
    '';
  if (!base || !anonKey) {
    throw new CarePlusSupportApiError(500, 'Supabase URL / publishable key missing.');
  }

  const res = await fetch(`${base}/functions/v1/careplus-support`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => '');
  let raw: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      raw = asRecord(JSON.parse(text));
    } catch {
      raw = { error: text.slice(0, 400) };
    }
  }

  if (!res.ok) {
    const msg =
      (typeof raw.error === 'string' && raw.error.trim()) ||
      `Care Plus support failed (${res.status})`;
    throw new CarePlusSupportApiError(res.status, msg);
  }

  if (typeof raw.error === 'string' && raw.error.trim()) {
    throw new CarePlusSupportApiError(400, raw.error.trim());
  }

  return { status: res.status, data: raw };
}

export async function fetchCarePlusThreads(opts?: {
  status?: 'open' | 'closed' | 'all';
  limit?: number;
}): Promise<CarePlusThreadsResponse> {
  const { data } = await invokeCarePlus({
    action: 'listThreads',
    status: opts?.status ?? 'open',
    limit: opts?.limit ?? 100,
  });

  const configured = data.configured !== false;
  const list = Array.isArray(data.threads)
    ? data.threads
    : Array.isArray(data.items)
      ? data.items
      : [];

  return {
    configured,
    threads: list.map(toThread).filter((t) => t.id),
  };
}

export async function fetchCarePlusMessages(
  threadId: string,
  opts?: { since?: string | null },
): Promise<CarePlusMessagesResponse> {
  const id = threadId.trim();
  if (!id) throw new CarePlusSupportApiError(400, 'threadId is required');

  const { data } = await invokeCarePlus({
    action: 'listMessages',
    threadId: id,
    since: opts?.since?.trim() || undefined,
  });

  const configured = data.configured !== false;
  const list = Array.isArray(data.messages)
    ? data.messages
    : Array.isArray(data.items)
      ? data.items
      : [];

  return {
    configured,
    thread: data.thread ? toThread(data.thread) : null,
    messages: list.map(toMessage).filter((m) => m.id),
  };
}

export async function postCarePlusReply(
  threadId: string,
  body: string,
): Promise<{ thread: CarePlusSupportThread | null; message: CarePlusSupportMessage }> {
  const id = threadId.trim();
  const text = body.trim();
  if (!id) throw new CarePlusSupportApiError(400, 'threadId is required');
  if (!text || text.length > 8000) {
    throw new CarePlusSupportApiError(400, 'Message must be 1–8000 characters.');
  }

  const { data } = await invokeCarePlus({
    action: 'postMessage',
    threadId: id,
    body: text,
  });

  return {
    thread: data.thread ? toThread(data.thread) : null,
    message: toMessage(data.message ?? data),
  };
}
