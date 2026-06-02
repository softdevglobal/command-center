declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// @ts-expect-error Supabase Edge Functions resolve this remote ESM import at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

const SMS_CHANNEL = "sms-center";
const ALLOWED_ROLES = new Set(["super-admin", "supervisor", "agent"]);

type SmsAction = "list" | "messages" | "claim" | "resolve" | "send" | "start";

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

  return {
    queues: queues ?? [],
    threads: visibleThreads,
    unreadCount: visibleThreads.reduce((sum, thread) => sum + Number(thread.unread_for_agent ?? 0), 0),
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

async function getThreadByPhone(
  supabaseAdmin: ReturnType<typeof createClient>,
  phone: string,
): Promise<SmsThreadRow | null> {
  const { data, error } = await supabaseAdmin
    .from("sms_threads")
    .select("*, queue:sms_queues(id, queue_name)")
    .eq("customer_phone", phone)
    .maybeSingle();
  if (error) throw error;
  return data?.id ? (data as SmsThreadRow) : null;
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

async function startThread(
  supabaseAdmin: ReturnType<typeof createClient>,
  auth: AuthContext,
  body: Record<string, unknown>,
) {
  const phone = normalizePhone(requireString(body.customerPhone ?? body.phone, "customerPhone"));
  const messageBody = requireString(body.messageBody ?? body.message, "messageBody");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const auth = await getAuthContext(req, supabaseAdmin, supabaseUrl);
    const body = asRecord(await req.json().catch(() => ({})));
    const action = requireString(body.action, "action") as SmsAction;

    if (action === "list") {
      return json(await listSms(supabaseAdmin, auth));
    }
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

    return json({ error: `Unsupported action: ${action}` }, 400);
  } catch (error) {
    if (error instanceof Response) {
      const text = await error.text();
      return json(JSON.parse(text), error.status);
    }
    console.error("[sms-api] failed", error);
    return json({ error: error instanceof Error ? error.message : "SMS API failed" }, 500);
  }
});
