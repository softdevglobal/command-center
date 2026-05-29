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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type CallSheetMode = "incoming" | "live";

export interface CallDetailSnapshot {
  id: string;
  mode: CallSheetMode;
  tenantId: string;
  workshopName: string;
  workshopColor: string;
  queueName: string;
  agentOrGroupLabel: string;
  customerName: string | null;
  customerPhone: string;
  callStatusText: string;
  didLabel: string;
  branchId: string;
  branchName: string;
  mappingWorkshopName: string;
  ownerId: string;
}

// ?? SessionStorage persistence for call detail across page navigation ??
const CALL_DETAIL_STORAGE_KEY = 'cc_active_call_detail';

export function saveCallDetailToSession(detail: CallDetailSnapshot): void {
  try {
    sessionStorage.setItem(CALL_DETAIL_STORAGE_KEY, JSON.stringify(detail));
  } catch { /* ignore quota errors */ }
}

export function restoreCallDetailFromSession(): CallDetailSnapshot | null {
  try {
    const raw = sessionStorage.getItem(CALL_DETAIL_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CallDetailSnapshot;
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

export function buildIncomingCallSnapshot(
  call: IncomingCall,
  now: number,
  opts?: { showAsEnded?: boolean },
): CallDetailSnapshot {
  const callStatusText = call.status === "answered"
    ? "This call has been answered."
    : call.status === "ended" || opts?.showAsEnded
    ? "This call has ended; details stay available on the queue card for 10 minutes."
    : `Incoming for ${formatDuration(now - call.waitingSince)}`;

  return {
    id: call.id,
    mode: "incoming",
    tenantId: call.tenantId,
    workshopName: call.tenantName,
    workshopColor: call.tenantBrandColor,
    queueName: call.queueName,
    agentOrGroupLabel: `Group: ${call.groupName}`,
    customerPhone: call.callerNumber,
    customerName: call.callerName,
    didLabel: call.didLabel || call.did,
    branchId: call.branchId ?? "",
    branchName: call.branchName ?? "",
    mappingWorkshopName: call.mappingWorkshopName ?? "",
    ownerId: call.ownerId ?? "",
    callStatusText,
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

  return {
    id: agent.id,
    mode: "live",
    tenantId: agent.tenantId,
    workshopName: tenant?.name || agent.tenantName || "Workshop",
    workshopColor: tenant?.brandColor || "var(--cc-color-cyan)",
    queueName: queue?.name || agent.queueName || "Live Queue",
    agentOrGroupLabel: `Agent: ${agent.name}${agent.extension ? ` ? Ext ${agent.extension}` : ""}`,
    customerPhone: activeNumber,
    customerName: incomingCall?.callerName ?? null,
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

  useEffect(() => {
    let cancelled = false;

    if (!open || !detail?.customerPhone) {
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

    const ownerKey = detail.ownerId || detail.tenantId;
    const firebasePromise = ownerKey
      ? fetchFirebaseCallerContext(ownerKey, detail.customerPhone)
      : Promise.resolve(null);
    const agentPromise = fetchAgentByCallerNumber(
      detail.customerPhone,
      detail.tenantId,
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
  }, [detail?.id, detail?.tenantId, detail?.ownerId, detail?.customerPhone, open]);

  useEffect(() => {
    let cancelled = false;

    if (!open || !detail?.branchId || !detail?.ownerId) {
      setBranchServices(null);
      setBranchServicesLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setBranchServicesLoading(true);

    getServicesByBranch(detail.ownerId, detail.branchId)
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
  }, [detail?.branchId, detail?.ownerId, open]);

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
    normalizeCustomerName(detail?.customerName);
  const resolvedCustomerEmail =
    callerContext?.customer.email || matchedAgent?.email || "";
  const availableVehicles = callerContext?.vehicles || [];
  const hasKnownProfile = Boolean(callerContext) || Boolean(matchedAgent);
  const statusTone = hasKnownProfile
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    : "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  const matchedAgentWorkshop =
    matchedAgent?.tenantName ||
    detail?.mappingWorkshopName ||
    detail?.workshopName ||
    "";
  const matchedAgentRoleLabel = matchedAgent
    ? formatMatchedAgentRole(matchedAgent)
    : "";
  const statusLabel = callerContext
    ? "Known Customer"
    : matchedAgent
      ? "Command Centre Agent"
      : contextLoading
        ? "Searching..."
        : "Unknown Caller";
  const canOpenBooking = detail?.mode === "live";
  const sortedWorkshopChatMessages = useMemo(
    () =>
      [...workshopChatMessages].sort((a, b) => {
        const ta = parseChatTime(a.createdAt);
        const tb = parseChatTime(b.createdAt);
        return ta !== tb ? ta - tb : (a.messageId || "").localeCompare(b.messageId || "");
      }),
    [workshopChatMessages],
  );

  const handleOpenWorkshopChat = async () => {
    if (!detail) return;
    const ownerUid = detail.ownerId.trim();
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
        branchId: detail.branchId,
        branchName: detail.branchName,
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
  };

  const handleSendWorkshopChat = async (event: FormEvent<HTMLFormElement>) => {
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
  };
  // const canOpenBooking = true;
  if (!detail) return null;

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
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
                    color: detail.workshopColor,
                    background: `${detail.workshopColor}18`,
                  }}
                >
                  {detail.mode === "incoming" ? "Incoming Call" : "Live Call"}
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
                {detail.callStatusText}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 p-6">
              {matchedAgent ? (
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
                      Workshop / Branch
                    </div>
                    <div className="mt-2 text-lg font-semibold text-slate-950">
                      {(detail.mappingWorkshopName || detail.workshopName) +
                        (detail.branchName ? ` - ${detail.branchName}` : "")}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {detail.queueName}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      Caller
                    </div>
                    <div className="mt-2 text-lg font-semibold text-slate-950">
                      {formatPhone(detail.customerPhone)}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {detail.agentOrGroupLabel}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      Profile Status
                    </div>
                    <div className="mt-2 text-sm font-medium text-slate-900">
                      {statusLabel}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                      Line / DID
                    </div>
                    <div className="mt-2 text-sm font-medium text-slate-900">
                      {detail.didLabel}
                    </div>
                  </div>
                  {detail.ownerId && (
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        Owner ID
                      </div>
                      {/* <div className="mt-2 text-sm font-medium text-slate-900 font-mono text-xs">
                        {detail.ownerId}
                      </div> */}
                    </div>
                  )}
                  {callerContext?.customer.email && (
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
                  {callerContext?.customer.address && (
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
                        // disabled={command.label === 'Book Now' && !canOpenBooking}
                        onClick={() => {
                          if (command.label === "Book Now") {
                            if (detail) saveCallDetailToSession(detail);
                            navigate("/booking", {
                              state: {
                                tenantId: detail?.tenantId ?? "",
                                customerId: callerContext?.customer.id ?? null,
                                customerName: resolvedCustomerName ?? "",
                                customerPhone: detail?.customerPhone ?? "",
                                customerEmail: resolvedCustomerEmail ?? "",
                                availableVehicles: availableVehicles,
                                workshopName: detail?.workshopName ?? "",
                                workshopColor: detail?.workshopColor ?? "",
                                branchId: detail?.branchId ?? "",
                                ownerId: detail?.ownerId ?? "",
                              },
                            });
                            return;
                          }
                          if (command.label === "Booking Details") {
                            if (detail) saveCallDetailToSession(detail);
                            navigate("/bookings/dashboard", {
                              state: {
                                ownerId: detail?.ownerId ?? "",
                                branchId: detail?.branchId ?? "",
                              },
                            });
                            return;
                          }
                          if (command.label === "Workshop Chat") {
                            void handleOpenWorkshopChat();
                            return;
                          }
                        }}
                        disabled={
                          (command.label === "Workshop Chat" &&
                            !detail.ownerId?.trim()) ||
                          (command.label === "Workshop Chat" &&
                            workshopChatLoading)
                        }
                        title={
                          command.label === "Workshop Chat" &&
                          !detail.ownerId?.trim()
                            ? "No DID workshop owner mapping found for this call"
                            : undefined
                        }
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
                          {detail.branchName ? ` - ${detail.branchName}` : ""}
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
                      Chat opened from DID {detail.didLabel || "-"} for{" "}
                      {detail.mappingWorkshopName || detail.workshopName || "workshop"}
                      {detail.branchName ? ` / ${detail.branchName}` : ""}.
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
