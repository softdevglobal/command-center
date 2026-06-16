import {
  API_BASE,
  apiFetch,
  getAccessToken,
} from "@/lib/api";

const AGENT_ACTIVITIES_URL =
  (import.meta.env.VITE_BLACK_AGENT_ACTIVITIES_API_URL as string | undefined)
    ?.trim()
    .replace(/\/+$/, "") ||
  `${API_BASE}/bms-black/agent-activities`;

export interface BlackAgentActivityPayload {
  activityType: "call_note";
  callId: string;
  agentName: string;
  agentUserId: string | null;
  callerNumber: string;
  callerName: string;
  agentNote: string;
  note: string;
  didNumber: string;
  ownerId: string;
  branchId: string;
  branchName: string | null;
  queueId: string;
  queueName: string;
  tenantId: string;
  /** Yeastar CDR recording path/URL — backend fetches and stores the audio file. */
  recordingUrl?: string | null;
  /** Supabase CDR row id (`yeastar-…`) when recording is linked. */
  recordingCallId?: string | null;
}

export interface BlackCallRecordingFile {
  blob: Blob;
  fileName: string;
  recordingUrl?: string | null;
  recordingCallId?: string | null;
}

export async function saveBlackCallNote(
  payload: Omit<
    BlackAgentActivityPayload,
    "activityType" | "note"
  > & {
    agentNote: string;
    recordingUrl?: string | null;
    recordingCallId?: string | null;
  },
): Promise<unknown> {
  const body: BlackAgentActivityPayload = {
    ...payload,
    activityType: "call_note",
    note: payload.agentNote,
    recordingUrl: payload.recordingUrl?.trim() || null,
    recordingCallId: payload.recordingCallId?.trim() || null,
  };

  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  const tenant = payload.ownerId?.trim();
  if (tenant) headers.set("X-Tenant-Id", tenant);

  const res = await apiFetch(AGENT_ACTIVITIES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(await readBlackActivityError(res));
  }

  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

export async function saveBlackCallNoteWithRecording(
  payload: Omit<
    BlackAgentActivityPayload,
    "activityType" | "note"
  > & {
    agentNote: string;
    recordingUrl?: string | null;
    recordingCallId?: string | null;
  },
  recording: BlackCallRecordingFile | null,
): Promise<unknown> {
  if (!recording) {
    return saveBlackCallNote(payload);
  }

  if (!getAccessToken()) {
    throw new Error("Sign in again to save the call note.");
  }

  const recordingUrl =
    recording.recordingUrl?.trim() || payload.recordingUrl?.trim() || "";
  const recordingCallId =
    recording.recordingCallId?.trim() || payload.recordingCallId?.trim() || "";

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
  form.set("recordingFileName", recording.fileName);
  form.set("recordingSizeBytes", String(recording.blob.size));
  if (recording.blob.type) form.set("recordingMimeType", recording.blob.type);
  if (recordingUrl) form.set("recordingUrl", recordingUrl);
  if (recordingCallId) form.set("recordingCallId", recordingCallId);
  // File field expected by the agent-activities upload endpoint.
  form.set("recording", recording.blob, recording.fileName);

  const headers = new Headers();
  const tenant = payload.ownerId?.trim();
  if (tenant) headers.set("X-Tenant-Id", tenant);

  const res = await apiFetch(AGENT_ACTIVITIES_URL, {
    method: "POST",
    headers,
    body: form,
  });

  if (!res.ok) {
    if (res.status === 413) {
      const detail = await readBlackActivityError(res);
      throw new Error(
        `Recording upload was rejected as too large (${formatBytes(recording.blob.size)}). A backend/proxy/upstream layer still has a low upload limit. ${detail}`,
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
    };
    return body.error || body.message || body.detail || fallback;
  } catch {
    return text.slice(0, 400) || fallback;
  }
}
