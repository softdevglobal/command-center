import { apiFetch } from "@/lib/api";

const BLUE_NOTES_ENDPOINT =
  (import.meta.env.VITE_BMS_BLUE_CALL_NOTES_API_URL as string | undefined)
    ?.trim()
    .replace(/\/+$/, "") ||
  (import.meta.env.VITE_BLUE_CALL_NOTES_API_URL as string | undefined)
    ?.trim()
    .replace(/\/+$/, "") ||
  "";

export interface BlueCallNotePayload {
  callId: string;
  customerName: string;
  businessName: string;
  callerNumber: string;
  did: string;
  didLabel: string;
  queueId: string;
  queueName: string;
  tenantId: string;
  ownerId: string | null;
  branchId: string | null;
  branchName: string | null;
  agentUserId: string | null;
  agentName: string | null;
  note: string;
}

export class BlueNotesEndpointNotConfiguredError extends Error {
  constructor() {
    super(
      "Blue notes endpoint is not configured. Set VITE_BMS_BLUE_CALL_NOTES_API_URL when the Blue admin API is ready.",
    );
    this.name = "BlueNotesEndpointNotConfiguredError";
  }
}

export async function sendBlueCallNote(
  payload: BlueCallNotePayload,
): Promise<unknown> {
  if (!BLUE_NOTES_ENDPOINT) {
    throw new BlueNotesEndpointNotConfiguredError();
  }

  const res = await apiFetch(BLUE_NOTES_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await readBlueNotesError(res));
  }

  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

async function readBlueNotesError(res: Response): Promise<string> {
  const fallback = `Blue note submission failed (${res.status}).`;
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
