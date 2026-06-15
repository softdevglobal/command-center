import type { Agent, IncomingCall, Queue, Tenant } from "@/services/types";
import { formatDuration } from "@/utils/formatters";

type CallSheetMode = "incoming" | "live";
export type CallQueueKind = "black" | "blue";

export interface CallDetailSnapshot {
  id: string;
  mode: CallSheetMode;
  tenantId: string;
  queueId: string;
  workshopName: string;
  workshopColor: string;
  queueName: string;
  queueKind: CallQueueKind;
  agentOrGroupLabel: string;
  customerName: string | null;
  customerPhone: string;
  callStatusText: string;
  did: string;
  didLabel: string;
  branchId: string;
  branchName: string;
  mappingWorkshopName: string;
  ownerId: string;
}

const CALL_DETAIL_STORAGE_KEY = "cc_active_call_detail";

export function saveCallDetailToSession(detail: CallDetailSnapshot): void {
  try {
    sessionStorage.setItem(CALL_DETAIL_STORAGE_KEY, JSON.stringify(detail));
  } catch {
    // Ignore quota errors.
  }
}

export function restoreCallDetailFromSession(): CallDetailSnapshot | null {
  try {
    const raw = sessionStorage.getItem(CALL_DETAIL_STORAGE_KEY);
    if (!raw) return null;
    const detail = JSON.parse(raw) as CallDetailSnapshot;
    return {
      ...detail,
      queueId: detail.queueId ?? "",
      queueKind:
        detail.queueKind ??
        detectCallQueueKind({ id: detail.queueId, name: detail.queueName }),
    };
  } catch {
    return null;
  }
}

export function clearCallDetailSession(): void {
  try {
    sessionStorage.removeItem(CALL_DETAIL_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function detectCallQueueKind(input: {
  id?: string | null;
  name?: string | null;
  type?: string | null;
}): CallQueueKind {
  const values = [input.id, input.name, input.type];
  return values.some((value) => hasQueueToken(value, "blue")) ? "blue" : "black";
}

function hasQueueToken(value: string | null | undefined, token: string): boolean {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized.split(/\s+/).includes(token);
}

export function buildIncomingCallSnapshot(
  call: IncomingCall,
  now: number,
  opts?: { showAsEnded?: boolean },
): CallDetailSnapshot {
  return {
    id: call.id,
    mode: "incoming",
    tenantId: call.tenantId,
    queueId: call.queueId,
    workshopName: call.tenantName,
    workshopColor: call.tenantBrandColor,
    queueName: call.queueName,
    queueKind: detectCallQueueKind({
      id: call.queueId,
      name: call.queueName,
    }),
    agentOrGroupLabel: `Group: ${call.groupName}`,
    customerPhone: call.callerNumber,
    customerName: call.callerName,
    did: call.did,
    didLabel: call.didLabel || call.did,
    branchId: call.branchId ?? "",
    branchName: call.branchName ?? "",
    mappingWorkshopName: call.mappingWorkshopName ?? "",
    ownerId: call.ownerId ?? "",
    callStatusText: opts?.showAsEnded
      ? "This call has ended; details stay available on the queue card briefly."
      : `Incoming for ${formatDuration(now - call.waitingSince)}`,
  };
}

export function buildLiveCallSnapshot(args: {
  agent: Agent;
  queues: Queue[];
  tenants: Tenant[];
  incomingCall?: IncomingCall | null;
  now: number;
}): CallDetailSnapshot {
  const { agent, queues, tenants, incomingCall, now } = args;
  const activeNumber = agent.currentCaller || incomingCall?.callerNumber || "";
  const queue = queues.find((entry) => agent.queueIds.includes(entry.id));
  const tenant = tenants.find((entry) => entry.id === agent.tenantId);
  const queueId = incomingCall?.queueId || queue?.id || agent.queueIds[0] || "";
  const queueName = incomingCall?.queueName || queue?.name || agent.queueName || "Live Queue";

  return {
    id: agent.id,
    mode: "live",
    tenantId: agent.tenantId,
    queueId,
    workshopName: tenant?.name || agent.tenantName || "Workshop",
    workshopColor: tenant?.brandColor || "var(--cc-color-cyan)",
    queueName,
    queueKind: detectCallQueueKind({
      id: queueId,
      name: queueName,
      type: queue?.type,
    }),
    agentOrGroupLabel: `Agent: ${agent.name}${agent.extension ? ` - Ext ${agent.extension}` : ""}`,
    customerPhone: activeNumber,
    customerName: incomingCall?.callerName ?? null,
    did: incomingCall?.did || "",
    didLabel:
      incomingCall?.didLabel ||
      incomingCall?.did ||
      queue?.name ||
      "Active line",
    branchId: incomingCall?.branchId ?? "",
    branchName: incomingCall?.branchName ?? "",
    mappingWorkshopName: incomingCall?.mappingWorkshopName ?? "",
    ownerId: incomingCall?.ownerId ?? "",
    callStatusText: `Live for ${agent.callStartTime ? formatDuration(now - agent.callStartTime) : "?"}`,
  };
}
