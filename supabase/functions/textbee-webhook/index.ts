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
    "authorization, x-client-info, apikey, content-type, x-textbee-secret, x-webhook-secret",
  "Access-Control-Max-Age": "86400",
};

const SMS_CHANNEL = "sms-center";

type SmsQueue = {
  id: string;
  queue_name: string;
};

type SmsThread = {
  id: string;
  customer_phone: string;
  current_queue_id: string;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  status: "QUEUED" | "ACTIVE" | "RESOLVED";
  unread_for_agent: number;
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

function normalizePayload(raw: unknown) {
  const root = asRecord(raw);
  const data = asRecord(root.data);
  const sms = asRecord(root.sms);
  const messageObj = asRecord(root.message);
  const nested = Object.keys(data).length ? data : Object.keys(sms).length ? sms : messageObj;

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

  const messageBody = firstString(
    root.message,
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
    textbeeMessageId: firstString(root.smsId, root.id, nested.smsId, nested.id) || null,
    deviceId: firstString(root.deviceId, root.device_id, nested.deviceId, nested.device_id) || null,
    event: firstString(root.webhookEvent, root.event, root.type, nested.webhookEvent, nested.event, nested.type),
  };
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

async function findOrCreateThread(
  supabaseAdmin: ReturnType<typeof createClient>,
  phone: string,
  queueId: string,
): Promise<SmsThread> {
  const { data: existing, error: findError } = await supabaseAdmin
    .from("sms_threads")
    .select(
      "id, customer_phone, current_queue_id, assigned_agent_id, assigned_agent_name, status, unread_for_agent",
    )
    .eq("customer_phone", phone)
    .maybeSingle();

  if (findError) throw findError;
  if (existing?.id) return existing as SmsThread;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("sms_threads")
    .insert({
      customer_phone: phone,
      current_queue_id: queueId,
      status: "QUEUED",
      unread_for_agent: 0,
    })
    .select(
      "id, customer_phone, current_queue_id, assigned_agent_id, assigned_agent_name, status, unread_for_agent",
    )
    .single();

  if (!insertError && inserted?.id) return inserted as SmsThread;

  const { data: raced, error: racedError } = await supabaseAdmin
    .from("sms_threads")
    .select(
      "id, customer_phone, current_queue_id, assigned_agent_id, assigned_agent_name, status, unread_for_agent",
    )
    .eq("customer_phone", phone)
    .single();

  if (racedError) throw insertError ?? racedError;
  return raced as SmsThread;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const webhookSecret = Deno.env.get("TEXTBEE_WEBHOOK_SECRET")?.trim();
  if (webhookSecret) {
    const url = new URL(req.url);
    const provided =
      req.headers.get("x-textbee-secret") ||
      req.headers.get("x-webhook-secret") ||
      url.searchParams.get("secret");
    if (provided !== webhookSecret) {
      return json({ error: "Invalid webhook secret" }, 401);
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const inbound = normalizePayload(body);
  if (!inbound.phone || !inbound.messageBody) {
    return json({ error: "Missing sender phone or message body" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const queue = await ensureSalesQueue(supabaseAdmin);
    const thread = await findOrCreateThread(supabaseAdmin, inbound.phone, queue.id);
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

    return json({ ok: true, threadId: thread.id, messageId: message.id });
  } catch (error) {
    console.error("[textbee-webhook] failed", error);
    return json({ error: error instanceof Error ? error.message : "Webhook failed" }, 500);
  }
});
