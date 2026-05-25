import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { apiFetch } from "@/lib/api";

export type SalesLeadRow = Database["public"]["Tables"]["sales_leads"]["Row"];
export type SalesCampaignRow = Database["public"]["Tables"]["sales_campaigns"]["Row"];
export type SalesInteractionRow =
  Database["public"]["Tables"]["sales_lead_interactions"]["Row"];
export type LeadJourneyStage = Database["public"]["Enums"]["lead_journey_stage"];
export type LeadCallOutcome = Database["public"]["Enums"]["lead_call_outcome"];
export type SalesTrialRow = Database["public"]["Tables"]["sales_trials"]["Row"];
export type SalesSiteVisitRow = Database["public"]["Tables"]["sales_site_visits"]["Row"];
export type SalesCommissionRow =
  Database["public"]["Tables"]["sales_commission_events"]["Row"];
export type SalesSuburbRow =
  Database["public"]["Tables"]["sales_agent_suburb_assignments"]["Row"];
export type SalesSuburbWorkshopRow =
  Database["public"]["Tables"]["sales_suburb_workshops"]["Row"];
export type SalesSuburbWorkshopContactRow =
  Database["public"]["Tables"]["sales_suburb_workshop_agent_contact"]["Row"];
/** Workshop directory row plus this agent’s call/remarks from `sales_suburb_workshop_agent_contact`. */
export type SalesSuburbWorkshopWithAgentContact = SalesSuburbWorkshopRow & {
  agent_contact_id: string | null;
  agent_first_called_at: string | null;
  agent_remarks: string;
  agent_follow_up_at: string | null;
  agent_call_status: string | null;
};

export type FetchSalesSuburbWorkshopsWithAgentContactOptions = {
  agentId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
};

/** Match workshop rows to suburb strings on leads and assignments */
export function normalizeSalesSuburbKey(s: string): string {
  return s.trim().toLowerCase();
}

/** All workshops for one suburb label (normalized match), sorted by workshop name then id */
export function workshopsMatchingSuburb(
  workshops: SalesSuburbWorkshopRow[],
  suburb: string,
): SalesSuburbWorkshopRow[] {
  const k = normalizeSalesSuburbKey(suburb);
  if (!k) return [];
  return workshops
    .filter((w) => normalizeSalesSuburbKey(w.suburb) === k)
    .slice()
    .sort((a, b) => {
      const nm = (a.workshop_name || "").localeCompare(b.workshop_name || "", undefined, {
        sensitivity: "base",
      });
      return nm !== 0 ? nm : a.id.localeCompare(b.id);
    });
}

export async function fetchSalesCampaigns(tenantId: string): Promise<SalesCampaignRow[]> {
  const { data, error } = await supabase
    .from("sales_campaigns")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createSalesCampaign(params: {
  tenantId: string;
  name: string;
  isActive?: boolean;
}): Promise<SalesCampaignRow> {
  const { tenantId, name, isActive = true } = params;
  const { data, error } = await supabase
    .from("sales_campaigns")
    .insert({ tenant_id: tenantId, name: name.trim(), is_active: isActive })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Admin / supervisor: visible leads for tenant scope. */
export async function fetchSalesLeadsTenant(tenantId: string): Promise<SalesLeadRow[]> {
  const { data, error } = await supabase
    .from("sales_leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** RLS restricts to assigned, non-DNC rows for agents. */
export async function fetchSalesLeadsMine(): Promise<SalesLeadRow[]> {
  const { data, error } = await supabase
    .from("sales_leads")
    .select("*")
    .order("follow_up_at", { ascending: true, nullsFirst: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertSalesLead(
  row: Database["public"]["Tables"]["sales_leads"]["Insert"],
): Promise<SalesLeadRow> {
  const { data, error } = await supabase.from("sales_leads").insert(row).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateSalesLeadAssignment(
  leadId: string,
  assignedAgentId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("sales_leads")
    .update({ assigned_agent_id: assignedAgentId, updated_at: new Date().toISOString() })
    .eq("id", leadId);
  if (error) throw error;
}

export async function updateSalesLeadFlags(
  leadId: string,
  patch: Pick<SalesLeadRow, "do_not_call"> & Partial<Pick<SalesLeadRow, "display_name" | "phone" | "suburb">>,
): Promise<void> {
  const { error } = await supabase.from("sales_leads").update(patch).eq("id", leadId);
  if (error) throw error;
}

export async function deleteSalesLead(leadId: string): Promise<void> {
  const { error } = await supabase.from("sales_leads").delete().eq("id", leadId);
  if (error) throw error;
}

/** Desk notes visible to admins on the lead row. Outcome drawer overwrites notes when agents log calls. */
export async function updateSalesLeadDeskNotes(leadId: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from("sales_leads")
    .update({
      notes: notes.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (error) throw error;
}

/** Sets first call timestamp (if not yet set) and bumps stage from assigned→called. Claims unassigned leads in the agent’s suburb patch. Uses DB RPC so RLS + claim rules stay in sync. */
export async function markSalesLeadCalled(leadId: string): Promise<void> {
  const { data, error } = await supabase.rpc("mark_sales_lead_called", {
    p_lead_id: leadId,
  });
  if (error) throw error;
  if (data && typeof data === "object" && "ok" in data && !(data as { ok: boolean }).ok) {
    throw new Error("Could not mark as called");
  }
}

export async function applySalesLeadOutcome(params: {
  leadId: string;
  outcome: LeadCallOutcome;
  notes: string;
  customerResponse?: string;
  followUpAt?: string | null;
}): Promise<void> {
  const { data, error } = await supabase.rpc("apply_sales_lead_outcome", {
    p_lead_id: params.leadId,
    p_outcome: params.outcome,
    p_notes: params.notes,
    p_customer_response: params.customerResponse ?? "",
    p_follow_up_at: params.followUpAt ?? null,
  });
  if (error) throw error;
  if (data && typeof data === "object" && "ok" in data && !(data as { ok: boolean }).ok) {
    throw new Error("Outcome was not saved");
  }
}

export async function fetchSalesInteractions(tenantId: string): Promise<
  Array<
    SalesInteractionRow & {
      lead?: Pick<SalesLeadRow, "id" | "display_name" | "phone" | "journey_stage" | "suburb"> | null;
    }
  >
> {
  const { data: ints, error: e1 } = await supabase
    .from("sales_lead_interactions")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (e1) throw e1;
  const rows = ints ?? [];
  if (rows.length === 0) return [];

  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
  const { data: leads, error: e2 } = await supabase
    .from("sales_leads")
    .select("id, display_name, phone, journey_stage, suburb")
    .in("id", leadIds);
  if (e2) throw e2;
  const byId = new Map((leads ?? []).map((l) => [l.id, l]));
  return rows.map((r) => ({ ...r, lead: byId.get(r.lead_id) ?? null }));
}

export async function fetchSalesTrialsTenant(tenantId: string): Promise<SalesTrialRow[]> {
  const { data, error } = await supabase
    .from("sales_trials")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchSalesSiteVisitsTenant(
  tenantId: string,
): Promise<SalesSiteVisitRow[]> {
  const { data, error } = await supabase
    .from("sales_site_visits")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("booked_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchSalesCommissionTenant(
  tenantId: string,
): Promise<SalesCommissionRow[]> {
  const { data, error } = await supabase
    .from("sales_commission_events")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchSalesSuburbs(tenantId: string): Promise<SalesSuburbRow[]> {
  const tenantKey = tenantId.trim();
  const raw = await requestSalesSuburbAssignments("GET", { tenantId: tenantKey });
  const rows = extractAssignmentRows(raw)
    .map(rowToSalesSuburbAssignment)
    .filter(
      (row) =>
        Boolean(row.id) &&
        (!tenantKey || !row.tenant_id || row.tenant_id === tenantKey),
    );
  return sortSalesSuburbAssignments(rows);
}

/** Agent-facing: rows for this agent profile (RLS limits to own agent_id). */
export async function fetchAgentSuburbsAssigned(): Promise<SalesSuburbRow[]> {
  const raw = await requestSalesSuburbAssignments("GET");
  const rows = extractAssignmentRows(raw)
    .map(rowToSalesSuburbAssignment)
    .filter((row) => Boolean(row.id));
  return sortSalesSuburbAssignments(rows);
}

export async function fetchSalesSuburbAssignment(id: string): Promise<SalesSuburbRow | null> {
  const assignmentId = id.trim();
  if (!assignmentId) return null;

  try {
    const raw = await requestSalesSuburbAssignments("GET", { id: assignmentId });
    const assignment = rowToSalesSuburbAssignment(extractAssignmentRow(raw));
    return assignment.id ? assignment : null;
  } catch (err) {
    if (err instanceof Error && /\b404\b/.test(err.message)) return null;
    throw err;
  }
}

export async function insertSalesSuburb(params: {
  tenantId: string;
  agentId: string;
  suburb: string;
}): Promise<SalesSuburbRow> {
  const payload = toSalesSuburbAssignmentPayload(params);
  const raw = await requestSalesSuburbAssignments("POST", {
    body: payload,
  });
  const assignment = rowToSalesSuburbAssignment(extractAssignmentRow(raw));
  return assignment.id
    ? assignment
    : rowToSalesSuburbAssignment({ ...payload, tenantId: params.tenantId });
}

export async function updateSalesSuburb(
  id: string,
  params: {
    tenantId?: string;
    agentId?: string;
    suburb?: string;
  },
): Promise<SalesSuburbRow | null> {
  const raw = await requestSalesSuburbAssignments("PATCH", {
    id,
    body: toSalesSuburbAssignmentPayload(params),
  });
  const assignment = rowToSalesSuburbAssignment(extractAssignmentRow(raw));
  return assignment.id ? assignment : null;
}

export async function deleteSalesSuburb(id: string): Promise<void> {
  await requestSalesSuburbAssignments("DELETE", { id });
}

/** Admin scope */
export async function fetchSalesSuburbWorkshopsTenant(
  tenantId: string,
): Promise<SalesSuburbWorkshopRow[]> {
  const tenantKey = tenantId.trim();
  const raw = await requestSalesSuburbWorkshops("GET", { tenantId: tenantKey });
  const rows = extractWorkshopRows(raw)
    .map(rowToSalesSuburbWorkshop)
    .filter(
      (row) =>
        Boolean(row.id) &&
        (!tenantKey || !row.tenant_id || row.tenant_id === tenantKey),
    );
  return sortSalesSuburbWorkshops(rows);
}

/** Admin scope — all tenants visible to the API caller. */
export async function fetchSalesSuburbWorkshopsAllTenants(): Promise<SalesSuburbWorkshopRow[]> {
  const raw = await requestSalesSuburbWorkshops("GET");
  const rows = extractWorkshopRows(raw)
    .map(rowToSalesSuburbWorkshop)
    .filter((row) => Boolean(row.id));
  return sortSalesSuburbWorkshops(rows);
}

/** Assigned suburbs only — RLS. */
export async function fetchSalesSuburbWorkshopsMine(): Promise<SalesSuburbWorkshopRow[]> {
  const raw = await requestSalesSuburbWorkshops("GET");
  const rows = extractWorkshopRows(raw)
    .map(rowToSalesSuburbWorkshop)
    .filter((row) => Boolean(row.id));
  return sortSalesSuburbWorkshops(rows);
}

/** Super admin / tenant staff: every agent workshop touch row for CRM reporting.
 *  Hits `GET /api/sales-suburb-workshop-agent-contacts` (no filter) and narrows by tenant
 *  client-side so admins see every agent's activity for the selected tenant.
 *  If the tenant filter would empty out the results (e.g. backend doesn't return
 *  tenant_id yet), we fall back to all rows so the admin can still see activity. */
export async function fetchSalesSuburbWorkshopAgentContactTenant(
  tenantId: string,
): Promise<SalesSuburbWorkshopContactRow[]> {
  const tenantKey = tenantId.trim();
  const all = await fetchSalesSuburbWorkshopAgentContactsMine();
  const matching = tenantKey
    ? all.filter((r) => r.tenant_id === tenantKey)
    : all;
  const rows = matching.length > 0 ? matching : all;

  return rows.slice().sort((a, b) => {
    const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return tb - ta;
  });
}

async function resolveSalesAgentScope(
  options: FetchSalesSuburbWorkshopsWithAgentContactOptions,
): Promise<{ agentId: string | null; tenantId: string | null }> {
  let agentId = options.agentId?.trim() || null;
  let tenantId = options.tenantId?.trim() || null;
  const userId = options.userId?.trim();

  if ((!agentId || !tenantId) && userId) {
    const { data, error } = await supabase
      .from("agents")
      .select("id, tenant_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(formatSupabaseError(error));
    agentId = agentId ?? data?.id ?? null;
    tenantId = tenantId ?? data?.tenant_id ?? null;
  }

  return { agentId, tenantId };
}

/** Workshops + per-agent overlays both come from the backend REST API
 *  (`/api/sales-suburb-workshops` and `/api/sales-suburb-workshop-agent-contacts`). */
export async function fetchSalesSuburbWorkshopsWithAgentContact(
  options: FetchSalesSuburbWorkshopsWithAgentContactOptions = {},
): Promise<SalesSuburbWorkshopWithAgentContact[]> {
  const { agentId, tenantId } = await resolveSalesAgentScope(options);

  const workshopsPromise = (tenantId
    ? fetchSalesSuburbWorkshopsTenant(tenantId)
    : fetchSalesSuburbWorkshopsAllTenants()
  ).catch(() => [] as SalesSuburbWorkshopRow[]);

  const contactsPromise = fetchSalesSuburbWorkshopAgentContactsMine({
    agentId,
    tenantId,
  }).catch(() => [] as SalesSuburbWorkshopContactRow[]);

  const [workshops, contacts] = await Promise.all([workshopsPromise, contactsPromise]);

  const scopedContacts = agentId ? contacts.filter((c) => c.agent_id === agentId) : contacts;
  const byWorkshop = new Map(scopedContacts.map((c) => [c.workshop_id, c] as const));
  return sortSalesSuburbWorkshops(workshops).map((w) => {
    const c = byWorkshop.get(w.id);
    return {
      ...w,
      agent_contact_id: c?.id ?? null,
      agent_first_called_at: c?.first_called_at ?? null,
      agent_remarks: c?.remarks ?? "",
      agent_follow_up_at: c?.follow_up_at ?? null,
      agent_call_status: c?.call_status ?? null,
    };
  });
}

/** Surface PostgREST / Supabase client errors without losing hint/code. */
function formatSupabaseError(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const o = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [
      typeof o.message === "string" ? o.message : null,
      typeof o.details === "string" && o.details.trim() ? o.details : null,
      typeof o.code === "string" && o.code.trim() ? `(${o.code})` : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" — ");
  }
  if (err instanceof Error && err.message) return err.message;
  return String(err);
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

function rowToSalesSuburbAssignment(raw: unknown): SalesSuburbRow {
  const row = asRecord(raw);

  return {
    id: pickString(row, ["id", "assignmentId", "assignment_id"]),
    tenant_id: pickString(row, ["tenant_id", "tenantId"]),
    agent_id: pickString(row, ["agent_id", "agentId"]),
    suburb: pickString(row, ["suburb", "suburbName", "suburb_name", "name"]),
    created_at: pickString(row, ["created_at", "createdAt"]),
  };
}

function sortSalesSuburbAssignments(rows: SalesSuburbRow[]): SalesSuburbRow[] {
  return rows.slice().sort((a, b) => {
    const bySuburb = normalizeSalesSuburbKey(a.suburb).localeCompare(
      normalizeSalesSuburbKey(b.suburb),
    );
    if (bySuburb !== 0) return bySuburb;
    return a.id.localeCompare(b.id);
  });
}

function extractAssignmentRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;

  const body = asRecord(raw);
  for (const key of [
    "assignments",
    "assignedSuburbs",
    "suburbs",
    "salesAgentSuburbAssignments",
    "sales_agent_suburb_assignments",
    "items",
    "rows",
    "results",
    "data",
  ] as const) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }

  const data = asRecord(body.data);
  for (const key of ["assignments", "assignedSuburbs", "suburbs", "items", "rows", "results"] as const) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function extractAssignmentRow(raw: unknown): unknown {
  const body = asRecord(raw);
  for (const key of [
    "assignment",
    "salesAgentSuburbAssignment",
    "sales_agent_suburb_assignment",
    "item",
    "result",
    "data",
  ] as const) {
    const value = body[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return body;
}

function rowToSalesSuburbWorkshop(raw: unknown): SalesSuburbWorkshopRow {
  const row = asRecord(raw);
  const suburb = pickString(row, ["suburb"]);

  return {
    id: pickString(row, ["id", "workshopId", "workshop_id"]),
    tenant_id: pickString(row, ["tenant_id", "tenantId"]),
    suburb,
    suburb_normalized:
      pickString(row, ["suburb_normalized", "suburbNormalized"]) ||
      normalizeSalesSuburbKey(suburb),
    workshop_name: pickString(row, ["workshop_name", "workshopName", "name"]),
    phone_number: pickString(row, ["phone_number", "phoneNumber", "phone"]),
    owner_name: pickString(row, ["owner_name", "ownerName"]),
    owner_email: pickString(row, ["owner_email", "ownerEmail"]),
    location: pickString(row, ["location", "address"]),
    website: pickString(row, ["website"]),
    created_at: pickString(row, ["created_at", "createdAt"]),
    updated_at: pickString(row, ["updated_at", "updatedAt"]),
  };
}

function sortSalesSuburbWorkshops(
  rows: SalesSuburbWorkshopRow[],
): SalesSuburbWorkshopRow[] {
  return rows.slice().sort((a, b) => {
    const bySuburb = normalizeSalesSuburbKey(a.suburb).localeCompare(
      normalizeSalesSuburbKey(b.suburb),
    );
    if (bySuburb !== 0) return bySuburb;
    const byName = (a.workshop_name || "").localeCompare(
      b.workshop_name || "",
      undefined,
      { sensitivity: "base" },
    );
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });
}

function extractWorkshopRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;

  const body = asRecord(raw);
  for (const key of ["workshops", "items", "results", "data"] as const) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }

  const data = asRecord(body.data);
  for (const key of ["workshops", "items", "results"] as const) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function extractWorkshopRow(raw: unknown): unknown {
  const body = asRecord(raw);
  for (const key of [
    "workshop",
    "salesSuburbWorkshop",
    "sales_suburb_workshop",
    "item",
    "result",
    "data",
  ] as const) {
    const value = body[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return body;
}

async function readHttpErrorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) return "";

  try {
    const body = asRecord(JSON.parse(text) as unknown);
    const detail = body.message ?? body.error ?? body.detail;
    return typeof detail === "string" ? detail : text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as unknown) : null;
}

async function requestSalesSuburbWorkshops(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  options: {
    id?: string;
    tenantId?: string | null;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const id = options.id?.trim();
  const search = new URLSearchParams();
  const tenantId = options.tenantId?.trim();
  if (tenantId) search.set("tenantId", tenantId);

  const endpoint = `/sales-suburb-workshops${
    id ? `/${encodeURIComponent(id)}` : ""
  }${search.size > 0 ? `?${search.toString()}` : ""}`;

  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const res = await apiFetch(endpoint, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `Sales suburb workshops API ${method} failed: ${res.status}${
        detail ? ` - ${detail}` : ""
      }`,
    );
  }

  return parseJsonBody(res);
}

async function requestSalesSuburbAssignments(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  options: {
    id?: string;
    tenantId?: string | null;
    agentId?: string | null;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const id = options.id?.trim();
  const search = new URLSearchParams();
  const tenantId = options.tenantId?.trim();
  const agentId = options.agentId?.trim();
  if (tenantId) search.set("tenantId", tenantId);
  if (agentId) search.set("agentId", agentId);

  const endpoint = `/sales-agent-suburb-assignments${
    id ? `/${encodeURIComponent(id)}` : ""
  }${search.size > 0 ? `?${search.toString()}` : ""}`;

  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const res = await apiFetch(endpoint, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `Sales agent suburb assignments API ${method} failed: ${res.status}${
        detail ? ` - ${detail}` : ""
      }`,
    );
  }

  return parseJsonBody(res);
}

async function requestSalesSuburbWorkshopAgentContacts(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  options: {
    id?: string;
    tenantId?: string | null;
    agentId?: string | null;
    workshopId?: string | null;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const id = options.id?.trim();
  const search = new URLSearchParams();
  const tenantId = options.tenantId?.trim();
  const agentId = options.agentId?.trim();
  const workshopId = options.workshopId?.trim();
  if (tenantId) search.set("tenantId", tenantId);
  if (agentId) search.set("agentId", agentId);
  if (workshopId) search.set("workshopId", workshopId);

  const endpoint = `/sales-suburb-workshop-agent-contacts${
    id ? `/${encodeURIComponent(id)}` : ""
  }${search.size > 0 ? `?${search.toString()}` : ""}`;

  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const res = await apiFetch(endpoint, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `Sales suburb workshop agent contacts API ${method} failed: ${res.status}${
        detail ? ` - ${detail}` : ""
      }`,
    );
  }

  return parseJsonBody(res);
}

function pickNullableString(
  row: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value === null) return null;
    if (value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function rowToSalesSuburbWorkshopAgentContact(
  raw: unknown,
): SalesSuburbWorkshopContactRow {
  const row = asRecord(raw);
  return {
    id: pickString(row, ["id", "contactId", "contact_id"]),
    agent_id: pickString(row, ["agent_id", "agentId"]),
    tenant_id: pickString(row, ["tenant_id", "tenantId"]),
    workshop_id: pickString(row, ["workshop_id", "workshopId"]),
    first_called_at: pickNullableString(row, [
      "first_called_at",
      "firstCalledAt",
    ]),
    remarks: pickString(row, ["remarks", "notes"]),
    follow_up_at: pickNullableString(row, ["follow_up_at", "followUpAt"]),
    call_status: pickNullableString(row, ["call_status", "callStatus"]),
    created_at: pickString(row, ["created_at", "createdAt"]),
    updated_at: pickString(row, ["updated_at", "updatedAt"]),
  };
}

function extractContactRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;

  const body = asRecord(raw);
  for (const key of [
    "contacts",
    "salesSuburbWorkshopAgentContacts",
    "sales_suburb_workshop_agent_contacts",
    "items",
    "rows",
    "results",
    "data",
  ] as const) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }

  const data = asRecord(body.data);
  for (const key of ["contacts", "items", "rows", "results"] as const) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function extractContactRow(raw: unknown): unknown {
  const body = asRecord(raw);
  for (const key of [
    "contact",
    "salesSuburbWorkshopAgentContact",
    "sales_suburb_workshop_agent_contact",
    "item",
    "result",
    "data",
  ] as const) {
    const value = body[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return body;
}

/** Agent-facing list. RLS / auth on the backend restricts to the caller's contacts. */
export async function fetchSalesSuburbWorkshopAgentContactsMine(
  filters: { agentId?: string | null; tenantId?: string | null; workshopId?: string | null } = {},
): Promise<SalesSuburbWorkshopContactRow[]> {
  const raw = await requestSalesSuburbWorkshopAgentContacts("GET", {
    agentId: filters.agentId ?? undefined,
    tenantId: filters.tenantId ?? undefined,
    workshopId: filters.workshopId ?? undefined,
  });
  return extractContactRows(raw)
    .map(rowToSalesSuburbWorkshopAgentContact)
    .filter((row) => Boolean(row.id));
}

export async function fetchSalesSuburbWorkshopAgentContactById(
  contactId: string,
): Promise<SalesSuburbWorkshopContactRow | null> {
  const id = contactId.trim();
  if (!id) return null;
  try {
    const raw = await requestSalesSuburbWorkshopAgentContacts("GET", { id });
    const contact = rowToSalesSuburbWorkshopAgentContact(extractContactRow(raw));
    return contact.id ? contact : null;
  } catch (err) {
    if (err instanceof Error && /\b404\b/.test(err.message)) return null;
    throw err;
  }
}

function toSalesSuburbAssignmentPayload(row: {
  tenantId?: string;
  agentId?: string;
  suburb?: string;
}): Record<string, string> {
  const body: Record<string, string> = {};

  const tenantId = row.tenantId?.trim();
  const agentId = row.agentId?.trim();
  const suburb = row.suburb?.trim();

  if (tenantId) body.tenantId = tenantId;
  if (agentId) body.agentId = agentId;
  if (suburb) body.suburb = suburb;

  return body;
}

function toSalesSuburbWorkshopPayload(row: {
  tenantId?: string;
  suburb: string;
  workshopName: string;
  phoneNumber: string;
  ownerName: string;
  ownerEmail: string;
  location: string;
  website: string;
}): Record<string, string> {
  const body: Record<string, string> = {
    suburb: row.suburb.trim(),
    workshopName: row.workshopName.trim(),
    phoneNumber: row.phoneNumber.trim(),
    ownerName: row.ownerName.trim(),
    ownerEmail: row.ownerEmail.trim(),
    location: row.location.trim(),
    website: row.website.trim(),
  };

  const tenantId = row.tenantId?.trim();
  if (tenantId) body.tenantId = tenantId;

  return body;
}

export async function insertSalesSuburbWorkshop(row: {
  tenantId: string;
  suburb: string;
  workshopName: string;
  phoneNumber: string;
  ownerName: string;
  ownerEmail: string;
  location: string;
  website: string;
}): Promise<SalesSuburbWorkshopRow> {
  const payload = toSalesSuburbWorkshopPayload(row);
  const raw = await requestSalesSuburbWorkshops("POST", {
    body: payload,
  });
  const workshop = rowToSalesSuburbWorkshop(extractWorkshopRow(raw));
  return workshop.id
    ? workshop
    : rowToSalesSuburbWorkshop({ ...payload, tenantId: row.tenantId });
}

export async function updateSalesSuburbWorkshop(
  id: string,
  row: {
    suburb: string;
    workshopName: string;
    phoneNumber: string;
    ownerName: string;
    ownerEmail: string;
    location: string;
    website: string;
  },
): Promise<void> {
  await requestSalesSuburbWorkshops("PATCH", {
    id,
    body: toSalesSuburbWorkshopPayload(row),
  });
}

export async function deleteSalesSuburbWorkshop(id: string): Promise<void> {
  await requestSalesSuburbWorkshops("DELETE", { id });
}

type SalesWorkshopAgentContactPatch = {
  firstCalledAt?: string | null;
  remarks?: string;
  followUpAt?: string | null;
  callStatus?: "confirmed" | "rejected" | null;
};

async function upsertSalesSuburbWorkshopAgentContact(opts: {
  workshopId: string;
  contactId?: string | null;
  tenantId?: string | null;
  patch: SalesWorkshopAgentContactPatch;
}): Promise<SalesSuburbWorkshopContactRow> {
  const contactId = opts.contactId?.trim() || null;
  const workshopId = opts.workshopId.trim();
  const tenantId = opts.tenantId?.trim() || null;

  const raw = contactId
    ? await requestSalesSuburbWorkshopAgentContacts("PATCH", {
        id: contactId,
        body: opts.patch,
      })
    : await requestSalesSuburbWorkshopAgentContacts("POST", {
        body: {
          workshopId,
          ...(tenantId ? { tenantId } : {}),
          ...opts.patch,
        },
      });

  return rowToSalesSuburbWorkshopAgentContact(extractContactRow(raw));
}

export async function markSalesSuburbWorkshopCalled(
  workshopId: string,
  contactId?: string | null,
): Promise<SalesSuburbWorkshopContactRow> {
  return upsertSalesSuburbWorkshopAgentContact({
    workshopId,
    contactId,
    patch: { firstCalledAt: new Date().toISOString() },
  });
}

export async function updateSalesSuburbWorkshopAgentRemarks(
  workshopId: string,
  remarks: string,
  contactId?: string | null,
): Promise<SalesSuburbWorkshopContactRow> {
  return upsertSalesSuburbWorkshopAgentContact({
    workshopId,
    contactId,
    patch: { remarks },
  });
}

export async function setSalesSuburbWorkshopFollowUp(
  workshopId: string,
  followUpAtIso: string | null,
  contactId?: string | null,
): Promise<SalesSuburbWorkshopContactRow> {
  return upsertSalesSuburbWorkshopAgentContact({
    workshopId,
    contactId,
    patch: { followUpAt: followUpAtIso },
  });
}

/** Set or clear the agent's call outcome (confirmed / rejected / null) for a suburb workshop. */
export async function setSalesSuburbWorkshopCallStatus(
  workshopId: string,
  status: "confirmed" | "rejected" | null,
  contactId?: string | null,
): Promise<SalesSuburbWorkshopContactRow> {
  return upsertSalesSuburbWorkshopAgentContact({
    workshopId,
    contactId,
    patch: { callStatus: status },
  });
}

export function journeysRank(s: LeadJourneyStage): number {
  const order: LeadJourneyStage[] = [
    "assigned",
    "called",
    "answered",
    "interested",
    "trial_offered",
    "trial_started",
    "site_visit_booked",
    "converted",
  ];
  const i = order.indexOf(s);
  return i < 0 ? 0 : i + 1;
}

/** Progress stats for tracker (tenant scope). */
export function salesProgressFromLeads(leads: SalesLeadRow[]): {
  assignedTotal: number;
  called: number;
  notCalled: number;
  interested: number;
  trialStarted: number;
  siteVisitsBooked: number;
  converted: number;
} {
  const assigned = leads.filter((l) => l.assigned_agent_id && !l.do_not_call);
  const assignedTotal = assigned.length;
  const called = assigned.filter((l) => l.first_called_at).length;
  const notCalled = assignedTotal - called;
  const interested = assigned.filter((l) => journeysRank(l.journey_stage) >= journeysRank("interested")).length;
  const trialStarted = assigned.filter(
    (l) => journeysRank(l.journey_stage) >= journeysRank("trial_started"),
  ).length;
  const siteVisitsBooked = assigned.filter(
    (l) => journeysRank(l.journey_stage) >= journeysRank("site_visit_booked"),
  ).length;
  const converted = assigned.filter((l) => l.journey_stage === "converted").length;
  return {
    assignedTotal,
    called,
    notCalled,
    interested,
    trialStarted,
    siteVisitsBooked,
    converted,
  };
}

export const OUTCOME_OPTIONS: { value: LeadCallOutcome; label: string }[] = [
  { value: "no_answer", label: "No answer" },
  { value: "answered_short", label: "Answered (short)" },
  { value: "not_interested", label: "Not interested" },
  { value: "interested", label: "Interested" },
  { value: "trial_offered", label: "Trial offered" },
  { value: "trial_started", label: "Trial started" },
  { value: "site_visit_booked", label: "Site visit booked" },
  { value: "call_back_later", label: "Call back later" },
  { value: "converted", label: "Converted" },
];
