import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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
  agent_first_called_at: string | null;
  agent_remarks: string;
  agent_follow_up_at: string | null;
  agent_call_status: string | null;
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
  const { data, error } = await supabase
    .from("sales_agent_suburb_assignments")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("suburb", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Agent-facing: rows for this agent profile (RLS limits to own agent_id). */
export async function fetchAgentSuburbsAssigned(agentId: string): Promise<SalesSuburbRow[]> {
  const { data, error } = await supabase
    .from("sales_agent_suburb_assignments")
    .select("*")
    .eq("agent_id", agentId)
    .order("suburb", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function insertSalesSuburb(params: {
  tenantId: string;
  agentId: string;
  suburb: string;
}): Promise<void> {
  const { error } = await supabase.from("sales_agent_suburb_assignments").insert({
    tenant_id: params.tenantId,
    agent_id: params.agentId,
    suburb: params.suburb.trim(),
  });
  if (error) throw error;
}

export async function deleteSalesSuburb(id: string): Promise<void> {
  const { error } = await supabase.from("sales_agent_suburb_assignments").delete().eq("id", id);
  if (error) throw error;
}

/** Admin scope */
export async function fetchSalesSuburbWorkshopsTenant(
  tenantId: string,
): Promise<SalesSuburbWorkshopRow[]> {
  const { data, error } = await supabase
    .from("sales_suburb_workshops")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("suburb", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Super admin / tenant staff scope via RLS. */
export async function fetchSalesSuburbWorkshopsAllTenants(): Promise<SalesSuburbWorkshopRow[]> {
  const { data, error } = await supabase
    .from("sales_suburb_workshops")
    .select("*")
    .order("tenant_id", { ascending: true })
    .order("suburb", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Assigned suburbs only — RLS. */
export async function fetchSalesSuburbWorkshopsMine(): Promise<SalesSuburbWorkshopRow[]> {
  const { data, error } = await supabase.from("sales_suburb_workshops").select("*").order("suburb", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchSalesSuburbWorkshopContactMine(): Promise<SalesSuburbWorkshopContactRow[]> {
  const { data, error } = await supabase.from("sales_suburb_workshop_agent_contact").select("*");
  if (error) throw error;
  return data ?? [];
}

/** Super admin / tenant staff: every agent workshop touch row for CRM reporting (RLS). */
export async function fetchSalesSuburbWorkshopAgentContactTenant(
  tenantId: string,
): Promise<SalesSuburbWorkshopContactRow[]> {
  const { data, error } = await supabase
    .from("sales_suburb_workshop_agent_contact")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Workshops visible to the agent plus per-agent first call time and remarks. */
export async function fetchSalesSuburbWorkshopsWithAgentContact(): Promise<SalesSuburbWorkshopWithAgentContact[]> {
  const [workshops, contacts] = await Promise.all([
    fetchSalesSuburbWorkshopsMine(),
    fetchSalesSuburbWorkshopContactMine().catch(() => [] as SalesSuburbWorkshopContactRow[]),
  ]);
  const byWorkshop = new Map(contacts.map((c) => [c.workshop_id, c] as const));
  return workshops.map((w) => {
    const c = byWorkshop.get(w.id);
    return {
      ...w,
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
  // Use RPC to bypass RLS — the function does its own authorization check
  const { data, error } = await supabase.rpc(
    "agent_insert_sales_suburb_workshop" as never,
    {
      p_tenant_id: row.tenantId,
      p_suburb: row.suburb.trim(),
      p_workshop_name: row.workshopName.trim(),
      p_phone_number: row.phoneNumber.trim(),
      p_owner_name: row.ownerName.trim(),
      p_owner_email: row.ownerEmail.trim(),
      p_location: row.location.trim(),
      p_website: row.website.trim(),
    } as never,
  );
  if (error) throw new Error(formatSupabaseError(error));
  if (!data) throw new Error("No row returned after insert — check RLS and migrations.");
  return data as unknown as SalesSuburbWorkshopRow;
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
  const { error } = await supabase
    .from("sales_suburb_workshops")
    .update({
      suburb: row.suburb.trim(),
      workshop_name: row.workshopName.trim(),
      phone_number: row.phoneNumber.trim(),
      owner_name: row.ownerName.trim(),
      owner_email: row.ownerEmail.trim(),
      location: row.location.trim(),
      website: row.website.trim(),
    })
    .eq("id", id);
  if (error) throw new Error(formatSupabaseError(error));
}

export async function deleteSalesSuburbWorkshop(id: string): Promise<void> {
  const { error } = await supabase.from("sales_suburb_workshops").delete().eq("id", id);
  if (error) throw error;
}

export async function markSalesSuburbWorkshopCalled(workshopId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_sales_suburb_workshop_called", {
    p_workshop_id: workshopId,
  });
  if (error) throw new Error(formatSupabaseError(error));
}

export async function updateSalesSuburbWorkshopAgentRemarks(
  workshopId: string,
  remarks: string,
): Promise<void> {
  const { error } = await supabase.rpc("update_sales_suburb_workshop_remarks", {
    p_workshop_id: workshopId,
    p_remarks: remarks,
  });
  if (error) throw new Error(formatSupabaseError(error));
}

export async function setSalesSuburbWorkshopFollowUp(
  workshopId: string,
  followUpAtIso: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("set_sales_suburb_workshop_follow_up", {
    p_workshop_id: workshopId,
    p_follow_up_at: followUpAtIso,
  });
  if (error) throw new Error(formatSupabaseError(error));
}

/** Set or clear the agent's call outcome (confirmed / rejected / null) for a suburb workshop. */
export async function setSalesSuburbWorkshopCallStatus(
  workshopId: string,
  status: "confirmed" | "rejected" | null,
): Promise<void> {
  const { error } = await supabase.rpc("set_sales_suburb_workshop_call_status", {
    p_workshop_id: workshopId,
    p_status: status,
  });
  if (error) throw new Error(formatSupabaseError(error));
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
