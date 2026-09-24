/**
 * Care Plus support BFF — browser never touches careplus_support_* with anon keys.
 *
 * Default: service_role on shared careplus_support_* tables in this Supabase project
 * (same DB Care Plus writes via COMMAND_CENTER_SUPABASE_*). No CAREPLUS_* secrets required.
 *
 * Optional HTTP proxy (if all set): Care Plus agent APIs at CAREPLUS_API_ORIGIN with
 * Firebase super_admin token (CAREPLUS_FIREBASE_*). Used only when those secrets exist.
 *
 * Command Center caller: session JWT; role super-admin | supervisor | agent.
 */

// @ts-expect-error Supabase Edge Functions resolve this remote ESM import at runtime.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeadersFor, preflightResponse } from "../_shared/cors.ts";
import { resolveCaller, type AuthedCaller } from "../_shared/auth.ts";

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const ALLOWED_ROLES = new Set(["super-admin", "supervisor", "agent"]);

type CarePlusAction = "listThreads" | "listMessages" | "postMessage";

type TokenCache = { idToken: string; expiresAtMs: number };
let tokenCache: TokenCache | null = null;

function json(body: unknown, status = 200, req?: Request): Response {
  const headers = {
    ...(req ? corsHeadersFor(req, ALLOWED_METHODS) : {}),
    "Content-Type": "application/json",
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function carePlusOrigin(): string | null {
  const raw = Deno.env.get("CAREPLUS_API_ORIGIN")?.trim().replace(/\/+$/, "");
  return raw || null;
}

function hasFirebaseCreds(): boolean {
  if (Deno.env.get("CAREPLUS_FIREBASE_ID_TOKEN")?.trim()) return true;
  return Boolean(
    Deno.env.get("CAREPLUS_FIREBASE_REFRESH_TOKEN")?.trim() &&
      Deno.env.get("CAREPLUS_FIREBASE_API_KEY")?.trim(),
  );
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing on edge runtime");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function mapThread(row: Record<string, unknown>) {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    requesterUid: row.requester_uid,
    requesterEmail: row.requester_email,
    requesterName: row.requester_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: Record<string, unknown>) {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderRole: row.sender_role,
    senderName: row.sender_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

async function getCarePlusFirebaseIdToken(): Promise<string> {
  const staticToken = Deno.env.get("CAREPLUS_FIREBASE_ID_TOKEN")?.trim();
  if (staticToken) return staticToken;

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 60_000) {
    return tokenCache.idToken;
  }

  const refreshToken = Deno.env.get("CAREPLUS_FIREBASE_REFRESH_TOKEN")?.trim();
  const apiKey = Deno.env.get("CAREPLUS_FIREBASE_API_KEY")?.trim();
  if (!refreshToken || !apiKey) {
    throw new Error(
      "Care Plus Firebase credentials not configured (CAREPLUS_FIREBASE_REFRESH_TOKEN + CAREPLUS_FIREBASE_API_KEY)",
    );
  }

  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    },
  );

  const data = asRecord(await res.json().catch(() => ({})));
  const idToken = typeof data.id_token === "string" ? data.id_token : "";
  if (!res.ok || !idToken) {
    const detail =
      (typeof data.error === "string" && data.error) ||
      (typeof data.error_description === "string" && data.error_description) ||
      `HTTP ${res.status}`;
    throw new Error(`Failed to refresh Care Plus Firebase token: ${detail}`);
  }

  const expiresInSec = Number(data.expires_in ?? 3600);
  tokenCache = {
    idToken,
    expiresAtMs: now + Math.max(60, expiresInSec) * 1000,
  };
  return idToken;
}

async function carePlusFetch(
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const origin = carePlusOrigin();
  if (!origin) {
    return { status: 503, body: { error: "Care Plus not configured", configured: false } };
  }

  const idToken = await getCarePlusFirebaseIdToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${idToken}`,
    Accept: "application/json",
  };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${origin}${path}`, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text().catch(() => "");
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 400) };
    }
  }
  return { status: res.status, body };
}

function isMissingTableError(message: string): boolean {
  return /careplus_support_|schema cache|does not exist|relation/i.test(message);
}

async function dbListThreads(
  status: string,
  limit: number,
): Promise<{ status: number; body: unknown }> {
  const db = serviceClient();
  let query = db
    .from("careplus_support_threads")
    .select(
      "id, provider_id, provider_name, requester_uid, requester_email, requester_name, status, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (status === "open" || status === "closed") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error.message)) {
      return {
        status: 503,
        body: {
          configured: false,
          error:
            "careplus_support_* tables missing — run scripts/command-center-supabase.sql in the Supabase SQL editor",
        },
      };
    }
    return { status: 500, body: { error: error.message } };
  }

  return {
    status: 200,
    body: {
      configured: true,
      mode: "shared-db",
      threads: (data ?? []).map((row) => mapThread(asRecord(row))),
    },
  };
}

async function dbListMessages(
  threadId: string,
  since: string | null,
): Promise<{ status: number; body: unknown }> {
  const db = serviceClient();
  const { data: thread, error: threadErr } = await db
    .from("careplus_support_threads")
    .select(
      "id, provider_id, provider_name, requester_uid, requester_email, requester_name, status, created_at, updated_at",
    )
    .eq("id", threadId)
    .maybeSingle();

  if (threadErr) {
    if (isMissingTableError(threadErr.message)) {
      return {
        status: 503,
        body: {
          configured: false,
          error:
            "careplus_support_* tables missing — run scripts/command-center-supabase.sql",
        },
      };
    }
    return { status: 500, body: { error: threadErr.message } };
  }
  if (!thread) {
    return { status: 404, body: { error: "Thread not found" } };
  }

  let msgQuery = db
    .from("careplus_support_messages")
    .select("id, thread_id, sender_role, sender_name, body, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (since) {
    msgQuery = msgQuery.gt("created_at", since);
  }

  const { data: messages, error: msgErr } = await msgQuery;
  if (msgErr) {
    return { status: 500, body: { error: msgErr.message } };
  }

  return {
    status: 200,
    body: {
      configured: true,
      mode: "shared-db",
      thread: mapThread(asRecord(thread)),
      messages: (messages ?? []).map((row) => mapMessage(asRecord(row))),
    },
  };
}

async function dbPostMessage(
  threadId: string,
  body: string,
  caller: AuthedCaller,
): Promise<{ status: number; body: unknown }> {
  const db = serviceClient();
  const { data: thread, error: threadErr } = await db
    .from("careplus_support_threads")
    .select(
      "id, provider_id, provider_name, requester_uid, requester_email, requester_name, status, created_at, updated_at",
    )
    .eq("id", threadId)
    .maybeSingle();

  if (threadErr) {
    if (isMissingTableError(threadErr.message)) {
      return {
        status: 503,
        body: {
          configured: false,
          error:
            "careplus_support_* tables missing — run scripts/command-center-supabase.sql",
        },
      };
    }
    return { status: 500, body: { error: threadErr.message } };
  }
  if (!thread) {
    return { status: 404, body: { error: "Thread not found" } };
  }
  if (String(asRecord(thread).status) !== "open") {
    return { status: 409, body: { error: "Thread is closed" } };
  }

  const senderName =
    caller.email?.split("@")[0] ||
    caller.email ||
    "Command Center agent";

  const now = new Date().toISOString();
  const { data: message, error: insertErr } = await db
    .from("careplus_support_messages")
    .insert({
      thread_id: threadId,
      sender_role: "agent",
      sender_name: senderName,
      body,
      created_at: now,
    })
    .select("id, thread_id, sender_role, sender_name, body, created_at")
    .single();

  if (insertErr) {
    return { status: 500, body: { error: insertErr.message } };
  }

  const { data: updatedThread, error: updateErr } = await db
    .from("careplus_support_threads")
    .update({ updated_at: now })
    .eq("id", threadId)
    .select(
      "id, provider_id, provider_name, requester_uid, requester_email, requester_name, status, created_at, updated_at",
    )
    .single();

  if (updateErr) {
    // Message already written — still return success with prior thread snapshot
    return {
      status: 200,
      body: {
        thread: mapThread(asRecord(thread)),
        message: mapMessage(asRecord(message)),
      },
    };
  }

  return {
    status: 200,
    body: {
      thread: mapThread(asRecord(updatedThread)),
      message: mapMessage(asRecord(message)),
    },
  };
}

async function handleAction(
  action: CarePlusAction,
  payload: Record<string, unknown>,
  caller: AuthedCaller,
): Promise<{ status: number; body: unknown }> {
  const useHttp = Boolean(carePlusOrigin() && hasFirebaseCreds());

  if (action === "listThreads") {
    const status = String(payload.status ?? "open").trim() || "open";
    const limit = Math.min(Math.max(Number(payload.limit ?? 100) || 100, 1), 200);
    if (useHttp) {
      const qs = new URLSearchParams({ status, limit: String(limit) });
      return await carePlusFetch(`/api/admin/command-center/threads?${qs}`, {
        method: "GET",
      });
    }
    return await dbListThreads(status, limit);
  }

  if (action === "listMessages") {
    const threadId = requireString(payload.threadId, "threadId");
    const since =
      typeof payload.since === "string" && payload.since.trim()
        ? payload.since.trim()
        : null;
    if (useHttp) {
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      return await carePlusFetch(
        `/api/admin/command-center/threads/${encodeURIComponent(threadId)}/messages${qs}`,
        { method: "GET" },
      );
    }
    return await dbListMessages(threadId, since);
  }

  if (action === "postMessage") {
    const threadId = requireString(payload.threadId, "threadId");
    const body = requireString(payload.body, "body");
    if (body.length > 8000) {
      return { status: 400, body: { error: "body must be 1–8000 characters" } };
    }
    if (useHttp) {
      return await carePlusFetch(
        `/api/admin/command-center/threads/${encodeURIComponent(threadId)}/messages`,
        { method: "POST", body: { body } },
      );
    }
    return await dbPostMessage(threadId, body, caller);
  }

  return { status: 400, body: { error: `Unknown action: ${action}` } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req, ALLOWED_METHODS);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, req);
  }

  const caller = await resolveCaller(req);
  if (!caller) {
    return json({ error: "Unauthorized" }, 401, req);
  }
  const role = (caller.role ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!ALLOWED_ROLES.has(role)) {
    return json(
      { error: "Forbidden — Care Plus inbox requires agent, supervisor, or super-admin" },
      403,
      req,
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = asRecord(await req.json());
  } catch {
    return json({ error: "Invalid JSON body" }, 400, req);
  }

  try {
    const action = requireString(payload.action, "action") as CarePlusAction;
    const result = await handleAction(action, payload, caller);
    return json(result.body, result.status, req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Care Plus proxy failed";
    const status = /not configured|tables missing/i.test(message) ? 503 : 500;
    return json({ error: message, configured: false }, status, req);
  }
});
