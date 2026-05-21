import { supabase } from "@/integrations/supabase/client";
import { apiFetch, getAccessToken } from "@/lib/api";
import {
  AUDIT_ACTION_LEAVE_REQUEST_CREATE,
  AUDIT_ACTION_LEAVE_REQUEST_UPDATE,
  postSystemAuditLog,
} from "./auditLogApi";

const AGENT_LEAVE_REQUESTS_API_URL =
  (import.meta.env.VITE_AGENT_LEAVE_REQUESTS_API_URL as string | undefined)?.trim() ||
  "http://127.0.0.1:5050/api/agent-leave-requests";

export const LEAVE_DURATION_TYPES = ["full_day", "half_day"] as const;
export type LeaveDurationType = (typeof LEAVE_DURATION_TYPES)[number];

export const LEAVE_HALF_DAY_PARTS = ["am", "pm"] as const;
export type LeaveHalfDayPart = (typeof LEAVE_HALF_DAY_PARTS)[number];

export const LEAVE_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

export type AgentLeaveRequestRow = {
  id: string;
  user_id: string;
  tenant_id: string | null;
  agent_display_name: string | null;
  start_date: string;
  end_date: string;
  duration_type: string;
  half_day_part: string | null;
  reason: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  attachment_storage_path: string | null;
  created_at: string;
};

export const LEAVE_ATTACHMENTS_BUCKET = "leave-request-attachments";

export const LEAVE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function pickString(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function pickNullableString(row: Record<string, unknown>, keys: readonly string[]): string | null {
  const text = pickString(row, keys);
  return text || null;
}

function normalizeDate(raw: string): string {
  if (!raw) return "";
  return raw.includes("T") ? raw.slice(0, 10) : raw;
}

function normalizeDurationType(raw: string): LeaveDurationType {
  return raw === "half_day" ? "half_day" : "full_day";
}

function normalizeLeaveStatus(raw: string): LeaveRequestStatus {
  const status = raw.toLowerCase();
  if (status === "approved" || status === "rejected") return status;
  return "pending";
}

function normalizeLeaveRequest(raw: unknown): AgentLeaveRequestRow {
  const row = asRecord(raw);
  const startDate = normalizeDate(pickString(row, ["start_date", "startDate", "fromDate"]));
  return {
    id: pickString(row, ["id", "requestId", "request_id"]),
    user_id: pickString(row, ["user_id", "userId", "agentId", "agent_id"]),
    tenant_id: pickNullableString(row, ["tenant_id", "tenantId"]),
    agent_display_name: pickNullableString(row, [
      "agent_display_name",
      "agentDisplayName",
      "displayName",
      "agentName",
    ]),
    start_date: startDate,
    end_date: normalizeDate(pickString(row, ["end_date", "endDate", "toDate"])) || startDate,
    duration_type: normalizeDurationType(pickString(row, ["duration_type", "durationType"])),
    half_day_part: pickNullableString(row, ["half_day_part", "halfDayPart"]),
    reason: pickNullableString(row, ["reason"]),
    status: normalizeLeaveStatus(pickString(row, ["status", "decision"])),
    reviewed_by: pickNullableString(row, ["reviewed_by", "reviewedBy"]),
    reviewed_at: pickNullableString(row, ["reviewed_at", "reviewedAt"]),
    review_comment: pickNullableString(row, ["review_comment", "reviewComment", "comment"]),
    attachment_storage_path: pickNullableString(row, [
      "attachment_storage_path",
      "attachmentStoragePath",
      "attachmentPath",
      "photoStoragePath",
    ]),
    created_at: pickString(row, ["created_at", "createdAt"]) || new Date().toISOString(),
  };
}

function collectRows(raw: unknown, keys: readonly string[]): unknown[] {
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

function extractLeaveRequests(raw: unknown): AgentLeaveRequestRow[] {
  return collectRows(raw, ["leaveRequests", "requests", "items", "results", "rows"])
    .map(normalizeLeaveRequest)
    .filter((row) => row.id && row.start_date && row.end_date);
}

function extractLeaveRequest(raw: unknown): AgentLeaveRequestRow {
  const body = asRecord(raw);
  const nested =
    body.leaveRequest ??
    body.request ??
    body.item ??
    body.row ??
    body.data ??
    raw;
  const row = normalizeLeaveRequest(nested);
  if (!row.id) throw new Error("Leave request API returned an invalid row.");
  return row;
}

function requireLeaveRequestsAuth(): void {
  if (!getAccessToken()) {
    throw new Error("Sign in with your dashboard account to use leave requests.");
  }
}

function leaveRequestsUrl(path: string): string {
  const base = AGENT_LEAVE_REQUESTS_API_URL.replace(/\/+$/, "");
  const suffix = path.trim() ? (path.startsWith("/") ? path : `/${path}`) : "";
  return new URL(`${base}${suffix}`, window.location.origin).toString();
}

async function leaveRequestsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  requireLeaveRequestsAuth();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return apiFetch(leaveRequestsUrl(path), { ...init, headers });
}

async function readHttpErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  if (!text.trim()) return "";
  try {
    const body = asRecord(JSON.parse(text) as unknown);
    const detail = body.message ?? body.error ?? body.detail;
    return typeof detail === "string" ? detail : text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as unknown) : null;
}

function normalizeLeaveAttachmentExt(file: File): string {
  if (file.type && ALLOWED_IMAGE_TYPES.has(file.type)) {
    if (file.type === "image/jpeg") return "jpg";
    if (file.type === "image/png") return "png";
    if (file.type === "image/webp") return "webp";
    if (file.type === "image/gif") return "gif";
    if (file.type === "image/heic" || file.type === "image/heif") return "heic";
  }
  const tail = file.name.split(".").pop()?.toLowerCase();
  if (tail && ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(tail)) {
    return tail === "jpeg" ? "jpg" : tail;
  }
  throw new Error("Please choose a JPEG, PNG, WebP, GIF, or HEIC image.");
}

function assertValidLeaveAttachment(file: File): void {
  if (!file.size) throw new Error("Image is empty.");
  if (file.size > LEAVE_ATTACHMENT_MAX_BYTES) throw new Error("Image must be 5 MB or smaller.");
  if (file.type && !ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Please choose a JPEG, PNG, WebP, GIF, or HEIC image.");
  }
  normalizeLeaveAttachmentExt(file);
}

/** Signed URL for agents or super-admins (storage RLS allows both). */
export async function getLeaveRequestAttachmentSignedUrl(
  storagePath: string,
  expiresSec = 3600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(LEAVE_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresSec);
  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error("Could not create link for this image.");
  return data.signedUrl;
}

export function formatLeaveDurationLabel(row: Pick<AgentLeaveRequestRow, "duration_type" | "half_day_part">): string {
  if (row.duration_type === "full_day") return "Full day";
  return row.half_day_part === "am" ? "Half day (AM)" : "Half day (PM)";
}

export function formatLeaveDateRange(row: Pick<AgentLeaveRequestRow, "start_date" | "end_date">): string {
  if (row.start_date === row.end_date) return row.start_date;
  return `${row.start_date} → ${row.end_date}`;
}

export async function fetchMyLeaveRequests(userId: string): Promise<AgentLeaveRequestRow[]> {
  const res = await leaveRequestsFetch("");
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`Leave requests API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  return extractLeaveRequests(await readJsonBody(res))
    .filter((row) => !row.user_id || row.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function fetchAllLeaveRequests(): Promise<AgentLeaveRequestRow[]> {
  const res = await leaveRequestsFetch("");
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`Leave requests API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  return extractLeaveRequests(await readJsonBody(res)).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export async function fetchLeaveRequest(requestId: string): Promise<AgentLeaveRequestRow> {
  const res = await leaveRequestsFetch(`/${encodeURIComponent(requestId)}`);
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`Leave request API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  return extractLeaveRequest(await readJsonBody(res));
}

export async function insertLeaveRequest(opts: {
  userId: string;
  tenantId: string | null;
  displayName: string;
  startDate: string;
  endDate: string;
  durationType: LeaveDurationType;
  halfDayPart: LeaveHalfDayPart | null;
  reason: string | null;
  attachmentFile?: File | null;
}): Promise<void> {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user || authData.user.id !== opts.userId) {
    throw new Error("Sign in with your dashboard account to submit leave.");
  }

  if (opts.endDate < opts.startDate) {
    throw new Error("End date must be on or after the start date.");
  }

  const maxSpanDays = 60;
  const start = new Date(`${opts.startDate}T12:00:00`);
  const end = new Date(`${opts.endDate}T12:00:00`);
  const span = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (span > maxSpanDays) {
    throw new Error(`Leave cannot exceed ${maxSpanDays} days per request.`);
  }

  if (opts.durationType === "half_day" && !opts.halfDayPart) {
    throw new Error("Choose morning or afternoon for a half-day leave.");
  }

  const requestId = crypto.randomUUID();
  let attachment_storage_path: string | null = null;

  if (opts.attachmentFile && opts.attachmentFile.size > 0) {
    assertValidLeaveAttachment(opts.attachmentFile);
    const ext = normalizeLeaveAttachmentExt(opts.attachmentFile);
    attachment_storage_path = `${opts.userId}/${requestId}.${ext}`;
    const contentType =
      opts.attachmentFile.type ||
      (ext === "jpg"
        ? "image/jpeg"
        : ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "gif"
              ? "image/gif"
              : ext === "heic"
                ? "image/heic"
                : `image/${ext}`);
    const { error: upErr } = await supabase.storage
      .from(LEAVE_ATTACHMENTS_BUCKET)
      .upload(attachment_storage_path, opts.attachmentFile, {
        cacheControl: "3600",
        upsert: false,
        contentType,
      });
    if (upErr) throw new Error(upErr.message);
  }

  const res = await leaveRequestsFetch("", {
    method: "POST",
    body: JSON.stringify({
      id: requestId,
      userId: opts.userId,
      tenantId: opts.tenantId,
      displayName: opts.displayName || null,
      startDate: opts.startDate,
      endDate: opts.endDate,
      durationType: opts.durationType,
      halfDayPart: opts.durationType === "full_day" ? null : opts.halfDayPart,
      reason: opts.reason?.trim() || null,
      attachmentStoragePath: attachment_storage_path,
    }),
  });

  if (!res.ok) {
    if (attachment_storage_path) {
      await supabase.storage.from(LEAVE_ATTACHMENTS_BUCKET).remove([attachment_storage_path]);
    }
    const detail = await readHttpErrorDetail(res);
    throw new Error(`Leave request API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }

  void postSystemAuditLog({
    action: AUDIT_ACTION_LEAVE_REQUEST_CREATE,
    resourceType: "agent_leave_request",
    resourceId: requestId,
    details: {
      agentId: opts.userId,
      tenantId: opts.tenantId,
      displayName: opts.displayName,
      startDate: opts.startDate,
      endDate: opts.endDate,
      durationType: opts.durationType,
      halfDayPart: opts.durationType === "full_day" ? null : opts.halfDayPart,
      hasAttachment: Boolean(attachment_storage_path),
    },
  }).catch(() => {});
}

export async function deleteMyPendingLeaveRequest(userId: string, requestId: string): Promise<void> {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user || authData.user.id !== userId) {
    throw new Error("Sign in with your dashboard account.");
  }

  const { data: row, error: selErr } = await supabase
    .from("agent_leave_requests")
    .select("attachment_storage_path")
    .eq("id", requestId)
    .eq("user_id", userId)
    .maybeSingle();

  if (selErr) throw new Error(selErr.message);

  if (row?.attachment_storage_path) {
    await supabase.storage.from(LEAVE_ATTACHMENTS_BUCKET).remove([row.attachment_storage_path]);
  }

  const { error } = await supabase.from("agent_leave_requests").delete().eq("id", requestId).eq("user_id", userId);

  if (error) throw new Error(error.message);
}

export async function reviewLeaveRequest(opts: {
  requestId: string;
  decision: Exclude<LeaveRequestStatus, "pending">;
  reviewComment: string | null;
}): Promise<void> {
  const res = await leaveRequestsFetch(`/${encodeURIComponent(opts.requestId)}/review`, {
    method: "PATCH",
    body: JSON.stringify({
      status: opts.decision,
      reviewComment: opts.reviewComment?.trim() || null,
    }),
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`Leave review API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }

  void postSystemAuditLog({
    action: AUDIT_ACTION_LEAVE_REQUEST_UPDATE,
    resourceType: "agent_leave_request",
    resourceId: opts.requestId,
    details: {
      status: opts.decision,
      hasReviewComment: Boolean(opts.reviewComment?.trim()),
    },
  }).catch(() => {});
}

export function subscribeToMyLeaveRequests(
  userId: string,
  onChange: (row: AgentLeaveRequestRow, event: "INSERT" | "UPDATE" | "DELETE") => void,
): () => void {
  const channel = supabase
    .channel(`leave-requests-self-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "agent_leave_requests",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const ev = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        if (ev === "DELETE") {
          const oldRow = payload.old as AgentLeaveRequestRow | undefined;
          if (oldRow?.id) onChange(oldRow, "DELETE");
          return;
        }
        const row = payload.new as AgentLeaveRequestRow;
        if (row) onChange(row, ev);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToAllLeaveRequestChanges(
  onChange: (row: AgentLeaveRequestRow, event: "INSERT" | "UPDATE" | "DELETE") => void,
): () => void {
  const channel = supabase
    .channel("leave-requests-super-admin")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "agent_leave_requests",
      },
      (payload) => {
        const ev = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        if (ev === "DELETE") {
          const oldRow = payload.old as AgentLeaveRequestRow | undefined;
          if (oldRow?.id) onChange(oldRow, "DELETE");
          return;
        }
        const row = payload.new as AgentLeaveRequestRow;
        if (row) onChange(row, ev);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
