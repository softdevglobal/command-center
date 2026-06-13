import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  CalendarPlus2,
  CarFront,
  History,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Send,
  StickyNote,
  UserRound,
  Wrench,
} from "lucide-react";
import type {
  Agent,
  CallerContext,
  IncomingCall,
  Queue,
  ServiceRecord,
  Tenant,
  VehicleRecord,
  WorkshopUserRole,
} from "@/services/types";
import { fetchAgentByCallerNumber } from "@/services/dashboardApi";
import { fetchFirebaseCallerContext } from "@/services/customersApi";
import { getDIDMappingByDid } from "@/services/didMappingsApi";
import {
  fetchCallCenterChatMessages,
  postCallCenterChatMessage,
  startCallCenterChatWithOwner,
  type ChatMessage,
} from "@/services/chatApi";
import {
  getServicesByBranch,
  type WorkshopService,
} from "@/services/servicesApi";
import { formatDuration, formatPhone } from "@/utils/formatters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { sendBlueCallNote } from "@/services/blueNotesApi";

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

// ?? SessionStorage persistence for call detail across page navigation ??
const CALL_DETAIL_STORAGE_KEY = 'cc_active_call_detail';
const BLUE_INSPECTION_REQUEST_PATH = "/trade";

export function saveCallDetailToSession(detail: CallDetailSnapshot): void {
  try {
    sessionStorage.setItem(CALL_DETAIL_STORAGE_KEY, JSON.stringify(detail));
  } catch { /* ignore quota errors */ }
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
  } catch { /* ignore */ }
}

interface CallDetailsSheetProps {
  detail: CallDetailSnapshot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    agentOrGroupLabel: `Agent: ${agent.name}${agent.extension ? ` ? Ext ${agent.extension}` : ""}`,
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

export function CallDetailsSheet({
  detail,
  open,
  onOpenChange,
}: CallDetailsSheetProps) {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [callerContext, setCallerContext] = useState<CallerContext | null>(
    null,
  );
  /** Supabase `agents.phone_number` match for this caller (separate from Firebase customer). */
  const [matchedAgent, setMatchedAgent] = useState<Agent | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const [branchServices, setBranchServices] = useState<
    WorkshopService[] | null
  >(null);
  const [branchServicesLoading, setBranchServicesLoading] = useState(false);
  const [mappedDetail, setMappedDetail] = useState<Partial<CallDetailSnapshot> | null>(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [blueNote, setBlueNote] = useState("");
  const [blueNoteSending, setBlueNoteSending] = useState(false);
  const [blueNoteMessage, setBlueNoteMessage] = useState<string | null>(null);
  const [blueNoteError, setBlueNoteError] = useState<string | null>(null);
  const [workshopChatOpen, setWorkshopChatOpen] = useState(false);
  const [workshopChatId, setWorkshopChatId] = useState<string | null>(null);
  const [workshopChatMessages, setWorkshopChatMessages] = useState<ChatMessage[]>([]);
  const [workshopChatLoading, setWorkshopChatLoading] = useState(false);
  const [workshopChatError, setWorkshopChatError] = useState<string | null>(null);
  const [workshopChatDraft, setWorkshopChatDraft] = useState("");
  const [workshopChatSending, setWorkshopChatSending] = useState(false);
  const workshopChatScrollRef = useRef<HTMLDivElement>(null);
  const commandButtons = useMemo(
    () => [
      { label: "Book Now", icon: CalendarPlus2 },
      { label: "Booking Details", icon: CalendarCheck },
      { label: "Workshop Chat", icon: MessageSquare },
    ],
    [],
  );

  const effectiveDetail = useMemo(() => {
    if (!detail || !mappedDetail) return detail;
    return {
      ...detail,
      ...mappedDetail,
      did: detail.did || mappedDetail.did || "",
      didLabel: mappedDetail.didLabel || detail.didLabel,
      branchId: mappedDetail.branchId || detail.branchId,
      branchName: mappedDetail.branchName || detail.branchName,
      mappingWorkshopName:
        mappedDetail.mappingWorkshopName || detail.mappingWorkshopName,
      ownerId: mappedDetail.ownerId || detail.ownerId,
      tenantId: mappedDetail.tenantId || detail.tenantId,
      queueKind: detail.queueKind,
    };
  }, [detail, mappedDetail]);

  const isBlueDetail = effectiveDetail?.queueKind === "blue";

  useEffect(() => {
    let cancelled = false;

    if (!open || !detail) {
      setMappedDetail(null);
      setMappingLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (detail.ownerId && detail.branchId) {
      setMappedDetail(null);
      setMappingLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const candidates = [detail.did, detail.didLabel]
      .map((value) => String(value ?? "").trim())
      .filter((value, index, all) => value && all.indexOf(value) === index);

    if (candidates.length === 0) {
      setMappedDetail(null);
      setMappingLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setMappingLoading(true);
    setMappedDetail(null);

    (async () => {
      for (const candidate of candidates) {
        try {
          const mapping = await getDIDMappingByDid(candidate);
          if (!mapping) continue;
          if (cancelled) return;
          setMappedDetail({
            did: mapping.did,
            didLabel: mapping.label || detail.didLabel || mapping.did,
            tenantId: mapping.tenantId || detail.tenantId,
            branchId: mapping.branchId,
            branchName: mapping.branchName,
            mappingWorkshopName: mapping.mappingWorkshopName,
            ownerId: mapping.ownerId,
          });
          return;
        } catch {
          // Try the next candidate. A missing mapping should not block call details.
        }
      }
    })().finally(() => {
      if (!cancelled) setMappingLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    detail?.branchId,
    detail?.did,
    detail?.didLabel,
    detail?.id,
    detail?.ownerId,
    detail?.tenantId,
    detail,
    open,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!open || !effectiveDetail?.customerPhone || isBlueDetail) {
      setCallerContext(null);
      setMatchedAgent(null);
      setContextError(null);
      setContextLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setContextLoading(true);
    setContextError(null);
    setCallerContext(null);
    setMatchedAgent(null);

    const ownerKey = effectiveDetail.ownerId || effectiveDetail.tenantId;
    const firebasePromise = ownerKey
      ? fetchFirebaseCallerContext(ownerKey, effectiveDetail.customerPhone)
      : Promise.resolve(null);
    const agentPromise = fetchAgentByCallerNumber(
      effectiveDetail.customerPhone,
      effectiveDetail.tenantId,
    );

    Promise.allSettled([firebasePromise, agentPromise])
      .then((results) => {
        if (cancelled) return;
        const [fbRes, agentRes] = results;
        setCallerContext(fbRes.status === "fulfilled" ? fbRes.value : null);
        setMatchedAgent(agentRes.status === "fulfilled" ? agentRes.value : null);
        const fbFail = fbRes.status === "rejected" ? fbRes.reason : null;
        const agFail = agentRes.status === "rejected" ? agentRes.reason : null;
        if (fbFail && agFail) {
          const err = fbFail ?? agFail;
          setContextError(
            err instanceof Error ? err.message : "Failed to load caller context",
          );
        } else {
          setContextError(null);
        }
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    effectiveDetail?.id,
    effectiveDetail?.tenantId,
    effectiveDetail?.ownerId,
    effectiveDetail?.customerPhone,
    isBlueDetail,
    open,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (
      !open ||
      isBlueDetail ||
      !effectiveDetail?.branchId ||
      !effectiveDetail?.ownerId
    ) {
      setBranchServices(null);
      setBranchServicesLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setBranchServicesLoading(true);

    getServicesByBranch(effectiveDetail.ownerId, effectiveDetail.branchId)
      .then((services) => {
        if (!cancelled) setBranchServices(services);
      })
      .catch(() => {
        // console.error("Failed to load branch services", error);
      })
      .finally(() => {
        if (!cancelled) setBranchServicesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveDetail?.branchId, effectiveDetail?.ownerId, isBlueDetail, open]);

  useEffect(() => {
    if (!open) return;
    setBlueNote("");
    setBlueNoteMessage(null);
    setBlueNoteError(null);
    setBlueNoteSending(false);
  }, [detail?.id, open]);

  useEffect(() => {
    setWorkshopChatOpen(false);
    setWorkshopChatId(null);
    setWorkshopChatMessages([]);
    setWorkshopChatError(null);
    setWorkshopChatDraft("");
    setWorkshopChatLoading(false);
    setWorkshopChatSending(false);
  }, [detail?.id]);

  useEffect(() => {
    if (!open) {
      setWorkshopChatOpen(false);
      setWorkshopChatId(null);
      setWorkshopChatMessages([]);
      setWorkshopChatError(null);
      setWorkshopChatDraft("");
      setWorkshopChatLoading(false);
      setWorkshopChatSending(false);
    }
  }, [open]);

  useEffect(() => {
    if (!workshopChatOpen) return;
    const container = workshopChatScrollRef.current;
    if (!container) return;

    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [workshopChatMessages, workshopChatLoading, workshopChatOpen]);

  useEffect(() => {
    if (!workshopChatOpen || !workshopChatId) return;
    const id = workshopChatId;
    const interval = setInterval(() => {
      fetchCallCenterChatMessages(id)
        .then(setWorkshopChatMessages)
        .catch(() => {
          /* keep existing messages while polling */
        });
    }, 5_000);
    return () => clearInterval(interval);
  }, [workshopChatId, workshopChatOpen]);


  const resolvedCustomerName =
    callerContext?.customer.name ||
    matchedAgent?.name ||
    normalizeCustomerName(effectiveDetail?.customerName);
  const resolvedCustomerEmail =
    callerContext?.customer.email || matchedAgent?.email || "";
  const availableVehicles = callerContext?.vehicles || [];
  const hasKnownProfile = Boolean(callerContext) || Boolean(matchedAgent);
  const statusTone = isBlueDetail
    ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
    : hasKnownProfile
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  const matchedAgentWorkshop =
    matchedAgent?.tenantName ||
    effectiveDetail?.mappingWorkshopName ||
    effectiveDetail?.workshopName ||
    "";
  const matchedAgentRoleLabel = matchedAgent
    ? formatMatchedAgentRole(matchedAgent)
    : "";
  const statusLabel = isBlueDetail
    ? "Blue Queue"
    : callerContext
      ? "Known Customer"
      : matchedAgent
        ? "Command Centre Agent"
        : contextLoading
          ? "Searching..."
          : "Unknown Caller";
  const sortedWorkshopChatMessages = useMemo(
    () =>
      [...workshopChatMessages].sort((a, b) => {
        const ta = parseChatTime(a.createdAt);
        const tb = parseChatTime(b.createdAt);
        return ta !== tb ? ta - tb : (a.messageId || "").localeCompare(b.messageId || "");
      }),
    [workshopChatMessages],
  );
  if (!effectiveDetail) return null;
  const activeDetail = effectiveDetail;
  const isBlueCall = activeDetail.queueKind === "blue";
  const businessName =
    (activeDetail.mappingWorkshopName || activeDetail.workshopName || "Unknown business") +
    (activeDetail.branchName ? ` - ${activeDetail.branchName}` : "");

  function handleCreateBlueInspectionRequest() {
    saveCallDetailToSession(activeDetail);
    navigate(BLUE_INSPECTION_REQUEST_PATH, {
      state: {
        source: "blue-call-inspection-request",
        callId: activeDetail.id,
        customerName: resolvedCustomerName,
        callerNumber: activeDetail.customerPhone,
        businessId: activeDetail.ownerId || "",
        businessName,
        did: activeDetail.did || activeDetail.didLabel,
        didLabel: activeDetail.didLabel,
        queueId: activeDetail.queueId,
        queueName: activeDetail.queueName,
        tenantId: activeDetail.tenantId,
        ownerId: activeDetail.ownerId || "",
        agentUserId: session?.userId ?? null,
        agentName: session?.displayName ?? null,
      },
    });
  }

  async function handleOpenWorkshopChat() {
    const ownerUid = activeDetail.ownerId.trim();
    if (!ownerUid || workshopChatLoading) return;

    setWorkshopChatOpen(true);
    setWorkshopChatError(null);

    if (workshopChatId) {
      setWorkshopChatLoading(true);
      try {
        const rows = await fetchCallCenterChatMessages(workshopChatId);
        setWorkshopChatMessages(rows);
      } catch (err) {
        setWorkshopChatError(err instanceof Error ? err.message : "Failed to load workshop chat.");
      } finally {
        setWorkshopChatLoading(false);
      }
      return;
    }

    setWorkshopChatLoading(true);
    try {
      const started = await startCallCenterChatWithOwner(ownerUid, undefined, {
        branchId: activeDetail.branchId,
        branchName: activeDetail.branchName,
      });
      const chatId = started.chatId || started.conversationId || "";
      if (!chatId) throw new Error("Chat API did not return a chat id.");
      setWorkshopChatId(chatId);
      const rows = await fetchCallCenterChatMessages(chatId);
      setWorkshopChatMessages(rows);
    } catch (err) {
      setWorkshopChatError(err instanceof Error ? err.message : "Failed to open workshop chat.");
    } finally {
      setWorkshopChatLoading(false);
    }
  }

  async function handleSendWorkshopChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = workshopChatDraft.trim();
    if (!text || !workshopChatId || workshopChatSending) return;

    setWorkshopChatSending(true);
    setWorkshopChatError(null);
    try {
      const created = await postCallCenterChatMessage(workshopChatId, text);
      setWorkshopChatDraft("");
      if (created) {
        setWorkshopChatMessages((prev) => {
          const id = created.messageId?.trim();
          if (id && prev.some((m) => m.messageId === id)) return prev;
          return [...prev, created];
        });
      } else {
        const rows = await fetchCallCenterChatMessages(workshopChatId);
        setWorkshopChatMessages(rows);
      }
    } catch (err) {
      setWorkshopChatError(err instanceof Error ? err.message : "Failed to send workshop chat message.");
    } finally {
      setWorkshopChatSending(false);
    }
  }

  async function handleBlueNoteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isBlueCall) return;

    const note = blueNote.trim();
    if (!note) {
      setBlueNoteError("Add a note before sending.");
      setBlueNoteMessage(null);
      return;
    }

    setBlueNoteSending(true);
    setBlueNoteError(null);
    setBlueNoteMessage(null);

    try {
      await sendBlueCallNote({
        callId: activeDetail.id,
        customerName: resolvedCustomerName,
        businessName,
        callerNumber: activeDetail.customerPhone,
        did: activeDetail.did || activeDetail.didLabel,
        didLabel: activeDetail.didLabel,
        queueId: activeDetail.queueId,
        queueName: activeDetail.queueName,
        tenantId: activeDetail.tenantId,
        ownerId: activeDetail.ownerId || null,
        branchId: activeDetail.branchId || null,
        branchName: activeDetail.branchName || null,
        agentUserId: session?.userId ?? null,
        agentName: session?.displayName ?? null,
        note,
      });
      setBlueNote("");
      setBlueNoteMessage("Note sent to the Blue business admin.");
    } catch (err) {
      setBlueNoteError(
        err instanceof Error ? err.message : "Failed to send Blue note.",
      );
    } finally {
      setBlueNoteSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="w-full border-l border-slate-200 bg-slate-50 p-0 sm:max-w-2xl"
        preventClose
      >
        <ScrollArea className="h-full">
          <div className="min-h-full">
            <SheetHeader className="border-b border-slate-200 bg-white px-6 py-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="rounded-full border-0 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]"
                  style={{
                    color: activeDetail.workshopColor,
                    background: `${activeDetail.workshopColor}18`,
                  }}
                >
                  {activeDetail.mode === "incoming" ? "Incoming Call" : "Live Call"}
                </Badge>
                <div
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${statusTone}`}
                >
                  <UserRound className="h-3.5 w-3.5" />
                  {statusLabel}
                </div>
              </div>
              <SheetTitle className="mt-3 text-2xl">
                {resolvedCustomerName}
              </SheetTitle>
              <SheetDescription className="text-sm text-slate-600">
                {activeDetail.callStatusText}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 p-6">
              {!isBlueCall && matchedAgent ? (
                <Card className="border-sky-200 bg-sky-50/40 shadow-sm ring-1 ring-sky-100">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-sky-950">
                      Matched agent
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 pt-0 text-sm text-slate-800 sm:grid-cols-3">
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        Name
                      </div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">
                        {matchedAgent.name}
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        Workshop
                      </div>
                      <div className="mt-1 font-semibold text-slate-950">
                        {matchedAgentWorkshop || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        Role
                      </div>
                      <div className="mt-1 font-semibold text-slate-950">
                        {matchedAgentRoleLabel || "-"}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              <Card className="border-slate-200 bg-white shadow-sm">
                <CardContent className="grid gap-4 p-6 md:grid-cols-2">
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      {isBlueCall ? "Business" : "Workshop / Branch"}
                    </div>
                    <div className="mt-2 text-lg font-semibold text-slate-950">
                      {isBlueCall
                        ? businessName
                        : (activeDetail.mappingWorkshopName || activeDetail.workshopName) +
                          (activeDetail.branchName ? ` - ${activeDetail.branchName}` : "")}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {activeDetail.queueName}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      Caller
                    </div>
                    <div className="mt-2 text-lg font-semibold text-slate-950">
                      {formatPhone(activeDetail.customerPhone)}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {activeDetail.agentOrGroupLabel}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      {isBlueCall ? "Queue" : "Profile Status"}
                    </div>
                    <div className="mt-2 text-sm font-medium text-slate-900">
                      {isBlueCall ? activeDetail.queueName : statusLabel}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      Line / DID
                    </div>
                    <div className="mt-2 text-sm font-medium text-slate-900">
                      {activeDetail.did || activeDetail.didLabel}
                      {activeDetail.did &&
                      activeDetail.didLabel &&
                      activeDetail.didLabel !== activeDetail.did ? (
                        <span className="ml-2 text-slate-500">
                          ({activeDetail.didLabel})
                        </span>
                      ) : null}
                      {mappingLoading ? (
                        <span className="ml-2 text-xs text-slate-400">
                          loading mapping...
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {!isBlueCall && activeDetail.ownerId && (
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        Owner ID
                      </div>
                      {/* <div className="mt-2 text-sm font-medium text-slate-900 font-mono text-xs">
                        {activeDetail.ownerId}
                      </div> */}
                    </div>
                  )}
                  {!isBlueCall && callerContext?.customer.email && (
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        Email
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-sm font-medium text-slate-900">
                        <Mail className="h-4 w-4 text-slate-500" />
                        {callerContext.customer.email}
                      </div>
                    </div>
                  )}
                  {!isBlueCall && callerContext?.customer.address && (
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        Address
                      </div>
                      <div className="mt-2 flex items-start gap-2 text-sm font-medium text-slate-900">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                        <span>{callerContext.customer.address}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {isBlueCall ? (
                <>
                  <Card className="border-blue-200 bg-blue-50/70 shadow-sm ring-1 ring-blue-100">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base text-blue-950">
                        <Wrench className="h-4 w-4 text-blue-600" />
                        Inspection request
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0">
                      <p className="text-sm text-blue-900/80">
                        Open Trade to load all inspection requests for the mapped Blue
                        business. New requests are created from the inspection requests page.
                      </p>
                      {!activeDetail.ownerId && !mappingLoading ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          No Blue business id is mapped to this DID yet.
                        </div>
                      ) : null}
                      <Button
                        type="button"
                        className="bg-blue-600 text-white hover:bg-blue-700"
                        onClick={handleCreateBlueInspectionRequest}
                        disabled={mappingLoading || !activeDetail.ownerId}
                      >
                        <Wrench className="h-4 w-4" />
                        View inspection requests
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="border-blue-200 bg-white shadow-sm ring-1 ring-blue-100">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base text-blue-950">
                        <StickyNote className="h-4 w-4 text-blue-600" />
                        Blue call note
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <form className="space-y-4" onSubmit={handleBlueNoteSubmit}>
                        <Textarea
                          value={blueNote}
                          onChange={(event) => {
                            setBlueNote(event.target.value);
                            setBlueNoteError(null);
                            setBlueNoteMessage(null);
                          }}
                          placeholder="Type notes for the Blue business admin..."
                          className="min-h-[180px] resize-y bg-white"
                          disabled={blueNoteSending}
                        />
                        {blueNoteError ? (
                          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {blueNoteError}
                          </div>
                        ) : null}
                        {blueNoteMessage ? (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                            {blueNoteMessage}
                          </div>
                        ) : null}
                        <Button
                          type="submit"
                          className="bg-blue-600 text-white hover:bg-blue-700"
                          disabled={blueNoteSending}
                        >
                          {blueNoteSending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          Send to Blue admin
                        </Button>
                      </form>
                    </CardContent>
                  </Card>

                  <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 px-4 py-3 text-sm text-blue-900">
                    Booking commands and booking history are hidden for this Blue queue. Use the
                    inspection request action to continue in Trade.
                  </div>
                </>
              ) : (
                <>
                  {callerContext?.customer.notes && (
                    <Card className="border-slate-200 bg-white shadow-sm">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Customer Notes</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0 text-sm text-slate-700">
                        {callerContext.customer.notes}
                      </CardContent>
                    </Card>
                  )}

                  <Card className="border-slate-200 bg-white shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">System Commands</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {commandButtons.map((command) => {
                        const Icon = command.icon;
                        return (
                          <Button
                            key={command.label}
                            variant={
                              command.label === "Book Now" ? "default" : "outline"
                            }
                            className="justify-start"
                            disabled={
                              command.label === "Workshop Chat"
                                ? mappingLoading ||
                                  workshopChatLoading ||
                                  !activeDetail.ownerId
                                : (command.label === "Book Now" ||
                                    command.label === "Booking Details") &&
                                  (mappingLoading ||
                                    !activeDetail.ownerId ||
                                    !activeDetail.branchId)
                            }
                            title={
                              command.label === "Workshop Chat" &&
                              !activeDetail.ownerId
                                ? "No DID workshop owner mapping found for this call"
                                : undefined
                            }
                            onClick={() => {
                              if (command.label === "Book Now") {
                                saveCallDetailToSession(activeDetail);
                                navigate("/booking", {
                                  state: {
                                    tenantId: activeDetail.tenantId ?? "",
                                    customerId: callerContext?.customer.id ?? null,
                                    customerName: resolvedCustomerName ?? "",
                                    customerPhone: activeDetail.customerPhone ?? "",
                                    customerEmail: resolvedCustomerEmail ?? "",
                                    availableVehicles: availableVehicles,
                                    workshopName:
                                      activeDetail.mappingWorkshopName ||
                                      activeDetail.workshopName ||
                                      "",
                                    workshopColor: activeDetail.workshopColor ?? "",
                                    branchId: activeDetail.branchId ?? "",
                                    ownerId: activeDetail.ownerId ?? "",
                                  },
                                });
                                return;
                              }
                              if (command.label === "Booking Details") {
                                saveCallDetailToSession(activeDetail);
                                navigate("/bookings/dashboard", {
                                  state: {
                                    ownerId: activeDetail.ownerId ?? "",
                                    branchId: activeDetail.branchId ?? "",
                                  },
                                });
                                return;
                              }
                              if (command.label === "Workshop Chat") {
                                void handleOpenWorkshopChat();
                                return;
                              }
                            }}
                          >
                            <Icon className="h-4 w-4" />
                            {command.label}
                          </Button>
                        );
                      })}
                    </CardContent>
                  </Card>

                  {workshopChatOpen && (
                    <Card className="border-sky-200 bg-white shadow-sm ring-1 ring-sky-100">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center justify-between gap-3 text-base">
                          <span className="flex min-w-0 items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-sky-600" />
                            <span className="truncate">
                              Workshop Chat
                              {activeDetail.branchName ? ` - ${activeDetail.branchName}` : ""}
                            </span>
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0"
                            onClick={() => void handleOpenWorkshopChat()}
                            disabled={workshopChatLoading}
                          >
                            {workshopChatLoading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "Refresh"
                            )}
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-0">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          Chat opened from DID {activeDetail.did || activeDetail.didLabel || "-"} for{" "}
                          {activeDetail.mappingWorkshopName || activeDetail.workshopName || "workshop"}
                          {activeDetail.branchName ? ` / ${activeDetail.branchName}` : ""}.
                        </div>

                        {workshopChatError && (
                          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                            {workshopChatError}
                          </div>
                        )}

                        <div
                          ref={workshopChatScrollRef}
                          className="flex max-h-80 min-h-48 flex-col overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                        >
                          {workshopChatLoading && sortedWorkshopChatMessages.length === 0 ? (
                            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Opening workshop chat...
                            </div>
                          ) : sortedWorkshopChatMessages.length === 0 ? (
                            <div className="flex flex-1 items-center justify-center text-center text-sm text-slate-500">
                              No messages yet. Start the conversation below.
                            </div>
                          ) : (
                            <ul className="space-y-3">
                              {sortedWorkshopChatMessages.map((message, index) => {
                                const agentMessage = isWorkshopChatAgentMessage(message);
                                return (
                                  <li
                                    key={
                                      message.messageId?.trim() ||
                                      `workshop-chat-${index}-${message.createdAt}`
                                    }
                                    className={`flex ${agentMessage ? "justify-end" : "justify-start"}`}
                                  >
                                    <div
                                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                                        agentMessage
                                          ? "rounded-br-md bg-sky-600 text-white"
                                          : "rounded-bl-md border border-slate-200 bg-white text-slate-800"
                                      }`}
                                    >
                                      <p className="whitespace-pre-wrap break-words">
                                        {message.text}
                                      </p>
                                      <div
                                        className={`mt-1 text-[10px] ${
                                          agentMessage ? "text-sky-100" : "text-slate-400"
                                        }`}
                                      >
                                        {formatChatTime(message.createdAt) || "Just now"}
                                      </div>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>

                        <form
                          onSubmit={(event) => void handleSendWorkshopChat(event)}
                          className="flex gap-2"
                        >
                          <Input
                            value={workshopChatDraft}
                            onChange={(event) => setWorkshopChatDraft(event.target.value)}
                            placeholder="Type a message to the workshop..."
                            disabled={!workshopChatId || workshopChatLoading || workshopChatSending}
                            autoComplete="off"
                          />
                          <Button
                            type="submit"
                            className="shrink-0 gap-1.5 bg-sky-600 hover:bg-sky-700"
                            disabled={
                              !workshopChatId ||
                              workshopChatLoading ||
                              workshopChatSending ||
                              !workshopChatDraft.trim()
                            }
                          >
                            {workshopChatSending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                            Send
                          </Button>
                        </form>
                      </CardContent>
                    </Card>
                  )}

                  <Tabs defaultValue="vehicles" className="space-y-4">
                    <TabsList className="grid h-auto grid-cols-2 rounded-xl bg-slate-200/70 p-1">
                      <TabsTrigger value="vehicles" className="rounded-lg">
                        Vehicles &amp; History
                      </TabsTrigger>
                      <TabsTrigger value="branch-services" className="rounded-lg">
                        Branch Services
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="vehicles" className="mt-0">
                      {contextLoading ? (
                        <Card className="border-slate-200 bg-white shadow-sm">
                          <CardContent className="p-5 text-sm text-slate-600">
                            Loading caller vehicles and history...
                          </CardContent>
                        </Card>
                      ) : callerContext?.vehicles.length ? (
                        <div className="space-y-4">
                          {callerContext.vehicles.map((vehicle) => {
                            const vehicleServices = (callerContext.services || []).filter(
                              (s) => s.vehicleId === vehicle.id,
                            );
                            return (
                              <VehicleCard
                                key={vehicle.id}
                                vehicle={vehicle}
                                services={vehicleServices}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <Card className="border-slate-200 bg-white shadow-sm">
                          <CardContent className="p-5">
                            <EmptyState
                              message={
                                contextError ||
                                "No vehicles found for this caller yet."
                              }
                            />
                          </CardContent>
                        </Card>
                      )}
                    </TabsContent>

                    <TabsContent value="branch-services" className="mt-0">
                      <Card className="border-slate-200 bg-white shadow-sm">
                        <CardContent className="space-y-4 p-5">
                          {branchServicesLoading ? (
                            <div className="text-sm text-slate-600">
                              Loading branch services...
                            </div>
                          ) : branchServices?.length ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                              {branchServices.map((service) => (
                                <div
                                  key={service.id}
                                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                                >
                                  <div className="font-semibold text-slate-900">
                                    {service.name}
                                  </div>
                                  <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                                    <span>{service.duration} mins</span>
                                    <div className="h-1 w-1 rounded-full bg-slate-300" />
                                    <span>${service.price}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <EmptyState message="No services found for this branch." />
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>

                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
                    Quick context: workshop vehicles and history come from Firebase
                    bookings for this number. The command-centre agent roster in
                    Supabase is also checked so internal or team calls match by
                    extension or roster phone.
                  </div>
                </>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function workshopUserRoleLabel(role: WorkshopUserRole | null | undefined): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "branch_admin":
      return "Branch admin";
    case "staff":
      return "Staff";
    default:
      return "";
  }
}

/** BMS workshop role from `agents.workshop_user_role` only. */
function formatMatchedAgentRole(agent: Agent): string {
  return workshopUserRoleLabel(agent.workshopUserRole);
}

function normalizeCustomerName(name?: string | null): string {
  return name && name.trim() ? name.trim() : "Unknown caller";
}

function parseChatTime(value: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return parsed;
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return value.length <= 10 ? n * 1000 : n;
  }
  return 0;
}

function formatChatTime(value: string): string {
  const time = parseChatTime(value);
  if (!time) return "";
  return new Date(time).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isWorkshopChatAgentMessage(message: ChatMessage): boolean {
  const role = message.senderRole?.trim().toLowerCase();
  return !role || role === "agent" || role === "call-center" || role === "call_center";
}


function formatVehicleLabel(vehicle: VehicleRecord): string {
  const parts = [
    vehicle.year ? String(vehicle.year) : null,
    vehicle.make,
    vehicle.model,
  ].filter(Boolean);
  return parts.join(" ") || "Vehicle";
}

function formatServiceDate(serviceDate: string): string {
  const parsed = new Date(serviceDate);
  if (Number.isNaN(parsed.getTime())) return serviceDate;
  return parsed.toLocaleDateString();
}

function formatAmount(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  }).format(amount);
}


function VehicleCard({
  vehicle,
  services,
}: {
  vehicle: VehicleRecord;
  services: ServiceRecord[];
}) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="p-5">
        {/* Vehicle header */}
        <div className="flex items-center gap-3 pb-4">
          <div className="rounded-xl bg-slate-100 p-2 text-slate-700">
            <CarFront className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-slate-950">{vehicle.rego}</div>
            <div className="text-sm text-slate-600">
              {formatVehicleLabel(vehicle)}
            </div>
            {vehicle.notes && (
              <div className="mt-0.5 text-sm text-slate-500">{vehicle.notes}</div>
            )}
          </div>
          <div className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {services.length} {services.length === 1 ? "visit" : "visits"}
          </div>
        </div>

        {/* Service history timeline for this vehicle */}
        {services.length > 0 ? (
          <div className="border-t border-slate-100 pt-3 space-y-0">
            {services.map((service, index) => (
              <div key={service.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="mt-0.5 rounded-full bg-slate-100 p-1.5 text-slate-600">
                    {index === 0 ? (
                      <Wrench className="h-3.5 w-3.5" />
                    ) : (
                      <History className="h-3.5 w-3.5" />
                    )}
                  </div>
                  {index < services.length - 1 && (
                    <div className="mt-1 mb-1 h-full min-h-[16px] w-px bg-slate-200" />
                  )}
                </div>
                <div className="pb-3">
                  <div className="text-sm font-semibold text-slate-900">
                    {service.serviceType}
                  </div>
                  <div className="text-xs text-slate-500">
                    {[
                      service.odometerKm != null
                        ? `${service.odometerKm.toLocaleString()} km`
                        : null,
                      formatAmount(service.amount),
                    ]
                      .filter(Boolean)
                      .join(" ? ")}
                  </div>
                  {service.advisorNotes && (
                    <div className="mt-0.5 text-xs text-slate-500 italic">
                      {service.advisorNotes}
                    </div>
                  )}
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    {formatServiceDate(service.serviceDate)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border-t border-slate-100 pt-3 text-sm text-slate-400 italic">
            No service history for this vehicle yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
