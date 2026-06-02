import { supabase } from '@/integrations/supabase/client';

export type SmsThreadStatus = 'QUEUED' | 'ACTIVE' | 'RESOLVED';
export type SmsMessageDirection = 'INBOUND' | 'OUTBOUND';

export interface SmsQueue {
  id: string;
  queueName: string;
  sortOrder: number;
}

export interface SmsThread {
  id: string;
  customerPhone: string;
  customerName: string | null;
  queueId: string;
  queueName: string;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  status: SmsThreadStatus;
  unreadForAgent: number;
  lastMessageBody: string;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface SmsMessage {
  id: string;
  threadId: string;
  direction: SmsMessageDirection;
  messageBody: string;
  senderAgentId: string | null;
  senderAgentName: string | null;
  textbeeMessageId: string | null;
  textbeeStatus: string | null;
  createdAt: string;
}

export interface SmsInbox {
  queues: SmsQueue[];
  threads: SmsThread[];
  unreadCount: number;
}

export interface SmsUpdatePayload {
  type: 'INBOUND' | 'OUTBOUND' | 'CLAIMED' | 'RESOLVED' | string;
  threadId?: string;
  queueId?: string;
  thread?: unknown;
  message?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function pickString(raw: Record<string, unknown>, keys: readonly string[], fallback = ''): string {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
  }
  return fallback;
}

function pickNullableString(raw: Record<string, unknown>, keys: readonly string[]): string | null {
  const value = pickString(raw, keys);
  return value.trim() ? value : null;
}

function toQueue(raw: unknown): SmsQueue {
  const r = asRecord(raw);
  return {
    id: pickString(r, ['id']),
    queueName: pickString(r, ['queueName', 'queue_name']),
    sortOrder: Number(r.sortOrder ?? r.sort_order ?? 0),
  };
}

function toThread(raw: unknown): SmsThread {
  const r = asRecord(raw);
  const queue = asRecord(r.queue);
  return {
    id: pickString(r, ['id']),
    customerPhone: pickString(r, ['customerPhone', 'customer_phone']),
    customerName: pickNullableString(r, ['customerName', 'customer_name']),
    queueId: pickString(r, ['queueId', 'current_queue_id']),
    queueName: pickString(queue, ['queueName', 'queue_name'], 'Sales'),
    assignedAgentId: pickNullableString(r, ['assignedAgentId', 'assigned_agent_id']),
    assignedAgentName: pickNullableString(r, ['assignedAgentName', 'assigned_agent_name']),
    status: pickString(r, ['status'], 'QUEUED') as SmsThreadStatus,
    unreadForAgent: Number(r.unreadForAgent ?? r.unread_for_agent ?? 0),
    lastMessageBody: pickString(r, ['lastMessageBody', 'last_message_body']),
    lastMessageAt: pickString(r, ['lastMessageAt', 'last_message_at']),
    createdAt: pickString(r, ['createdAt', 'created_at']),
    updatedAt: pickString(r, ['updatedAt', 'updated_at']),
    resolvedAt: pickNullableString(r, ['resolvedAt', 'resolved_at']),
  };
}

function toMessage(raw: unknown): SmsMessage {
  const r = asRecord(raw);
  return {
    id: pickString(r, ['id']),
    threadId: pickString(r, ['threadId', 'thread_id']),
    direction: pickString(r, ['direction'], 'INBOUND') as SmsMessageDirection,
    messageBody: pickString(r, ['messageBody', 'message_body']),
    senderAgentId: pickNullableString(r, ['senderAgentId', 'sender_agent_id']),
    senderAgentName: pickNullableString(r, ['senderAgentName', 'sender_agent_name']),
    textbeeMessageId: pickNullableString(r, ['textbeeMessageId', 'textbee_message_id']),
    textbeeStatus: pickNullableString(r, ['textbeeStatus', 'textbee_status']),
    createdAt: pickString(r, ['createdAt', 'created_at']),
  };
}

async function invokeSmsApi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('sms-api', { body });
  if (error) {
    throw new Error(error.message || 'SMS API request failed');
  }
  return data as T;
}

export async function fetchSmsInbox(): Promise<SmsInbox> {
  const raw = asRecord(await invokeSmsApi<unknown>({ action: 'list' }));
  const queues = Array.isArray(raw.queues) ? raw.queues.map(toQueue) : [];
  const threads = Array.isArray(raw.threads) ? raw.threads.map(toThread) : [];
  return {
    queues,
    threads,
    unreadCount: Number(raw.unreadCount ?? raw.unread_count ?? 0),
  };
}

export async function fetchSmsMessages(threadId: string): Promise<SmsMessage[]> {
  const raw = asRecord(await invokeSmsApi<unknown>({ action: 'messages', threadId }));
  return Array.isArray(raw.messages) ? raw.messages.map(toMessage) : [];
}

export async function claimSmsThread(threadId: string): Promise<SmsThread> {
  const raw = asRecord(await invokeSmsApi<unknown>({ action: 'claim', threadId }));
  return toThread(raw.thread);
}

export async function resolveSmsThread(threadId: string): Promise<SmsThread> {
  const raw = asRecord(await invokeSmsApi<unknown>({ action: 'resolve', threadId }));
  return toThread(raw.thread);
}

export async function sendSmsMessage(threadId: string, messageBody: string): Promise<{
  thread: SmsThread;
  message: SmsMessage;
}> {
  const raw = asRecord(await invokeSmsApi<unknown>({ action: 'send', threadId, messageBody }));
  return {
    thread: toThread(raw.thread),
    message: toMessage(raw.message),
  };
}

export async function startSmsThread(params: {
  customerPhone: string;
  messageBody: string;
  queueId?: string | null;
}): Promise<{
  thread: SmsThread;
  message: SmsMessage;
}> {
  const raw = asRecord(
    await invokeSmsApi<unknown>({
      action: 'start',
      customerPhone: params.customerPhone,
      messageBody: params.messageBody,
      queueId: params.queueId || undefined,
    }),
  );
  return {
    thread: toThread(raw.thread),
    message: toMessage(raw.message),
  };
}

export async function fetchSmsUnreadCount(): Promise<number> {
  const inbox = await fetchSmsInbox();
  return inbox.unreadCount;
}

export function subscribeToSmsUpdates(onUpdate: (payload: SmsUpdatePayload) => void): () => void {
  const channel = supabase
    .channel('sms-center')
    .on('broadcast', { event: 'SMS_UPDATED' }, ({ payload }) => {
      onUpdate(payload as SmsUpdatePayload);
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
