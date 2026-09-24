import { apiFetch, apiUrl } from "@/lib/api";

function resolveInspectionRequestsApiBase(): string {
  const override = (
    import.meta.env.VITE_BLUE_INSPECTION_REQUESTS_API_URL as string | undefined
  )
    ?.trim()
    .replace(/\/+$/, "");
  if (!override) return apiUrl("/inspection-requests");
  if (/^https?:\/\//i.test(override)) return override;
  return apiUrl(override.startsWith("/") ? override : `/${override}`);
}

const BLUE_INSPECTION_REQUESTS_API_URL = resolveInspectionRequestsApiBase();

export interface BlueInspectionRequest {
  id: string;
  businessId: string;
  title: string;
  service: string;
  status: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  preferredDate: string;
  preferredTime: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

export interface CreateBlueInspectionRequestInput {
  businessId: string;
  requestTitle: string;
  requestType: string;
  priority: string;
  preferredDate: string;
  preferredTime: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  service: string;
  description: string;
  did: string;
  didLabel: string;
  callId: string;
  queueId: string;
  queueName: string;
  tenantId: string;
  agentUserId: string | null;
  agentName: string | null;
  notes: string;
  internalNotes: string;
}

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

function collectRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;

  const body = asRecord(raw);
  for (const key of ["inspectionRequests", "requests", "data", "items", "results"]) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }

  const data = asRecord(body.data);
  for (const key of ["inspectionRequests", "requests", "items", "results"]) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function toInspectionRequest(raw: unknown, fallbackBusinessId = ""): BlueInspectionRequest {
  const row = asRecord(raw);
  const businessId = pickString(row, ["businessId", "business_id", "business", "tenantId"]) || fallbackBusinessId;
  const createdAt = pickString(row, ["createdAt", "created_at", "submittedAt", "submitted_at", "date"]);
  const phone = pickString(row, [
    "customerPhone",
    "customer_phone",
    "callerNumber",
    "caller_number",
    "phone",
    "mobile",
    "mobileNumber",
    "mobile_number",
  ]);
  const id =
    pickString(row, ["id", "inspectionRequestId", "inspection_request_id", "requestId", "_id", "uid"]) ||
    [businessId, phone, createdAt].filter(Boolean).join(":");
  const service = pickString(row, [
    "service",
    "serviceName",
    "service_name",
    "serviceType",
    "service_type",
    "requestType",
    "request_type",
    "inspectionType",
    "inspection_type",
    "category",
  ]);

  return {
    id,
    businessId,
    title:
      pickString(row, ["title", "subject", "requestTitle", "request_title"]) ||
      service ||
      "Inspection request",
    service,
    status: pickString(row, ["status", "state", "requestStatus", "request_status"]) || "pending",
    name: pickString(row, [
      "name",
      "customerName",
      "customer_name",
      "callerName",
      "caller_name",
      "clientName",
      "client_name",
      "fullName",
      "full_name",
    ]),
    phone,
    email: pickString(row, ["email", "customerEmail", "customer_email", "clientEmail", "client_email"]),
    address: pickString(row, ["address", "customerAddress", "customer_address", "siteAddress", "site_address", "location"]),
    preferredDate: pickString(row, ["preferredDate", "preferred_date", "requestedDate", "requested_date", "date"]),
    preferredTime: pickString(row, ["preferredTime", "preferred_time", "requestedTime", "requested_time", "time"]),
    notes: pickString(row, ["notes", "note", "description", "message", "details"]),
    createdAt,
    updatedAt: pickString(row, ["updatedAt", "updated_at"]),
    raw: row,
  };
}

function inspectionRequestsUrl(path = ""): string {
  const base = BLUE_INSPECTION_REQUESTS_API_URL.replace(/\/+$/, "");
  const suffix = path.trim() ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `${base}${suffix}`;
}

function businessInspectionRequestsUrl(businessId: string): string {
  return inspectionRequestsUrl(`/businesses/${encodeURIComponent(businessId)}`);
}

async function readHttpError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  const fallback = `Inspection requests API failed (${res.status}).`;
  if (!text.trim()) return fallback;

  try {
    const body = asRecord(JSON.parse(text) as unknown);
    const detail = body.message ?? body.error ?? body.detail;
    return typeof detail === "string" ? detail : fallback;
  } catch {
    return text.slice(0, 400) || fallback;
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as unknown) : null;
}

function requestPayload(input: CreateBlueInspectionRequestInput): Record<string, unknown> {
  return {
    businessId: input.businessId,
    requestTitle: input.requestTitle,
    title: input.requestTitle,
    requestType: input.requestType,
    priority: input.priority,
    preferredDate: input.preferredDate,
    preferredTime: input.preferredTime,
    name: input.name,
    customerName: input.name,
    phone: input.phone,
    customerPhone: input.phone,
    callerNumber: input.phone,
    email: input.email,
    customerEmail: input.email,
    address: input.address,
    customerAddress: input.address,
    service: input.service,
    description: input.description,
    did: input.did,
    didLabel: input.didLabel,
    callId: input.callId,
    queueId: input.queueId,
    queueName: input.queueName,
    tenantId: input.tenantId,
    agentUserId: input.agentUserId,
    agentName: input.agentName,
    notes: input.notes,
    internalNotes: input.internalNotes,
    source: "command-centre-blue-call",
  };
}

async function postInspectionRequest(url: string, body: Record<string, unknown>): Promise<Response> {
  return apiFetch(url, {
    method: "POST",
    logoutOnSessionExpired: false,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function fetchBlueInspectionRequestsForBusiness(
  businessId: string,
): Promise<BlueInspectionRequest[]> {
  const id = businessId.trim();
  if (!id) throw new Error("Blue business id is required to load inspection requests.");

  const res = await apiFetch(businessInspectionRequestsUrl(id), {
    logoutOnSessionExpired: false,
    headers: { Accept: "application/json" },
  });

  if (res.status === 404) {
    return [];
  }

  if (!res.ok) {
    throw new Error(await readHttpError(res));
  }

  return collectRows(await readJson(res)).map((row) => toInspectionRequest(row, id));
}

export async function createBlueInspectionRequest(
  input: CreateBlueInspectionRequestInput,
): Promise<BlueInspectionRequest> {
  const businessId = input.businessId.trim();
  if (!businessId) throw new Error("Blue business id is required to create an inspection request.");

  const body = requestPayload({ ...input, businessId });
  const res = await postInspectionRequest(businessInspectionRequestsUrl(businessId), body);

  if (!res.ok) {
    throw new Error(await readHttpError(res));
  }

  const raw = await readJson(res);
  const row = asRecord(raw);
  const payload = row.inspectionRequest ?? row.request ?? row.data ?? row.result ?? raw;
  return toInspectionRequest(payload, businessId);
}
