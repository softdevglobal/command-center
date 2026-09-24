import { API_BASE, apiFetch, apiUrl, getAccessToken } from "@/lib/api";

function resolveAgentActivitiesUrl(): string {
  const override = (import.meta.env.VITE_BLACK_AGENT_ACTIVITIES_API_URL as string | undefined)
    ?.trim()
    .replace(/\/+$/, "");
  if (!override) return apiUrl("/call-center/agent-activities");
  if (/^https?:\/\//i.test(override)) return override;
  if (override.startsWith("/")) return apiUrl(override);
  return apiUrl(`/${override}`);
}

const AGENT_ACTIVITIES_URL = resolveAgentActivitiesUrl();

export interface BlackAgentActivityPayload {
  callId: string;
  agentName: string;
  agentUserId: string | null;
  callerNumber: string;
  callerName: string;
  agentNote: string;
  didNumber: string;
  ownerId: string;
  branchId: string;
  branchName: string | null;
  queueId: string;
  queueName: string;
  tenantId: string;
  sourceRecordingUrl?: string | null;
  recordingCallId?: string | null;
}

export interface BlackCallRecordingFile {
  blob: Blob;
  fileName: string;
  sourceRecordingUrl: string;
  recordingCallId: string;
}

export async function saveBlackCallActivity(
  payload: BlackAgentActivityPayload,
  recording?: BlackCallRecordingFile | null,
): Promise<unknown> {
  if (!getAccessToken()) {
    throw new Error("Sign in again to save the call note.");
  }

  const form = new FormData();
  form.set("activityType", "call_note");
  form.set("callId", payload.callId);
  form.set("agentName", payload.agentName);
  if (payload.agentUserId) form.set("agentUserId", payload.agentUserId);
  form.set("callerNumber", payload.callerNumber);
  form.set("callerName", payload.callerName);
  form.set("agentNote", payload.agentNote);
  form.set("note", payload.agentNote);
  form.set("didNumber", payload.didNumber);
  form.set("ownerId", payload.ownerId);
  form.set("branchId", payload.branchId);
  if (payload.branchName) form.set("branchName", payload.branchName);
  form.set("queueId", payload.queueId);
  form.set("queueName", payload.queueName);
  form.set("tenantId", payload.tenantId);

  const sourceRecordingUrl =
    recording?.sourceRecordingUrl?.trim() || payload.sourceRecordingUrl?.trim() || "";
  const recordingCallId =
    recording?.recordingCallId?.trim() || payload.recordingCallId?.trim() || "";
  if (sourceRecordingUrl) form.set("sourceRecordingUrl", sourceRecordingUrl);
  if (recordingCallId) form.set("recordingCallId", recordingCallId);

  if (recording) {
    form.set("recordingFileName", recording.fileName);
    form.set("recordingSizeBytes", String(recording.blob.size));
    if (recording.blob.type) form.set("recordingMimeType", recording.blob.type);
    form.set("recording", recording.blob, recording.fileName);
  }

  const headers = new Headers({ Accept: "application/json" });
  const tenant = payload.ownerId?.trim();
  if (tenant) headers.set("X-Tenant-Id", tenant);

  const res = await apiFetch(AGENT_ACTIVITIES_URL, {
    method: "POST",
    headers,
    body: form,
    // Do not force logout on 401/403/404 from this route — show the error in the sheet instead.
    logoutOnSessionExpired: false,
  });

  if (!res.ok) {
    if (res.status === 413) {
      const detail = await readBlackActivityError(res);
      throw new Error(
        `Recording upload was rejected as too large${
          recording ? ` (${formatBytes(recording.blob.size)})` : ""
        }. ${detail}`,
      );
    }
    throw new Error(await readBlackActivityError(res));
  }

  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

async function readBlackActivityError(res: Response): Promise<string> {
  const fallback = `Black agent activity save failed (${res.status}).`;
  const text = await res.text().catch(() => "");
  if (!text.trim()) return fallback;

  try {
    const body = JSON.parse(text) as {
      error?: string;
      message?: string;
      detail?: string;
      hint?: string;
    };
    return body.error || body.message || body.detail || body.hint || fallback;
  } catch {
    return text.slice(0, 500) || fallback;
  }
}
