import { API_BASE, apiFetch, getAccessToken, syncSupabaseAuthSession } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';

/** Contacts live in Supabase (`sms_contacts`). The Command Center :5050 API has no `/sms/contacts` routes. */
const SMS_CONTACTS_USE_SUPABASE =
  (import.meta.env.VITE_SMS_CONTACTS_VIA_API as string | undefined)?.trim().toLowerCase() !== 'true';

/** Command Center backend root. Defaults to `API_BASE` (`/api` in dev). Override with `VITE_SMS_API_BASE`. */
const SMS_API_BASE =
  (import.meta.env.VITE_SMS_API_BASE as string | undefined)?.trim().replace(/\/+$/, '') || API_BASE;

const SMS_API_URL =
  (import.meta.env.VITE_SMS_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  `${SMS_API_BASE}/sms`;

export type SmsThreadStatus = 'QUEUED' | 'ACTIVE' | 'RESOLVED';
export type SmsMessageDirection = 'INBOUND' | 'OUTBOUND';
export type SmsContactType = 'customer' | 'owner';

export interface SmsContact {
  id: string;
  contactType: SmsContactType;
  displayName: string;
  phone: string;
  ownerUid: string | null;
  createdAt: string;
}

export function normalizeSmsPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function normalizeSmsPhone(phone: string): string {
  return phone.replace(/[\s().-]/g, '').trim();
}

/** Last 9 digits — matches AU mobiles when one side uses +61 and the other uses 0. */
function smsPhoneTailDigits(phone: string): string {
  const digits = normalizeSmsPhoneDigits(phone);
  if (!digits) return '';
  if (digits.startsWith('61') && digits.length >= 11) return digits.slice(-9);
  if (digits.startsWith('0') && digits.length >= 10) return digits.slice(-9);
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

export function smsPhonesEquivalent(a: string, b: string): boolean {
  const da = normalizeSmsPhoneDigits(a);
  const db = normalizeSmsPhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (normalizeSmsPhone(a) === normalizeSmsPhone(b)) return true;
  const tailA = smsPhoneTailDigits(a);
  const tailB = smsPhoneTailDigits(b);
  return Boolean(tailA && tailB && tailA.length >= 8 && tailA === tailB);
}

export function findSmsContactByPhone(
  contacts: readonly SmsContact[],
  phone: string,
): SmsContact | undefined {
  return contacts.find((contact) => smsPhonesEquivalent(contact.phone, phone));
}

export function resolveCustomerNameForPhone(
  phone: string,
  contacts: readonly SmsContact[],
  threadName?: string | null,
): string | null {
  const fromThread = threadName?.trim();
  if (fromThread) return fromThread;
  return findSmsContactByPhone(contacts, phone)?.displayName?.trim() || null;
}

export function enrichSmsThreadsWithContacts(
  threads: SmsThread[],
  contacts: readonly SmsContact[],
): SmsThread[] {
  return threads.map((thread) => {
    const resolved = resolveCustomerNameForPhone(
      thread.customerPhone,
      contacts,
      thread.customerName,
    );
    if (!resolved || resolved === thread.customerName) return thread;
    return { ...thread, customerName: resolved };
  });
}

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

export interface SmsContactsListParams {
  contactType?: SmsContactType;
  phone?: string;
  ownerUid?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SmsContactsListResult {
  contacts: SmsContact[];
  total: number;
  limit: number;
  offset: number;
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
    queueName: pickString(r, ['queueName', 'queue_name'], pickString(queue, ['queueName', 'queue_name'], 'Sales')),
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

function requireSmsAuth(): void {
  if (!getAccessToken()) {
    throw new Error('Sign in to use SMS.');
  }
}

function smsUrl(path = ''): string {
  const suffix = path.trim() ? (path.startsWith('/') ? path : `/${path}`) : '';
  return `${SMS_API_URL}${suffix}`;
}

async function readHttpErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  if (!text.trim()) return '';
  try {
    const body = asRecord(JSON.parse(text) as unknown);
    const detail = body.message ?? body.error ?? body.detail;
    return typeof detail === 'string' ? detail : text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as unknown) : null;
}

function extractBody(raw: unknown, keys: readonly string[]): unknown {
  if (Array.isArray(raw)) return raw;
  const body = asRecord(raw);
  for (const key of keys) {
    if (body[key] !== undefined) return body[key];
  }
  if (Array.isArray(body.data)) return body.data;
  const data = asRecord(body.data);
  for (const key of keys) {
    if (data[key] !== undefined) return data[key];
  }
  return raw;
}

async function requestSms(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  requireSmsAuth();

  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  const res = await apiFetch(smsUrl(path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`SMS API ${method} ${path} failed: ${res.status}${detail ? ` - ${detail}` : ''}`);
  }

  return readJsonBody(res);
}

export async function fetchSmsInbox(): Promise<SmsInbox> {
  const raw = asRecord(extractBody(await requestSms('GET', '/inbox'), ['inbox', 'data', 'result']));
  const queues = Array.isArray(raw.queues) ? raw.queues.map(toQueue) : [];
  const threads = Array.isArray(raw.threads) ? raw.threads.map(toThread) : [];
  return {
    queues,
    threads,
    unreadCount: Number(raw.unreadCount ?? raw.unread_count ?? 0),
  };
}

export async function fetchSmsMessages(threadId: string): Promise<SmsMessage[]> {
  const id = encodeURIComponent(threadId.trim());
  const raw = await requestSms('GET', `/threads/${id}/messages`);
  const messages = extractBody(raw, ['messages', 'items', 'results']);
  return Array.isArray(messages) ? messages.map(toMessage) : [];
}

export async function claimSmsThread(threadId: string): Promise<SmsThread> {
  const id = encodeURIComponent(threadId.trim());
  const raw = await requestSms('POST', `/threads/${id}/claim`);
  return toThread(extractBody(raw, ['thread', 'item', 'result']));
}

export async function resolveSmsThread(threadId: string): Promise<SmsThread> {
  const id = encodeURIComponent(threadId.trim());
  const raw = await requestSms('POST', `/threads/${id}/resolve`);
  return toThread(extractBody(raw, ['thread', 'item', 'result']));
}

export async function sendSmsMessage(threadId: string, messageBody: string): Promise<{
  thread: SmsThread;
  message: SmsMessage;
}> {
  const id = encodeURIComponent(threadId.trim());
  const raw = asRecord(await requestSms('POST', `/threads/${id}/messages`, { messageBody }));
  return {
    thread: toThread(extractBody(raw, ['thread'])),
    message: toMessage(extractBody(raw, ['message'])),
  };
}

/** Operations not implemented on the Command Center :5050 `/api/sms` routes. */
async function invokeSmsEdgeFunction(body: Record<string, unknown>): Promise<unknown> {
  await syncSupabaseAuthSession();
  const token = getAccessToken();
  if (!token) throw new Error('Sign in to use SMS.');

  const { data, error } = await supabase.functions.invoke('sms-api', {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) throw new Error(error.message || 'SMS API failed');

  const raw = asRecord(data);
  if (raw.error) throw new Error(String(raw.error));
  return data;
}

/** Pull received SMS from TextBee into Supabase (supervisor / super-admin). */
export async function syncInboundSmsFromTextBee(): Promise<{
  imported: number;
  skipped: number;
  duplicates: number;
}> {
  const raw = asRecord(await invokeSmsEdgeFunction({ action: 'syncInbound' }));
  return {
    imported: Number(raw.imported ?? 0),
    skipped: Number(raw.skipped ?? 0),
    duplicates: Number(raw.duplicates ?? 0),
  };
}

export async function startSmsThread(params: {
  customerPhone: string;
  messageBody: string;
  customerName?: string | null;
  queueId?: string | null;
}): Promise<{
  thread: SmsThread;
  message: SmsMessage;
}> {
  const raw = asRecord(
    await requestSms('POST', '/threads/start', {
      customerPhone: params.customerPhone,
      messageBody: params.messageBody,
      customerName: params.customerName?.trim() || undefined,
      queueId: params.queueId || undefined,
    }),
  );
  return {
    thread: toThread(extractBody(raw, ['thread'])),
    message: toMessage(extractBody(raw, ['message'])),
  };
}

function toContact(raw: Record<string, unknown>): SmsContact {
  return {
    id: pickString(raw, ['id']),
    contactType: pickString(raw, ['contactType', 'contact_type'], 'customer') as SmsContactType,
    displayName: pickString(raw, ['displayName', 'display_name', 'name']),
    phone: pickString(raw, ['phone', 'mobile', 'contact_phone']),
    ownerUid: pickNullableString(raw, ['ownerUid', 'owner_uid']),
    createdAt: pickString(raw, ['createdAt', 'created_at']),
  };
}

async function ensureSupabaseSession(): Promise<void> {
  const first = await supabase.auth.getUser();
  if (!first.error && first.data.user) return;
  await syncSupabaseAuthSession();
  const retry = await supabase.auth.getUser();
  if (retry.error || !retry.data.user) {
    throw new Error('Sign in to manage SMS contacts.');
  }
}

function mapSmsContactRow(row: {
  id: string;
  contact_type: string;
  display_name: string;
  phone: string;
  owner_uid: string | null;
  created_at: string;
}): SmsContact {
  return toContact(
    asRecord({
      id: row.id,
      contact_type: row.contact_type,
      display_name: row.display_name,
      phone: row.phone,
      owner_uid: row.owner_uid,
      created_at: row.created_at,
    }),
  );
}

async function fetchSmsContactsFromSupabase(
  params: SmsContactsListParams = {},
): Promise<SmsContactsListResult> {
  await ensureSupabaseSession();
  const limit = Math.min(200, Math.max(1, params.limit ?? 200));
  const offset = Math.max(0, params.offset ?? 0);

  let query = supabase.from('sms_contacts').select('*', { count: 'exact' });
  if (params.contactType) query = query.eq('contact_type', params.contactType);
  if (params.ownerUid?.trim()) query = query.eq('owner_uid', params.ownerUid.trim());

  const { data, error, count } = await query
    .order('display_name', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  let contacts = (data ?? []).map((row) => mapSmsContactRow(row));

  if (params.phone?.trim()) {
    const phone = params.phone.trim();
    contacts = contacts.filter((contact) => smsPhonesEquivalent(contact.phone, phone));
  }
  if (params.search?.trim()) {
    const q = params.search.trim().toLowerCase();
    contacts = contacts.filter(
      (contact) =>
        contact.displayName.toLowerCase().includes(q) || contact.phone.toLowerCase().includes(q),
    );
  }

  return {
    contacts,
    total: count ?? contacts.length,
    limit,
    offset,
  };
}

async function fetchSmsContactsFromApi(
  params: SmsContactsListParams = {},
): Promise<SmsContactsListResult> {
  const q = new URLSearchParams();
  if (params.contactType) q.set('contactType', params.contactType);
  if (params.phone?.trim()) q.set('phone', params.phone.trim());
  if (params.ownerUid?.trim()) q.set('ownerUid', params.ownerUid.trim());
  if (params.search?.trim()) q.set('search', params.search.trim());
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  const query = q.toString();
  const body = asRecord(await requestSms('GET', `/contacts${query ? `?${query}` : ''}`));
  const raw = asRecord(body.data ?? body.result ?? body);
  const list = raw.contacts ?? raw.items ?? body.contacts ?? body.items;
  const contacts = Array.isArray(list) ? list.map((c) => toContact(asRecord(c))) : [];
  return {
    contacts,
    total: Number(raw.total ?? contacts.length),
    limit: Number(raw.limit ?? contacts.length),
    offset: Number(raw.offset ?? 0),
  };
}

export async function fetchSmsContacts(
  params: SmsContactsListParams = {},
): Promise<SmsContactsListResult> {
  if (SMS_CONTACTS_USE_SUPABASE) {
    return fetchSmsContactsFromSupabase(params);
  }
  return fetchSmsContactsFromApi(params);
}

export async function fetchSmsContact(contactId: string): Promise<SmsContact> {
  if (!SMS_CONTACTS_USE_SUPABASE) {
    const id = encodeURIComponent(contactId.trim());
    const raw = asRecord(await requestSms('GET', `/contacts/${id}`));
    return toContact(asRecord(extractBody(raw, ['contact'])));
  }

  await ensureSupabaseSession();
  const { data, error } = await supabase
    .from('sms_contacts')
    .select('*')
    .eq('id', contactId.trim())
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('Contact not found.');
  return mapSmsContactRow(data);
}

async function syncThreadCustomerNamesFromContact(
  phone: string,
  displayName: string,
): Promise<void> {
  const { data: threads, error } = await supabase
    .from('sms_threads')
    .select('id, customer_phone, customer_name');
  if (error) throw error;

  const updates = (threads ?? []).filter(
    (thread) =>
      !thread.customer_name?.trim() && smsPhonesEquivalent(String(thread.customer_phone), phone),
  );
  if (!updates.length) return;

  await Promise.all(
    updates.map((thread) =>
      supabase.from('sms_threads').update({ customer_name: displayName }).eq('id', thread.id),
    ),
  );
}

async function createSmsContactInSupabase(params: {
  contactType: SmsContactType;
  displayName: string;
  phone: string;
  ownerUid?: string | null;
}): Promise<SmsContact> {
  await ensureSupabaseSession();
  const phone = normalizeSmsPhone(params.phone);
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('sms_contacts')
    .insert({
      contact_type: params.contactType,
      display_name: params.displayName.trim(),
      phone,
      owner_uid: params.ownerUid?.trim() || null,
      created_by: userData.user?.id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  if (params.contactType === 'customer') {
    await syncThreadCustomerNamesFromContact(phone, params.displayName.trim());
  }
  return mapSmsContactRow(data);
}

export async function createSmsContact(params: {
  contactType: SmsContactType;
  displayName: string;
  phone: string;
  ownerUid?: string | null;
}): Promise<SmsContact> {
  const phone = normalizeSmsPhone(params.phone);
  if (SMS_CONTACTS_USE_SUPABASE) {
    return createSmsContactInSupabase({ ...params, phone });
  }

  const raw = asRecord(
    await requestSms('POST', '/contacts', {
      contactType: params.contactType,
      displayName: params.displayName.trim(),
      phone,
      ownerUid: params.ownerUid?.trim() || undefined,
    }),
  );
  return toContact(asRecord(extractBody(raw, ['contact'])));
}

export async function updateSmsContact(
  contactId: string,
  params: {
    contactType?: SmsContactType;
    displayName?: string;
    phone?: string;
    ownerUid?: string | null;
  },
): Promise<SmsContact> {
  if (!SMS_CONTACTS_USE_SUPABASE) {
    const id = encodeURIComponent(contactId.trim());
    const body: Record<string, unknown> = {};
    if (params.contactType) body.contactType = params.contactType;
    if (params.displayName !== undefined) body.displayName = params.displayName;
    if (params.phone !== undefined) body.phone = params.phone;
    if (params.ownerUid !== undefined) body.ownerUid = params.ownerUid;
    const raw = asRecord(await requestSms('PATCH', `/contacts/${id}`, body));
    return toContact(asRecord(extractBody(raw, ['contact'])));
  }

  await ensureSupabaseSession();
  const patch: Record<string, string | null> = {};
  if (params.contactType) patch.contact_type = params.contactType;
  if (params.displayName !== undefined) patch.display_name = params.displayName.trim();
  if (params.phone !== undefined) patch.phone = normalizeSmsPhone(params.phone);
  if (params.ownerUid !== undefined) patch.owner_uid = params.ownerUid?.trim() || null;

  const { data, error } = await supabase
    .from('sms_contacts')
    .update(patch)
    .eq('id', contactId.trim())
    .select('*')
    .single();
  if (error) throw error;

  const contact = mapSmsContactRow(data);
  if (contact.contactType === 'customer' && contact.displayName) {
    await syncThreadCustomerNamesFromContact(contact.phone, contact.displayName);
  }
  return contact;
}

export async function deleteSmsContact(contactId: string): Promise<void> {
  if (!SMS_CONTACTS_USE_SUPABASE) {
    const id = encodeURIComponent(contactId.trim());
    await requestSms('DELETE', `/contacts/${id}`);
    return;
  }

  await ensureSupabaseSession();
  const { error } = await supabase.from('sms_contacts').delete().eq('id', contactId.trim());
  if (error) throw error;
}

export async function deleteSmsThread(threadId: string): Promise<void> {
  const id = threadId.trim();
  if (!id) throw new Error('Thread id is required');

  // :5050 does not expose DELETE /api/sms/threads/:id — use Supabase sms-api edge function.
  try {
    await requestSms('DELETE', `/threads/${encodeURIComponent(id)}`);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    const missingOnBackend =
      message.includes('404') ||
      message.includes('Cannot DELETE') ||
      message.includes('Not found');
    if (!missingOnBackend) throw err;
  }

  await invokeSmsEdgeFunction({ action: 'deleteThread', threadId: id });
}

export async function fetchSmsUnreadCount(): Promise<number> {
  const inbox = await fetchSmsInbox();
  return inbox.unreadCount;
}

export function subscribeToSmsUpdates(onUpdate: (payload: SmsUpdatePayload) => void): () => void {
  const notify = () => onUpdate({ type: 'REFRESH' });

  const channel = supabase
    .channel('sms-center')
    .on('broadcast', { event: 'SMS_UPDATED' }, ({ payload }) => {
      onUpdate(payload as SmsUpdatePayload);
    })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sms_threads' },
      notify,
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'sms_messages' },
      notify,
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
