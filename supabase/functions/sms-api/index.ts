declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// @ts-expect-error Supabase Edge Functions resolve this remote ESM import at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { syncInboundFromTextBee } from "../_shared/textbeeInbound.ts";

import { baseCorsHeaders, serveWithCors } from "../_shared/cors.ts";

const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const corsHeaders = baseCorsHeaders(ALLOWED_METHODS);

const SMS_CHANNEL = "sms-center";
const ALLOWED_ROLES = new Set(["super-admin", "supervisor", "agent"]);

type SmsAction =
  | "list"
  | "messages"
  | "claim"
  | "resolve"
  | "send"
  | "start"
  | "deleteThread"
  | "syncInbound";

type AuthContext = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  agentId: string;
  agentName: string;
};

type SmsThreadRow = {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  current_queue_id: string;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  status: "QUEUED" | "ACTIVE" | "RESOLVED";
  unread_for_agent: number;
  last_message_body: string;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  queue?: { id: string; queue_name: string } | null;
};

type SmsMessageRow = {
  id: string;
  thread_id: string;
  direction: "INBOUND" | "OUTBOUND";
  message_body: string;
  sender_agent_id: string | null;
  sender_agent_name: string | null;
  textbee_message_id: string | null;
  textbee_status: string | null;
  created_at: string;
};

type SmsContactRow = {
  id: string;
  contact_type: "customer" | "owner";
  display_name: string;
  phone: string;
  owner_uid: string | null;
  created_by: string | null;
  created_at: string;
};

type ParsedRoute =
  | { kind: "inbox" }
  | { kind: "inbound_sync" }
  | { kind: "threads_start" }
  | { kind: "thread"; threadId: string; sub?: "messages" | "claim" | "resolve" }
  | { kind: "contacts" }
  | { kind: "contact"; contactId: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function normalizePhone(value: string): string {
  return value.replace(/[\s().-]/g, "").trim();
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function phoneTailDigits(value: string): string {
  const digits = phoneDigits(value);
  if (!digits) return "";
  if (digits.startsWith("61") && digits.length >= 11) return digits.slice(-9);
  if (digits.startsWith("0") && digits.length >= 10) return digits.slice(-9);
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function phonesEquivalent(a: string, b: string): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (normalizePhone(a) === normalizePhone(b)) return true;
  const tailA = phoneTailDigits(a);
  const tailB = phoneTailDigits(b);
  return Boolean(tailA && tailB && tailA.length >= 8 && tailA === tailB);
}

async function syncThreadNamesFromContact(
  supabaseAdmin: ReturnType<typeof createClient>,
  phone: string,
  displayName: string,
): Promise<void> {
  const { data: threads, error } = await supabaseAdmin
    .from("sms_threads")
    .select("id, customer_phone, customer_name");
  if (error) throw error;

  const updates = (threads ?? []).filter(
    (thread) => !thread.customer_name?.trim() && phonesEquivalent(String(thread.customer_phone), phone),
  );
  if (!updates.length) return;

  await Promise.all(
    updates.map((thread) =>
      supabaseAdmin
        .from("sms_threads")
        .update({ customer_name: displayName })
        .eq("id", thread.id),
    ),
  );
}

function serializeContact(row: SmsContactRow) {
  return {
    id: row.id,
    contactType: row.contact_type,
    displayName: row.display_name,
    phone: row.phone,
    ownerUid: row.owner_uid,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function parseSmsPath(pathname: string): ParsedRoute | null {
  let path = pathname;
  for (const marker of ["/sms-api", "/api/sms", "/sms"]) {
    const idx = path.indexOf(marker);
    if (idx >= 0) {
      path = path.slice(idx + marker.length);
      break;
    }
  }
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0] === "inbox" && parts.length === 1) return { kind: "inbox" };
  if (parts[0] === "inbound" && parts[1] === "sync" && parts.length === 2) {
    return { kind: "inbound_sync" };
  }
  if (parts[0] === "contacts" && parts.length === 1) return { kind: "contacts" };
  if (parts[0] === "contacts" && parts.length === 2) {
    return { kind: "contact", contactId: parts[1] };
  }
  if (parts[0] === "threads" && parts.length === 2 && parts[1] === "start") {
    return { kind: "threads_start" };
  }
  if (parts[0] === "threads" && parts.length >= 2) {
    const threadId = parts[1];
    const sub = parts[2] as "messages" | "claim" | "resolve" | undefined;
    if (parts.length === 2) return { kind: "thread", threadId };
    if (sub === "messages" || sub === "claim" || sub === "resolve") {
      return { kind: "thread", threadId, sub };
    }
  }
  return null;
}

function sanitizeSearchTerm(value: string): string {
  return value.replace(/[%_\\]/g, "").trim().slice(0, 80);
}

function parseContactType(value: string | null): "customer" | "owner" | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "customer" || v === "owner") return v;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function userDisplayName(user: { email?: string; user_metadata?: Record<string, unknown> }): string {
  const meta = asRecord(user.user_metadata);
  const displayName = meta.display_name ?? meta.full_name ?? meta.name;
  if (typeof displayName === "string" && displayName.trim()) return displayName.trim();
  return user.email || "Command Center agent";
}

async function getAuthContext(
  req: Request,
  supabaseAdmin: ReturnType<typeof createClient>,
  supabaseUrl: string,
): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401 });

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error,
  } = await callerClient.auth.getUser();
  if (error || !user) {
    throw new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 });
  }

  const { data: roleData } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  const role = String(roleData?.role ?? "");
  if (!ALLOWED_ROLES.has(role)) {
    throw new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403 });
  }

  const { data: agentRow } = await supabaseAdmin
    .from("agents")
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle();
  const displayName = userDisplayName({
    email: user.email,
    user_metadata: asRecord(user.user_metadata),
  });

  return {
    userId: user.id,
    email: user.email ?? "",
    displayName,
    role,
    agentId: String(agentRow?.id ?? user.id),
    agentName: String(agentRow?.name ?? displayName),
  };
}

function agentIds(auth: AuthContext): string[] {
  return [...new Set([auth.agentId, auth.userId].filter(Boolean))];
}

function canSeeThread(auth: AuthContext, thread: SmsThreadRow): boolean {
  if (auth.role === "super-admin" || auth.role === "supervisor") return true;
  if (thread.status === "QUEUED") return true;
  return thread.assigned_agent_id ? agentIds(auth).includes(thread.assigned_agent_id) : false;
}

function canActOnThread(auth: AuthContext, thread: SmsThreadRow): boolean {
  if (auth.role === "super-admin" || auth.role === "supervisor") return true;
  return thread.assigned_agent_id ? agentIds(auth).includes(thread.assigned_agent_id) : false;
}

async function broadcastSmsUpdate(
  supabaseAdmin: ReturnType<typeof createClient>,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await supabaseAdmin.channel(SMS_CHANNEL).send({
    type: "broadcast",
    event: "SMS_UPDATED",
    payload: { type, ...payload },
  });
}

async function listSms(supabaseAdmin: ReturnType<typeof createClient>, auth: AuthContext) {
  const [{ data: queues, error: queuesError }, { data: threads, error: threadsError }] =
    await Promise.all([
      supabaseAdmin.from("sms_queues").select("id, queue_name, sort_order").order("sort_order"),
      supabaseAdmin
        .from("sms_threads")
        .select("*, queue:sms_queues(id, queue_name)")
        .neq("status", "RESOLVED")
        .order("last_message_at", { ascending: false }),
    ]);

  if (queuesError) throw queuesError;
  if (threadsError) throw threadsError;

  const visibleThreads = ((threads ?? []) as SmsThreadRow[]).filter((thread) =>
    canSeeThread(auth, thread),
  );

  const { data: contactRows, error: contactsError } = await supabaseAdmin
    .from("sms_contacts")
    .select("display_name, phone")
    .eq("contact_type", "customer");
  if (contactsError) throw contactsError;

  const enrichedThreads = visibleThreads.map((thread) => {
    if (thread.customer_name?.trim()) return thread;
    const match = (contactRows ?? []).find((contact) =>
      phonesEquivalent(String(contact.phone), String(thread.customer_phone)),
    );
    if (!match?.display_name?.trim()) return thread;
    return { ...thread, customer_name: match.display_name.trim() };
  });

  return {
    queues: queues ?? [],
    threads: enrichedThreads,
    unreadCount: enrichedThreads.reduce((sum, thread) => sum + Number(thread.unread_for_agent ?? 0), 0),
  };
}

async function loadMessages(
  supabaseAdmin: ReturnType<typeof createClient>,
  auth: AuthContext,
  body: Record<string, unknown>,
) {
  const threadId = requireString(body.threadId, "threadId");
  const thread = await getThread(supabaseAdmin, threadId);
  if (!canSeeThread(auth, thread)) {
    return json({ error: "Thread not found" }, 404);
  }

  const { data, error } = await supabaseAdmin
    .from("sms_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return { messages: (data ?? []) as SmsMessageRow[] };
}

async function getThread(
  supabaseAdmin: ReturnType<typeof createClient>,
  threadId: string,
): Promise<SmsThreadRow> {
  const { data, error } = await supabaseAdmin
    .from("sms_threads")
    .select("*, queue:sms_queues(id, queue_name)")
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("Thread not found");
  return data as SmsThreadRow;
}

function canonicalSmsPhone(value: string): string {
  const digits = phoneDigits(value);
  if (!digits) return normalizePhone(value);
  if (digits.startsWith("61") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+61${digits.slice(1)}`;
  if (digits.length === 9) return `+61${digits}`;
  return value.trim().startsWith("+") ? normalizePhone(value) : `+${digits}`;
}

async function getThreadByPhone(
  supabaseAdmin: ReturnType<typeof createClient>,
  phone: string,
): Promise<SmsThreadRow | null> {
  const canonical = canonicalSmsPhone(phone);
  for (const candidate of [canonical, normalizePhone(phone), phone.trim()]) {
    if (!candidate) continue;
    const { data, error } = await supabaseAdmin
      .from("sms_threads")
      .select("*, queue:sms_queues(id, queue_name)")
      .eq("customer_phone", candidate)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data as SmsThreadRow;
  }

  const { data: rows, error: listError } = await supabaseAdmin
    .from("sms_threads")
    .select("*, queue:sms_queues(id, queue_name)")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (listError) throw listError;
  const match = (rows ?? []).find((row) =>
    phonesEquivalent(String(row.customer_phone), phone),
  );
  return match ? (match as SmsThreadRow) : null;
}

async function resolveQueueId(
  supabaseAdmin: ReturnType<typeof createClient>,
  queueIdRaw: unknown,
): Promise<string> {
  const queueId = typeof queueIdRaw === "string" ? queueIdRaw.trim() : "";
  if (queueId) {
    const { data, error } = await supabaseAdmin
      .from("sms_queues")
      .select("id")
      .eq("id", queueId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return String(data.id);
  }

  const { data: salesQueue, error: salesError } = await supabaseAdmin
    .from("sms_queues")
    .select("id")
    .eq("queue_name", "Sales")
    .maybeSingle();
  if (salesError) throw salesError;
  if (salesQueue?.id) return String(salesQueue.id);

  const { data: firstQueue, error: firstError } = await supabaseAdmin
    .from("sms_queues")
    .select("id")
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  if (firstError) throw firstError;
  if (!firstQueue?.id) throw new Error("No SMS queues are configured");
  return String(firstQueue.id);
}

async function claimThread(
  supabaseAdmin: ReturnType<typeof createClient>,
  auth: AuthContext,
  body: Record<string, unknown>,
) {
  const threadId = requireString(body.threadId, "threadId");
  const thread = await getThread(supabaseAdmin, threadId);
  if (!canSeeThread(auth, thread)) {
    return json({ error: "Thread not found" }, 404);
  }
  if (
    thread.assigned_agent_id &&
    !agentIds(auth).includes(thread.assigned_agent_id) &&
    auth.role !== "super-admin"
  ) {
    return json({ error: "Conversation is already assigned" }, 409);
  }

  const { data, error } = await supabaseAdmin
    .from("sms_threads")
    .update({
      assigned_agent_id: auth.agentId,
      assigned_agent_name: auth.agentName,
      status: "ACTIVE",
      unread_for_agent: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId)
    .select("*, queue:sms_queues(id, queue_name)")
    .single();
  if (error) throw error;

  await broadcastSmsUpdate(supabaseAdmin, "CLAIMED", { threadId, thread: data });
  return { thread: data };
}

async function resolveThread(
  supabaseAdmin: ReturnType<typeof createClient>,
  auth: AuthContext,
  body: Record<string, unknown>,
) {
  const threadId = requireString(body.threadId, "threadId");
  const thread = await getThread(supabaseAdmin, threadId);
  if (!canActOnThread(auth, thread)) {
    return json({ error: "Cannot resolve this conversation" }, 403);
  }

  const { data, error } = await supabaseAdmin
    .from("sms_threads")
    .update({
      status: "RESOLVED",
      unread_for_agent: 0,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId)
    .select("*, queue:sms_queues(id, queue_name)")
    .single();
  if (error) throw error;

  await broadcastSmsUpdate(supabaseAdmin, "RESOLVED", { threadId, thread: data });
  return { thread: data };
}

async function reserveDispatchSlot(supabaseAdmin: ReturnType<typeof createClient>): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("reserve_sms_dispatch_slot");
  if (error) throw error;
  const reservedAt = typeof data === "string" ? Date.parse(data) : Date.now();
  const waitMs = Math.max(0, reservedAt - Date.now());
  if (waitMs > 0) await sleep(waitMs);
}

async function sendViaTextBee(phone: string, message: string): Promise<unknown> {
  const apiKey = Deno.env.get("TEXTBEE_API_KEY")?.trim();
  const deviceId = Deno.env.get("TEXTBEE_DEVICE_ID")?.trim();
  if (!apiKey || !deviceId) {
    throw new Error("Missing TEXTBEE_API_KEY or TEXTBEE_DEVICE_ID");
  }

  const simRaw = Deno.env.get("TEXTBEE_SIM_SUBSCRIPTION_ID")?.trim();
  const payload: Record<string, unknown> = {
    recipients: [phone],
    message,
  };
  if (simRaw && Number.isFinite(Number(simRaw))) {
    payload.simSubscriptionId = Number(simRaw);
  }

  const response = await fetch(
    `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(deviceId)}/send-sms`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    },
  );
  const text = await response.text();
  const parsed = text.trim() ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = asRecord(parsed);
    throw new Error(String(detail.error ?? detail.message ?? `TextBee HTTP ${response.status}`));
  }
  return parsed;
}

function extractTextBeeMessageId(response: unknown): string | null {
  const root = asRecord(response);
  const data = asRecord(root.data);
  const value =
    data.smsBatchId ??
    data.smsId ??
    data.id ??
    root.smsBatchId ??
    root.smsId ??
    root.id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function sendMessage(
  supabaseAdmin: ReturnType<typeof createClient>,
  auth: AuthContext,
  body: Record<string, unknown>,
) {
  const threadId = requireString(body.threadId, "threadId");
  const messageBody = requireString(body.messageBody ?? body.message, "messageBody");
  const thread = await getThread(supabaseAdmin, threadId);
  if (!canActOnThread(auth, thread) || !thread.assigned_agent_id) {
    return json({ error: "Claim this conversation before replying" }, 409);
  }

  const normalizedPhone = normalizePhone(thread.customer_phone);
  const now = new Date().toISOString();
  const { data: message, error: insertError } = await supabaseAdmin
    .from("sms_messages")
    .insert({
      thread_id: threadId,
      direction: "OUTBOUND",
      message_body: messageBody,
      sender_agent_id: auth.agentId,
      sender_agent_name: auth.agentName,
      textbee_status: "QUEUED",
      created_at: now,
    })
    .select("*")
    .single();
  if (insertError) throw insertError;

  try {
    await reserveDispatchSlot(supabaseAdmin);
    const textbeeResponse = await sendViaTextBee(normalizedPhone, messageBody);
    const textbeeMessageId = extractTextBeeMessageId(textbeeResponse);

    const { data: updatedMessage, error: messageUpdateError } = await supabaseAdmin
      .from("sms_messages")
      .update({
        textbee_message_id: textbeeMessageId,
        textbee_status: "SENT",
      })
      .eq("id", message.id)
      .select("*")
      .single();
    if (messageUpdateError) throw messageUpdateError;

    const { data: updatedThread, error: threadUpdateError } = await supabaseAdmin
      .from("sms_threads")
      .update({
        status: "ACTIVE",
        last_message_body: messageBody,
        last_message_at: now,
        unread_for_agent: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", threadId)
      .select("*, queue:sms_queues(id, queue_name)")
      .single();
    if (threadUpdateError) throw threadUpdateError;

    await broadcastSmsUpdate(supabaseAdmin, "OUTBOUND", {
      threadId,
      thread: updatedThread,
      message: updatedMessage,
    });

    return { thread: updatedThread, message: updatedMessage, textbee: textbeeResponse };
  } catch (error) {
    await supabaseAdmin
      .from("sms_messages")
      .update({ textbee_status: "FAILED" })
      .eq("id", message.id);
    throw error;
  }
}

async function deleteThread(
  supabaseAdmin: ReturnType<typeof createClient>,
  auth: AuthContext,
  body: Record<string, unknown>,
) {
  const threadId = requireString(body.threadId, "threadId");
  const thread = await getThread(supabaseAdmin, threadId);
  if (!canSeeThread(auth, thread)) {
    return json({ error: "Thread not found" }, 404);
  }
  if (!canActOnThread(auth, thread) && auth.role !== "super-admin" && auth.role !== "supervisor") {
    return json({ error: "Cannot delete this conversation" }, 403);
  }

  const { error } = await supabaseAdmin.from("sms_threads").delete().eq("id", threadId);
  if (error) throw error;

  await broadcastSmsUpdate(supabaseAdmin, "DELETED", { threadId });
  return { ok: true };
}

async function startThread(
  supabaseAdmin: ReturnType<typeof createClient>,
  auth: AuthContext,
  body: Record<string, unknown>,
) {
  const phone = canonicalSmsPhone(requireString(body.customerPhone ?? body.phone, "customerPhone"));
  const messageBody = requireString(body.messageBody ?? body.message, "messageBody");
  const customerNameRaw = body.customerName ?? body.customer_name;
  const customerName =
    typeof customerNameRaw === "string" && customerNameRaw.trim() ? customerNameRaw.trim() : null;
  if (phone.replace(/\D/g, "").length < 6) {
    return json({ error: "Enter a valid customer phone number" }, 400);
  }

  const queueId = await resolveQueueId(supabaseAdmin, body.queueId);
  const existing = await getThreadByPhone(supabaseAdmin, phone);
  if (
    existing?.assigned_agent_id &&
    !agentIds(auth).includes(existing.assigned_agent_id) &&
    auth.role !== "super-admin" &&
    auth.role !== "supervisor"
  ) {
    return json({ error: "An active SMS conversation already exists for this phone number" }, 409);
  }

  const now = new Date().toISOString();
  let threadId = existing?.id ?? "";

  if (existing?.id) {
    const { data, error } = await supabaseAdmin
      .from("sms_threads")
      .update({
        current_queue_id: queueId,
        customer_name: customerName ?? existing.customer_name,
        assigned_agent_id: auth.agentId,
        assigned_agent_name: auth.agentName,
        status: "ACTIVE",
        unread_for_agent: 0,
        resolved_at: null,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select("*, queue:sms_queues(id, queue_name)")
      .single();
    if (error) throw error;
    threadId = String(data.id);
  } else {
    const { data, error } = await supabaseAdmin
      .from("sms_threads")
      .insert({
        customer_phone: phone,
        customer_name: customerName,
        current_queue_id: queueId,
        assigned_agent_id: auth.agentId,
        assigned_agent_name: auth.agentName,
        status: "ACTIVE",
        unread_for_agent: 0,
        last_message_body: messageBody,
        last_message_at: now,
        updated_at: now,
      })
      .select("*, queue:sms_queues(id, queue_name)")
      .single();

    if (error) {
      const raced = await getThreadByPhone(supabaseAdmin, phone);
      if (!raced?.id) throw error;
      threadId = raced.id;
      await supabaseAdmin
        .from("sms_threads")
        .update({
          current_queue_id: queueId,
          customer_name: customerName ?? raced.customer_name,
          assigned_agent_id: auth.agentId,
          assigned_agent_name: auth.agentName,
          status: "ACTIVE",
          unread_for_agent: 0,
          resolved_at: null,
          updated_at: now,
        })
        .eq("id", threadId);
    } else {
      threadId = String(data.id);
    }
  }

  return sendMessage(supabaseAdmin, auth, {
    action: "send",
    threadId,
    messageBody,
  });
}

async function listContacts(
  supabaseAdmin: ReturnType<typeof createClient>,
  url: URL,
) {
  const contactType =
    parseContactType(url.searchParams.get("contactType") ?? url.searchParams.get("contact_type"));
  const phoneRaw = url.searchParams.get("phone");
  const ownerUid = url.searchParams.get("ownerUid") ?? url.searchParams.get("owner_uid");
  const search = sanitizeSearchTerm(url.searchParams.get("search") ?? "");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

  let query = supabaseAdmin.from("sms_contacts").select("*", { count: "exact" });
  if (contactType) query = query.eq("contact_type", contactType);
  if (phoneRaw?.trim()) query = query.eq("phone", normalizePhone(phoneRaw));
  if (ownerUid?.trim()) query = query.eq("owner_uid", ownerUid.trim());
  if (search) {
    query = query.or(`display_name.ilike.%${search}%,phone.ilike.%${search}%`);
  }

  const { data, error, count } = await query
    .order("display_name", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  return {
    contacts: ((data ?? []) as SmsContactRow[]).map(serializeContact),
    total: count ?? 0,
    limit,
    offset,
  };
}

async function getContact(
  supabaseAdmin: ReturnType<typeof createClient>,
  contactId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("sms_contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return json({ error: "Contact not found" }, 404);
  return { contact: serializeContact(data as SmsContactRow) };
}

async function createContact(
  supabaseAdmin: ReturnType<typeof createClient>,
  auth: AuthContext,
  body: Record<string, unknown>,
) {
  const contactType = parseContactType(
    String(body.contactType ?? body.contact_type ?? ""),
  );
  if (!contactType) {
    return json({ error: "contactType must be customer or owner" }, 400);
  }
  const displayName = requireString(body.displayName ?? body.display_name, "displayName");
  const phone = normalizePhone(requireString(body.phone, "phone"));
  if (phone.replace(/\D/g, "").length < 6) {
    return json({ error: "Enter a valid phone number" }, 400);
  }
  const ownerUidRaw = body.ownerUid ?? body.owner_uid;
  const ownerUid =
    typeof ownerUidRaw === "string" && ownerUidRaw.trim() ? ownerUidRaw.trim() : null;

  const { data, error } = await supabaseAdmin
    .from("sms_contacts")
    .insert({
      contact_type: contactType,
      display_name: displayName,
      phone,
      owner_uid: ownerUid,
      created_by: auth.userId,
    })
    .select("*")
    .single();
  if (error) {
    if (String(error.message).includes("duplicate") || error.code === "23505") {
      return json({ error: "A contact with this phone already exists for that type" }, 409);
    }
    throw error;
  }
  if (contactType === "customer") {
    await syncThreadNamesFromContact(supabaseAdmin, phone, displayName);
  }
  return { contact: serializeContact(data as SmsContactRow) };
}

async function updateContact(
  supabaseAdmin: ReturnType<typeof createClient>,
  contactId: string,
  body: Record<string, unknown>,
) {
  const existing = await supabaseAdmin
    .from("sms_contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data?.id) return json({ error: "Contact not found" }, 404);

  const patch: Record<string, unknown> = {};
  const contactType = parseContactType(
    String(body.contactType ?? body.contact_type ?? ""),
  );
  if (body.contactType !== undefined || body.contact_type !== undefined) {
    if (!contactType) return json({ error: "contactType must be customer or owner" }, 400);
    patch.contact_type = contactType;
  }
  if (body.displayName !== undefined || body.display_name !== undefined) {
    patch.display_name = requireString(body.displayName ?? body.display_name, "displayName");
  }
  if (body.phone !== undefined) {
    const phone = normalizePhone(requireString(body.phone, "phone"));
    if (phone.replace(/\D/g, "").length < 6) {
      return json({ error: "Enter a valid phone number" }, 400);
    }
    patch.phone = phone;
  }
  if (body.ownerUid !== undefined || body.owner_uid !== undefined) {
    const ownerUidRaw = body.ownerUid ?? body.owner_uid;
    patch.owner_uid =
      typeof ownerUidRaw === "string" && ownerUidRaw.trim() ? ownerUidRaw.trim() : null;
  }
  if (Object.keys(patch).length === 0) {
    return json({ error: "No fields to update" }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from("sms_contacts")
    .update(patch)
    .eq("id", contactId)
    .select("*")
    .single();
  if (error) {
    if (String(error.message).includes("duplicate") || error.code === "23505") {
      return json({ error: "A contact with this phone already exists for that type" }, 409);
    }
    throw error;
  }
  return { contact: serializeContact(data as SmsContactRow) };
}

async function deleteContact(
  supabaseAdmin: ReturnType<typeof createClient>,
  contactId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("sms_contacts")
    .delete()
    .eq("id", contactId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return json({ error: "Contact not found" }, 404);
  return { ok: true };
}

async function dispatchLegacyAction(
  supabaseAdmin: ReturnType<typeof createClient>,
  auth: AuthContext,
  action: SmsAction,
  body: Record<string, unknown>,
): Promise<Response> {
  if (action === "list") return json(await listSms(supabaseAdmin, auth));
  if (action === "messages") {
    const result = await loadMessages(supabaseAdmin, auth, body);
    return result instanceof Response ? result : json(result);
  }
  if (action === "claim") {
    const result = await claimThread(supabaseAdmin, auth, body);
    return result instanceof Response ? result : json(result);
  }
  if (action === "resolve") {
    const result = await resolveThread(supabaseAdmin, auth, body);
    return result instanceof Response ? result : json(result);
  }
  if (action === "send") {
    const result = await sendMessage(supabaseAdmin, auth, body);
    return result instanceof Response ? result : json(result);
  }
  if (action === "start") {
    const result = await startThread(supabaseAdmin, auth, body);
    return result instanceof Response ? result : json(result);
  }
  if (action === "deleteThread") {
    const result = await deleteThread(supabaseAdmin, auth, body);
    return result instanceof Response ? result : json(result);
  }
  if (action === "syncInbound") {
    if (auth.role !== "super-admin" && auth.role !== "supervisor") {
      return json({ error: "Insufficient permissions" }, 403);
    }
    return json(await syncInboundFromTextBee(supabaseAdmin));
  }
  return json({ error: `Unsupported action: ${action}` }, 400);
}

async function handleRestRequest(
  req: Request,
  supabaseAdmin: ReturnType<typeof createClient>,
  auth: AuthContext,
  route: ParsedRoute,
): Promise<Response> {
  const url = new URL(req.url);
  const body = asRecord(await req.json().catch(() => ({})));

  if (route.kind === "inbox") {
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
    return json(await listSms(supabaseAdmin, auth));
  }

  if (route.kind === "inbound_sync") {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (auth.role !== "super-admin" && auth.role !== "supervisor") {
      return json({ error: "Insufficient permissions" }, 403);
    }
    return json(await syncInboundFromTextBee(supabaseAdmin));
  }

  if (route.kind === "threads_start") {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const result = await startThread(supabaseAdmin, auth, body);
    return result instanceof Response ? result : json(result);
  }

  if (route.kind === "thread") {
    const payload = { ...body, threadId: route.threadId };
    if (route.sub === "messages") {
      if (req.method === "GET") {
        const result = await loadMessages(supabaseAdmin, auth, payload);
        return result instanceof Response ? result : json(result);
      }
      if (req.method === "POST") {
        const result = await sendMessage(supabaseAdmin, auth, payload);
        return result instanceof Response ? result : json(result);
      }
      return json({ error: "Method not allowed" }, 405);
    }
    if (route.sub === "claim") {
      if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const result = await claimThread(supabaseAdmin, auth, payload);
      return result instanceof Response ? result : json(result);
    }
    if (route.sub === "resolve") {
      if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const result = await resolveThread(supabaseAdmin, auth, payload);
      return result instanceof Response ? result : json(result);
    }
    if (!route.sub && req.method === "DELETE") {
      const result = await deleteThread(supabaseAdmin, auth, payload);
      return result instanceof Response ? result : json(result);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (route.kind === "contacts") {
    if (req.method === "GET") return json(await listContacts(supabaseAdmin, url));
    if (req.method === "POST") {
      const result = await createContact(supabaseAdmin, auth, body);
      return result instanceof Response ? result : json(result, 201);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (route.kind === "contact") {
    if (req.method === "GET") {
      const result = await getContact(supabaseAdmin, route.contactId);
      return result instanceof Response ? result : json(result);
    }
    if (req.method === "PATCH") {
      const result = await updateContact(supabaseAdmin, route.contactId, body);
      return result instanceof Response ? result : json(result);
    }
    if (req.method === "DELETE") {
      const result = await deleteContact(supabaseAdmin, route.contactId);
      return result instanceof Response ? result : json(result);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  return json({ error: "Not found" }, 404);
}

Deno.serve(serveWithCors(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const auth = await getAuthContext(req, supabaseAdmin, supabaseUrl);
    const url = new URL(req.url);
    const route = parseSmsPath(url.pathname);

    if (route) {
      return await handleRestRequest(req, supabaseAdmin, auth, route);
    }

    if (req.method === "POST") {
      const body = asRecord(await req.json().catch(() => ({})));
      if (typeof body.action === "string" && body.action.trim()) {
        return await dispatchLegacyAction(
          supabaseAdmin,
          auth,
          body.action.trim() as SmsAction,
          body,
        );
      }
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof Response) {
      const text = await error.text();
      return json(JSON.parse(text), error.status);
    }
    console.error("[sms-api] failed", error);
    return json({ error: error instanceof Error ? error.message : "SMS API failed" }, 500);
  }
}, ALLOWED_METHODS));
