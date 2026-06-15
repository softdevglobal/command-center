import {
  BMS_BLACK_API_URL,
  bmsBlackFetch,
  bmsBlackHeaders,
} from "@/services/bmsBlackApi";

const BASE_URL = BMS_BLACK_API_URL;

export interface BlackCallNotePayload {
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
}

export async function saveBlackCallNote(
  payload: BlackCallNotePayload,
): Promise<unknown> {
  const res = await bmsBlackFetch(`${BASE_URL}/call-notes`, {
    method: "POST",
    headers: bmsBlackHeaders(payload.ownerId),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await readBlackNotesError(res));
  }

  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

async function readBlackNotesError(res: Response): Promise<string> {
  const fallback = `Black call note save failed (${res.status}).`;
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
