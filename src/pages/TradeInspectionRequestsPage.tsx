import "@/styles/dashboard.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { restoreCallDetailFromSession } from "@/components/dashboard/CallDetailsSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  fetchBlueInspectionRequestsForBusiness,
  type BlueInspectionRequest,
} from "@/services/blueInspectionRequestsApi";
import { formatPhone } from "@/utils/formatters";

export interface TradeInspectionRequestsPageState {
  source?: string;
  callId?: string;
  customerName?: string;
  callerNumber?: string;
  businessId?: string;
  ownerId?: string;
  businessName?: string;
  did?: string;
  didLabel?: string;
  queueId?: string;
  queueName?: string;
  tenantId?: string;
  agentUserId?: string | null;
  agentName?: string | null;
}

export function resolveTradeInspectionContext(
  state: TradeInspectionRequestsPageState | null,
) {
  const restoredDetail = restoreCallDetailFromSession();
  const businessId = (
    state?.businessId ||
    state?.ownerId ||
    restoredDetail?.ownerId ||
    ""
  ).trim();

  return {
    restoredDetail,
    businessId,
    customerName: state?.customerName || restoredDetail?.customerName || "",
    callerNumber: state?.callerNumber || restoredDetail?.customerPhone || "",
    businessName:
      state?.businessName ||
      restoredDetail?.mappingWorkshopName ||
      restoredDetail?.workshopName ||
      "Blue business",
    did: state?.did || restoredDetail?.did || restoredDetail?.didLabel || "",
    didLabel: state?.didLabel || restoredDetail?.didLabel || state?.did || "",
    callId: state?.callId || restoredDetail?.id || "",
    queueId: state?.queueId || restoredDetail?.queueId || "",
    queueName: state?.queueName || restoredDetail?.queueName || "",
    tenantId: state?.tenantId || restoredDetail?.tenantId || "",
    agentUserId: state?.agentUserId ?? null,
    agentName: state?.agentName ?? null,
  };
}

function formatDateTime(value: string): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("complete") || normalized.includes("done")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (normalized.includes("cancel") || normalized.includes("reject")) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (normalized.includes("progress") || normalized.includes("assigned")) {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function humanizeKey(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function displayValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const SUMMARY_RAW_KEYS = new Set([
  "id",
  "_id",
  "uid",
  "businessId",
  "business_id",
  "tenantId",
  "title",
  "requestType",
  "request_type",
  "inspectionType",
  "inspection_type",
  "serviceType",
  "service_type",
  "service",
  "serviceName",
  "service_name",
  "category",
  "subject",
  "status",
  "state",
  "requestStatus",
  "request_status",
  "customerName",
  "customer_name",
  "callerName",
  "caller_name",
  "name",
  "customerPhone",
  "customer_phone",
  "callerNumber",
  "caller_number",
  "phone",
  "mobile",
  "mobileNumber",
  "mobile_number",
  "email",
  "customerEmail",
  "customer_email",
  "clientEmail",
  "client_email",
  "address",
  "customerAddress",
  "customer_address",
  "siteAddress",
  "site_address",
  "location",
  "preferredDate",
  "preferred_date",
  "requestedDate",
  "requested_date",
  "preferredTime",
  "preferred_time",
  "requestedTime",
  "requested_time",
  "time",
  "notes",
  "note",
  "description",
  "message",
  "details",
  "createdAt",
  "created_at",
  "submittedAt",
  "submitted_at",
  "date",
  "updatedAt",
  "updated_at",
]);

function DetailField({ label, value }: { label: string; value: unknown }) {
  const text = displayValue(value);
  if (!text) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-medium text-slate-900">{text}</div>
    </div>
  );
}

function RequestCard({
  request,
  index,
  expanded,
  onToggle,
}: {
  request: BlueInspectionRequest;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const extraFields = Object.entries(request.raw).filter(([key, value]) => {
    return !SUMMARY_RAW_KEYS.has(key) && displayValue(value);
  });

  return (
    <Card className="border-0 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="block w-full text-left"
        aria-expanded={expanded}
      >
        <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-slate-950">
              <Wrench className="h-4 w-4 text-blue-600" />
              {request.title || `Inspection request ${index + 1}`}
            </CardTitle>
            <div className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-3">
              <span className="font-mono text-xs text-slate-500">
                {request.id || "-"}
              </span>
              <span>{request.name || "Unknown name"}</span>
              <span>{request.service || "No service listed"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={statusTone(request.status)}>
              {request.status}
            </Badge>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          <span>{formatDateTime(request.createdAt)}</span>
          {request.phone ? <span>{formatPhone(request.phone)}</span> : null}
          {request.preferredDate ? <span>{request.preferredDate}</span> : null}
        </div>
        </CardHeader>
      </button>
      {expanded ? (
        <>
          <Separator />
          <CardContent className="space-y-5 pt-5">
        <section>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Contact
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Name" value={request.name} />
            <DetailField
              label="Phone"
              value={request.phone ? formatPhone(request.phone) : ""}
            />
            <DetailField label="Email" value={request.email} />
            <DetailField label="Address" value={request.address} />
            <DetailField label="Business ID" value={request.businessId} />
            <DetailField label="Request ID" value={request.id} />
          </div>
        </section>

        <section>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Service request
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Service" value={request.service} />
            <DetailField label="Status" value={request.status} />
            <DetailField label="Preferred date" value={request.preferredDate} />
            <DetailField label="Preferred time" value={request.preferredTime} />
            <DetailField label="Updated" value={formatDateTime(request.updatedAt)} />
          </div>
          {request.notes ? (
            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                Notes
              </div>
              {request.notes}
            </div>
          ) : null}
        </section>

        {extraFields.length > 0 ? (
          <section>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <Eye className="h-3.5 w-3.5" />
              Additional details
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {extraFields.map(([key, value]) => (
                <DetailField key={key} label={humanizeKey(key)} value={value} />
              ))}
            </div>
          </section>
        ) : null}
          </CardContent>
        </>
      ) : null}
    </Card>
  );
}

export default function TradeInspectionRequestsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as TradeInspectionRequestsPageState | null;
  const context = useMemo(() => resolveTradeInspectionContext(state), [state]);
  const [requests, setRequests] = useState<BlueInspectionRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!context.businessId) {
      setRequests([]);
      setLoadError("No Blue business id is mapped to this DID.");
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const rows = await fetchBlueInspectionRequestsForBusiness(context.businessId);
      setRequests(rows);
      setExpandedRequestId(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load inspection requests.");
    } finally {
      setLoading(false);
    }
  }, [context.businessId]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  function goToCreate() {
    navigate("/trade/create", {
      state: {
        ...state,
        businessId: context.businessId,
        ownerId: context.businessId,
        customerName: context.customerName,
        callerNumber: context.callerNumber,
        businessName: context.businessName,
        did: context.did,
        didLabel: context.didLabel,
        callId: context.callId,
        queueId: context.queueId,
        queueName: context.queueName,
        tenantId: context.tenantId,
        agentUserId: context.agentUserId,
        agentName: context.agentName,
      } satisfies TradeInspectionRequestsPageState,
    });
  }

  return (
    <div className="cc-fade-in min-h-screen bg-[#f5f5f5]">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 shadow-sm">
              <ClipboardList className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight">
                Blue Inspection Requests
              </div>
              <div className="text-xs text-muted-foreground">{context.businessName}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadRequests()}
              disabled={loading || !context.businessId}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button
              type="button"
              className="bg-blue-600 text-white hover:bg-blue-700"
              disabled={!context.businessId}
              onClick={goToCreate}
            >
              <Plus className="h-4 w-4" />
              Create inspection request
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Card className="mb-6 border-0 bg-white shadow-sm">
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <DetailField label="Business" value={context.businessName} />
            <DetailField label="Business ID" value={context.businessId} />
            <DetailField
              label="Caller"
              value={context.callerNumber ? formatPhone(context.callerNumber) : ""}
            />
            <DetailField
              label="DID"
              value={
                context.didLabel && context.didLabel !== context.did
                  ? `${context.did} (${context.didLabel})`
                  : context.did
              }
            />
          </CardContent>
        </Card>

        {!context.businessId ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            No Blue business id is mapped to this DID. Update the DID mapping before creating
            inspection requests.
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-600 shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading inspection requests...
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        ) : requests.length === 0 ? (
          <Card className="border-0 bg-white shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <ClipboardList className="h-10 w-10 text-slate-300" />
              <div className="text-lg font-semibold text-slate-900">
                No inspection requests found
              </div>
              <p className="max-w-md text-sm text-slate-500">
                Create the first inspection request for this Blue business and caller.
              </p>
              <Button
                className="bg-blue-600 text-white hover:bg-blue-700"
                onClick={goToCreate}
              >
                <Plus className="h-4 w-4" />
                Create inspection request
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {requests.map((request, index) => (
              <RequestCard
                key={request.id || `${request.businessId}-${index}`}
                request={request}
                index={index}
                expanded={expandedRequestId === (request.id || `${request.businessId}-${index}`)}
                onToggle={() => {
                  const key = request.id || `${request.businessId}-${index}`;
                  setExpandedRequestId((current) => (current === key ? null : key));
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
