import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, Permissions, Tenant, UserSession, Queue } from "@/services/types";
import {
  createSalesCampaign,
  deleteSalesLead,
  deleteSalesSuburb,
  deleteSalesSuburbWorkshop,
  fetchSalesCampaigns,
  fetchSalesInteractions,
  fetchSalesLeadsTenant,
  fetchSalesSiteVisitsTenant,
  fetchSalesSuburbs,
  fetchSalesSuburbWorkshopAgentContactTenant,
  fetchSalesSuburbWorkshopsAllTenants,
  fetchSalesSuburbWorkshopsTenant,
  fetchSalesTrialsTenant,
  insertSalesLead,
  insertSalesSuburb,
  insertSalesSuburbWorkshop,
  normalizeSalesSuburbKey,
  salesProgressFromLeads,
  workshopsMatchingSuburb,
  updateSalesLeadAssignment,
  updateSalesLeadFlags,
  updateSalesSuburbWorkshop,
  type SalesCampaignRow,
  type SalesLeadRow,
  type SalesSuburbWorkshopContactRow,
  type SalesSuburbWorkshopRow,
} from "@/services/salesWorkspaceApi";
import { fetchAllAgents } from "@/services/dashboardApi";
import { SalesTenantScope } from "@/tabs/sales-workspace/SalesTenantScope";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatTimeAu } from "@/utils/australianTime";

const PROGRESS_EXPAND_AT = 20;

export interface SalesAdminTabProps {
  tenantId: string | null;
  tenants: Tenant[];
  agents: Agent[];
  /** Queues roster (same tenant scoping rules as Agents tab pickers). */
  queues: Queue[];
  permissions: Permissions;
  session: UserSession;
  onRefreshDashboard: () => void;
}

function sortAgentsForPicker(agentsList: Agent[]): Agent[] {
  return [...agentsList].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Full org roster (fetchAllAgents ∪ dashboard agents), sorted. `fullFetch=null` means still loading. */
function pickerRosterAgents(
  fullFetch: Agent[] | null,
  dashboardAgents: Agent[],
): Agent[] {
  const byId = new Map<string, Agent>();
  for (const a of dashboardAgents) byId.set(a.id, a);
  if (fullFetch !== null) {
    for (const a of fullFetch) byId.set(a.id, a);
  }
  return sortAgentsForPicker([...byId.values()]);
}

function useAgentsFullPickerRoster(dashboardAgents: Agent[]): {
  roster: Agent[];
  loading: boolean;
} {
  const [fullFetch, setFullFetch] = useState<Agent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAllAgents()
      .then((rows) => {
        if (!cancelled) setFullFetch(rows);
      })
      .catch(() => {
        if (!cancelled) setFullFetch([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const roster = useMemo(
    () => pickerRosterAgents(fullFetch, dashboardAgents),
    [fullFetch, dashboardAgents],
  );

  return { roster, loading: fullFetch === null };
}

export function SalesCallCentreDashboardTab({
  tenantId,
  agents,
  onRefreshDashboard,
}: SalesAdminTabProps) {
  const [leads, setLeads] = useState<SalesLeadRow[]>([]);
  const [campaigns, setCampaigns] = useState<SalesCampaignRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (tid: string) => {
    setLoading(true);
    setErr(null);
    try {
      const [l, c] = await Promise.all([
        fetchSalesLeadsTenant(tid),
        fetchSalesCampaigns(tid),
      ]);
      setLeads(l);
      setCampaigns(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    void load(tenantId);
  }, [tenantId, load]);

  const stats = useMemo(() => {
    const p = salesProgressFromLeads(leads);
    const unassigned = leads.filter(
      (x) => !x.assigned_agent_id && !x.do_not_call,
    ).length;
    const dnc = leads.filter((x) => x.do_not_call).length;
    return { ...p, unassigned, dnc, campaignCount: campaigns.length };
  }, [leads, campaigns]);

  const showWide = stats.assignedTotal >= PROGRESS_EXPAND_AT;

  return (
    <SalesTenantScope tenantId={tenantId}>
      {(tid) => (
        <div className="space-y-6">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">
              Call Centre Dashboard
            </h2>
            <p className="text-sm text-muted-foreground">
              Live counts for campaigns, routing, and progress in this tenant (
              {tid}).
              {stats.assignedTotal >= PROGRESS_EXPAND_AT
                ? " Full funnel metrics unlock at 20 or more assigned leads."
                : " Add assignments to reach richer tracking."}
            </p>
          </header>
          {err ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {err}
            </div>
          ) : null}
          {loading ? (
            <EmptyState message="Loading tenant sales data..." />
          ) : (
            <>
              <div
                className={`grid gap-3 sm:grid-cols-2 ${
                  showWide ? "lg:grid-cols-4 xl:grid-cols-4" : "lg:grid-cols-3"
                }`}
              >
                <Card className="border-border/70">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Campaigns
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {stats.campaignCount}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-border/70">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Unassigned pool
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {stats.unassigned}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-border/70">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Do-not-call
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {stats.dnc}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-border/70">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Assigned active
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">
                      {stats.assignedTotal}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {(showWide || stats.assignedTotal > 0) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Funnel pulse</CardTitle>
                    <CardDescription>
                      Assigned pipeline (excluding do-not-call)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div
                      className={`grid gap-3 ${
                        showWide
                          ? "sm:grid-cols-4 lg:grid-cols-7"
                          : "sm:grid-cols-4"
                      }`}
                    >
                      <Badge variant="outline" className="justify-center py-3">
                        Called - {stats.called}
                      </Badge>
                      <Badge variant="outline" className="justify-center py-3">
                        Not called - {stats.notCalled}
                      </Badge>
                      {showWide ? (
                        <>
                          <Badge
                            variant="secondary"
                            className="justify-center py-3"
                          >
                            Interested+ - {stats.interested}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className="justify-center py-3"
                          >
                            Trial - {stats.trialStarted}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className="justify-center py-3"
                          >
                            Visit - {stats.siteVisitsBooked}
                          </Badge>
                          <Badge variant="default" className="justify-center py-3">
                            Converted - {stats.converted}
                          </Badge>
                          <Badge variant="outline" className="justify-center py-3">
                            Assigned - {stats.assignedTotal}
                          </Badge>
                        </>
                      ) : (
                        <Badge variant="outline" className="justify-center py-3 sm:col-span-2">
                          Converted - {stats.converted}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void load(tid);
                    onRefreshDashboard();
                  }}
                >
                  Refresh data
                </Button>
              </div>
              {agents.length ? null : (
                <p className="text-xs text-muted-foreground">
                  Agent roster arrives from Agents - ensure extensions are visible
                  for assignments.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </SalesTenantScope>
  );
}

export function SalesLeadDatabaseTab({
  tenantId,
  agents,
  onRefreshDashboard,
}: SalesAdminTabProps) {
  const [rows, setRows] = useState<SalesLeadRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [suburb, setSuburb] = useState("");

  const load = useCallback(async (tid: string) => {
    setLoading(true);
    setErr(null);
    try {
      setRows(await fetchSalesLeadsTenant(tid));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    void load(tenantId);
  }, [tenantId, load]);

  return (
    <SalesTenantScope tenantId={tenantId}>
      {(tid) => (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Lead / customer database</h2>
            <p className="text-sm text-muted-foreground">
              Create records, mark do-not-call, and manage suburb metadata.
            </p>
          </div>
          {err ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {err}
            </div>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Add lead</CardTitle>
              <CardDescription>
                Assignments respect do-not-call - blocked pairs cannot be routed.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Input
                placeholder="Display name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="max-w-xs"
              />
              <Input
                placeholder="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="max-w-xs"
              />
              <Input
                placeholder="Suburb"
                value={suburb}
                onChange={(e) => setSuburb(e.target.value)}
                className="max-w-xs"
              />
              <Button
                type="button"
                disabled={creating || !phone.trim()}
                onClick={async () => {
                  setCreating(true);
                  try {
                    await insertSalesLead({
                      tenant_id: tid,
                      display_name: name.trim() || phone.trim(),
                      phone: phone.trim(),
                      suburb: suburb.trim() || "",
                    });
                    setName("");
                    setPhone("");
                    setSuburb("");
                    await load(tid);
                    onRefreshDashboard();
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : "Create failed");
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                Create lead
              </Button>
            </CardContent>
          </Card>
          {loading ? (
            <EmptyState message="Loading leads..." />
          ) : (
            <ScrollArea className="h-[min(480px,calc(100vh-24rem))] rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Suburb</TableHead>
                    <TableHead className="max-w-[240px]">Latest notes</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>DNC</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.display_name}</TableCell>
                      <TableCell className="font-mono text-xs">{r.phone}</TableCell>
                      <TableCell className="text-xs">{r.suburb?.trim() || "-"}</TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs" title={r.notes}>
                        {r.notes?.trim() || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.journey_stage}</Badge>
                      </TableCell>
                      <TableCell>
                        {r.assigned_agent_id
                          ? agents.find((a) => a.id === r.assigned_agent_id)
                              ?.name ?? r.assigned_agent_id
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={r.do_not_call}
                          onCheckedChange={(c) => {
                            void (async () => {
                              if (c) {
                                await updateSalesLeadAssignment(r.id, null);
                                await updateSalesLeadFlags(r.id, { do_not_call: true });
                              } else {
                                await updateSalesLeadFlags(r.id, { do_not_call: false });
                              }
                              await load(tid);
                              onRefreshDashboard();
                            })();
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            void (async () => {
                              await deleteSalesLead(r.id);
                              await load(tid);
                              onRefreshDashboard();
                            })();
                          }}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8}>
                        <EmptyState message="No leads yet - create one above." />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>
      )}
    </SalesTenantScope>
  );
}

export function SalesCampaignManagerTab({
  tenantId,
  onRefreshDashboard,
}: SalesAdminTabProps) {
  const [rows, setRows] = useState<SalesCampaignRow[]>([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (tid: string) => {
    setLoading(true);
    try {
      setRows(await fetchSalesCampaigns(tid));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    void load(tenantId);
  }, [tenantId, load]);

  return (
    <SalesTenantScope tenantId={tenantId}>
      {(tid) => (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Campaign manager</h2>
          {err ? <div className="text-sm text-rose-700">{err}</div> : null}
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-sm"
              placeholder="Campaign name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              type="button"
              disabled={!name.trim()}
              onClick={() => {
                void createSalesCampaign({ tenantId: tid, name })
                  .then(async () => {
                    setName("");
                    await load(tid);
                    onRefreshDashboard();
                  })
                  .catch((e: unknown) =>
                    setErr(e instanceof Error ? e.message : "Create failed"),
                  );
              }}
            >
              Create campaign
            </Button>
          </div>
          {loading ? (
            <EmptyState message="Loading..." />
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border px-4 py-3"
                >
                  <span>{r.name}</span>
                  <Badge variant={r.is_active ? "default" : "secondary"}>
                    {r.is_active ? "Active" : "Paused"}
                  </Badge>
                </li>
              ))}
              {rows.length === 0 ? (
                <EmptyState message="Create your first outbound or nurture campaign." />
              ) : null}
            </ul>
          )}
        </div>
      )}
    </SalesTenantScope>
  );
}

export function SalesAgentSuburbAssignmentTab({
  tenantId,
  agents,
  queues: _queues,
  permissions,
  onRefreshDashboard,
}: SalesAdminTabProps) {
  void _queues;
  const isSuperAdmin = permissions.canSwitchTenant;
  const { roster, loading: pickerLoading } = useAgentsFullPickerRoster(agents);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchSalesSuburbs>>>(
    [],
  );
  const [workshops, setWorkshops] = useState<SalesSuburbWorkshopRow[]>([]);
  const [pickedSuburb, setPickedSuburb] = useState<string>("");
  const [agentId, setAgentId] = useState("");
  const [loadingTable, setLoadingTable] = useState(true);

  const load = useCallback(async (tid: string) => {
    setLoadingTable(true);
    try {
      const [assignRows, wsRows] = await Promise.all([
        fetchSalesSuburbs(tid),
        isSuperAdmin
          ? fetchSalesSuburbWorkshopsAllTenants()
          : fetchSalesSuburbWorkshopsTenant(tid),
      ]);
      setRows(assignRows);
      setWorkshops(wsRows);
    } finally {
      setLoadingTable(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!tenantId) return;
    void load(tenantId);
  }, [tenantId, load]);

  useEffect(() => {
    if (roster.length === 0) return;
    setAgentId((prev) =>
      prev && roster.some((a) => a.id === prev) ? prev : roster[0].id,
    );
  }, [roster]);

  const suburbChoices = useMemo(() => {
    const canonicalByNorm = new Map<string, string>();
    for (const w of workshops) {
      const k = normalizeSalesSuburbKey(w.suburb);
      if (!canonicalByNorm.has(k)) canonicalByNorm.set(k, w.suburb.trim());
    }
    return [...canonicalByNorm.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [workshops]);

  useEffect(() => {
    setPickedSuburb((prev) =>
      prev &&
        suburbChoices.some(
          (s) => normalizeSalesSuburbKey(s) === normalizeSalesSuburbKey(prev),
        )
        ? prev
        : "",
    );
  }, [suburbChoices]);

  return (
    <SalesTenantScope tenantId={tenantId}>
      {(tid) => (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Agent suburb assignment</h2>
          <p className="text-xs text-muted-foreground">
            Pick an agent, then choose a suburb. One suburb can host several workshop records; assigning the suburb gives the agent visibility to all of them. Add many suburbs per agent one at a time. Suburb options come from Sales â†’ Suburb workshops.
            {pickerLoading ? " Loading full roster..." : null}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label className="text-sm">Agent</Label>
              <Select
                value={agentId}
                onValueChange={setAgentId}
                disabled={pickerLoading || roster.length === 0}
              >
                <SelectTrigger className="min-w-[240px] max-w-sm">
                  <SelectValue
                    placeholder={
                      pickerLoading ? "Loading agents..." : "Choose agent"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {roster.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex flex-col items-start gap-0.5">
                        <span>{a.name}</span>
                        <span className="text-[11px] font-normal text-muted-foreground">
                          {[a.extension ? `Ext ${a.extension}` : "", a.tenantName || a.tenantId]
                            .filter(Boolean)
                            .join(" - ") || "-"}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 min-w-[220px] max-w-md flex-1">
              <Label className="text-sm">Suburb</Label>
              <Select
                value={pickedSuburb || undefined}
                onValueChange={setPickedSuburb}
                disabled={pickerLoading || suburbChoices.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      suburbChoices.length === 0
                        ? "Add workshops first (Suburb workshops tab)"
                        : "Choose suburb..."
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {suburbChoices.map((sub) => {
                    const wsList = workshopsMatchingSuburb(workshops, sub);
                    return (
                      <SelectItem key={normalizeSalesSuburbKey(sub)} value={sub}>
                        <span className="flex flex-col items-start gap-0.5 text-left">
                          <span className="font-medium">{sub}</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            {wsList.length}{" "}
                            workshop
                            {wsList.length === 1 ? "" : "s"}
                            {wsList.length > 0
                              ? ` - ${wsList
                                  .map((w) => w.workshop_name.trim())
                                  .filter(Boolean)
                                  .slice(0, 3)
                                  .join(", ")}${wsList.length > 3 ? "..." : ""}`
                              : ""}
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              disabled={!agentId || !pickedSuburb.trim() || pickerLoading || loadingTable}
              onClick={() => {
                void insertSalesSuburb({
                  tenantId: tid,
                  agentId,
                  suburb: pickedSuburb,
                })
                  .then(async () => {
                    setPickedSuburb("");
                    await load(tid);
                    onRefreshDashboard();
                  })
                  .catch((e) => {
                    toast.error(
                      e instanceof Error
                        ? e.message
                        : "Could not assign (duplicate suburb for this agent?)",
                    );
                  });
              }}
            >
              Assign suburb
            </Button>
          </div>
          {loadingTable ? (
            <EmptyState message="Loading..." />
          ) : (
            <ScrollArea className="h-[360px] rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Suburb</TableHead>
                    <TableHead>Workshop</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...rows]
                    .sort((a, b) => {
                      const an =
                        roster.find((x) => x.id === a.agent_id)?.name ?? a.agent_id;
                      const bn =
                        roster.find((x) => x.id === b.agent_id)?.name ?? b.agent_id;
                      const c = an.localeCompare(bn, undefined, {
                        sensitivity: "base",
                      });
                      return c !== 0
                        ? c
                        : a.suburb.localeCompare(b.suburb, undefined, {
                            sensitivity: "base",
                          });
                    })
                    .map((r) => {
                      const wsList = workshopsMatchingSuburb(workshops, r.suburb);
                      const names = wsList
                        .map((w) => w.workshop_name.trim())
                        .filter(Boolean);
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            {roster.find((a) => a.id === r.agent_id)?.name ??
                              r.agent_id}
                          </TableCell>
                          <TableCell className="font-medium">{r.suburb}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {names.length === 0
                              ? "-"
                              : names.join(" - ")}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                void deleteSalesSuburb(r.id).then(() => load(tid));
                              }}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <EmptyState message="Assign workshop suburbs from the dropdown - each agent can carry multiple suburbs." />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>
      )}
    </SalesTenantScope>
  );
}

export function SalesSuburbWorkshopsTab({
  tenantId,
  tenants,
  permissions,
  onRefreshDashboard,
}: SalesAdminTabProps) {
  const [rows, setRows] = useState<SalesSuburbWorkshopRow[]>([]);
  const [loadingTable, setLoadingTable] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [suburb, setSuburb] = useState("");
  const [workshopName, setWorkshopName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [formTenantId, setFormTenantId] = useState<string>("");
  const showingAllTenants = permissions.canSwitchTenant && !tenantId;
  const tenantNameById = useMemo(
    () => new Map(tenants.map((t) => [t.id, t.name] as const)),
    [tenants],
  );

  useEffect(() => {
    if (showingAllTenants && tenants.length > 0 && !formTenantId) {
      setFormTenantId(tenants[0].id);
    }
  }, [showingAllTenants, tenants, formTenantId]);

  const load = useCallback(async (tid: string | null) => {
    setLoadingTable(true);
    try {
      setRows(
        tid
          ? await fetchSalesSuburbWorkshopsTenant(tid)
          : await fetchSalesSuburbWorkshopsAllTenants(),
      );
    } finally {
      setLoadingTable(false);
    }
  }, []);

  useEffect(() => {
    void load(tenantId);
  }, [tenantId, load]);

  function resetForm() {
    setEditingId(null);
    setSuburb("");
    setWorkshopName("");
    setPhoneNumber("");
    setOwnerName("");
    setOwnerEmail("");
    setLocation("");
    setWebsite("");
  }

  function startEdit(r: SalesSuburbWorkshopRow) {
    setEditingId(r.id);
    setSuburb(r.suburb);
    setWorkshopName(r.workshop_name);
    setPhoneNumber(r.phone_number);
    setOwnerName(r.owner_name);
    setOwnerEmail(r.owner_email);
    setLocation(r.location);
    setWebsite(r.website);
  }

  const sortedWsRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const bySub = normalizeSalesSuburbKey(a.suburb).localeCompare(
        normalizeSalesSuburbKey(b.suburb),
      );
      if (bySub !== 0) return bySub;
      return (a.workshop_name || "").localeCompare(b.workshop_name || "", undefined, {
        sensitivity: "base",
      });
    });
  }, [rows]);

  const distinctSuburbOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of rows) {
      const k = normalizeSalesSuburbKey(w.suburb);
      if (!m.has(k)) m.set(k, w.suburb.trim());
    }
    return [...m.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [rows]);

  const workshopsPerSuburbHint = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of rows) {
      const k = normalizeSalesSuburbKey(w.suburb);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const filteredWsRows = useMemo(() => {
    if (!searchQuery.trim()) return sortedWsRows;
    const q = searchQuery.toLowerCase();
    return sortedWsRows.filter(
      (w) =>
        (w.workshop_name && w.workshop_name.toLowerCase().includes(q)) ||
        (w.phone_number && w.phone_number.toLowerCase().includes(q)) ||
        (w.suburb && w.suburb.toLowerCase().includes(q)) ||
        (tenantNameById.get(w.tenant_id) ?? "").toLowerCase().includes(q)
    );
  }, [sortedWsRows, searchQuery, tenantNameById]);

  const duplicateWarning = useMemo(() => {
    if (!workshopName.trim() && !phoneNumber.trim()) return null;
    const wsNameTrim = workshopName.trim().toLowerCase();
    const phoneTrim = phoneNumber.trim();

    const dup = rows.find(
      (r) =>
        r.id !== editingId &&
        ((wsNameTrim &&
          r.workshop_name.trim().toLowerCase() === wsNameTrim &&
          normalizeSalesSuburbKey(r.suburb) === normalizeSalesSuburbKey(suburb)) ||
          (phoneTrim && r.phone_number?.trim() === phoneTrim))
    );

    if (dup) {
      if (
        phoneTrim &&
        dup.phone_number?.trim() === phoneTrim &&
        wsNameTrim &&
        dup.workshop_name.trim().toLowerCase() === wsNameTrim
      ) {
        return `Workshop with this name and phone number exists in ${dup.suburb}.`;
      } else if (phoneTrim && dup.phone_number?.trim() === phoneTrim) {
        return `Phone number already used by ${dup.workshop_name} in ${dup.suburb}.`;
      } else {
        return `Workshop with this name already exists in this suburb.`;
      }
    }
    return null;
  }, [rows, editingId, workshopName, phoneNumber, suburb]);

  function partialResetKeepSuburb(keepSuburb: string) {
    setEditingId(null);
    setSuburb(keepSuburb.trim());
    setWorkshopName("");
    setPhoneNumber("");
    setOwnerName("");
    setOwnerEmail("");
    setLocation("");
    setWebsite("");
  }

  function submitWorkshop(tid: string) {
    const effectiveTenantId = showingAllTenants ? formTenantId : tid;

    if (!effectiveTenantId) {
      toast.error("Please select a client before saving.");
      return;
    }

    const isDuplicate = rows.some(
      (r) =>
        r.id !== editingId &&
        r.workshop_name.trim().toLowerCase() === workshopName.trim().toLowerCase() &&
        (
          normalizeSalesSuburbKey(r.suburb) === normalizeSalesSuburbKey(suburb) ||
          (phoneNumber.trim() && r.phone_number?.trim() === phoneNumber.trim())
        )
    );

    if (isDuplicate) {
      toast.error("Duplicate workshop: A workshop with this name already exists in this suburb, or shares the same phone number.");
      return;
    }

    const payload = {
      suburb,
      workshopName,
      phoneNumber,
      ownerName,
      ownerEmail,
      location,
      website,
    };
    const subKeep = suburb.trim();
    const countAfter =
      (workshopsPerSuburbHint.get(normalizeSalesSuburbKey(subKeep)) ?? 0) +
      (editingId ? 0 : 1);
    setSaving(true);
    const req = editingId
      ? updateSalesSuburbWorkshop(editingId, payload).then(async () => {
          toast.success("Workshop saved");
          resetForm();
          await load(tenantId);
          onRefreshDashboard();
        })
      : insertSalesSuburbWorkshop({
          tenantId: effectiveTenantId,
          ...payload,
        }).then(async () => {
          toast.success(
            countAfter === 1
              ? "Workshop saved - suburb kept so you can add another site."
              : `This suburb now has ${countAfter} workshops - suburb stays filled.`,
          );
          partialResetKeepSuburb(subKeep);
          await load(tenantId);
          onRefreshDashboard();
        });
    void req.catch((e) => {
      const msg = e instanceof Error ? e.message : "Could not save workshop";
      toast.error(msg);
    }).finally(() => setSaving(false));
  }

  return (
    <SalesTenantScope tenantId={showingAllTenants ? "__all__" : tenantId}>
      {(tid) => (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Suburb workshops</h2>
            <p className="text-sm text-muted-foreground">
              Log as many workshops as you need against the same suburb (each row is one site/dealer card). Reuse suburb spelling exactly as on CRM leads - case does not matter. Agents mapped to that suburb see every workshop here.
              {showingAllTenants ? " You are viewing all clients — select a client in the form below to add new workshops." : ""}
            </p>
          </div>
          {rows.length > 0 ? (
            <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              {[...new Set(sortedWsRows.map((w) => normalizeSalesSuburbKey(w.suburb)))]
                .sort()
                .map((norm) => {
                  const label =
                    sortedWsRows.find((w) => normalizeSalesSuburbKey(w.suburb) === norm)
                      ?.suburb ?? norm;
                  const n = workshopsPerSuburbHint.get(norm) ?? 0;
                  return (
                    <Badge key={norm} variant="outline" className="font-normal">
                      {label}
                      <span className="ml-1.5 tabular-nums opacity-70">Ã-{n}</span>
                    </Badge>
                  );
                })}
            </div>
          ) : null}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {editingId ? "Edit workshop" : "Add workshop"}
              </CardTitle>
              <CardDescription>
                After saving a new workshop, the form keeps the same suburb filled in so you can add the next site quickly. Change suburb anytime.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="sw-suburb">Suburb</Label>
                <Input
                  id="sw-suburb"
                  placeholder="e.g. Preston - same label for multiple workshops"
                  value={suburb}
                  onChange={(e) => setSuburb(e.target.value)}
                  list={
                    distinctSuburbOptions.length > 0
                      ? "sw-suburb-existing"
                      : undefined
                  }
                />
                {distinctSuburbOptions.length > 0 ? (
                  <datalist id="sw-suburb-existing">
                    {distinctSuburbOptions.map((s) => (
                      <option key={normalizeSalesSuburbKey(s)} value={s} />
                    ))}
                  </datalist>
                ) : null}
                <p className="text-[11px] text-muted-foreground">
                  Matches CRM leads and agent assignments (case-insensitive).
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="sw-name">Workshop name</Label>
                <Input
                  id="sw-name"
                  value={workshopName}
                  onChange={(e) => setWorkshopName(e.target.value)}
                  placeholder="Required - e.g. Preston North Panel"
                />
              </div>
              <p className="text-xs font-medium text-muted-foreground sm:col-span-2">
                Contact &amp; location (all optional)
              </p>
              <div className="space-y-2">
                <Label htmlFor="sw-phone">Workshop phone</Label>
                <Input
                  id="sw-phone"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sw-owner">Owner name</Label>
                <Input
                  id="sw-owner"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="sw-email">Owner email</Label>
                <Input
                  id="sw-email"
                  type="email"
                  autoComplete="off"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="sw-loc">Location</Label>
                <Input
                  id="sw-loc"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="sw-web">Website (optional)</Label>
                <Input
                  id="sw-web"
                  placeholder="Optional - https://..."
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>
            </CardContent>
            {duplicateWarning && (
              <div className="px-6 pb-4 text-sm font-medium text-rose-500">
                Duplicate Warning: {duplicateWarning}
              </div>
            )}
            <CardFooter className="flex-col items-stretch gap-3 border-t bg-muted/20 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="min-h-11 min-w-[10rem] font-semibold shadow-sm"
                  disabled={saving || !suburb.trim() || !workshopName.trim() || !!duplicateWarning || (showingAllTenants && !formTenantId)}
                  onClick={() => submitWorkshop(tid)}
                >
                  {saving ? "Saving..." : editingId ? "Save changes" : "Save workshop"}
                </Button>
                {editingId ? (
                  <Button type="button" variant="outline" disabled={saving} onClick={resetForm}>
                    Cancel edit
                  </Button>
                ) : null}
              </div>
              <p className="max-w-xl text-xs text-muted-foreground">
                Required: suburb + workshop name only. If save fails on a second workshop in the same suburb, apply pending Supabase migrations (multi-workshop constraint fix).
              </p>
            </CardFooter>
          </Card>

          <div className="flex items-center gap-2">
            <Input
              placeholder="Search by name or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm"
            />
          </div>

          {loadingTable ? (
            <EmptyState message="Loading workshops..." />
          ) : (
            <ScrollArea className="h-[min(420px,50vh)] rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {showingAllTenants ? <TableHead>Client</TableHead> : null}
                    <TableHead>Suburb</TableHead>
                    <TableHead>Workshop</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWsRows.map((r, idx) => {
                    const prev = idx > 0 ? filteredWsRows[idx - 1] : null;
                    const nk = normalizeSalesSuburbKey(r.suburb);
                    const grouped =
                      prev !== null &&
                      normalizeSalesSuburbKey(prev.suburb) === nk;
                    const nHere = workshopsPerSuburbHint.get(nk) ?? 1;

                    return (
                      <TableRow key={r.id}>
                        {showingAllTenants ? (
                          <TableCell className="text-sm">
                            {tenantNameById.get(r.tenant_id) ?? r.tenant_id}
                          </TableCell>
                        ) : null}
                        <TableCell
                          className={
                            grouped ? "border-l-4 border-muted pl-4" : ""
                          }
                          title={
                            grouped
                              ? undefined
                              : nHere > 1
                                ? `${nHere} workshops in this suburb`
                                : undefined
                          }
                        >
                          {grouped ? (
                            <span className="text-muted-foreground text-xs italic">
                              same suburb - different site
                            </span>
                          ) : (
                            <span className="font-medium">
                              {r.suburb}
                              {nHere > 1 ? (
                                <Badge
                                  variant="secondary"
                                  className="ml-2 align-middle text-[10px] font-normal"
                                >
                                  {nHere} workshops
                                </Badge>
                              ) : null}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{r.workshop_name || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.phone_number || "-"}</TableCell>
                      <TableCell className="text-sm">{r.owner_name || "-"}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-xs">{r.owner_email || "-"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Button type="button" variant="outline" size="sm" className="mr-2" onClick={() => startEdit(r)}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            void deleteSalesSuburbWorkshop(r.id).then(async () => {
                              toast.success("Removed");
                              if (editingId === r.id) resetForm();
                              await load(tenantId);
                              onRefreshDashboard();
                            }).catch(() => toast.error("Could not remove"));
                          }}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={showingAllTenants ? 7 : 6}>
                        <EmptyState message="Add the first workshop row. Reuse the same suburb name for additional sites in that area." />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>
      )}
    </SalesTenantScope>
  );
}

export function SalesCallAssignmentBoardTab({
  tenantId,
  agents,
  queues: _queues,
  onRefreshDashboard,
}: SalesAdminTabProps) {
  void _queues;
  const { roster, loading: pickerLoading } = useAgentsFullPickerRoster(agents);
  const [rows, setRows] = useState<SalesLeadRow[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (tid: string) => {
    setLoading(true);
    try {
      const all = await fetchSalesLeadsTenant(tid);
      setRows(all.filter((l) => !l.assigned_agent_id && !l.do_not_call));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    void load(tenantId);
  }, [tenantId, load]);

  return (
    <SalesTenantScope tenantId={tenantId}>
      {(tid) => (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Call assignment board</h2>
          <p className="text-sm text-muted-foreground">
            Do-not-call leads never appear here; assignment respects DNC upstream.
          </p>
          <p className="text-xs text-muted-foreground">
            Full agent roster loads for assignees (every extension you can see in RLS).
            {pickerLoading ? " Loading..." : ""}
          </p>
          {loading ? (
            <EmptyState message="Loading pool..." />
          ) : (
            <ScrollArea className="h-[min(520px,70vh)] rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Suburb</TableHead>
                    <TableHead className="w-[280px]">Assign</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.display_name}</TableCell>
                      <TableCell className="font-mono text-xs">{r.phone}</TableCell>
                      <TableCell>{r.suburb || "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Select
                            value={pick[r.id] ?? ""}
                            onValueChange={(v) =>
                              setPick((p) => ({ ...p, [r.id]: v }))
                            }
                            disabled={pickerLoading || roster.length === 0}
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  pickerLoading ? "Loading agents..." : "Pick agent"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                              {roster.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  <span className="flex flex-col items-start gap-0.5">
                                    <span>{a.name}</span>
                                    <span className="text-[11px] font-normal text-muted-foreground">
                                      {[a.extension ? `Ext ${a.extension}` : "", a.tenantName || a.tenantId]
                                        .filter(Boolean)
                                        .join(" - ") || "-"}
                                    </span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            disabled={
                              !(pick[r.id] ?? "").trim() || pickerLoading
                            }
                            onClick={() => {
                              void updateSalesLeadAssignment(r.id, pick[r.id]).then(
                                async () => {
                                  await load(tid);
                                  onRefreshDashboard();
                                },
                              );
                            }}
                          >
                            Assign
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <EmptyState message="No unassigned routable leads right now." />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>
      )}
    </SalesTenantScope>
  );
}

export function SalesCallProgressTab({
  tenantId,
  agents,
  onRefreshDashboard: _onRefreshDashboard,
}: SalesAdminTabProps) {
  const [contacts, setContacts] = useState<SalesSuburbWorkshopContactRow[]>([]);
  const [workshops, setWorkshops] = useState<SalesSuburbWorkshopRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (tid: string) => {
    setLoading(true);
    try {
      const [c, w] = await Promise.all([
        fetchSalesSuburbWorkshopAgentContactTenant(tid),
        fetchSalesSuburbWorkshopsTenant(tid),
      ]);
      setContacts(c);
      setWorkshops(w);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    void load(tenantId);
  }, [tenantId, load]);

  const workshopById = useMemo(() => new Map(workshops.map((w) => [w.id, w] as const)), [workshops]);

  const stats = useMemo(() => {
    const total = contacts.length;
    const markedCalled = contacts.filter((r) => Boolean(r.first_called_at)).length;
    const withRemarks = contacts.filter((r) => (r.remarks ?? "").trim().length > 0).length;
    const withFollowUp = contacts.filter((r) => Boolean(r.follow_up_at)).length;
    const completed = contacts.filter((r) => r.call_status === "confirmed" || r.call_status === "rejected").length;
    return { total, markedCalled, withRemarks, withFollowUp, completed };
  }, [contacts]);

  const followUpRows = useMemo(
    () =>
      contacts
        .filter((r) => Boolean(r.follow_up_at))
        .slice()
        .sort((a, b) => String(a.follow_up_at!).localeCompare(String(b.follow_up_at!))),
    [contacts],
  );

  const completedRows = useMemo(
    () =>
      contacts
        .filter((r) => r.call_status === "confirmed" || r.call_status === "rejected")
        .slice()
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [contacts],
  );

  return (
    <SalesTenantScope tenantId={tenantId}>
      {(tid) => (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Call progress tracker</h2>
              <p className="text-sm text-muted-foreground">
                Workshop contact activity for this tenant. Switch between <span className="font-medium text-foreground">All activity</span> and{" "}
                <span className="font-medium text-foreground">Follow-ups</span> (callbacks only). Agents update records on{" "}
                <span className="font-medium text-foreground">My call list</span>.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => void load(tid)}>
              Refresh
            </Button>
          </div>
          {loading ? (
            <EmptyState message="Loading workshop contact activity..." />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Badge className="justify-center py-4 text-sm font-medium bg-neutral-900 text-white">
                  Total logged - {stats.total}
                </Badge>
                <Badge variant="outline" className="justify-center py-4 text-sm border-blue-200 text-blue-700 bg-blue-50/50">
                  Marked called - {stats.markedCalled}
                </Badge>
                <Badge variant="outline" className="justify-center py-4 text-sm border-amber-200 text-amber-700 bg-amber-50/50">
                  With follow-up - {stats.withFollowUp}
                </Badge>
                <Badge variant="outline" className="justify-center py-4 text-sm border-purple-200 text-purple-700 bg-purple-50/50">
                  With remarks - {stats.withRemarks}
                </Badge>
                <Badge variant="outline" className="justify-center py-4 text-sm border-emerald-200 text-emerald-700 bg-emerald-50/50">
                  Completed - {stats.completed}
                </Badge>
              </div>

              <Tabs defaultValue="all" className="space-y-4">
                <TabsList className="bg-muted border border-border">
                  <TabsTrigger value="all">All activity</TabsTrigger>
                  <TabsTrigger value="followups">Follow-ups ({stats.withFollowUp})</TabsTrigger>
                  <TabsTrigger value="completed">Completed ({stats.completed})</TabsTrigger>
                </TabsList>

                <TabsContent value="all" className="space-y-2 mt-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Suburb workshops - agent status</h3>
                      <p className="text-xs text-muted-foreground">
                        Every saved workshop contact row (mark called + remarks); use Follow-ups tab for callbacks only.
                      </p>
                    </div>
                  </div>
                  <ScrollArea className="h-[min(60vh,520px)] rounded-xl border border-border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Updated</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Suburb</TableHead>
                          <TableHead>Workshop</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="min-w-[200px]">Remarks</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contacts.map((r) => {
                          const w = workshopById.get(r.workshop_id);
                          const agentName = agents.find((a) => a.id === r.agent_id)?.name ?? r.agent_id;
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                                {r.updated_at ? formatTimeAu(r.updated_at) : "-"}
                              </TableCell>
                              <TableCell className="font-medium text-sm">{agentName}</TableCell>
                              <TableCell className="text-sm">{w?.suburb?.trim() || "-"}</TableCell>
                              <TableCell className="font-medium text-sm">
                                {w?.workshop_name?.trim() || "-"}
                              </TableCell>
                              <TableCell>
                                {r.call_status ? (
                                  <Badge variant={r.call_status === 'confirmed' ? 'default' : 'destructive'} className="text-[10px] tracking-wide uppercase">
                                    {r.call_status}
                                  </Badge>
                                ) : r.first_called_at ? (
                                  <Badge variant="outline" className="text-[10px] tracking-wide uppercase">Called</Badge>
                                ) : "-"}
                              </TableCell>
                              <TableCell className="text-xs max-w-md align-top whitespace-pre-wrap break-words text-muted-foreground">
                                {(r.remarks ?? "").trim() || "-"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {contacts.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <EmptyState message="No workshop contact rows yet - agents use Mark as called and remarks on My call list." />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="followups" className="space-y-2 mt-0">
                  <h3 className="text-sm font-semibold text-amber-700">Scheduled workshop callbacks</h3>
                  <p className="text-xs text-muted-foreground">
                    Rows with a follow-up time set by agents on My call list suburb workshops - sorted earliest first.
                  </p>
                  <ScrollArea className="h-[min(60vh,520px)] rounded-xl border border-amber-200 bg-amber-50/10">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-amber-50/50">
                          <TableHead className="text-amber-900">Follow-up</TableHead>
                          <TableHead className="text-amber-900">Agent</TableHead>
                          <TableHead className="text-amber-900">Suburb</TableHead>
                          <TableHead className="text-amber-900">Workshop</TableHead>
                          <TableHead className="text-amber-900 min-w-[200px]">Remarks</TableHead>
                          <TableHead className="text-amber-900">Updated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {followUpRows.map((r) => {
                          const w = workshopById.get(r.workshop_id);
                          const agentName = agents.find((a) => a.id === r.agent_id)?.name ?? r.agent_id;
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="text-xs whitespace-nowrap font-semibold text-amber-700">
                                {r.follow_up_at ? formatTimeAu(r.follow_up_at) : "-"}
                              </TableCell>
                              <TableCell className="font-medium text-sm">{agentName}</TableCell>
                              <TableCell className="text-sm">{w?.suburb?.trim() || "-"}</TableCell>
                              <TableCell className="font-medium text-sm">{w?.workshop_name?.trim() || "-"}</TableCell>
                              <TableCell className="text-xs max-w-md align-top whitespace-pre-wrap break-words text-muted-foreground">
                                {(r.remarks ?? "").trim() || "-"}
                              </TableCell>
                              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                                {r.updated_at ? formatTimeAu(r.updated_at) : "-"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {followUpRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <EmptyState message="No scheduled workshop follow-ups yet." />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="completed" className="space-y-2 mt-0">
                  <h3 className="text-sm font-semibold text-emerald-700">Completed workshop calls</h3>
                  <p className="text-xs text-muted-foreground">
                    Rows marked as Confirmed or Rejected by agents. Sorted most recent first.
                  </p>
                  <ScrollArea className="h-[min(60vh,520px)] rounded-xl border border-emerald-200 bg-emerald-50/10">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-emerald-50/50">
                          <TableHead className="text-emerald-900">Updated</TableHead>
                          <TableHead className="text-emerald-900">Agent</TableHead>
                          <TableHead className="text-emerald-900">Suburb</TableHead>
                          <TableHead className="text-emerald-900">Workshop</TableHead>
                          <TableHead className="text-emerald-900">Status</TableHead>
                          <TableHead className="text-emerald-900 min-w-[200px]">Remarks</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {completedRows.map((r) => {
                          const w = workshopById.get(r.workshop_id);
                          const agentName = agents.find((a) => a.id === r.agent_id)?.name ?? r.agent_id;
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                                {r.updated_at ? formatTimeAu(r.updated_at) : "-"}
                              </TableCell>
                              <TableCell className="font-medium text-sm">{agentName}</TableCell>
                              <TableCell className="text-sm">{w?.suburb?.trim() || "-"}</TableCell>
                              <TableCell className="font-medium text-sm">{w?.workshop_name?.trim() || "-"}</TableCell>
                              <TableCell>
                                <Badge variant={r.call_status === 'confirmed' ? 'default' : 'destructive'} className="text-[10px] tracking-wide uppercase">
                                  {r.call_status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs max-w-md align-top whitespace-pre-wrap break-words text-muted-foreground">
                                {(r.remarks ?? "").trim() || "-"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {completedRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <EmptyState message="No completed workshop calls yet." />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      )}
    </SalesTenantScope>
  );
}

export function SalesTrialSitePipelineTab({
  tenantId,
  onRefreshDashboard,
}: SalesAdminTabProps) {
  const [trials, setTrials] = useState<
    Awaited<ReturnType<typeof fetchSalesTrialsTenant>>
  >([]);
  const [visits, setVisits] = useState<
    Awaited<ReturnType<typeof fetchSalesSiteVisitsTenant>>
  >([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (tid: string) => {
    setLoading(true);
    try {
      const [t, v] = await Promise.all([
        fetchSalesTrialsTenant(tid),
        fetchSalesSiteVisitsTenant(tid),
      ]);
      setTrials(t);
      setVisits(v);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    void load(tenantId);
  }, [tenantId, load]);

  return (
    <SalesTenantScope tenantId={tenantId}>
      {(tid) => (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Trials</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <EmptyState message="Loading..." />
              ) : (
                <ScrollArea className="h-[360px] pr-4">
                  <div className="space-y-2">
                    {trials.map((trow) => (
                      <div
                        key={trow.id}
                        className="flex justify-between rounded-lg border px-3 py-2 text-sm"
                      >
                        <span className="truncate font-mono">{trow.lead_id}</span>
                        <Badge>{trow.status}</Badge>
                      </div>
                    ))}
                    {trials.length === 0 ? (
                      <EmptyState message='Trials appear when outcomes log "Trial started".' />
                    ) : null}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Site visits</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <EmptyState message="Loading..." />
              ) : (
                <ScrollArea className="h-[360px] pr-4">
                  <div className="space-y-2">
                    {visits.map((vrow) => (
                      <div
                        key={vrow.id}
                        className="flex justify-between rounded-lg border px-3 py-2 text-sm"
                      >
                        <span className="truncate font-mono">{vrow.lead_id}</span>
                        <Badge>{vrow.status}</Badge>
                      </div>
                    ))}
                    {visits.length === 0 ? (
                      <EmptyState message="Visits log when reps book on-site demos." />
                    ) : null}
                  </div>
                </ScrollArea>
              )}
              <Button
                className="mt-4 w-full sm:w-auto"
                variant="outline"
                type="button"
                onClick={() => {
                  void load(tid);
                  onRefreshDashboard();
                }}
              >
                Refresh pipeline objects
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </SalesTenantScope>
  );
}

export function SalesCallLogsTab({
  tenantId,
  agents,
  onRefreshDashboard,
}: SalesAdminTabProps) {
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof fetchSalesInteractions>>
  >([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (tid: string) => {
    setLoading(true);
    try {
      setRows(await fetchSalesInteractions(tid));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    void load(tenantId);
  }, [tenantId, load]);

  return (
    <SalesTenantScope tenantId={tenantId}>
      {(tid) => (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                Call logs &amp; customer responses
              </h2>
              <p className="text-sm text-muted-foreground">
                Every disposition creates a row here with suburb, agent attribution, remarks, and customer responses - alongside the latest notes shown on Lead / customer database.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void load(tid);
                onRefreshDashboard();
              }}
            >
              Refresh
            </Button>
          </div>
          {loading ? (
            <EmptyState message="Fetching interaction history..." />
          ) : (
            <ScrollArea className="h-[min(520px,72vh)] rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">When</TableHead>
                    <TableHead>Lead</TableHead>
                    <TableHead className="w-[100px]">Suburb</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Customer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatTimeAu(r.created_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.lead?.display_name ?? r.lead_id}
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {r.lead?.phone}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap max-w-[100px] truncate">
                        {r.lead?.suburb?.trim() || "-"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[120px] truncate">
                        {r.agent_id ? agents.find((a) => a.id === r.agent_id)?.name ?? r.agent_id : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.outcome}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {r.notes || "-"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {r.customer_response || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <EmptyState message="No interactions yet - agents log outcomes from their workspace." />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>
      )}
    </SalesTenantScope>
  );
}
