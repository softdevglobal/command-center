import { getFirebaseOnlyBmsBearerToken } from '@/services/bmsAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Agent } from '@/services/types';

const BASE_URL =
  (import.meta.env.VITE_BMS_SUPPORT_CHAT_API_URL as string) ??
  'https://black.bmspros.com.au/api/support-chat';

const AGENT_PREFIX = '/agent/conversations';

const CALL_CENTER_BASE_URL =
  (import.meta.env.VITE_CALL_CENTER_API_URL as string) ?? 'https://black.bmspros.com.au';

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
  const token = await getFirebaseOnlyBmsBearerToken();
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Authorization', `Bearer ${token}`);
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  return fetch(url, { ...init, headers });
}

async function authorizedFetchCallCenter(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getFirebaseOnlyBmsBearerToken();
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Authorization', `Bearer ${token}`);
  const url = `${CALL_CENTER_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(url, { ...init, headers });
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
    senderId: String(r.senderId ?? r.userId ?? ''),
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
    text,
    createdAt: new Date().toISOString(),
  };

  if (!rawText.trim()) return fallback;

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const payload = parsed.message ?? parsed.data ?? parsed;
    return toMessage(payload, conversationId);
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
  const res = await authorizedFetchCallCenter('/api/call-center/chats/workshop-owners');
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
};

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
  options?: { branchId?: string | null; branchName?: string | null },
): Promise<StartCallCenterChatResponse> {
  const body: Record<string, unknown> = { workshopOwnerUid };
  if (text != null && text.trim()) body.text = text.trim();
  const branchId = options?.branchId?.trim();
  const branchName = options?.branchName?.trim();
  if (branchId) body.branchId = branchId;
  if (branchName) body.branchName = branchName;

  const res = await authorizedFetchCallCenter('/api/call-center/chats/start-with-owner', {
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
  return { chatId, conversationId: chatId || undefined };
}

export async function postCallCenterChatMessage(
  chatId: string,
  text: string,
): Promise<ChatMessage | null> {
  const res = await authorizedFetchCallCenter(
    `/api/call-center/chats/${encodeURIComponent(chatId)}/messages`,
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
    text,
    createdAt: new Date().toISOString(),
  };

  if (!rawText.trim()) return fallback;

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const payload = parsed.message ?? parsed.data ?? parsed;
    return toMessage(payload, chatId);
  } catch {
    return fallback;
  }
}

export async function fetchCallCenterChatMessages(chatId: string): Promise<ChatMessage[]> {
  const res = await authorizedFetchCallCenter(
    `/api/call-center/chats/${encodeURIComponent(chatId)}/messages`,
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
    `/api/call-center/chats/${encodeURIComponent(chatId)}/close`,
    { method: 'POST', body: '{}' },
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `postCallCenterChatClose failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }
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

export async function fetchInternalConversations(currentAgentId: string): Promise<InternalChatConversation[]> {
  const { data, error } = await ((supabase as any)
    .from('agent_conversations'))
    .select(`
      *,
      agent_a:participant_a(id, name, extension, status),
      agent_b:participant_b(id, name, extension, status)
    `)
    .or(`participant_a.eq.${currentAgentId},participant_b.eq.${currentAgentId}`)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Fetch unread counts for these conversations
  const { data: unreadData, error: unreadError } = await ((supabase as any)
    .from('agent_messages'))
    .select('conversation_id')
    .eq('is_read', false)
    .neq('sender_id', currentAgentId)
    .in('conversation_id', data.map(c => c.id));

  const unreadMap = (unreadData || []).reduce((acc: any, msg: any) => {
    acc[msg.conversation_id] = (acc[msg.conversation_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return data.map(conv => {
    const isParticipantA = conv.participant_a === currentAgentId;
    const otherAgent = isParticipantA ? conv.agent_b : conv.agent_a;
    
    return {
      ...conv,
      otherParticipant: otherAgent as unknown as Agent,
      unreadCount: unreadMap[conv.id] || 0
    };
  });
}

/**
 * Fetch all conversations for Super Admin
 */
export async function fetchAllInternalConversations(): Promise<InternalChatConversation[]> {
  const { data, error } = await ((supabase as any)
    .from('agent_conversations'))
    .select(`
      *,
      agent_a:participant_a(id, name, extension, status),
      agent_b:participant_b(id, name, extension, status)
    `)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Fetch all unread messages for these conversations
  const { data: unreadData, error: unreadError } = await ((supabase as any)
    .from('agent_messages'))
    .select('conversation_id')
    .eq('is_read', false)
    .in('conversation_id', data.map(c => c.id));

  const unreadMap = (unreadData || []).reduce((acc: any, msg: any) => {
    acc[msg.conversation_id] = (acc[msg.conversation_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return data.map(conv => ({
    ...conv,
    agentA: conv.agent_a as unknown as Agent,
    agentB: conv.agent_b as unknown as Agent,
    unreadCount: unreadMap[conv.id] || 0
  }));
}

export async function fetchInternalMessages(conversationId: string): Promise<InternalChatMessage[]> {
  const { data, error } = await ((supabase as any)
    .from('agent_messages'))
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as InternalChatMessage[];
}

export async function fetchInternalUnreadCount(agentId: string): Promise<number> {
  // First get conversation IDs
  const { data: convs, error: convError } = await ((supabase as any)
    .from('agent_conversations'))
    .select('id')
    .or(`participant_a.eq.${agentId},participant_b.eq.${agentId}`);

  if (convError || !convs || convs.length === 0) return 0;
  const ids = (convs as any[]).map((c: any) => c.id);

  const { count, error } = await ((supabase as any)
    .from('agent_messages'))
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false)
    .neq('sender_id', agentId)
    .in('conversation_id', ids);

  if (error) return 0;
  return count || 0;
}

/**
 * Fetch a global count of all unread internal messages for Super Admin oversight.
 */
export async function fetchGlobalInternalUnreadCount(): Promise<number> {
  const { count, error } = await ((supabase as any)
    .from('agent_messages'))
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);

  if (error) return 0;
  return count || 0;
}

export async function markInternalMessagesAsRead(conversationId: string, readerId: string): Promise<void> {
  const { error } = await ((supabase as any)
    .from('agent_messages'))
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
  const { error } = await ((supabase as any)
    .from('agent_messages'))
    .update({ is_read: true })
    .eq('conversation_id', conversationId)
    .eq('is_read', false);

  if (error) {
    console.warn('[chatApi] markInternalConversationAllRead failed:', error.message);
  }
}

export async function sendInternalMessage(conversationId: string, senderId: string, content: string): Promise<void> {
  const { error } = await ((supabase as any)
    .from('agent_messages'))
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content
    });

  if (error) throw error;
}

export async function getOrCreateInternalConversation(agentIdA: string, agentIdB: string): Promise<string> {
  // Ensure consistent order for unique constraint
  const [p1, p2] = agentIdA < agentIdB ? [agentIdA, agentIdB] : [agentIdB, agentIdA];

  // Try to find existing
  const { data: existing, error: fetchError } = await ((supabase as any)
    .from('agent_conversations'))
    .select('id')
    .eq('participant_a', p1)
    .eq('participant_b', p2)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) return (existing as any).id;

  // Create new
  const { data: created, error: createError } = await ((supabase as any)
    .from('agent_conversations'))
    .insert({
      participant_a: p1,
      participant_b: p2
    })
    .select('id')
    .single();

  if (createError) throw createError;
  return created.id;
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
