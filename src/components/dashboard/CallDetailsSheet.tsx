import { useEffect, useMemo, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  CalendarPlus2,
  CarFront,
  History,
  Mail,
  MapPin,
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
  getServicesByBranch,
  type WorkshopService,
} from "@/services/servicesApi";
import { formatDuration, formatPhone } from "@/utils/formatters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/EmptyState";
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
    callStatusText: opts?.showAsEnded
      ? "This call has ended; details stay available on the queue card for 10 minutes."
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
  const commandButtons = useMemo(
    () => [
      { label: "Book Now", icon: CalendarPlus2 },
      { label: "Booking Details", icon: CalendarCheck },
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
                        }}
                      >
                        <Icon className="h-4 w-4" />
                        {command.label}
                      </Button>
                    );
                  })}
                </CardContent>
              </Card>

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
