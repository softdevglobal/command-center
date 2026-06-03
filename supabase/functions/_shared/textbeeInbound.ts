// @ts-expect-error Supabase Edge Functions resolve this remote ESM import at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const SMS_CHANNEL = "sms-center";

const SKIP_WEBHOOK_EVENTS = new Set([
  "MESSAGE_SENT",
  "MESSAGE_DELIVERED",
  "MESSAGE_FAILED",
  "MESSAGE_SENDING",
]);

export type NormalizedInbound = {
  phone: string;
  messageBody: string;
  receivedAt: string;
  textbeeMessageId: string | null;
  deviceId: string | null;
  event: string;
};

export type SmsQueue = {
  id: string;
  queue_name: string;
};

export type SmsThread = {
  id: string;
  customer_phone: string;
  current_queue_id: string;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  status: "QUEUED" | "ACTIVE" | "RESOLVED";
  unread_for_agent: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
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

export function canonicalSmsPhone(value: string): string {
  const digits = phoneDigits(value);
  if (!digits) return normalizePhone(value);
  if (digits.startsWith("61") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+61${digits.slice(1)}`;
  if (digits.length === 9) return `+61${digits}`;
  return value.trim().startsWith("+") ? normalizePhone(value) : `+${digits}`;
}

function nestedPayloadRoot(raw: unknown): Record<string, unknown> {
  const root = asRecord(raw);
  const data = asRecord(root.data);
  const sms = asRecord(root.sms);
  const messageField = root.message;
  const messageObj = typeof messageField === "object" ? asRecord(messageField) : {};
  if (Object.keys(data).length) return data;
  if (Object.keys(sms).length) return sms;
  if (Object.keys(messageObj).length) return messageObj;
  return root;
}

export function normalizeTextBeePayload(raw: unknown): NormalizedInbound {
  const root = asRecord(raw);
  const nested = nestedPayloadRoot(raw);

  const phone = normalizePhone(
    firstString(
      root.sender,
      root.from,
      root.phone,
      root.customerPhone,
      root.customer_phone,
      nested.sender,
      nested.from,
      nested.phone,
      nested.customerPhone,
      nested.customer_phone,
    ),
  );

  const messageField = root.message;
  const messageFromRoot =
    typeof messageField === "string" || typeof messageField === "number"
      ? firstString(messageField)
      : "";

  const messageBody = firstString(
    messageFromRoot,
    root.text,
    root.body,
    root.content,
    root.messageBody,
    root.message_body,
    nested.message,
    nested.text,
    nested.body,
    nested.content,
    nested.messageBody,
    nested.message_body,
  );

  const receivedAt = firstString(
    root.receivedAt,
    root.received_at,
    root.timestamp,
    root.createdAt,
    nested.receivedAt,
    nested.received_at,
    nested.timestamp,
    nested.createdAt,
  );

  const receivedMs = receivedAt ? Date.parse(receivedAt) : Number.NaN;

  return {
    phone,
    messageBody,
    receivedAt: Number.isNaN(receivedMs) ? new Date().toISOString() : new Date(receivedMs).toISOString(),
    textbeeMessageId: firstString(root.smsId, root.id, root._id, nested.smsId, nested.id, nested._id) || null,
    deviceId: firstString(root.deviceId, root.device_id, nested.deviceId, nested.device_id) || null,
    event: firstString(root.webhookEvent, root.event, root.type, nested.webhookEvent, nested.event, nested.type),
  };
}

export function shouldSkipTextBeeWebhookEvent(event: string): boolean {
  if (!event) return false;
  return SKIP_WEBHOOK_EVENTS.has(event.trim().toUpperCase());
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(payload: unknown, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return Array.from(new Uint8Array(sig))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** TextBee signs webhooks with HMAC-SHA256 of JSON.stringify(payload) in X-Signature / X-Textbee-Signature. */
export async function verifyTextBeeWebhookAuth(
  req: Request,
  payload: unknown,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return true;

  const url = new URL(req.url);
  const providedSecret =
    req.headers.get("x-textbee-secret")?.trim() ||
    req.headers.get("x-webhook-secret")?.trim() ||
    url.searchParams.get("secret")?.trim();
  if (providedSecret && providedSecret === secret) return true;

  const signature =
    req.headers.get("x-signature")?.trim() ||
    req.headers.get("x-textbee-signature")?.trim();
  if (!signature) return false;

  const expected = await hmacSha256Hex(payload, secret);
  return timingSafeEqualHex(signature, expected);
}

async function ensureSalesQueue(supabaseAdmin: ReturnType<typeof createClient>): Promise<SmsQueue> {
  const { data, error } = await supabaseAdmin
    .from("sms_queues")
    .select("id, queue_name")
    .eq("queue_name", "Sales")
    .maybeSingle();

  if (error) throw error;
  if (data?.id) return data as SmsQueue;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("sms_queues")
    .insert({ queue_name: "Sales", sort_order: 1 })
    .select("id, queue_name")
    .single();
  if (insertError) throw insertError;
  return inserted as SmsQueue;
}

const THREAD_SELECT =
  "id, customer_phone, current_queue_id, assigned_agent_id, assigned_agent_name, status, unread_for_agent";

async function findThreadByPhone(
  supabaseAdmin: ReturnType<typeof createClient>,
  phone: string,
): Promise<SmsThread | null> {
  const canonical = canonicalSmsPhone(phone);
  for (const candidate of [canonical, normalizePhone(phone), phone.trim()]) {
    if (!candidate) continue;
    const { data, error } = await supabaseAdmin
      .from("sms_threads")
      .select(THREAD_SELECT)
      .eq("customer_phone", candidate)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data as SmsThread;
  }

  const { data: rows, error: listError } = await supabaseAdmin
    .from("sms_threads")
    .select(THREAD_SELECT)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (listError) throw listError;
  return (
    (rows ?? []).find((row) => phonesEquivalent(String(row.customer_phone), phone)) as SmsThread | undefined
  ) ?? null;
}

async function findOrCreateThread(
  supabaseAdmin: ReturnType<typeof createClient>,
  phone: string,
  queueId: string,
): Promise<SmsThread> {
  const existing = await findThreadByPhone(supabaseAdmin, phone);
  if (existing?.id) return existing;

  const storedPhone = canonicalSmsPhone(phone);
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("sms_threads")
    .insert({
      customer_phone: storedPhone,
      current_queue_id: queueId,
      status: "QUEUED",
      unread_for_agent: 0,
    })
    .select(THREAD_SELECT)
    .single();

  if (!insertError && inserted?.id) return inserted as SmsThread;

  const raced = await findThreadByPhone(supabaseAdmin, phone);
  if (raced?.id) return raced;
  if (insertError) throw insertError;
  throw new Error("Failed to create SMS thread");
}

async function inboundAlreadyStored(
  supabaseAdmin: ReturnType<typeof createClient>,
  textbeeMessageId: string | null,
): Promise<boolean> {
  if (!textbeeMessageId) return false;
  const { data, error } = await supabaseAdmin
    .from("sms_messages")
    .select("id")
    .eq("textbee_message_id", textbeeMessageId)
    .eq("direction", "INBOUND")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

export async function persistInboundSms(
  supabaseAdmin: ReturnType<typeof createClient>,
  inbound: NormalizedInbound,
): Promise<{ threadId: string; messageId: string; duplicate: boolean }> {
  const phone = canonicalSmsPhone(inbound.phone);
  if (!phone || !inbound.messageBody) {
    throw new Error("Missing sender phone or message body");
  }

  if (await inboundAlreadyStored(supabaseAdmin, inbound.textbeeMessageId)) {
    const thread = await findThreadByPhone(supabaseAdmin, phone);
    return {
      threadId: thread?.id ?? "",
      messageId: "",
      duplicate: true,
    };
  }

  const queue = await ensureSalesQueue(supabaseAdmin);
  const thread = await findOrCreateThread(supabaseAdmin, phone, queue.id);
  const reopened = thread.status === "RESOLVED";
  const nextStatus = reopened ? "QUEUED" : thread.status;
  const nextAssignedAgentId = reopened ? null : thread.assigned_agent_id;
  const nextAssignedAgentName = reopened ? null : thread.assigned_agent_name;

  const { data: message, error: messageError } = await supabaseAdmin
    .from("sms_messages")
    .insert({
      thread_id: thread.id,
      direction: "INBOUND",
      message_body: inbound.messageBody,
      textbee_message_id: inbound.textbeeMessageId,
      created_at: inbound.receivedAt,
    })
    .select("id, thread_id, direction, message_body, created_at")
    .single();
  if (messageError) throw messageError;

  const { data: updatedThread, error: threadError } = await supabaseAdmin
    .from("sms_threads")
    .update({
      status: nextStatus,
      assigned_agent_id: nextAssignedAgentId,
      assigned_agent_name: nextAssignedAgentName,
      unread_for_agent: Number(thread.unread_for_agent ?? 0) + 1,
      last_message_body: inbound.messageBody,
      last_message_at: inbound.receivedAt,
      resolved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", thread.id)
    .select("*")
    .single();
  if (threadError) throw threadError;

  await supabaseAdmin.channel(SMS_CHANNEL).send({
    type: "broadcast",
    event: "SMS_UPDATED",
    payload: {
      type: "INBOUND",
      threadId: thread.id,
      queueId: updatedThread.current_queue_id,
      message,
      thread: updatedThread,
    },
  });

  return { threadId: thread.id, messageId: message.id, duplicate: false };
}

export function extractReceivedMessagesFromTextBeeResponse(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) return response as Record<string, unknown>[];
  const root = asRecord(response);
  if (Array.isArray(root.data)) return root.data as Record<string, unknown>[];
  if (Array.isArray(root.messages)) return root.messages as Record<string, unknown>[];
  const data = asRecord(root.data);
  if (Array.isArray(data.messages)) return data.messages as Record<string, unknown>[];
  if (Array.isArray(data.items)) return data.items as Record<string, unknown>[];
  return [];
}

export function normalizeReceivedApiRow(row: Record<string, unknown>): NormalizedInbound | null {
  const inbound = normalizeTextBeePayload(row);
  if (!inbound.phone || !inbound.messageBody) return null;
  inbound.phone = canonicalSmsPhone(inbound.phone);
  return inbound;
}

export async function fetchTextBeeReceivedMessages(): Promise<Record<string, unknown>[]> {
  const apiKey = Deno.env.get("TEXTBEE_API_KEY")?.trim();
  const deviceId = Deno.env.get("TEXTBEE_DEVICE_ID")?.trim();
  if (!apiKey || !deviceId) {
    throw new Error("Missing TEXTBEE_API_KEY or TEXTBEE_DEVICE_ID");
  }

  const base = `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(deviceId)}`;
  const urls = [
    `${base}/messages?type=received&limit=100`,
    `${base}/get-received-sms`,
  ];

  let lastError = "TextBee fetch failed";
  for (const url of urls) {
    const response = await fetch(url, { headers: { "x-api-key": apiKey } });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text.trim() ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const detail = asRecord(parsed);
      lastError = String(detail.error ?? detail.message ?? `TextBee HTTP ${response.status}`);
      continue;
    }
    const rows = extractReceivedMessagesFromTextBeeResponse(parsed);
    if (rows.length) return rows;
    if (parsed) return extractReceivedMessagesFromTextBeeResponse(parsed);
  }

  throw new Error(lastError);
}

export async function syncInboundFromTextBee(
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<{ imported: number; skipped: number; duplicates: number }> {
  const rows = await fetchTextBeeReceivedMessages();
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const inbound = normalizeReceivedApiRow(row);
    if (!inbound) {
      skipped += 1;
      continue;
    }
    const result = await persistInboundSms(supabaseAdmin, inbound);
    if (result.duplicate) duplicates += 1;
    else imported += 1;
  }

  return { imported, skipped, duplicates };
}
