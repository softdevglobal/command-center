import { supabase } from '@/integrations/supabase/client';
import { API_BASE, apiFetch, getAccessToken } from '@/lib/api';
import { fetchAgentsList } from '@/services/agentApis';
import type { Agent } from '@/services/types';

const BASE_URL =
  (import.meta.env.VITE_BMS_SUPPORT_CHAT_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  `${API_BASE}/bms-black`;

const AGENT_PREFIX = '/agent/conversations';

const CALL_CENTER_BASE_URL =
  (import.meta.env.VITE_CALL_CENTER_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  `${API_BASE}/bms-black`;

const AGENT_CHAT_API_URL =
  (import.meta.env.VITE_AGENT_CHAT_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  `${API_BASE}/agent-chat`;

// ── Row from GET /agent/conversations (queue | mine) ──────────────────────

export interface Conversation {
  conversationId: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  userPhone: string | null;
  role: string;
  ownerUid: string | null;
  status: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  lastMessage: string;
  lastMessageAt: string;
  lastSender: string;
  unreadForAgent: number;
  unreadForCustomer: number;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
}

export type ConversationsResponse = {
  queue: Conversation[];
  mine: Conversation[];
};

/** @deprecated Use {@link Conversation} */
export type AgentConversation = Conversation;

/** @deprecated Use {@link ConversationsResponse} */
export type AgentConversationsResponse = ConversationsResponse;

// ── Legacy dashboard shape (sidebar unread / older UI) ─────────────────────

export interface ChatWorkshop {
  ownerUid: string;
  name: string;
  displayName: string;
  slug: string;
  logoUrl: string;
  email: string;
  phone: string;
  address: string;
  abn: string;
  timezone: string;
  state: string;
  bookingEngineUrl: string;
  accountStatus: string;
}

export interface ChatWorkshopUser {
  uid: string;
  name: string;
  displayName: string;
  email: string;
  role: string;
  phone: string;
  branchId: string;
  branchName: string;
}

export interface ChatItem {
  chatId: string;
  workshopOwnerUid: string;
  tenantUserUid: string;
  tenantRole: string;
  agentUid: string;
  participantIds: string[];
  agentName: string;
  tenantName: string;
  lastMessageText: string;
  lastMessageAt: string;
  lastSenderId: string;
  unreadForTenant: boolean;
  unreadForAgent: boolean;
  chatsReviewed: boolean;
  chatsReviewedAt: string | null;
  chatsReviewedByUid: string | null;
  createdAt: string;
  updatedAt: string;
  workshop: ChatWorkshop | null;
  workshopUser: ChatWorkshopUser | null;
}

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  /** Same as {@link conversationId} — kept for older call sites. */
  chatId: string;
  senderId: string;
  text: string;
  createdAt: string;
  senderRole?: string;
  readAt?: string | null;
}

export type FetchChatsOptions = {
  tenantId?: string | null;
  ownerUid?: string | null;
  queueLimit?: number;
  mineLimit?: number;
};

export type FetchChatMessagesOptions = {
  limit?: number;
  before?: string | null;
};

export type FetchChatMessagesPage = {
  messages: ChatMessage[];
  nextBefore: string | null;
};

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  return apiFetch(url, { ...init, headers });
}

async function authorizedFetchCallCenter(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const url = `${CALL_CENTER_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  return apiFetch(url, { ...init, headers });
}

async function authorizedFetchAgentChat(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!getAccessToken()) {
    throw new Error('Sign in to use internal chat.');
  }

  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const base = AGENT_CHAT_API_URL.replace(/\/+$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  return apiFetch(url, { ...init, headers });
}

async function readHttpErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  if (!text.trim()) return '';
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      const msg = o.message ?? o.error ?? o.detail ?? o.reason;
      if (typeof msg === 'string') return msg;
    }
    return text.slice(0, 800);
  } catch {
    return text.slice(0, 800);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function toConversation(raw: unknown): Conversation {
  const r = asRecord(raw);
  return {
    conversationId: String(r.conversationId ?? r.chatId ?? ''),
    userId: String(r.userId ?? ''),
    userName: String(r.userName ?? ''),
    userEmail: r.userEmail == null ? null : String(r.userEmail),
    userPhone: r.userPhone == null ? null : String(r.userPhone),
    role: String(r.role ?? ''),
    ownerUid: r.ownerUid == null ? null : String(r.ownerUid),
    status: String(r.status ?? ''),
    agentId: r.agentId == null ? null : String(r.agentId),
    agentName: r.agentName == null ? null : String(r.agentName),
    agentEmail: r.agentEmail == null ? null : String(r.agentEmail),
    lastMessage: String(r.lastMessage ?? r.lastMessageText ?? ''),
    lastMessageAt: String(r.lastMessageAt ?? ''),
    lastSender: String(r.lastSender ?? r.lastSenderId ?? ''),
    unreadForAgent: Number(r.unreadForAgent ?? 0),
    unreadForCustomer: Number(r.unreadForCustomer ?? 0),
    createdAt: String(r.createdAt ?? ''),
    updatedAt: String(r.updatedAt ?? ''),
    claimedAt: r.claimedAt == null ? null : String(r.claimedAt),
    closedAt: r.closedAt == null ? null : String(r.closedAt),
    closedBy: r.closedBy == null ? null : String(r.closedBy),
  };
}

function conversationToChatItem(c: Conversation): ChatItem {
  const lastN = c.lastSender.trim().toLowerCase();
  const lastSenderId =
    lastN === 'agent'
      ? (c.agentId ?? '')
      : lastN === 'customer'
        ? (c.userId ?? '')
        : '';

  return {
    chatId: c.conversationId,
    workshopOwnerUid: c.ownerUid ?? '',
    tenantUserUid: c.userId,
    tenantRole: c.role,
    agentUid: c.agentId ?? '',
    participantIds: [c.userId, c.agentId ?? ''].filter(Boolean),
    agentName: c.agentName ?? '',
    tenantName: c.userName,
    lastMessageText: c.lastMessage,
    lastMessageAt: c.lastMessageAt,
    lastSenderId,
    unreadForTenant: c.unreadForCustomer > 0,
    unreadForAgent: c.unreadForAgent > 0,
    chatsReviewed: Boolean(c.closedAt) || c.status === 'closed',
    chatsReviewedAt: c.closedAt,
    chatsReviewedByUid: c.closedBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    workshop: null,
    workshopUser: {
      uid: c.userId,
      name: c.userName,
      displayName: c.userName,
      email: c.userEmail ?? '',
      role: c.role,
      phone: c.userPhone ?? '',
      branchId: '',
      branchName: '',
    },
  };
}

function tenantScopedHeaders(ownerUid: string): Headers {
  const h = new Headers();
  if (ownerUid) h.set('X-Tenant-Id', ownerUid);
  return h;
}

function appendScopeQuery(params: URLSearchParams, options?: FetchChatsOptions): void {
  const ou = options?.ownerUid?.trim() || '';
  const tid = options?.tenantId?.trim() || '';
  if (ou) params.set('ownerUid', ou);
  else if (tid) params.set('tenantId', tid);
}

function extractMessageText(value: unknown, depth = 0): string {
  if (depth > 6) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const r = asRecord(value);
  for (const k of ['text', 'body', 'content', 'message', 'lastMessage'] as const) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  for (const wrap of ['data', 'result', 'payload'] as const) {
    const w = r[wrap];
    if (w != null && w !== r) {
      const inner = extractMessageText(w, depth + 1);
      if (inner.trim()) return inner;
    }
  }
  return '';
}

function extractMessageCreatedAt(raw: Record<string, unknown>): string {
  for (const k of [
    'createdAt',
    'created_at',
    'sentAt',
    'sent_at',
    'timestamp',
    'time',
    'date',
  ] as const) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function toMessage(raw: unknown, fallbackConversationId: string): ChatMessage {
  if (typeof raw === 'string') {
    const id = fallbackConversationId;
    return {
      messageId: '',
      conversationId: id,
      chatId: id,
      senderId: '',
      text: raw,
      createdAt: '',
    };
  }
  const r = asRecord(raw);
  const convId = String(r.conversationId ?? r.chatId ?? fallbackConversationId);
  return {
    messageId: String(r.messageId ?? r.id ?? ''),
    conversationId: convId,
    chatId: convId,
    senderId: String(r.senderId ?? r.senderUid ?? r.userId ?? ''),
    text: extractMessageText(raw),
    createdAt: extractMessageCreatedAt(r),
    senderRole: r.senderRole != null ? String(r.senderRole) : undefined,
    readAt:
      r.readAt === null ? null : r.readAt != null ? String(r.readAt) : undefined,
  };
}

function collectMessagesArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.messages)) return o.messages;
    const data = o.data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (Array.isArray(d.messages)) return d.messages;
    }
  }
  return [];
}

function readNextBefore(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const direct = o.nextBefore ?? o.next_before;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return null;
}

// ── Public API (support-chat) ─────────────────────────────────────────────

export async function fetchConversations(
  options?: FetchChatsOptions,
): Promise<ConversationsResponse> {
  const ou = options?.ownerUid?.trim() || '';
  const params = new URLSearchParams();
  appendScopeQuery(params, options);
  if (options?.queueLimit != null) params.set('queueLimit', String(options.queueLimit));
  if (options?.mineLimit != null) params.set('mineLimit', String(options.mineLimit));
  const qs = params.toString();
  const path = `${AGENT_PREFIX}${qs ? `?${qs}` : ''}`;

  const res = await authorizedFetch(path, { headers: tenantScopedHeaders(ou) });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`fetchConversations failed: ${res.status}${detail ? ` - ${detail}` : ''}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return {
    queue: Array.isArray(json.queue) ? json.queue.map(toConversation) : [],
    mine: Array.isArray(json.mine) ? json.mine.map(toConversation) : [],
  };
}

/** @deprecated Use {@link fetchConversations} */
export const fetchAgentConversations = fetchConversations;

export async function fetchConversationMessages(conversationId: string): Promise<ChatMessage[]> {
  const page = await fetchChatMessagesPage(conversationId);
  return page.messages;
}

export async function postConversationMessage(
  conversationId: string,
  text: string,
): Promise<ChatMessage | null> {
  const path = `${AGENT_PREFIX}/${encodeURIComponent(conversationId)}/messages`;
  const res = await authorizedFetch(path, {
    method: 'POST',
    body: JSON.stringify({ message: text }),
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `postConversationMessage failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }

  const rawText = await res.text();
  const fallback: ChatMessage = {
    messageId: '',
    conversationId,
    chatId: conversationId,
    senderId: '',
    senderRole: 'agent',
    text,
    createdAt: new Date().toISOString(),
  };

  if (!rawText.trim()) return fallback;

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const payload = parsed.message ?? parsed.data ?? parsed;
    const msg = toMessage(payload, conversationId);
    return msg.senderRole?.trim() ? msg : { ...msg, senderRole: 'agent' };
  } catch {
    return fallback;
  }
}

export async function postConversationClaim(conversationId: string): Promise<void> {
  const res = await authorizedFetch(
    `${AGENT_PREFIX}/${encodeURIComponent(conversationId)}/claim`,
    { method: 'POST', body: '{}' },
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`postConversationClaim failed: ${res.status}${detail ? ` - ${detail}` : ''}`);
  }
}

export async function postConversationRead(conversationId: string): Promise<void> {
  const res = await authorizedFetch(
    `${AGENT_PREFIX}/${encodeURIComponent(conversationId)}/read`,
    { method: 'POST', body: '{}' },
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`postConversationRead failed: ${res.status}${detail ? ` - ${detail}` : ''}`);
  }
}

export async function postConversationClose(conversationId: string): Promise<void> {
  const res = await authorizedFetch(
    `${AGENT_PREFIX}/${encodeURIComponent(conversationId)}/close`,
    { method: 'POST', body: '{}' },
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`postConversationClose failed: ${res.status}${detail ? ` - ${detail}` : ''}`);
  }
}

export async function fetchWorkshopName(ownerUid: string | null): Promise<string | null> {
  if (!ownerUid) return null;
  const { data, error } = await supabase
    .from('did_mappings')
    .select('workshop_name')
    .eq('owner_id', ownerUid)
    .maybeSingle();
  if (error || !data?.workshop_name) return null;
  return String(data.workshop_name).trim() || null;
}

export async function fetchWorkshopNames(ownerUids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ownerUids.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await supabase
    .from('did_mappings')
    .select('owner_id, workshop_name')
    .in('owner_id', unique);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const row of data) {
    if (row.owner_id && row.workshop_name && !map[row.owner_id]) {
      map[row.owner_id] = String(row.workshop_name).trim();
    }
  }
  return map;
}

// ── Public API (call-center chats) ─────────────────────────────────────────

export type CallCenterWorkshopOwner = {
  ownerUid: string;
  name: string;
  slug: string;
  logoUrl: string;
  contactPhone: string;
  email: string;
  timezone: string;
  state: string;
  accountStatus: string;
};

function collectWorkshopOwnersArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.workshopOwners)) return o.workshopOwners;
    const data = o.data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (Array.isArray(d.workshopOwners)) return d.workshopOwners;
    }
  }
  return [];
}

function toCallCenterWorkshopOwner(raw: unknown): CallCenterWorkshopOwner {
  const r = asRecord(raw);
  return {
    ownerUid: String(r.ownerUid ?? ''),
    name: String(r.name ?? ''),
    slug: String(r.slug ?? ''),
    logoUrl: String(r.logoUrl ?? ''),
    contactPhone: String(r.contactPhone ?? ''),
    email: String(r.email ?? ''),
    timezone: String(r.timezone ?? ''),
    state: String(r.state ?? ''),
    accountStatus: String(r.accountStatus ?? ''),
  };
}

export async function fetchCallCenterWorkshopOwners(): Promise<CallCenterWorkshopOwner[]> {
  const res = await authorizedFetchCallCenter('/chats/workshop-owners');
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `fetchCallCenterWorkshopOwners failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }
  const json = (await res.json()) as unknown;
  return collectWorkshopOwnersArray(json).map(toCallCenterWorkshopOwner);
}

export type StartCallCenterChatResponse = {
  chatId: string;
  conversationId?: string;
  /** True when the backend created a brand-new chat doc (vs. reusing the deterministic 1:1 thread). */
  created: boolean;
};

function extractStartedChatCreated(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  const r = json as Record<string, unknown>;
  if (typeof r.created === 'boolean') return r.created;
  for (const wrap of ['data', 'result', 'payload'] as const) {
    const w = r[wrap];
    if (w && typeof w === 'object' && typeof (w as Record<string, unknown>).created === 'boolean') {
      return (w as Record<string, unknown>).created as boolean;
    }
  }
  return false;
}

function extractChatId(json: unknown): string {
  const seen = new Set<unknown>();

  const walk = (v: unknown, depth: number): string => {
    if (!v || depth > 6) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v !== 'object') return '';
    if (seen.has(v)) return '';
    seen.add(v);

    const r = v as Record<string, unknown>;
    for (const k of ['chatId', 'conversationId', 'id'] as const) {
      const direct = r[k];
      if (typeof direct === 'string' && direct.trim()) return direct.trim();
    }

    for (const wrap of ['chat', 'conversation', 'thread', 'data', 'result', 'payload'] as const) {
      const inner = walk(r[wrap], depth + 1);
      if (inner) return inner;
    }

    // fallback: scan a few top-level object values
    for (const value of Object.values(r)) {
      const inner = walk(value, depth + 1);
      if (inner) return inner;
    }
    return '';
  };

  return walk(json, 0);
}

export async function startCallCenterChatWithOwner(
  workshopOwnerUid: string,
  text?: string,
): Promise<StartCallCenterChatResponse> {
  const body: Record<string, unknown> = { workshopOwnerUid };
  if (text != null && text.trim()) body.text = text.trim();

  const res = await authorizedFetchCallCenter('/chats/start-with-owner', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `startCallCenterChatWithOwner failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }

  const rawText = await res.text();
  const parsed: unknown = rawText.trim() ? (JSON.parse(rawText) as unknown) : rawText;
  const chatId = extractChatId(parsed);
  const created = extractStartedChatCreated(parsed);
  return { chatId, conversationId: chatId || undefined, created };
}

export async function postCallCenterChatMessage(
  chatId: string,
  text: string,
): Promise<ChatMessage | null> {
  const res = await authorizedFetchCallCenter(
    `/chats/${encodeURIComponent(chatId)}/messages`,
    { method: 'POST', body: JSON.stringify({ text }) },
  );

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `postCallCenterChatMessage failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }

  const rawText = await res.text();
  const fallback: ChatMessage = {
    messageId: '',
    conversationId: chatId,
    chatId,
    senderId: '',
    senderRole: 'agent',
    text,
    createdAt: new Date().toISOString(),
  };

  if (!rawText.trim()) return fallback;

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const payload = parsed.message ?? parsed.data ?? parsed;
    const msg = toMessage(payload, chatId);
    return msg.senderRole?.trim() ? msg : { ...msg, senderRole: 'agent' };
  } catch {
    return fallback;
  }
}

export async function fetchCallCenterChatMessages(chatId: string): Promise<ChatMessage[]> {
  const res = await authorizedFetchCallCenter(
    `/chats/${encodeURIComponent(chatId)}/messages`,
  );
  if (res.status === 404) return [];
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `fetchCallCenterChatMessages failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }
  const json = (await res.json()) as unknown;
  const rows = collectMessagesArray(json);
  return rows.map((row) => toMessage(row, chatId));
}

export async function postCallCenterChatClose(chatId: string): Promise<void> {
  const res = await authorizedFetchCallCenter(
    `/chats/${encodeURIComponent(chatId)}/close`,
    { method: 'POST', body: '{}' },
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `postCallCenterChatClose failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }
}

function collectCcChatsArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.chats)) return o.chats;
    const data = o.data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (Array.isArray(d.chats)) return d.chats;
    }
  }
  return [];
}

/** Maps a `/api/call-center/chats` row (CcChatWithDetails) onto the support-chat `Conversation` shape so the inbox can render both kinds of threads side by side. */
function ccChatToConversation(raw: unknown): Conversation {
  const r = asRecord(raw);
  const workshop = asRecord(r.workshop);
  const workshopUser = asRecord(r.workshopUser);

  const chatId = String(r.chatId ?? r.conversationId ?? '');
  const tenantUid = String(r.tenantUserUid ?? '');
  const ownerUid = String(r.workshopOwnerUid ?? '');
  const agentUid = String(r.agentUid ?? '') || null;
  const lastSenderId = String(r.lastSenderId ?? '');
  const lastSenderRole = lastSenderId
    ? lastSenderId === tenantUid
      ? 'customer'
      : 'agent'
    : '';

  const userName =
    String(workshopUser.name ?? workshopUser.displayName ?? '').trim() ||
    String(workshop.name ?? workshop.displayName ?? '').trim() ||
    String(r.tenantName ?? '').trim() ||
    'Workshop';
  const userEmail =
    String(workshopUser.email ?? '').trim() || String(workshop.email ?? '').trim() || null;
  const userPhone =
    String(workshopUser.phone ?? '').trim() || String(workshop.phone ?? '').trim() || null;
  const role = String(workshopUser.role ?? r.tenantRole ?? '').trim();

  return {
    conversationId: chatId,
    userId: tenantUid,
    userName,
    userEmail: userEmail || null,
    userPhone: userPhone || null,
    role,
    ownerUid: ownerUid || null,
    status: String(r.sessionStatus ?? 'open'),
    agentId: agentUid,
    agentName: String(r.agentName ?? '') || null,
    agentEmail: null,
    lastMessage: String(r.lastMessageText ?? ''),
    lastMessageAt: String(r.lastMessageAt ?? r.updatedAt ?? r.createdAt ?? ''),
    lastSender: lastSenderRole,
    unreadForAgent: r.unreadForAgent === true ? 1 : 0,
    unreadForCustomer: r.unreadForTenant === true ? 1 : 0,
    createdAt: String(r.createdAt ?? ''),
    updatedAt: String(r.updatedAt ?? r.createdAt ?? ''),
    claimedAt: null,
    closedAt: r.closedAt == null ? null : String(r.closedAt),
    closedBy: r.closedByUid == null ? null : String(r.closedByUid),
  };
}

/** Returns the call-center direct chats visible to the current agent (assigned + reachable workshops). */
export async function fetchCallCenterChats(limit = 50): Promise<Conversation[]> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  const res = await authorizedFetchCallCenter(`/chats?${params.toString()}`);
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `fetchCallCenterChats failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }
  const json = (await res.json()) as unknown;
  return collectCcChatsArray(json).map(ccChatToConversation);
}

// ── Compatibility wrappers (Dashboard sidebar + older hooks) ────────────────

export async function fetchChats(options?: FetchChatsOptions): Promise<ChatItem[]> {
  const data = await fetchConversations(options);
  const qIds = new Set(data.queue.map((c) => c.conversationId));
  const ordered = [...data.mine.filter((c) => !qIds.has(c.conversationId)), ...data.queue];
  return ordered.map(conversationToChatItem);
}

export async function fetchChatMessagesPage(
  conversationId: string,
  options?: FetchChatMessagesOptions,
): Promise<FetchChatMessagesPage> {
  const params = new URLSearchParams();
  if (options?.limit != null) params.set('limit', String(options.limit));
  const before = options?.before?.trim();
  if (before) params.set('before', before);
  const qs = params.toString();
  const path = `${AGENT_PREFIX}/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ''}`;

  const res = await authorizedFetch(path);
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `fetchChatMessagesPage failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }

  const json = (await res.json()) as unknown;
  const rows = collectMessagesArray(json);
  return {
    messages: rows.map((row) => toMessage(row, conversationId)),
    nextBefore: readNextBefore(json),
  };
}

export async function fetchChatMessages(
  conversationId: string,
  options?: FetchChatMessagesOptions,
): Promise<ChatMessage[]> {
  const page = await fetchChatMessagesPage(conversationId, options);
  return page.messages;
}

export async function postChatMessage(
  conversationId: string,
  text: string,
  options?: { claimOn403?: boolean },
): Promise<ChatMessage | null> {
  void options;
  return postConversationMessage(conversationId, text);
}

export async function postChatRead(conversationId: string): Promise<void> {
  return postConversationRead(conversationId);
}

export async function postChatClaim(conversationId: string): Promise<void> {
  return postConversationClaim(conversationId);
}

export async function postChatClose(
  conversationId: string,
  opts?: { farewellMessage?: string },
): Promise<void> {
  const farewell = opts?.farewellMessage?.trim();
  const res = await authorizedFetch(
    `${AGENT_PREFIX}/${encodeURIComponent(conversationId)}/close`,
    {
      method: 'POST',
      body: JSON.stringify(farewell ? { farewellMessage: farewell } : {}),
    },
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`postChatClose failed: ${res.status}${detail ? ` - ${detail}` : ''}`);
  }
}

// ── INTERNAL AGENT CHAT (Agent-to-Agent) ──────────────────────────────────

export interface InternalChatConversation {
  id: string;
  created_at: string;
  updated_at: string;
  participant_a: string;
  participant_b: string;
  last_message: string | null;
  last_message_at: string | null;
  otherParticipant?: Agent;
  /** Populated when loading all conversations (super-admin oversight). */
  agentA?: Agent;
  agentB?: Agent;
  unreadCount?: number;
}

/** Command-centre agent (not linked to a BMS workshop owner). */
export function isCommandCentreAgent(agent: Pick<Agent, "bmsOwnerUid">): boolean {
  return !String(agent.bmsOwnerUid ?? "").trim();
}

/** Resolve the agent row a super-admin uses to send internal messages. */
export function resolveSuperAdminMessagingAgentId(
  agents: Agent[],
  sessionUserId: string | undefined,
): string | null {
  const linked = agents.find(
    (a) =>
      isCommandCentreAgent(a) &&
      a.userId &&
      sessionUserId &&
      a.userId === sessionUserId,
  );
  if (linked) return linked.id;

  const fromEnv = import.meta.env.VITE_SUPER_ADMIN_AGENT_ID?.trim();
  if (fromEnv && agents.some((a) => a.id === fromEnv)) return fromEnv;

  return null;
}

export interface InternalChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
}

function pickInternalString(
  row: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function toInternalAgent(raw: unknown, fallbackId = ''): Agent {
  const r = asRecord(raw);
  const id = pickInternalString(r, ['id', 'agentId', 'userId']) || fallbackId;
  const name = pickInternalString(r, ['name', 'agentName', 'displayName']) || 'Unknown';
  return {
    id,
    userId: pickInternalString(r, ['userId', 'user_id']) || null,
    tenantId: pickInternalString(r, ['tenantId', 'tenant_id']),
    queueIds: Array.isArray(r.queueIds) ? r.queueIds.map(String) : [],
    name,
    extension: pickInternalString(r, ['extension']),
    email: pickInternalString(r, ['email']) || undefined,
    phone: pickInternalString(r, ['phone', 'phoneNumber', 'phone_number']) || undefined,
    bmsOwnerUid: pickInternalString(r, ['bmsOwnerUid', 'bms_owner_uid', 'ownerUid']) || null,
    bmsBranchId: pickInternalString(r, ['bmsBranchId', 'bms_branch_id', 'branchId']) || null,
    role: 'agent',
    status:
      r.status === 'ringing' ||
      r.status === 'on-call' ||
      r.status === 'available' ||
      r.status === 'wrap-up' ||
      r.status === 'break' ||
      r.status === 'offline'
        ? r.status
        : 'offline',
    currentCaller: null,
    callStartTime: null,
    allowedQueueIds: [],
    assignedTenantIds: [],
    groupIds: [],
  };
}

function toInternalConversation(
  raw: unknown,
  currentAgentId?: string | null,
): InternalChatConversation {
  const r = asRecord(raw);
  const agentARecord = r.agent_a ?? r.agentA ?? r.participantA;
  const agentBRecord = r.agent_b ?? r.agentB ?? r.participantB;
  const otherRecord = r.otherParticipant ?? r.peerAgent ?? r.otherAgent ?? r.agent;
  const peerAgentId =
    pickInternalString(r, ['peerAgentId', 'peer_agent_id', 'otherAgentId', 'other_agent_id']) ||
    pickInternalString(asRecord(otherRecord), ['id', 'agentId']);
  const participantA =
    pickInternalString(r, [
      'participant_a',
      'participantA',
      'participantAId',
      'agentAId',
      'agent_a_id',
    ]) ||
    currentAgentId ||
    '';
  const participantB =
    pickInternalString(r, [
      'participant_b',
      'participantB',
      'participantBId',
      'agentBId',
      'agent_b_id',
    ]) ||
    peerAgentId;
  const id = pickInternalString(r, ['id', 'conversationId', 'conversation_id']);
  const agentA = agentARecord ? toInternalAgent(agentARecord, participantA) : undefined;
  const agentB = agentBRecord ? toInternalAgent(agentBRecord, participantB) : undefined;
  const flatOtherName = pickInternalString(r, [
    'peerAgentName',
    'peer_agent_name',
    'otherAgentName',
    'other_agent_name',
  ]);
  const otherParticipant = otherRecord
    ? toInternalAgent(otherRecord, peerAgentId || participantB)
    : flatOtherName
      ? toInternalAgent({ id: peerAgentId || participantB, name: flatOtherName }, peerAgentId || participantB)
    : currentAgentId && participantA === currentAgentId && agentB
      ? agentB
      : currentAgentId && participantB === currentAgentId && agentA
        ? agentA
        : undefined;

  return {
    id,
    created_at: pickInternalString(r, ['created_at', 'createdAt']),
    updated_at: pickInternalString(r, ['updated_at', 'updatedAt']),
    participant_a: participantA,
    participant_b: participantB,
    last_message:
      pickInternalString(r, ['last_message', 'lastMessage', 'lastMessageText']) || null,
    last_message_at:
      pickInternalString(r, ['last_message_at', 'lastMessageAt']) || null,
    otherParticipant,
    agentA,
    agentB,
    unreadCount: Number(r.unreadCount ?? r.unread_count ?? 0),
  };
}

function toInternalMessage(raw: unknown, conversationId: string): InternalChatMessage {
  const r = asRecord(raw);
  return {
    id: pickInternalString(r, ['id', 'messageId', 'message_id']),
    conversation_id:
      pickInternalString(r, ['conversation_id', 'conversationId']) || conversationId,
    sender_id: pickInternalString(r, ['sender_id', 'senderId', 'agentId', 'userId']),
    content: pickInternalString(r, ['content', 'text', 'message', 'body']),
    created_at:
      pickInternalString(r, ['created_at', 'createdAt', 'sentAt']) ||
      new Date().toISOString(),
    is_read: Boolean(r.is_read ?? r.isRead ?? r.read),
  };
}

function collectInternalArray(raw: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  const body = asRecord(raw);
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }
  if (Array.isArray(body.data)) return body.data;
  const data = asRecord(body.data);
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function uniqueAgents(agents: Agent[]): Agent[] {
  const byId = new Map<string, Agent>();
  for (const agent of agents) {
    if (!agent.id) continue;
    const existing = byId.get(agent.id);
    byId.set(agent.id, {
      ...agent,
      ...(existing ?? {}),
      name: agent.name && agent.name !== 'Unknown' ? agent.name : (existing?.name ?? agent.name),
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function extractInternalConversationId(raw: unknown): string {
  const body = asRecord(raw);
  const direct = pickInternalString(body, ['id', 'conversationId', 'conversation_id']);
  if (direct) return direct;
  for (const key of ['conversation', 'data', 'result'] as const) {
    const nested = pickInternalString(asRecord(body[key]), [
      'id',
      'conversationId',
      'conversation_id',
    ]);
    if (nested) return nested;
  }
  return '';
}

function extractInternalMessage(raw: unknown, conversationId: string): InternalChatMessage | null {
  const body = asRecord(raw);
  const candidates = [
    body,
    asRecord(body.message),
    asRecord(body.data),
    asRecord(body.result),
  ];

  for (const candidate of candidates) {
    const message = toInternalMessage(candidate, conversationId);
    if (message.id && message.content) return message;
  }

  return null;
}

type InternalChatSupabaseResult = {
  error: { message?: string } | null;
};

type InternalChatSupabaseQuery = PromiseLike<InternalChatSupabaseResult> & {
  update(values: unknown): InternalChatSupabaseQuery;
  eq(column: string, value: unknown): InternalChatSupabaseQuery;
  neq(column: string, value: unknown): InternalChatSupabaseQuery;
};

function internalMessagesTable(): InternalChatSupabaseQuery {
  return (supabase as unknown as { from(table: string): InternalChatSupabaseQuery }).from(
    'agent_messages',
  );
}

async function readAgentChatJson(res: Response): Promise<unknown> {
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as unknown) : null;
}

async function fetchInternalChatAgentsFromSupabase(): Promise<Agent[]> {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .order('name');
  if (error) throw new Error(error.message);
  return uniqueAgents((data ?? []).map((row) => toInternalAgent(row)));
}

export async function fetchInternalChatAgents(
  options: { preferAgentsApi?: boolean } = {},
): Promise<Agent[]> {
  if (options.preferAgentsApi) {
    try {
      const apiAgents = await fetchAgentsList();
      if (apiAgents.length > 0) {
        return uniqueAgents(apiAgents.filter(isCommandCentreAgent));
      }
    } catch (error) {
      console.warn('[chatApi] Agents API roster unavailable, falling back to Supabase:', error);
    }
  }

  return fetchInternalChatAgentsFromSupabase();
}

export async function fetchInternalConversations(
  currentAgentId?: string | null,
): Promise<InternalChatConversation[]> {
  const res = await authorizedFetchAgentChat('/conversations');
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `fetchInternalConversations failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }
  const rows = collectInternalArray(await res.json(), [
    'conversations',
    'items',
    'results',
    'rows',
  ]);
  return rows.map((row) => toInternalConversation(row, currentAgentId));
}

/**
 * Fetch all conversations for Super Admin
 */
export async function fetchAllInternalConversations(): Promise<InternalChatConversation[]> {
  const res = await authorizedFetchAgentChat('/conversations');
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `fetchAllInternalConversations failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }
  const rows = collectInternalArray(await res.json(), [
    'conversations',
    'items',
    'results',
    'rows',
  ]);
  return rows.map((row) => toInternalConversation(row));
}

export async function fetchInternalMessages(conversationId: string): Promise<InternalChatMessage[]> {
  const res = await authorizedFetchAgentChat(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `fetchInternalMessages failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }
  const rows = collectInternalArray(await res.json(), [
    'messages',
    'items',
    'results',
    'rows',
  ]);
  return rows.map((row) => toInternalMessage(row, conversationId));
}

export async function fetchInternalUnreadCount(agentId: string): Promise<number> {
  const conversations = await fetchInternalConversations(agentId).catch(
    (): InternalChatConversation[] => [],
  );
  return conversations.reduce<number>((sum, c) => sum + (c.unreadCount ?? 0), 0);
}

/**
 * Fetch a global count of all unread internal messages for Super Admin oversight.
 */
export async function fetchGlobalInternalUnreadCount(): Promise<number> {
  const conversations = await fetchAllInternalConversations().catch(
    (): InternalChatConversation[] => [],
  );
  return conversations.reduce<number>((sum, c) => sum + (c.unreadCount ?? 0), 0);
}

export async function markInternalMessagesAsRead(conversationId: string, readerId: string): Promise<void> {
  const { error } = await internalMessagesTable()
    .update({ is_read: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', readerId)
    .eq('is_read', false);

  if (error) {
    console.warn('[chatApi] markInternalMessagesAsRead failed:', error.message);
  }
}

/** Mark every unread message in a conversation read (e.g. super-admin oversight with no agent row). */
export async function markInternalConversationAllRead(conversationId: string): Promise<void> {
  const { error } = await internalMessagesTable()
    .update({ is_read: true })
    .eq('conversation_id', conversationId)
    .eq('is_read', false);

  if (error) {
    console.warn('[chatApi] markInternalConversationAllRead failed:', error.message);
  }
}

export async function sendInternalMessage(
  conversationId: string,
  senderId: string | null | undefined,
  content: string,
): Promise<InternalChatMessage | null> {
  void senderId;
  const res = await authorizedFetchAgentChat(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ content }),
    },
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`sendInternalMessage failed: ${res.status}${detail ? ` - ${detail}` : ''}`);
  }
  return extractInternalMessage(await readAgentChatJson(res), conversationId);
}

export async function getOrCreateInternalConversation(
  agentIdA: string | null | undefined,
  agentIdB: string,
): Promise<string> {
  void agentIdA;
  const res = await authorizedFetchAgentChat('/conversations', {
    method: 'POST',
    body: JSON.stringify({ peerAgentId: agentIdB }),
  });
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `getOrCreateInternalConversation failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }
  const id = extractInternalConversationId(await readAgentChatJson(res));
  if (!id) throw new Error('Conversation API did not return a conversation id.');
  return id;
}

export function subscribeToInternalMessages(conversationId: string, onMessage: (message: InternalChatMessage) => void) {
  const channel = supabase
    .channel(`chat:internal:${conversationId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'agent_messages',
      filter: `conversation_id=eq.${conversationId}`
    }, payload => {
      onMessage(payload.new as InternalChatMessage);
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToAllInternalConversations(onUpdate: () => void) {
  const channel = supabase
    .channel('agent_conversations_all_internal')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'agent_conversations'
    }, () => {
      onUpdate();
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
