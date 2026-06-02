import { supabase } from "@/integrations/supabase/client";
import { API_BASE, apiFetch } from "@/lib/api";
import type {
  Tenant,
  Queue,
  Agent,
  WorkshopUserRole,
  Call,
  SipLine,
  DashboardSummary,
  TenantOnboarding,
  NewClientForm,
  StageTransitionResult,
  AgentGroup,
  DIDMapping,
  IncomingCall,
  CallResult,
  TranscriptStatus,
  SipLineStatus,
  RingStrategy,
  CallerContext,
  CustomerRecord,
  VehicleRecord,
  ServiceRecord,
  BookingRecord,
  BookingStatus,
} from "./types";
import {
  ONBOARDING_STAGES,
  validateStageTransition,
  getNextStage,
  getGoLiveBlockers,
  getGoLiveWarnings,
} from "@/utils/onboardingValidation";
import { getBookings, resolveBmsOwnerUidForTenant } from "./bookingsApi";
import { logSystemActivity } from "./auditLogApi";
import type { UserSession } from "./types";

export { ONBOARDING_STAGES };

const CALLS_API_URL =
  (import.meta.env.VITE_CALLS_API_URL as string | undefined)?.trim().replace(/\/+$/, "") ||
  `${API_BASE}/calls`;

const DASHBOARD_API_URL =
  (import.meta.env.VITE_DASHBOARD_API_URL as string | undefined)?.trim() ||
  deriveDashboardApiUrl(CALLS_API_URL);

function deriveDashboardApiUrl(callsApiUrl: string): string {
  const normalized = callsApiUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/api/calls")) {
    return `${normalized.slice(0, -"/api/calls".length)}/api/dashboard`;
  }
  if (normalized.endsWith("/calls")) {
    return `${normalized.slice(0, -"/calls".length)}/dashboard`;
  }
  return `${API_BASE}/dashboard`;
}

/* ─── Tenants ─── */

export async function fetchTenants(): Promise<Tenant[]> {
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return (data || []).map((t) => ({
    id: t.id,
    name: t.name,
    industry: t.industry,
    status: t.status as "active" | "inactive",
    brandColor: t.brand_color,
    didNumbers: t.did_numbers || [],
    bmsOwnerUid: t.bms_owner_uid ?? null,
    bmsDefaultBranchId: t.bms_default_branch_id ?? null,
  }));
}

/* ─── Summary (computed from live data) ─── */

export async function fetchSummary(
  tenantId?: string | null,
  providedData?: { agents?: Agent[]; queues?: Queue[]; calls?: Call[] },
  startDate?: string,
  endDate?: string,
  options?: { useDashboardApi?: boolean; agentMetrics?: boolean },
): Promise<DashboardSummary> {
  const localSummary = await computeDashboardSummary(
    tenantId,
    providedData,
    options?.agentMetrics,
  );

  if (options?.useDashboardApi === false) {
    return localSummary;
  }

  try {
    const apiSummary = await fetchDashboardMetrics(tenantId, startDate, endDate);
    return mergeDashboardSummary(localSummary, apiSummary);
  } catch {
    return localSummary;
  }
}

async function computeDashboardSummary(
  tenantId?: string | null,
  providedData?: { agents?: Agent[]; queues?: Queue[]; calls?: Call[] },
  agentMetrics = false,
): Promise<DashboardSummary> {
  // Use provided data if available to avoid redundant network requests.
  const agents = providedData?.agents ?? await fetchAgents(tenantId);
  const queues = providedData?.queues ?? await fetchQueues(tenantId);
  const calls = providedData?.calls ?? await fetchCalls(tenantId);

  const onCall = agents.filter((a) => a.status === "on-call").length;
  const online = agents.filter((a) => a.status !== "offline").length;
  const available = agents.filter((a) => a.status === "available").length;
  const queued = queues.reduce((s, q) => s + q.waitingCalls, 0);
  const answered = calls.filter((c) => c.result === "answered").length;
  const total = calls.length;
  const avgHandle =
    answered > 0
      ? Math.round(
          calls
            .filter((c) => c.result === "answered")
            .reduce((s, c) => s + c.durationSeconds, 0) / answered,
        )
      : 0;
  const sla =
    queues.length > 0
      ? Math.round(queues.reduce((s, q) => s + q.slaPercent, 0) / queues.length)
      : 0;

  return {
    activeCalls: onCall,
    queuedCalls: queued,
    availableAgents: available,
    onlineAgents: online,
    totalCallsToday: agentMetrics ? answered : total,
    answerRate: total > 0 ? Math.round((answered / total) * 1000) / 10 : 0,
    abandonRate:
      total > 0
        ? Math.round(
            (calls.filter((c) => c.result === "abandoned").length / total) *
              1000,
          ) / 10
        : 0,
    avgHandleTime: avgHandle,
    slaPercent: sla,
  };
}

function mergeDashboardSummary(
  localSummary: DashboardSummary,
  apiSummary: Partial<DashboardSummary>,
): DashboardSummary {
  return {
    ...localSummary,
    ...dropUndefinedDashboardMetrics(apiSummary),
  };
}

function dropUndefinedDashboardMetrics(
  summary: Partial<DashboardSummary>,
): Partial<DashboardSummary> {
  return Object.fromEntries(
    Object.entries(summary).filter(([, value]) => value !== undefined),
  ) as Partial<DashboardSummary>;
}

function dashboardApiUrl(
  path: string,
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): string {
  const base = DASHBOARD_API_URL.replace(/\/+$/, "");
  const suffix = path.trim() ? (path.startsWith("/") ? path : `/${path}`) : "";
  const url = new URL(`${base}${suffix}`, window.location.origin);
  if (tenantId) url.searchParams.set("tenantId", tenantId);
  if (startDate) url.searchParams.set("from", startDate);
  if (endDate) url.searchParams.set("to", endDate);
  return url.toString();
}

async function readDashboardApiErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  if (!text.trim()) return "";
  try {
    const parsed = JSON.parse(text) as unknown;
    const body = asPlainRecord(parsed);
    const detail = body.message ?? body.error ?? body.detail;
    return typeof detail === "string" ? detail : text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

async function readDashboardJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as unknown) : null;
}

async function fetchDashboardJson(
  path: string,
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<unknown> {
  const res = await apiFetch(dashboardApiUrl(path, tenantId, startDate, endDate), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const detail = await readDashboardApiErrorDetail(res);
    throw new Error(`Dashboard API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }

  return readDashboardJsonBody(res);
}

function pickOptionalMetricNumber(
  raw: unknown,
  keys: readonly string[],
): number | undefined {
  const direct = parseMetricNumber(raw);
  if (direct !== undefined) return direct;

  const candidates = metricRecordCandidates(raw);
  for (const row of candidates) {
    for (const key of keys) {
      const value = row[key];
      if (value == null || value === "") continue;
      const n = parseMetricNumber(value);
      if (n !== undefined) return n;
    }
  }

  return undefined;
}

function parseMetricNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  const n = text.endsWith("%") ? Number.parseFloat(text) : Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function metricRecordCandidates(raw: unknown): Record<string, unknown>[] {
  const body = asPlainRecord(raw);
  const records = [
    body,
    asPlainRecord(body.data),
    asPlainRecord(body.metrics),
    asPlainRecord(body.summary),
    asPlainRecord(body.overview),
    asPlainRecord(body.result),
  ];

  const metricRows = collectMetricRows(raw);
  if (metricRows.length > 0) {
    records.push(metricRowsToRecord(metricRows));
  }

  return records.filter((row) => Object.keys(row).length > 0);
}

function collectMetricRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.map(asPlainRecord);
  const body = asPlainRecord(raw);
  for (const key of ["metrics", "data", "items", "results", "rows"]) {
    const value = body[key];
    if (Array.isArray(value)) return value.map(asPlainRecord);
  }
  return [];
}

function metricRowsToRecord(rows: Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const key = pickRecordString(row, ["key", "name", "metric", "id"]);
    if (!key) continue;
    const value =
      pickOptionalMetricNumber(row, ["value", "count", "total", "rate", "seconds", "percent"]) ??
      row.value;
    out[key] = value;
    out[normalizeMetricKey(key)] = value;
  }
  return out;
}

function normalizeMetricKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function roundMetric(n: number): number {
  return Math.round(n * 10) / 10;
}

function normalizePercentMetric(n: number | undefined): number | undefined {
  if (n === undefined) return undefined;
  return roundMetric(n > 0 && n <= 1 ? n * 100 : n);
}

function normalizeCountMetric(n: number | undefined): number | undefined {
  return n === undefined ? undefined : Math.round(n);
}

function normalizeSecondsMetric(n: number | undefined): number | undefined {
  return n === undefined ? undefined : Math.round(n);
}

function normalizeDashboardMetrics(raw: unknown): Partial<DashboardSummary> {
  return {
    activeCalls: normalizeCountMetric(
      pickOptionalMetricNumber(raw, [
        "activeCalls",
        "active_calls",
        "activeCallsCount",
        "active_calls_count",
        "liveCalls",
        "live_calls",
        "livecallscount",
      ]),
    ),
    queuedCalls: normalizeCountMetric(
      pickOptionalMetricNumber(raw, [
        "queuedCalls",
        "queued_calls",
        "waitingCalls",
        "waiting_calls",
        "callsWaiting",
        "calls_waiting",
        "queuedcallscount",
      ]),
    ),
    availableAgents: normalizeCountMetric(
      pickOptionalMetricNumber(raw, [
        "availableAgents",
        "available_agents",
        "availableAgentsCount",
        "available_agents_count",
        "availableagentscount",
      ]),
    ),
    onlineAgents: normalizeCountMetric(
      pickOptionalMetricNumber(raw, [
        "onlineAgents",
        "online_agents",
        "onlineAgentsCount",
        "online_agents_count",
        "agentsOnline",
        "agents_online",
        "onlineagentscount",
      ]),
    ),
    totalCallsToday: normalizeCountMetric(
      pickOptionalMetricNumber(raw, [
        "totalCallsToday",
        "total_calls_today",
        "todayCallsCount",
        "today_calls_count",
        "callsToday",
        "calls_today",
        "totalCalls",
        "total_calls",
        "todaycallscount",
      ]),
    ),
    answerRate: normalizePercentMetric(
      pickOptionalMetricNumber(raw, [
        "answerRate",
        "answer_rate",
        "answeredRate",
        "answered_rate",
        "answerrate",
      ]),
    ),
    abandonRate: normalizePercentMetric(
      pickOptionalMetricNumber(raw, [
        "abandonRate",
        "abandon_rate",
        "abondonRate",
        "abondon_rate",
        "abandonrate",
        "abondonrate",
      ]),
    ),
    avgHandleTime: normalizeSecondsMetric(
      pickOptionalMetricNumber(raw, [
        "avgHandleTime",
        "avg_handle_time",
        "avgHandle",
        "avg_handle",
        "averageHandleTime",
        "average_handle_time",
        "avgHandleSeconds",
        "avg_handle_seconds",
        "avghandle",
      ]),
    ),
    slaPercent: normalizePercentMetric(
      pickOptionalMetricNumber(raw, [
        "slaPercent",
        "sla_percent",
        "sla",
        "slaRate",
        "sla_rate",
        "serviceLevel",
        "service_level",
      ]),
    ),
  };
}

async function fetchDashboardMetricNumber(
  path: string,
  keys: readonly string[],
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  const raw = await fetchDashboardJson(path, tenantId, startDate, endDate);
  const value = pickOptionalMetricNumber(raw, [
    ...keys,
    "value",
    "count",
    "total",
    "rate",
    "seconds",
    "percent",
  ]);
  if (value === undefined) {
    throw new Error(`Dashboard metric ${path} returned no numeric value.`);
  }
  return value;
}

export async function fetchOnlineAgentsCount(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  return normalizeCountMetric(
    await fetchDashboardMetricNumber(
      "/online-agents-count",
      ["onlineAgents", "online_agents", "onlineAgentsCount", "online_agents_count"],
      tenantId,
      startDate,
      endDate,
    ),
  ) ?? 0;
}

export async function fetchTodayCallsCount(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  return normalizeCountMetric(
    await fetchDashboardMetricNumber(
      "/today-calls-count",
      ["totalCallsToday", "todayCallsCount", "today_calls_count", "callsToday"],
      tenantId,
      startDate,
      endDate,
    ),
  ) ?? 0;
}

export async function fetchAnswerRate(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  return normalizePercentMetric(
    await fetchDashboardMetricNumber(
      "/answer-rate",
      ["answerRate", "answer_rate", "answeredRate", "answered_rate"],
      tenantId,
      startDate,
      endDate,
    ),
  ) ?? 0;
}

export async function fetchAbandonRate(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  return normalizePercentMetric(
    await fetchDashboardMetricNumber(
      "/abandon-rate",
      ["abandonRate", "abandon_rate", "abondonRate", "abondon_rate"],
      tenantId,
      startDate,
      endDate,
    ),
  ) ?? 0;
}

export async function fetchAbondonRate(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  return normalizePercentMetric(
    await fetchDashboardMetricNumber(
      "/abondon-rate",
      ["abondonRate", "abondon_rate", "abandonRate", "abandon_rate"],
      tenantId,
      startDate,
      endDate,
    ),
  ) ?? 0;
}

export async function fetchAverageHandleTime(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  return normalizeSecondsMetric(
    await fetchDashboardMetricNumber(
      "/avg-handle",
      ["avgHandleTime", "avg_handle_time", "avgHandle", "avg_handle", "avgHandleSeconds"],
      tenantId,
      startDate,
      endDate,
    ),
  ) ?? 0;
}

export async function fetchAvgHandle(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  return fetchAverageHandleTime(tenantId, startDate, endDate);
}

export async function fetchSlaPercent(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  return normalizePercentMetric(
    await fetchDashboardMetricNumber(
      "/sla",
      ["slaPercent", "sla_percent", "sla", "slaRate", "serviceLevel"],
      tenantId,
      startDate,
      endDate,
    ),
  ) ?? 0;
}

export async function fetchSla(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  return fetchSlaPercent(tenantId, startDate, endDate);
}

async function fetchDashboardMetricsFromIndividualEndpoints(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<Partial<DashboardSummary>> {
  const entries = await Promise.allSettled([
    fetchOnlineAgentsCount(tenantId, startDate, endDate),
    fetchTodayCallsCount(tenantId, startDate, endDate),
    fetchAnswerRate(tenantId, startDate, endDate),
    fetchAbandonRate(tenantId, startDate, endDate).catch(() =>
      fetchAbondonRate(tenantId, startDate, endDate),
    ),
    fetchAverageHandleTime(tenantId, startDate, endDate),
    fetchSlaPercent(tenantId, startDate, endDate),
  ]);

  const [onlineAgents, totalCallsToday, answerRate, abandonRate, avgHandleTime, slaPercent] =
    entries.map((entry) => (entry.status === "fulfilled" ? entry.value : undefined));

  const summary = dropUndefinedDashboardMetrics({
    onlineAgents,
    totalCallsToday,
    answerRate,
    abandonRate,
    avgHandleTime,
    slaPercent,
  });

  if (Object.keys(summary).length === 0) {
    throw new Error("Dashboard metric endpoints returned no usable values.");
  }

  return summary;
}

export async function fetchDashboardMetrics(
  tenantId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<Partial<DashboardSummary>> {
  try {
    const raw = await fetchDashboardJson("/metrics", tenantId, startDate, endDate);
    const summary = dropUndefinedDashboardMetrics(normalizeDashboardMetrics(raw));
    const requiredKeys: Array<keyof DashboardSummary> = [
      "onlineAgents",
      "totalCallsToday",
      "answerRate",
      "abandonRate",
      "avgHandleTime",
      "slaPercent",
    ];
    const hasAllRequired = requiredKeys.every((key) => summary[key] !== undefined);
    if (hasAllRequired) return summary;

    try {
      const individual = await fetchDashboardMetricsFromIndividualEndpoints(
        tenantId,
        startDate,
        endDate,
      );
      return { ...individual, ...summary };
    } catch {
      if (Object.keys(summary).length > 0) return summary;
      throw new Error("Dashboard metrics API returned no usable values.");
    }
  } catch (metricsError) {
    try {
      return await fetchDashboardMetricsFromIndividualEndpoints(tenantId, startDate, endDate);
    } catch {
      throw metricsError;
    }
  }
}

/* ─── Queues ─── */

export async function fetchQueues(tenantId?: string | null): Promise<Queue[]> {
  let query = supabase.from("queues").select("*");
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query.order("name");
  if (error) throw new Error(error.message);
  return (data || []).map((q) => ({
    id: q.id,
    tenantId: q.tenant_id,
    name: q.name,
    type: q.type,
    color: q.color,
    icon: q.icon,
    activeCalls: q.active_calls,
    waitingCalls: q.waiting_calls,
    availableAgents: q.available_agents,
    totalAgents: q.total_agents,
    avgWaitSeconds: q.avg_wait_seconds,
    slaPercent: q.sla_percent,
  }));
}

/* ─── Agents ─── */

export async function fetchAgents(tenantId?: string | null): Promise<Agent[]> {
  let query = supabase.from("agents").select("*, tenants(name)");
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query.order("name");
  if (error) {
    // Fallback without join if inner fails
    let q2 = supabase.from("agents").select("*");
    if (tenantId) q2 = q2.eq("tenant_id", tenantId);
    const { data: d2, error: e2 } = await q2.order("name");
    if (e2) throw new Error(e2.message);
    return (d2 || []).map(mapAgent);
  }
  return (data || []).map(mapAgent);
}

/**
 * Agents subject to Supabase RLS — no tenant filter (`fetchAgents(undefined)`).
 * Use roster pickers when dashboard data was loaded with `fetchAgents(scopeTenant)` and excludes agents tied only via queues or secondary tenants.
 */
export async function fetchAllAgents(): Promise<Agent[]> {
  return fetchAgents(undefined);
}

function pickBestAgentByPhoneNumber(
  agents: Agent[],
  callerNumber: string,
): Agent | null {
  if (agents.length === 0) return null;

  const normCaller = normalizePhoneNumber(callerNumber);
  if (!normCaller) return null;

  const variantSet = new Set(buildPhoneLookupVariants(callerNumber).map(normalizePhoneNumber));

  const scored = agents
    .map((a) => {
      const p = normalizePhoneNumber(a.phone);
      if (!p) return { a, score: 0 };
      if (p === normCaller) return { a, score: 20 };
      if (variantSet.has(p)) return { a, score: 15 };
      return { a, score: 0 };
    })
    .filter((row) => row.score > 0);

  if (scored.length === 0) return null;
  scored.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name));
  return scored[0].a;
}

/**
 * Query `public.agents` where `phone_number` matches any caller format variant.
 */
async function queryAgentsByPhoneNumber(
  callerNumber: string,
  tenantId?: string | null,
): Promise<Agent[]> {
  const variants = buildPhoneLookupVariants(callerNumber).filter(Boolean);
  if (variants.length === 0) return [];

  // PostgREST `in` supports up to ~30 values
  const inValues = variants.slice(0, 30);

  let query = dynamicSupabase
    .from("agents")
    .select("*, tenants(name)")
    .in("phone_number", inValues)
    .order("name")
    .limit(20);

  if (tenantId && tenantId !== "unknown") {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;
  if (error) return [];
  return ((data || []) as Record<string, unknown>[]).map(mapAgent);
}

/**
 * Match incoming CLI to `public.agents.phone_number` (Supabase roster mobile).
 * Tries the call tenant first, then all tenants. Does not use extension.
 */
export async function fetchAgentByCallerNumber(
  callerNumber: string,
  preferredTenantId?: string | null,
): Promise<Agent | null> {
  const trimmed = String(callerNumber ?? "").trim();
  if (!trimmed) return null;

  if (preferredTenantId && preferredTenantId !== "unknown") {
    const scoped = await queryAgentsByPhoneNumber(trimmed, preferredTenantId);
    const hit = pickBestAgentByPhoneNumber(scoped, trimmed);
    if (hit) return hit;
  }

  const global = await queryAgentsByPhoneNumber(trimmed, null);
  return pickBestAgentByPhoneNumber(global, trimmed);
}

function parseWorkshopUserRole(raw: unknown): WorkshopUserRole | null {
  const v = String(raw ?? "").trim();
  if (v === "owner" || v === "branch_admin" || v === "staff") return v;
  return null;
}

function mapAgent(
  a: Record<string, unknown> & { tenants?: { name?: string } },
): Agent {
  return {
    id: a.id as string,
    userId: (a.user_id as string | null) ?? null,
    tenantId: (a.tenant_id as string) || "",
    queueIds: (a.queue_ids as string[]) || [],
    name: a.name as string,
    extension: (a.extension as string) || "",
    email: (a.email as string) || undefined,
    phone: (a.phone_number as string) || (a.phone as string) || undefined,
    notes: (a.notes as string) || undefined,
    bmsOwnerUid: (a.bms_owner_uid as string | null) ?? null,
    bmsBranchId: (a.bms_branch_id as string | null) ?? null,
    workshopUserRole: parseWorkshopUserRole(a.workshop_user_role),
    role: (a.role as Agent["role"]) || "agent",
    status: (a.status as Agent["status"]) || "offline",
    currentCaller: (a.current_caller as string | null) ?? null,
    callStartTime: a.call_start_time ? Number(a.call_start_time) : null,
    allowedQueueIds: (a.allowed_queue_ids as string[]) || [],
    assignedTenantIds: (a.assigned_tenant_ids as string[]) || [],
    groupIds: (a.group_ids as string[]) || [],
    tenantName: a.tenants?.name,
  };
}

/** Fields super-admins may change from the Agents tab (maps to `public.agents` columns). */
export type DashboardAgentUpdate = {
  name?: string;
  extension?: string;
  email?: string;
  phone?: string;
  tenantId?: string | null;
  queueIds?: string[];
  role?: Agent["role"];
};

export async function updateDashboardAgent(
  agentId: string,
  patch: DashboardAgentUpdate,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.extension !== undefined) row.extension = patch.extension;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.phone !== undefined) row.phone_number = patch.phone;
  if (patch.tenantId !== undefined) row.tenant_id = patch.tenantId;
  if (patch.queueIds !== undefined) row.queue_ids = patch.queueIds;
  if (patch.role !== undefined) row.role = patch.role;

  const { error } = await supabase.from("agents").update(row).eq("id", agentId);
  if (error) throw new Error(error.message);
}

export async function deleteDashboardAgent(agentId: string): Promise<void> {
  const { error } = await supabase.from("agents").delete().eq("id", agentId);
  if (error) throw new Error(error.message);
}

/** Link a super-admin (or any auth user) to an existing command-centre agent row. */
export async function linkAgentToUser(
  agentId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("agents")
    .update({ user_id: userId })
    .eq("id", agentId);
  if (error) throw new Error(error.message);
}

/**
 * Create a minimal command-centre agent row for a super-admin so they can act as
 * a chat sender. Returns the newly created agent id.
 *
 * Requires a tenant id (RLS on agents enforces tenant_id NOT NULL). Pass the
 * first tenant from the dashboard if the super-admin has no tenant scope.
 */
export async function createSuperAdminAgent(opts: {
  userId: string;
  name: string;
  tenantId: string;
  email?: string | null;
}): Promise<string> {
  const agentId = `super-admin-${opts.userId.slice(0, 8)}-${Date.now()}`;
  const payload: Record<string, unknown> = {
    id: agentId,
    user_id: opts.userId,
    name: opts.name || "Super Admin",
    extension: "ADMIN",
    email: opts.email ?? null,
    status: "offline",
    role: "team-lead",
    tenant_id: opts.tenantId,
    queue_ids: [],
  };

  const { error } = await dynamicSupabase.from("agents").insert(payload);
  if (error) throw new Error(error.message);
  return agentId;
}

/* ─── Calls ─── */

type CallsApiRow = {
  id: string;
  tenant_id: string;
  queue_id: string;
  agent_id: string | null;
  direction?: string | null;
  caller_number: string;
  caller_name: string | null;
  dialed_number: string | null;
  start_time: string;
  answer_time: string | null;
  end_time: string | null;
  duration_seconds: number;
  result: string;
  recording_url: string | null;
  transcript_status: string;
  summary_status: string;
  agent_name?: string | null;
  queue_name?: string | null;
  tenant_name?: string | null;
};

function asPlainRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function pickRecordString(
  row: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

function pickNullableRecordString(
  row: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  return pickRecordString(row, keys) ?? null;
}

function pickRecordNumber(
  row: Record<string, unknown>,
  keys: readonly string[],
  fallback = 0,
): number {
  for (const key of keys) {
    const value = row[key];
    if (value == null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function extractCallsApiRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const body = asPlainRecord(raw);
  for (const key of ["calls", "data", "items", "results", "rows"]) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeCallsApiRow(raw: unknown): CallsApiRow {
  const row = asPlainRecord(raw);
  return {
    id: pickRecordString(row, ["id", "callId", "call_id"]) ?? "",
    tenant_id: pickRecordString(row, ["tenant_id", "tenantId"]) ?? "unknown",
    queue_id: pickRecordString(row, ["queue_id", "queueId"]) ?? "unknown",
    agent_id: pickNullableRecordString(row, ["agent_id", "agentId"]),
    direction: pickNullableRecordString(row, ["direction"]),
    caller_number: pickRecordString(row, ["caller_number", "callerNumber", "from"]) ?? "",
    caller_name: pickNullableRecordString(row, ["caller_name", "callerName", "customerName"]),
    dialed_number: pickNullableRecordString(row, ["dialed_number", "dialedNumber", "to", "did"]),
    start_time:
      pickRecordString(row, ["start_time", "startTime", "startedAt", "created_at", "createdAt"]) ??
      new Date(0).toISOString(),
    answer_time: pickNullableRecordString(row, ["answer_time", "answerTime", "answeredAt"]),
    end_time: pickNullableRecordString(row, ["end_time", "endTime", "endedAt"]),
    duration_seconds: pickRecordNumber(row, ["duration_seconds", "durationSeconds", "duration"], 0),
    result: pickRecordString(row, ["result", "status", "callResult"]) ?? "missed",
    recording_url: pickNullableRecordString(row, ["recording_url", "recordingUrl", "recording"]),
    transcript_status: pickRecordString(row, ["transcript_status", "transcriptStatus"]) ?? "none",
    summary_status: pickRecordString(row, ["summary_status", "summaryStatus"]) ?? "none",
    agent_name: pickNullableRecordString(row, ["agent_name", "agentName"]),
    queue_name: pickNullableRecordString(row, ["queue_name", "queueName"]),
    tenant_name: pickNullableRecordString(row, ["tenant_name", "tenantName"]),
  };
}

function callsApiUrl(
  tenantId?: string | null,
  limit: number = 200,
  startDate?: string,
  endDate?: string,
): string {
  const url = new URL(CALLS_API_URL, window.location.origin);
  if (tenantId) url.searchParams.set("tenantId", tenantId);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 1000)));
  if (startDate) url.searchParams.set("from", startDate);
  if (endDate) url.searchParams.set("to", endDate);
  return url.toString();
}

async function readCallsApiErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  if (!text.trim()) return "";
  try {
    const parsed = JSON.parse(text) as unknown;
    const body = asPlainRecord(parsed);
    const detail = body.message ?? body.error ?? body.detail;
    return typeof detail === "string" ? detail : text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

async function fetchCallsApiRows(
  tenantId?: string | null,
  limit: number = 200,
  startDate?: string,
  endDate?: string,
): Promise<CallsApiRow[]> {
  const res = await apiFetch(callsApiUrl(tenantId, limit, startDate, endDate), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const detail = await readCallsApiErrorDetail(res);
    throw new Error(`Calls API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }

  return extractCallsApiRows(await res.json())
    .map(normalizeCallsApiRow)
    .filter((row) => row.id && row.caller_number)
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
    .slice(0, Math.min(Math.max(limit, 1), 1000));
}

/** PBX row direction, or infer outbound when `direction` column is absent / default but CDR shape matches outbound. */
function resolveCallDirectionFromRow(c: {
  direction?: string | null;
  caller_number: string;
  dialed_number?: string | null;
  agent_id?: string | null;
}): "inbound" | "outbound" {
  if (c.direction === "outbound") return "outbound";
  if (c.direction === "inbound") return "inbound";
  const cust = String(c.caller_number ?? "").replace(/\D/g, "");
  const dialed = String(c.dialed_number ?? "").replace(/\D/g, "");
  const short = (s: string) => s.length >= 1 && s.length <= 7;
  const long = (s: string) => s.length >= 9;
  if (c.agent_id && dialed && short(dialed) && long(cust)) return "outbound";
  return "inbound";
}

/** Yeastar CDR primary key is `yeastar-<pbx_call_id>`; Linkus SDK uses the same id when they align. */
function pbxCallIdFromCallsRowId(id: string): string | null {
  if (!id.startsWith("yeastar-")) return null;
  return id.slice("yeastar-".length) || null;
}

function digitsOnlyText(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

function cleanPbxCallId(value: string): string {
  const withoutHost = String(value ?? "").trim().split("@")[0]?.trim() || "";
  return withoutHost.replace(/(?:[_-](?:leg|ring|queue|agent|ext|admin)[_-]?\d*)$/i, "");
}

function pbxDispositionLookupKeys(pbxId: string): string[] {
  const raw = String(pbxId ?? "").trim();
  const hostless = raw.split("@")[0]?.trim() || "";
  const cleaned = cleanPbxCallId(raw);
  return [...new Set([raw, hostless, cleaned].filter(Boolean))];
}

function pbxCallIdsCompatible(a: string, b: string): boolean {
  const aKeys = pbxDispositionLookupKeys(a);
  const bKeys = new Set(pbxDispositionLookupKeys(b));
  if (aKeys.some((key) => bKeys.has(key))) return true;

  const ad = digitsOnlyText(cleanPbxCallId(a));
  const bd = digitsOnlyText(cleanPbxCallId(b));
  if (!ad || !bd || Math.min(ad.length, bd.length) < 8) return false;
  return ad === bd || ad.endsWith(bd) || bd.endsWith(ad);
}

export async function fetchCalls(
  tenantId?: string | null,
  limit: number = 200,
  startDate?: string,
  endDate?: string,
): Promise<Call[]> {
  const rows = await fetchCallsApiRows(tenantId, limit, startDate, endDate);
  if (rows.length === 0) return [];

  const dispositionByLinkusId = await fetchSoftphoneDispositionAgentMap(tenantId, rows.map(r => r.id));


  // ── De-duplicate Yeastar CDR legs ────────────────────────────────────────
  // Yeastar PBX emits one CDR per call leg (queue ring, each agent ring, etc.).
  // We collapse those into one row per unique call, preferring the PBX call id
  // and only falling back to a narrow caller/time match.
  // Priority: softphone disposition match > recording/answered leg > longest duration.

  const DEDUP_WINDOW_MS = 90 * 1000;

  type RawRow = (typeof rows)[0];
  type DispositionAgent = { agentId: string; agentName: string };

  function findDispositionForPbxId(pbxId: string): DispositionAgent | undefined {
    for (const key of pbxDispositionLookupKeys(pbxId)) {
      const exact = dispositionByLinkusId.get(key);
      if (exact) return exact;
    }
    return [...dispositionByLinkusId.entries()].find(([key]) =>
      pbxCallIdsCompatible(key, pbxId),
    )?.[1];
  }

  function findDispositionForRow(row: RawRow): DispositionAgent | undefined {
    const pbxId = pbxCallIdFromCallsRowId(row.id);
    return pbxId ? findDispositionForPbxId(pbxId) : undefined;
  }

  // Score a row so we can pick the best leg.
  // Higher = better. Disposition match is king, then answered+DID, then answered.
  function rowScore(row: RawRow, disp: DispositionAgent | undefined): number {
    let score = 0;
    if (disp) score += 1000;                         // softphone disposition found
    if (row.result === "answered") score += 100;
    if (row.recording_url?.trim()) score += 80;      // answered agent leg (Linkus desktop has no browser disposition)
    if (row.dialed_number) score += 50;
    if ((row.duration_seconds ?? 0) > 0) score += 10;
    score += Math.min(row.duration_seconds ?? 0, 9); // tie-break by duration (cap at 9)
    return score;
  }

  function bestRecordingUrlFromCluster(
    cluster: RawRow[],
    clusterDisp: DispositionAgent | undefined,
  ): string | null {
    const recordingRow = cluster.reduce<RawRow | null>((best, row) => {
      if (!row.recording_url?.trim()) return best;
      if (!best) return row;
      const rowDisp = findDispositionForRow(row) ?? clusterDisp;
      const bestDisp = findDispositionForRow(best) ?? clusterDisp;
      return rowScore(row, rowDisp) > rowScore(best, bestDisp) ? row : best;
    }, null);
    return recordingRow?.recording_url?.trim() || null;
  }

  function pbxClusterKey(row: RawRow): string | null {
    const pbxId = pbxCallIdFromCallsRowId(row.id);
    const cleaned = pbxId ? cleanPbxCallId(pbxId) : "";
    return cleaned ? `pbx:${cleaned}` : null;
  }

  function numbersLikelySame(a: string, b: string): boolean {
    const da = digitsOnlyText(a);
    const db = digitsOnlyText(b);
    if (!da || !db) return false;
    return da === db || da.endsWith(db) || db.endsWith(da);
  }

  function optionalNumbersCompatible(a?: string | null, b?: string | null): boolean {
    const da = digitsOnlyText(a ?? "");
    const db = digitsOnlyText(b ?? "");
    if (!da || !db) return true;
    return da === db || da.endsWith(db) || db.endsWith(da);
  }

  function rowsLikelySameCall(a: RawRow, b: RawRow): boolean {
    const aKey = pbxClusterKey(a);
    const bKey = pbxClusterKey(b);
    if (aKey && bKey && aKey === bKey) return true;

    const aMs = new Date(a.start_time).getTime();
    const bMs = new Date(b.start_time).getTime();
    if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
    if (Math.abs(aMs - bMs) > DEDUP_WINDOW_MS) return false;

    return (
      resolveCallDirectionFromRow(a) === resolveCallDirectionFromRow(b) &&
      a.tenant_id === b.tenant_id &&
      a.queue_id === b.queue_id &&
      numbersLikelySame(a.caller_number, b.caller_number) &&
      optionalNumbersCompatible(a.dialed_number, b.dialed_number)
    );
  }

  // Build clusters: each cluster = one "real" call
  const clusters: RawRow[][] = [];

  for (const row of rows) {
    let placed = false;
    for (const cluster of clusters) {
      const rep = cluster[0];
      if (rowsLikelySameCall(row, rep)) {
        cluster.push(row);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([row]);
  }

  // Pick the best row from each cluster and keep track of the cluster-wide disposition
  const clusterData = clusters.map((cluster) => {
    // Find the disposition for any row in the cluster
    const clusterDisp = cluster.reduce<DispositionAgent | undefined>((found, r) => {
      if (found) return found;
      return findDispositionForRow(r);
    }, undefined);

    const winner = cluster.reduce((best, row) => {
      const rowDisp = findDispositionForRow(row);
      return rowScore(row, rowDisp ?? clusterDisp) > rowScore(best, clusterDisp)
        ? row
        : best;
    });

    const clusterRecording = bestRecordingUrlFromCluster(cluster, clusterDisp);
    const winnerWithRecording =
      clusterRecording && !winner.recording_url?.trim()
        ? { ...winner, recording_url: clusterRecording }
        : winner;

    return { winner: winnerWithRecording, disposition: clusterDisp };
  });

  const winners = clusterData.map(d => d.winner);
  const winnerDispositions = clusterData.map(d => d.disposition);

  const winnerAgentIds = winners.map((w, i) => winnerDispositions[i]?.agentId ?? w.agent_id);

  const allAgentIds = [...new Set(winnerAgentIds.filter((id): id is string => Boolean(id)))];
  const allQueueIds = [...new Set(winners.map((w) => w.queue_id))];
  const allTenantIds = [...new Set(winners.map((w) => w.tenant_id))];

  const [agentsRes, queuesRes, tenantsRes] = await Promise.all([
    allAgentIds.length > 0
      ? supabase.from("agents").select("id, name").in("id", allAgentIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    allQueueIds.length > 0
      ? supabase.from("queues").select("id, name").in("id", allQueueIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    allTenantIds.length > 0
      ? supabase.from("tenants").select("id, name").in("id", allTenantIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);

  if (agentsRes.error) throw new Error(agentsRes.error.message);
  if (queuesRes.error) throw new Error(queuesRes.error.message);
  if (tenantsRes.error) throw new Error(tenantsRes.error.message);

  const agentMap = new Map((agentsRes.data ?? []).map((a) => [a.id, a.name]));
  const queueMap = new Map((queuesRes.data ?? []).map((q) => [q.id, q.name]));
  const tenantMap = new Map((tenantsRes.data ?? []).map((t) => [t.id, t.name]));

  return winners.map((c, i) => {
    const effectiveAgentId = winnerAgentIds[i];
    const rowForDirection = { ...c, agent_id: effectiveAgentId };
    const dispName = winnerDispositions[i]?.agentName;
    const apiAgentName = c.agent_name?.trim();
    const apiQueueName = c.queue_name?.trim();
    const apiTenantName = c.tenant_name?.trim();
    const dbAgentName = effectiveAgentId ? agentMap.get(effectiveAgentId) : null;

    const direction = resolveCallDirectionFromRow(rowForDirection);

    return {
      id: c.id,
      tenantId: c.tenant_id,
      queueId: c.queue_id,
      agentId: effectiveAgentId,
      direction,
      callerNumber: c.caller_number,
      callerName: c.caller_name,
      dialedNumber: direction === "outbound" ? null : (c.dialed_number ?? null),
      startTime: c.start_time,
      answerTime: c.answer_time,
      endTime: c.end_time,
      durationSeconds: c.duration_seconds,
      result: c.result as CallResult,
      recordingUrl: c.recording_url,
      transcriptStatus: c.transcript_status as TranscriptStatus,
      summaryStatus: c.summary_status as "pending" | "ready" | "none",
      // Priority: 
      // 1. Captured Name from Softphone (Absolute authority)
      // 2. API-provided agent name
      // 3. Database Name from Agent Table (Fallback)
      // 4. Status-based label
      agentName: dispName || apiAgentName || dbAgentName || (effectiveAgentId ? "Unknown agent" : "—"),
      queueName: apiQueueName || queueMap.get(c.queue_id) || c.queue_id,
      tenantName: apiTenantName || tenantMap.get(c.tenant_id) || c.tenant_id,
    };
  });
}

/* ─── SIP Lines ─── */

export async function fetchSipLines(
  tenantId?: string | null,
): Promise<SipLine[]> {
  let query = supabase.from("sip_lines").select("*");
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query.order("label");
  if (error) throw new Error(error.message);
  return (data || []).map((l) => ({
    id: l.id,
    tenantId: l.tenant_id,
    label: l.label,
    trunkName: l.trunk_name,
    status: l.status as SipLineStatus,
    activeCaller: l.active_caller,
    activeSince: l.active_since ? Number(l.active_since) : null,
  }));
}

/* ─── Agent Groups ─── */

export async function fetchAgentGroups(
  tenantId?: string | null,
): Promise<AgentGroup[]> {
  let query = supabase.from("agent_groups").select("*");
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((g) => ({
    id: g.id,
    name: g.name,
    tenantId: g.tenant_id,
    queueId: g.queue_id,
    agentIds: g.agent_ids || [],
    ringStrategy: g.ring_strategy as RingStrategy,
  }));
}

/* ─── DID Mappings ─── */

export async function fetchDIDMappings(): Promise<DIDMapping[]> {
  const { data, error } = await dynamicSupabase
    .from("did_mappings")
    .select("*");
  if (error) throw new Error(error.message);
  return (data || []).map((d: Record<string, unknown>) => ({
    did: String(d.did ?? ""),
    tenantId: String(d.tenant_id ?? ""),
    queueId: String(d.queue_id ?? ""),
    label: String(d.label ?? ""),
    branchId: String(d.branch_id ?? ""),
    branchName: String(d.branch_name ?? ""),
    mappingWorkshopName: String(d.workshop_name ?? ""),
    ownerId: String(d.owner_id ?? ""),
  }));
}

/* ─── Caller Context ─── */

type UntypedSupabase = {
  from: (table: string) => UntypedSupabaseQuery;
};

type UntypedSupabaseData = Array<Record<string, unknown>> & Record<string, unknown>;

type UntypedSupabaseQuery = PromiseLike<{
  data: UntypedSupabaseData | null;
  error: { message?: string } | null;
}> & {
  select: (...args: unknown[]) => UntypedSupabaseQuery;
  insert: (...args: unknown[]) => UntypedSupabaseQuery;
  update: (...args: unknown[]) => UntypedSupabaseQuery;
  delete: (...args: unknown[]) => UntypedSupabaseQuery;
  upsert: (...args: unknown[]) => UntypedSupabaseQuery;
  eq: (...args: unknown[]) => UntypedSupabaseQuery;
  in: (...args: unknown[]) => UntypedSupabaseQuery;
  or: (...args: unknown[]) => UntypedSupabaseQuery;
  order: (...args: unknown[]) => UntypedSupabaseQuery;
  limit: (...args: unknown[]) => UntypedSupabaseQuery;
  single: (...args: unknown[]) => UntypedSupabaseQuery;
  maybeSingle: (...args: unknown[]) => UntypedSupabaseQuery;
};

const dynamicSupabase = supabase as unknown as UntypedSupabase;

/**
 * Agent chosen on Linkus answer/reject (durable; merged into fetchCalls).
 */
async function fetchSoftphoneDispositionAgentMap(
  tenantId: string | null | undefined,
  rawCallIds: string[],
): Promise<Map<string, { agentId: string; agentName: string }>> {
  if (rawCallIds.length === 0) return new Map();

  // Extract clean PBX IDs for the query (handle -admin, _leg, etc. suffixes)
  const cleanIds = rawCallIds
    .map((id) => pbxCallIdFromCallsRowId(id))
    .filter((id): id is string => Boolean(id))
    .flatMap(pbxDispositionLookupKeys);

  const uniqueIds = [...new Set(cleanIds)];
  if (uniqueIds.length === 0) return new Map();

  // Fetch only the dispositions relevant to these calls
  let q = dynamicSupabase
    .from("softphone_call_dispositions")
    .select("linkus_call_id, agent_id, agent_name")
    .in("linkus_call_id", uniqueIds.slice(0, 500)); // Cap at 500 to stay within query limits

  if (tenantId) q = q.eq("tenant_id", tenantId);

  const { data, error } = await q;
  if (error || !data?.length) return new Map();

  const m = new Map<string, { agentId: string; agentName: string }>();
  for (const row of data as Array<{
    linkus_call_id?: string;
    agent_id?: string;
    agent_name?: string | null;
  }>) {
    if (row.linkus_call_id && row.agent_id) {
      m.set(row.linkus_call_id, {
        agentId: row.agent_id,
        agentName: row.agent_name || "",
      });
    }
  }
  return m;
}

/** Linkus answer/reject row for Audit Logs (`softphone_call_dispositions`). */
export type SoftphoneCallDispositionAuditRow = {
  linkusCallId: string;
  agentId: string;
  tenantId: string;
  agentName: string;
  tenantName: string;
  action: "answered" | "rejected";
  callerNumber: string;
  createdAt: string;
  updatedAt: string;
};

export async function fetchSoftphoneCallDispositionsForAudit(
  limit: number = 200,
): Promise<SoftphoneCallDispositionAuditRow[]> {
  const lim = Math.min(Math.max(limit, 1), 500);
  const { data, error } = await dynamicSupabase
    .from("softphone_call_dispositions")
    .select(
      "linkus_call_id, agent_id, tenant_id, action, caller_number, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(lim);

  if (error) {
    throw new Error(
      (error as { message?: string }).message ??
        "softphone_call_dispositions fetch failed",
    );
  }

  const rows = (data ?? []) as Array<{
    linkus_call_id: string;
    agent_id: string;
    tenant_id: string;
    action: string;
    caller_number: string | null;
    created_at: string;
    updated_at: string;
  }>;
  if (rows.length === 0) return [];

  const agentIds = [...new Set(rows.map((r) => r.agent_id).filter(Boolean))];
  const tenantIds = [...new Set(rows.map((r) => r.tenant_id).filter(Boolean))];

  const [agentsRes, tenantsRes] = await Promise.all([
    agentIds.length > 0
      ? supabase.from("agents").select("id, name").in("id", agentIds)
      : Promise.resolve({
          data: [] as { id: string; name: string }[],
          error: null,
        }),
    tenantIds.length > 0
      ? supabase.from("tenants").select("id, name").in("id", tenantIds)
      : Promise.resolve({
          data: [] as { id: string; name: string }[],
          error: null,
        }),
  ]);

  if (agentsRes.error) throw new Error(agentsRes.error.message);
  if (tenantsRes.error) throw new Error(tenantsRes.error.message);

  const agentMap = new Map((agentsRes.data ?? []).map((a) => [a.id, a.name]));
  const tenantMap = new Map((tenantsRes.data ?? []).map((t) => [t.id, t.name]));

  return rows.map((r) => {
    const act = String(r.action ?? "").toLowerCase();
    const action: "answered" | "rejected" =
      act === "rejected" ? "rejected" : "answered";
    return {
      linkusCallId: r.linkus_call_id,
      agentId: r.agent_id,
      tenantId: r.tenant_id,
      agentName: agentMap.get(r.agent_id) ?? "Unknown agent",
      tenantName: tenantMap.get(r.tenant_id) ?? r.tenant_id,
      action,
      callerNumber: String(r.caller_number ?? ""),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export function normalizePhoneNumber(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "");
}

/**
 * Builds every plausible format of a phone number so the DB lookup
 * succeeds regardless of how the number was originally stored.
 *
 * Covers: +94…, 94…, 0…, raw local (no prefix), and the original input.
 */
export function buildPhoneLookupVariants(
  phone: string | null | undefined,
): string[] {
  const raw = String(phone ?? "").trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, "");
  if (!digits) return [];

  const variants = new Set<string>();

  variants.add(digits);
  variants.add(raw);
  if (raw.startsWith("+")) variants.add(raw.slice(1));

  // Sri Lanka: 94 + 9-digit local  →  also try 0 + local and bare local
  if (digits.startsWith("94") && digits.length === 11) {
    const local = digits.slice(2); // 766524216
    variants.add(`0${local}`); // 0766524216
    variants.add(local); // 766524216
    variants.add(`+94${local}`); // +94766524216
  }

  // Local with leading zero  →  also try with country code
  if (digits.startsWith("0") && digits.length === 10) {
    const local = digits.slice(1); // 766524216
    variants.add(`94${local}`); // 94766524216
    variants.add(`+94${local}`); // +94766524216
    variants.add(local); // 766524216
  }

  // Bare local (9 digits, no prefix) — common when Yeastar strips the trunk prefix
  if (
    !digits.startsWith("0") &&
    !digits.startsWith("94") &&
    digits.length === 9
  ) {
    variants.add(`0${digits}`); // 0766524216
    variants.add(`94${digits}`); // 94766524216
    variants.add(`+94${digits}`); // +94766524216
  }

  return Array.from(variants);
}

export async function fetchCallerContext(
  tenantId: string,
  callerNumber: string,
): Promise<CallerContext | null> {
  const variants = buildPhoneLookupVariants(callerNumber);
  if (!tenantId || variants.length === 0) return null;

  const phoneFilter = variants
    .flatMap((variant) => [
      `phone_normalized.eq.${variant}`,
      `primary_phone.eq.${variant}`,
    ])
    .join(",");

  const { data: customer, error: customerError } = await dynamicSupabase
    .from("customers")
    .select("*")
    .eq("tenant_id", tenantId)
    .or(phoneFilter)
    .maybeSingle();

  if (customerError) throw new Error(customerError.message);
  if (!customer) return null;

  const { data: vehicles, error: vehicleError } = await dynamicSupabase
    .from("vehicles")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customer.id)
    .order("created_at");

  if (vehicleError) throw new Error(vehicleError.message);

  const vehicleRows = (vehicles || []) as Record<string, unknown>[];
  const vehicleIds = vehicleRows.map((vehicle) => String(vehicle.id));

  let serviceRows: Record<string, unknown>[] = [];
  if (vehicleIds.length > 0) {
    const { data: services, error: serviceError } = await dynamicSupabase
      .from("services")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customer.id)
      .in("vehicle_id", vehicleIds)
      .order("service_date", { ascending: false });

    if (serviceError) throw new Error(serviceError.message);
    serviceRows = (services || []) as Record<string, unknown>[];
  }

  return {
    customer: mapCustomerRecord(customer as Record<string, unknown>),
    vehicles: vehicleRows.map(mapVehicleRecord),
    services: serviceRows.map(mapServiceRecord),
  };
}

/* ─── Incoming Calls — Yeastar Real-Time Integration ─── */

export { DASHBOARD_DISMISS_INCOMING_CALLER_EVENT } from "@/services/linkusCallLog";

/**
 * Kept for backwards compat — returns empty array.
 * Use subscribeToIncomingCalls() for live data.
 */
export async function fetchIncomingCalls(
  _allowedQueueIds?: string[],
): Promise<IncomingCall[]> {
  return [];
}

/**
 * Subscribe to live incoming call events broadcast by the
 * yeastar-webhook Supabase Edge Function.
 *
 * The Yeastar PBX fires an IncomingCall event when a call rings.
 * The edge function translates it and broadcasts it here via
 * Supabase Realtime so the dashboard shows it instantly.
 *
 * @returns cleanup function — call it in useEffect cleanup
 */
export function subscribeToIncomingCalls(
  allowedQueueIds: string[],
  onCall: (call: IncomingCall) => void,
  onHangup?: (callId: string) => void,
): () => void {
  const channel = supabase
    .channel("yeastar-incoming-calls")
    .on("broadcast", { event: "IncomingCall" }, ({ payload }) => {
      // If supervisor/agent, filter to their queues
      if (
        allowedQueueIds.length === 0 ||
        allowedQueueIds.includes(payload.queueId)
      ) {
        onCall(payload as IncomingCall);
      }
    })
    .on("broadcast", { event: "CallHangup" }, ({ payload }) => {
      // Call ended — remove from ringing list
      onHangup?.(payload.id as string);
    })
    .on("broadcast", { event: "CallAnswered" }, ({ payload }) => {
      // Agent picked up — stop ringing immediately (don't wait for the CDR)
      onHangup?.(payload.id as string);
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to agent table changes (Postgres CDC).
 * Triggers whenever the yeastar-webhook updates agent status.
 */
export function subscribeToAgents(
  tenantId: string | null,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel("yeastar-agents-cdc")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "agents",
        ...(tenantId ? { filter: `tenant_id=eq.${tenantId}` } : {}),
      },
      () => onChange(),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to calls table changes (Postgres CDC).
 * Triggers whenever the yeastar-webhook inserts a new CDR.
 */
export function subscribeToCalls(
  tenantId: string | null,
  onChange: () => void,
): () => void {
  const callsFilter = tenantId ? { filter: `tenant_id=eq.${tenantId}` } : {};
  const dispFilter = tenantId
    ? { filter: `tenant_id=eq.${tenantId}` }
    : {};

  const channel = supabase
    .channel("yeastar-calls-cdc")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "calls",
        ...callsFilter,
      },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "calls",
        ...callsFilter,
      },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "softphone_call_dispositions",
        ...dispFilter,
      },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "softphone_call_dispositions",
        ...dispFilter,
      },
      () => onChange(),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/* ─── Client Onboarding ─── */

export async function fetchClients(
  tenantId?: string | null,
): Promise<TenantOnboarding[]> {
  let query = supabase.from("tenant_onboarding").select("*, tenants(*)");
  if (tenantId) query = query.eq("id", tenantId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map(mapOnboarding);
}

function mapOnboarding(row: Record<string, unknown>): TenantOnboarding {
  const t =
    row.tenants && typeof row.tenants === "object" && !Array.isArray(row.tenants)
      ? (row.tenants as Record<string, unknown>)
      : {};
  return {
    id: String(row.id ?? ""),
    name: String(t.name ?? ""),
    industry: String(t.industry ?? ""),
    status: t.status === "inactive" ? "inactive" : "active",
    brandColor: String(t.brand_color ?? "#00d4f5"),
    didNumbers: Array.isArray(t.did_numbers) ? t.did_numbers.map(String) : [],
    onboardingStage: row.onboarding_stage as TenantOnboarding["onboardingStage"],
    contactName: String(row.contact_name ?? ""),
    contactPhone: String(row.contact_phone ?? ""),
    contactEmail: String(row.contact_email ?? ""),
    createdBy: String(row.created_by ?? ""),
    createdAt: String(row.created_at ?? ""),
    notes: String(row.notes ?? ""),
    clientDetails:
      (row.client_details as TenantOnboarding["clientDetails"] | undefined) ??
      ({} as TenantOnboarding["clientDetails"]),
    businessRules:
      (row.business_rules as TenantOnboarding["businessRules"] | undefined) ??
      ({} as TenantOnboarding["businessRules"]),
    queueSetup:
      (row.queue_setup as TenantOnboarding["queueSetup"] | undefined) ?? { queues: [] },
    scriptKnowledgeBase:
      (row.script_knowledge_base as TenantOnboarding["scriptKnowledgeBase"] | undefined) ??
      ({} as TenantOnboarding["scriptKnowledgeBase"]),
    bookingRules:
      (row.booking_rules as TenantOnboarding["bookingRules"] | undefined) ??
      ({} as TenantOnboarding["bookingRules"]),
    testingGoLive:
      (row.testing_go_live as TenantOnboarding["testingGoLive"] | undefined) ??
      ({} as TenantOnboarding["testingGoLive"]),
    activityLog: Array.isArray(row.activity_log)
      ? (row.activity_log as TenantOnboarding["activityLog"])
      : [],
  };
}

function mapCustomerRecord(row: Record<string, unknown>): CustomerRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name ?? ""),
    primaryPhone: String(row.primary_phone ?? ""),
    phoneNormalized: String(row.phone_normalized ?? ""),
    email: row.email ? String(row.email) : null,
    address: row.address ? String(row.address) : null,
    notes: row.notes ? String(row.notes) : null,
  };
}

function mapVehicleRecord(row: Record<string, unknown>): VehicleRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    rego: String(row.rego ?? ""),
    make: String(row.make ?? ""),
    model: String(row.model ?? ""),
    year:
      typeof row.year === "number"
        ? row.year
        : row.year
          ? Number(row.year)
          : null,
    color: row.color ? String(row.color) : null,
    vin: row.vin ? String(row.vin) : null,
    notes: row.notes ? String(row.notes) : null,
  };
}

function mapServiceRecord(row: Record<string, unknown>): ServiceRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    vehicleId: String(row.vehicle_id),
    serviceDate: String(row.service_date ?? ""),
    serviceType: String(row.service_type ?? ""),
    odometerKm:
      typeof row.odometer_km === "number"
        ? row.odometer_km
        : row.odometer_km
          ? Number(row.odometer_km)
          : null,
    amount:
      typeof row.amount === "number"
        ? row.amount
        : row.amount
          ? Number(row.amount)
          : null,
    advisorNotes: row.advisor_notes ? String(row.advisor_notes) : null,
  };
}

/* ─── Bookings ─── */

export interface CreateBookingInput {
  tenantId: string;
  customerId?: string | null;
  vehicleId?: string | null;
  vehicleRego?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serviceType: string;
  bookingDate: string;
  dropOffTime: string;
  pickupTime?: string;
  notes?: string;
}

export async function createBooking(input: CreateBookingInput): Promise<void> {
  const { error } = await (supabase as unknown as UntypedSupabase)
    .from("bookings")
    .insert({
      tenant_id: input.tenantId,
      customer_id: input.customerId || null,
      vehicle_id: input.vehicleId || null,
      vehicle_rego: input.vehicleRego || null,
      vehicle_make: input.vehicleMake || null,
      vehicle_model: input.vehicleModel || null,
      vehicle_year: input.vehicleYear ? Number(input.vehicleYear) : null,
      customer_name: input.customerName,
      customer_phone: input.customerPhone,
      customer_email: input.customerEmail || null,
      service_type: input.serviceType,
      booking_date: input.bookingDate,
      drop_off_time: input.dropOffTime,
      pickup_time: input.pickupTime || null,
      notes: input.notes || null,
      status: "pending",
    });
  if (error) throw new Error(error.message);
}

function mapBookingRecord(row: Record<string, unknown>): BookingRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: row.customer_id ? String(row.customer_id) : null,
    vehicleId: row.vehicle_id ? String(row.vehicle_id) : null,
    vehicleRego: row.vehicle_rego ? String(row.vehicle_rego) : null,
    vehicleMake: row.vehicle_make ? String(row.vehicle_make) : null,
    vehicleModel: row.vehicle_model ? String(row.vehicle_model) : null,
    vehicleYear:
      typeof row.vehicle_year === "number"
        ? row.vehicle_year
        : row.vehicle_year
          ? Number(row.vehicle_year)
          : null,
    customerName: String(row.customer_name ?? ""),
    customerPhone: String(row.customer_phone ?? ""),
    customerEmail: row.customer_email ? String(row.customer_email) : null,
    serviceType: String(row.service_type ?? ""),
    bookingDate: String(row.booking_date ?? ""),
    dropOffTime: String(row.drop_off_time ?? ""),
    pickupTime: row.pickup_time ? String(row.pickup_time) : null,
    notes: row.notes ? String(row.notes) : null,
    status: (row.status as BookingStatus) ?? "pending",
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function fetchBookings(
  tenantId: string | null,
): Promise<BookingRecord[]> {
  let query = (supabase as unknown as UntypedSupabase)
    .from("bookings")
    .select("*")
    .order("booking_date", { ascending: false });
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapBookingRecord);
}

export async function fetchBookingById(
  id: string,
): Promise<BookingRecord | null> {
  const { data, error } = await (supabase as unknown as UntypedSupabase)
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return mapBookingRecord(data as Record<string, unknown>);
}

export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
): Promise<void> {
  const { error } = await (supabase as unknown as UntypedSupabase)
    .from("bookings")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchLatestBookingByPhone(
  tenantId: string,
  phone: string,
  branchId?: string,
): Promise<BookingRecord | null> {
  try {
    // Fetch latest bookings for this owner (and branch if provided) from Firebase
    const ownerUid = await resolveBmsOwnerUidForTenant(tenantId);
    if (!ownerUid) return null;
    const bookings = await getBookings({
      scope: "tenant",
      ownerUid,
      limit: 50,
      branchId,
    });
    const normalizedPhone = phone.replace(/\D/g, "");

    // Support Sri Lanka specific formatting cases for the local 10-digit number
    const localPhone =
      normalizedPhone.startsWith("94") && normalizedPhone.length === 11
        ? `0${normalizedPhone.slice(2)}`
        : normalizedPhone;

    const matching = bookings.filter((b) => {
      const bPhone = (b.clientPhone || "").replace(/\D/g, "");
      return bPhone === normalizedPhone || bPhone === localPhone;
    });

    if (matching.length === 0) return null;

    // Sort descending by date
    matching.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const b = matching[0];

    // Map to BookingRecord for UI compatibility
    return {
      id: b.id,
      tenantId,
      customerId: b.customerId || null,
      vehicleId: null,
      vehicleRego: b.vehicleNumber || null,
      vehicleMake: null,
      vehicleModel: null,
      vehicleYear: null,
      customerName: b.client || "Unknown",
      customerPhone: b.clientPhone || "",
      customerEmail: b.clientEmail || null,
      serviceType:
        b.services?.map((s) => s.serviceName).join(", ") || "General Service",
      bookingDate: b.date,
      dropOffTime: b.time,
      pickupTime: b.pickupTime || null,
      notes: b.notes || null,
      status: "confirmed", // Fallback status
      createdAt: b.date,
      updatedAt: b.date,
    } as unknown as BookingRecord;
  } catch {
    // console.warn("fetchLatestBookingByPhone Firebase error:", error);
    return null;
  }
}

export async function createClient(
  data: NewClientForm,
  session: UserSession,
): Promise<TenantOnboarding> {
  // Create tenant first
  const tenantId = `t-${Date.now()}`;
  const { error: tErr } = await supabase.from("tenants").insert({
    id: tenantId,
    name: data.businessName.trim(),
    industry: data.industry,
    status: "active",
    brand_color: data.brandColor,
    did_numbers: [],
  });
  if (tErr) throw new Error(tErr.message);

  // Create onboarding record
  const { error: oErr } = await supabase.from("tenant_onboarding").insert({
    id: tenantId,
    onboarding_stage: "new",
    contact_name: data.contactName.trim(),
    contact_phone: data.contactPhone.trim(),
    contact_email: data.contactEmail.trim(),
    created_by: session.userId,
    notes: data.notes.trim(),
    client_details: {
      businessName: data.businessName.trim(),
      industry: data.industry,
      primaryContactName: data.contactName.trim(),
      primaryContactPhone: data.contactPhone.trim(),
      primaryContactEmail: data.contactEmail.trim(),
    },
  });
  if (oErr) throw new Error(oErr.message);

  await logSystemActivity(
    session,
    "CREATE_CLIENT",
    "TENANT_ONBOARDING",
    tenantId,
    { businessName: data.businessName.trim() },
  );

  const clients = await fetchClients(tenantId);
  return clients[0];
}

export async function advanceClientStage(
  clientId: string,
  session?: UserSession,
): Promise<{
  client: TenantOnboarding | null;
  transition: StageTransitionResult | null;
}> {
  const clients = await fetchClients(clientId);
  const client = clients[0];
  if (!client) return { client: null, transition: null };

  const nextStage = getNextStage(client.onboardingStage);
  if (!nextStage) {
    return {
      client,
      transition: {
        allowed: false,
        blockers: [
          {
            section: "Stage",
            field: "onboardingStage",
            message: "No next stage available",
            severity: "blocker",
          },
        ],
        warnings: [],
        targetStage: client.onboardingStage,
      },
    };
  }

  const transition = validateStageTransition(client, nextStage);

  if (transition.allowed) {
    await supabase
      .from("tenant_onboarding")
      .update({ onboarding_stage: nextStage })
      .eq("id", clientId);

    if (session) {
      await logSystemActivity(
        session,
        "ADVANCE_CLIENT_STAGE",
        "TENANT_ONBOARDING",
        clientId,
        { fromStage: client.onboardingStage, toStage: nextStage },
      );
    }

    const updated = await fetchClients(clientId);
    return { client: updated[0], transition };
  }

  return { client, transition };
}

export async function regressClientStage(
  clientId: string,
  session?: UserSession,
  reason: string = "",
): Promise<TenantOnboarding | null> {
  await supabase
    .from("tenant_onboarding")
    .update({ onboarding_stage: "needs-revision" })
    .eq("id", clientId);

  if (session) {
    await logSystemActivity(
      session,
      "REGRESS_CLIENT_STAGE",
      "TENANT_ONBOARDING",
      clientId,
      { toStage: "needs-revision", reason },
    );
  }

  const clients = await fetchClients(clientId);
  return clients[0] || null;
}

export async function getClientValidation(clientId: string) {
  const clients = await fetchClients(clientId);
  const client = clients[0];
  if (!client) return null;

  return {
    blockers: getGoLiveBlockers(client),
    warnings: getGoLiveWarnings(client),
  };
}
