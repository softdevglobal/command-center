import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Phone, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverClose,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SOFTPHONE_DIAL_REQUEST_EVENT } from "@/components/dashboard/SoftphoneWidget";
import type {
  Agent,
  Permissions,
  Tenant,
  UserSession,
} from "@/services/types";
import {
  fetchAgentSuburbsAssigned,
  fetchSalesCommissionTenant,
  fetchSalesLeadsMine,
  fetchSalesSuburbWorkshopsWithAgentContact,
  markSalesLeadCalled,
  markSalesSuburbWorkshopCalled,
  insertSalesSuburbWorkshop,
  normalizeSalesSuburbKey,
  salesProgressFromLeads,
  workshopsMatchingSuburb,
  updateSalesLeadDeskNotes,
  updateSalesSuburbWorkshopAgentRemarks,
  setSalesSuburbWorkshopFollowUp,
  setSalesSuburbWorkshopCallStatus,
  type SalesLeadRow,
  type SalesSuburbRow,
  type SalesSuburbWorkshopWithAgentContact,
} from "@/services/salesWorkspaceApi";
import { LeadOutcomeDrawer } from "@/tabs/sales-workspace/LeadOutcomeDrawer";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTimeAu } from "@/utils/australianTime";

const PROGRESS_EXPAND_AT = 20;

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(local: string): string | null {
  const s = local.trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

export interface SalesAgentTabProps {
  agents: Agent[];
  tenants: Tenant[];
  permissions: Permissions;
  session: UserSession;
  currentAgentDbId: string | null;
  onRefreshDashboard: () => void;
}

function resolveAgentId(props: Pick<SalesAgentTabProps, "session" | "agents">): string | null {
  const a = props.agents.find((ag) => ag.userId === props.session.userId);
  return a?.id ?? null;
}

/** Flat table: suburbs & workshops from `sales_suburb_workshops` (agent scope via RLS), plus per-agent call + remarks. */
function SuburbWorkshopsTable({
  workshops,
  loading,
  onRefresh,
}: {
  workshops: SalesSuburbWorkshopWithAgentContact[];
  loading?: boolean;
  onRefresh?: () => void | Promise<void>;
}) {
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<string, string>>({});
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null);
  const [savingFollowUpId, setSavingFollowUpId] = useState<string | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      [...workshops].sort((a, b) => {
        const bySub = (a.suburb || "").localeCompare(b.suburb || "", undefined, {
          sensitivity: "base",
        });
        if (bySub !== 0) return bySub;
        return (a.workshop_name || "").localeCompare(b.workshop_name || "", undefined, {
          sensitivity: "base",
        });
      }),
    [workshops],
  );

  useEffect(() => {
    setNoteDrafts(Object.fromEntries(workshops.map((w) => [w.id, w.agent_remarks ?? ""])));
    setFollowUpDrafts(
      Object.fromEntries(
        workshops.map((w) => [w.id, toDatetimeLocalValue(w.agent_follow_up_at)]),
      ),
    );
  }, [workshops]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Suburb workshops</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">
          Rows come from Sales → Suburb workshops. Mark called, remarks, and optional callback time are yours only (per agent).
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <EmptyState message="Loading workshops..." />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No workshop records for your access.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table className="w-max min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>Suburb</TableHead>
                  <TableHead>Workshop name</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="min-w-[12rem]">Mark as called</TableHead>
                  <TableHead className="min-w-[220px]">Remarks</TableHead>
                  <TableHead className="min-w-[13rem]">Follow-up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => {
                  const called = Boolean(w.agent_first_called_at);
                  const draft = noteDrafts[w.id] ?? w.agent_remarks ?? "";
                  const dirty = draft.trim() !== (w.agent_remarks ?? "").trim();
                  const followDraft =
                    followUpDrafts[w.id] ?? toDatetimeLocalValue(w.agent_follow_up_at);
                  const followDraftIso = fromDatetimeLocalValue(followDraft);
                  const serverFollowIso = w.agent_follow_up_at ?? null;
                  const followDirty = followDraftIso !== serverFollowIso;
                  return (
                    <TableRow key={w.id}>
                      <TableCell className="text-sm">{w.suburb?.trim() || "-"}</TableCell>
                      <TableCell className="font-medium">{w.workshop_name?.trim() || "-"}</TableCell>
                      <TableCell className="text-sm">{w.owner_name?.trim() || "-"}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {w.phone_number?.trim() ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="link" className="h-auto p-0 text-xs font-mono">
                                {w.phone_number.trim()}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-3" side="top">
                              <div className="flex flex-col gap-3">
                                <p className="text-xs font-medium text-slate-700">Dial {w.phone_number.trim()}?</p>
                                <div className="flex gap-2">
                                  <PopoverClose asChild>
                                    <Button 
                                      size="sm" 
                                      className="bg-emerald-500 hover:bg-emerald-600 flex-1 text-white"
                                      onClick={() => {
                                        window.dispatchEvent(
                                          new CustomEvent(SOFTPHONE_DIAL_REQUEST_EVENT, {
                                            detail: { number: w.phone_number?.trim() },
                                          })
                                        );
                                      }}
                                    >
                                      <Phone className="mr-1 h-3 w-3" />
                                      Call
                                    </Button>
                                  </PopoverClose>
                                  <PopoverClose asChild>
                                    <Button variant="outline" size="sm" className="flex-1">
                                      Cancel
                                    </Button>
                                  </PopoverClose>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-sm break-all">{w.owner_email?.trim() || "-"}</TableCell>
                      <TableCell className="align-top">
                        {called ? (
                          <div className="flex flex-col gap-1.5 min-w-[11rem]">
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {w.agent_first_called_at
                                ? formatTimeAu(w.agent_first_called_at)
                                : "Marked"}
                            </span>
                            <Select
                              value={w.agent_call_status ?? ""}
                              disabled={savingStatusId === w.id}
                              onValueChange={(val) => {
                                if (val === "confirmed" || val === "rejected") {
                                  setSavingStatusId(w.id);
                                  void setSalesSuburbWorkshopCallStatus(w.id, val, w.agent_contact_id)
                                    .then(async () => {
                                      toast.success(
                                        val === "confirmed" ? "Marked as confirmed" : "Marked as rejected",
                                      );
                                      await onRefresh?.();
                                    })
                                    .catch((e) =>
                                      toast.error(e instanceof Error ? e.message : "Could not save outcome"),
                                    )
                                    .finally(() => setSavingStatusId(null));
                                }
                              }}
                            >
                              <SelectTrigger className="h-7 text-xs" disabled={savingStatusId === w.id}>
                                <SelectValue placeholder={savingStatusId === w.id ? "Saving..." : "Set outcome..."} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="confirmed">
                                  <span className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                                    Confirmed
                                  </span>
                                </SelectItem>
                                <SelectItem value="rejected">
                                  <span className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-rose-500 inline-block" />
                                    Rejected
                                  </span>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="w-full min-w-[9rem]"
                            disabled={markingId === w.id}
                            onClick={() => {
                              setMarkingId(w.id);
                              void markSalesSuburbWorkshopCalled(w.id, w.agent_contact_id)
                                .then(async () => {
                                  toast.success("Marked as called");
                                  await onRefresh?.();
                                })
                                .catch((e) =>
                                  toast.error(e instanceof Error ? e.message : "Could not update"),
                                )
                                .finally(() => setMarkingId(null));
                            }}
                          >
                            {markingId === w.id ? "Saving..." : "Mark as called"}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-2 min-w-[200px] max-w-md">
                          <Textarea
                            rows={3}
                            value={draft}
                            onChange={(e) =>
                              setNoteDrafts((prev) => ({ ...prev, [w.id]: e.target.value }))
                            }
                            placeholder="Your notes on this workshop"
                            className="text-sm"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!dirty || savingNotesId === w.id}
                            onClick={() => {
                              setSavingNotesId(w.id);
                              void updateSalesSuburbWorkshopAgentRemarks(w.id, draft, w.agent_contact_id)
                                .then(async () => {
                                  toast.success("Remarks saved");
                                  await onRefresh?.();
                                })
                                .catch((e) =>
                                  toast.error(e instanceof Error ? e.message : "Could not save"),
                                )
                                .finally(() => setSavingNotesId(null));
                            }}
                          >
                            {savingNotesId === w.id && dirty ? "Saving..." : "Save remarks"}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-2 min-w-[12rem]">
                          <Input
                            type="datetime-local"
                            value={followDraft}
                            onChange={(e) =>
                              setFollowUpDrafts((prev) => ({
                                ...prev,
                                [w.id]: e.target.value,
                              }))
                            }
                            className="text-sm min-w-[12rem]"
                          />
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={!followDirty || savingFollowUpId === w.id}
                              onClick={() => {
                                setSavingFollowUpId(w.id);
                                void setSalesSuburbWorkshopFollowUp(
                                  w.id,
                                  fromDatetimeLocalValue(followDraft),
                                  w.agent_contact_id,
                                )
                                  .then(async () => {
                                    toast.success("Follow-up saved");
                                    await onRefresh?.();
                                  })
                                  .catch((e) =>
                                    toast.error(e instanceof Error ? e.message : "Could not save"),
                                  )
                                  .finally(() => setSavingFollowUpId(null));
                              }}
                            >
                              {savingFollowUpId === w.id && followDirty ? "Saving..." : "Save"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={
                                savingFollowUpId === w.id ||
                                (!serverFollowIso && !followDraft.trim())
                              }
                              onClick={() => {
                                setSavingFollowUpId(w.id);
                                setFollowUpDrafts((prev) => ({ ...prev, [w.id]: "" }));
                                void setSalesSuburbWorkshopFollowUp(w.id, null, w.agent_contact_id)
                                  .then(async () => {
                                    toast.success("Follow-up cleared");
                                    await onRefresh?.();
                                  })
                                  .catch((e) => {
                                    setFollowUpDrafts((prev) => ({
                                      ...prev,
                                      [w.id]: toDatetimeLocalValue(w.agent_follow_up_at),
                                    }));
                                    toast.error(e instanceof Error ? e.message : "Could not clear");
                                  })
                                  .finally(() => setSavingFollowUpId(null));
                              }}
                            >
                              Clear
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddWorkshopDialog({
  suburb: prefilledSuburb,
  assignedSuburbs = [],
  tenantId,
  onSuccess,
}: {
  suburb?: string;
  assignedSuburbs?: string[];
  tenantId: string;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [suburb, setSuburb] = useState(prefilledSuburb || "");
  const [workshopName, setWorkshopName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync internal suburb state when prefilledSuburb changes
  useEffect(() => {
    if (prefilledSuburb) setSuburb(prefilledSuburb);
  }, [prefilledSuburb]);

  // Clear error when dialog opens/closes
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const handleSubmit = async () => {
    setError(null);
    if (!suburb) {
      setError("Suburb is required");
      return;
    }
    if (!workshopName.trim()) {
      setError("Workshop name is required");
      return;
    }
    setSaving(true);
    try {
      await insertSalesSuburbWorkshop({
        tenantId,
        suburb: suburb.trim(),
        workshopName,
        phoneNumber,
        ownerName,
        ownerEmail,
        location,
        website,
      });
      toast.success("Workshop added successfully");
      setOpen(false);
      onSuccess?.();
      // Reset form
      if (!prefilledSuburb) setSuburb("");
      setWorkshopName("");
      setPhoneNumber("");
      setOwnerName("");
      setOwnerEmail("");
      setLocation("");
      setWebsite("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add workshop";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const trigger = prefilledSuburb ? (
    <Button variant="secondary" size="icon" className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200">
      <Plus className="h-3 w-3" />
    </Button>
  ) : (
    <Button variant="outline" size="sm" className="h-8 gap-1.5 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
      <Plus className="h-3.5 w-3.5" />
      Add Workshop
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Workshop</DialogTitle>
          <DialogDescription>
            {prefilledSuburb ? (
              <>Add a new workshop for <strong>{prefilledSuburb}</strong>.</>
            ) : (
              "Add a new workshop to one of your assigned suburbs."
            )}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="bg-destructive/10 text-destructive text-xs p-2 rounded-md mb-2">
            {error}
          </div>
        )}
        <div className="grid gap-4 py-4">
          {!prefilledSuburb && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="suburb-select" className="text-right text-xs">
                Suburb *
              </Label>
              <Select value={suburb} onValueChange={setSuburb}>
                <SelectTrigger id="suburb-select" className="col-span-3 text-sm">
                  <SelectValue placeholder="Select a suburb..." />
                </SelectTrigger>
                <SelectContent>
                  {assignedSuburbs.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right text-xs">
              Name *
            </Label>
            <Input
              id="name"
              value={workshopName}
              onChange={(e) => setWorkshopName(e.target.value)}
              className="col-span-3 text-sm"
              placeholder="e.g. Preston North Panel"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="phone" className="text-right text-xs">
              Phone
            </Label>
            <Input
              id="phone"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="col-span-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="owner" className="text-right text-xs">
              Owner
            </Label>
            <Input
              id="owner"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="col-span-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="email" className="text-right text-xs">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className="col-span-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="location" className="text-right text-xs">
              Location
            </Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="col-span-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="website" className="text-right text-xs">
              Website
            </Label>
            <Input
              id="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="col-span-3 text-sm"
              placeholder="https://..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving ? "Adding..." : "Add Workshop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentSalesHomeTab({
  agents,
  session,
  tenants,
  currentAgentDbId,
  onRefreshDashboard: _onRefreshDashboard,
}: SalesAgentTabProps) {
  const agentId = currentAgentDbId ?? resolveAgentId({ agents, session });
  const [leads, setLeads] = useState<SalesLeadRow[]>([]);
  const [suburbAssignments, setSuburbAssignments] = useState<SalesSuburbRow[]>([]);
  const [resolvedAgentIdFromApi, setResolvedAgentIdFromApi] = useState<string | null>(null);
  const [commissions, setCommissions] = useState<
    Awaited<ReturnType<typeof fetchSalesCommissionTenant>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const [ml, sbRows] = await Promise.all([
        fetchSalesLeadsMine(),
        fetchAgentSuburbsAssigned(),
      ]);

      setLeads(ml);
      setSuburbAssignments(sbRows);
      if (sbRows.length > 0 && sbRows[0].agent_id) {
        setResolvedAgentIdFromApi(sbRows[0].agent_id);
      }

      const tids = [...new Set(ml.map((l) => l.tenant_id))];
      if (tids.length === 1) {
        setCommissions(await fetchSalesCommissionTenant(tids[0]));
      } else {
        let acc: Awaited<ReturnType<typeof fetchSalesCommissionTenant>> = [];
        for (const t of tids) {
          const c = await fetchSalesCommissionTenant(t);
          acc = acc.concat(c);
        }
        setCommissions(acc);
      }
    } catch (e) {
      if (!silent) {
        setErr(e instanceof Error ? e.message : "Failed to load");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Use API-resolved agent ID as fallback when the local agents list match fails
  const effectiveAgentId = agentId ?? resolvedAgentIdFromApi;

  const stats = useMemo(() => salesProgressFromLeads(leads), [leads]);
  const assignedSuburbLabels = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const r of suburbAssignments) {
      const raw = r.suburb?.trim() ?? "";
      if (!raw) continue;
      const key = normalizeSalesSuburbKey(raw);
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(raw);
    }
    return labels.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [suburbAssignments]);
  const pendingCommissions = commissions.filter((c) => c.status === "Pending Review" &&
    (!effectiveAgentId || c.agent_id === effectiveAgentId)).length;
  const followUps = leads.filter((l) => l.follow_up_at).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Agent home</h2>
        <p className="text-sm text-muted-foreground">
          Assigned leads-only view - privacy enforced by tenant rules.
        </p>
      </div>
      {err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {err}
        </div>
      ) : null}
      {loading ? (
        <EmptyState message="Loading desk summary..." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">My assignments</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-semibold">{stats.assignedTotal}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Open follow-ups</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-semibold">{followUps}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Trials credited</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-semibold">{stats.trialStarted}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Commissions pending</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-semibold">{pendingCommissions}</p></CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Assigned suburbs</CardTitle>
                  <p className="text-sm font-normal text-muted-foreground">
                    Your territory from Sales → Agent suburb assignment.
                  </p>
                </div>
                {effectiveAgentId && assignedSuburbLabels.length > 0 && (
                  <AddWorkshopDialog 
                    assignedSuburbs={assignedSuburbLabels}
                    tenantId={agents.find((ag) => ag.userId === session.userId)?.tenantId || session.tenantId || ""}
                    onSuccess={() => void load({ silent: true })}
                  />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!effectiveAgentId && assignedSuburbLabels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Your login is not yet linked to an agent row - ops can attach it under Agents.
                </p>
              ) : assignedSuburbLabels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No suburbs on your profile yet - ask a super admin to assign suburbs to you.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {assignedSuburbLabels.map((s) => {
                    const agentObj = agents.find((ag) => ag.userId === session.userId);
                    const tid = agentObj?.tenantId || session.tenantId;
                    return (
                      <Badge key={s} variant="secondary" className="pr-1 gap-1.5 flex items-center h-8 px-2">
                        <span className="text-xs font-medium">{s}</span>
                        {tid && (
                          <AddWorkshopDialog 
                            suburb={s} 
                            tenantId={tid} 
                            onSuccess={() => void load({ silent: true })} 
                          />
                        )}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          {stats.assignedTotal >= PROGRESS_EXPAND_AT ? (
            <Card>
              <CardHeader><CardTitle>Snapshot</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Badge variant="outline">Called - {stats.called}</Badge>
                <Badge variant="outline">Not called - {stats.notCalled}</Badge>
                <Badge variant="secondary">Interested - {stats.interested}</Badge>
                <Badge variant="secondary">Visits - {stats.siteVisitsBooked}</Badge>
                <Badge>Converted - {stats.converted}</Badge>
              </CardContent>
            </Card>
          ) : (
            <p className="text-xs text-muted-foreground">
              Extended funnel snapshot appears automatically when at least twenty leads are routed to your queue.
            </p>
          )}
          <Button type="button" variant="outline" onClick={() => void load()}>
            Refresh summary
          </Button>
        </>
      )}
    </div>
  );
}

export function AgentMyCallListTab({
  agents,
  session,
  currentAgentDbId,
  tenants: _tenants,
  onRefreshDashboard: _onRefreshDashboard,
}: SalesAgentTabProps) {
  const effectiveAgentId = currentAgentDbId ?? resolveAgentId({ agents, session });
  const effectiveTenantId =
    agents.find((agent) => agent.id === effectiveAgentId)?.tenantId ?? session.tenantId ?? null;
  const [workshops, setWorkshops] = useState<SalesSuburbWorkshopWithAgentContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const ws = await fetchSalesSuburbWorkshopsWithAgentContact({
        agentId: effectiveAgentId,
        tenantId: effectiveTenantId,
        userId: session.userId,
      });
      setWorkshops(ws);
    } catch (e) {
      if (!silent) {
        setLoadError(e instanceof Error ? e.message : "Failed to load workshops");
        setWorkshops([]);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [effectiveAgentId, effectiveTenantId, session.userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const agentLabel = agents.find((a) => effectiveAgentId === a.id)?.name;

  // Workshops that have an outcome (confirmed/rejected) move to Completed tab
  // Workshops with a follow-up time set move to Follow-ups tab
  const pendingWorkshops = useMemo(
    () => workshops.filter((w) => !w.agent_call_status && !w.agent_follow_up_at),
    [workshops],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">My call list</h2>
          <p className="text-sm text-muted-foreground">
            Suburb workshops from Sales - mark called, save remarks, and set follow-ups below (scroll horizontally on
            narrow screens). Use <strong className="font-medium text-foreground">Reload</strong> to refresh.
            Workshops you set a <em>Follow-up</em> time for move to the <strong className="font-medium text-foreground">My follow-ups</strong> tab.
            Workshops you mark <em>Confirmed</em> or <em>Rejected</em> move to the{" "}
            <strong className="font-medium text-foreground">Completed</strong> tab automatically.
            {agentLabel ? ` - ${agentLabel}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(() => {
            const agentObj = agents.find((ag) => ag.userId === session.userId);
            const tid = agentObj?.tenantId || session.tenantId;
            // For general add button in this tab, we'd need a suburb picker or we just rely on the ones in Agent Home.
            // But since the user complained about visibility, let's at least make sure they can see them in Agent Home.
            return null;
          })()}
          <Button type="button" variant="outline" onClick={() => void load()}>
            Reload
          </Button>
        </div>
      </div>

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load workshops</AlertTitle>
          <AlertDescription className="text-sm">{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <SuburbWorkshopsTable
        workshops={pendingWorkshops}
        loading={loading}
        onRefresh={() => {
          void load({ silent: true });
        }}
      />
    </div>
  );
}

export function AgentCallWorkspaceTab(props: SalesAgentTabProps) {
  const effectiveAgentId = props.currentAgentDbId ?? resolveAgentId(props);
  const effectiveTenantId =
    props.agents.find((agent) => agent.id === effectiveAgentId)?.tenantId ??
    props.session.tenantId ??
    null;
  const [rows, setRows] = useState<SalesLeadRow[]>([]);
  const [workshops, setWorkshops] = useState<SalesSuburbWorkshopWithAgentContact[]>([]);
  const [sel, setSel] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deskNotes, setDeskNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [leads, ws] = await Promise.all([
        fetchSalesLeadsMine(),
        fetchSalesSuburbWorkshopsWithAgentContact({
          agentId: effectiveAgentId,
          tenantId: effectiveTenantId,
          userId: props.session.userId,
        }),
      ]);
      setRows(leads);
      setWorkshops(ws);
    } finally {
      setLoading(false);
    }
  }, [effectiveAgentId, effectiveTenantId, props.session.userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const picked = rows.find((r) => r.id === sel) ?? rows[0] ?? null;

  useEffect(() => {
    if (!picked) {
      setDeskNotes("");
      return;
    }
    setDeskNotes(picked.notes ?? "");
  }, [picked]);

  const workshopsForLead = useMemo(() => {
    if (!picked?.suburb?.trim()) return [];
    return workshopsMatchingSuburb(workshops, picked.suburb);
  }, [picked?.suburb, workshops]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Call workspace</h2>
        <p className="text-sm text-muted-foreground">
          Tie each dial to CRM outcomes - this drawer logs post-call results (trials / visits / conversions).
          Desk notes sync to supervisors on lead records and timelines. Use Overview + softphone for live PBX routing.
        </p>
      </div>
      {loading ? <EmptyState message="Loading assignees..." /> : rows.length === 0 ? (
        <EmptyState message="Nothing assigned - supervisors release leads from Assignment Board." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px,minmax(0,1fr)]">
          <Card>
            <CardHeader><CardTitle>Active dial target</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={picked?.id ?? ""}
                onValueChange={(v) => setSel(v)}
              >
                <SelectTrigger><SelectValue placeholder="Pick assigned lead" /></SelectTrigger>
                <SelectContent>
                  {rows.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {picked ? (
                <>
                  <div className="rounded-lg bg-muted px-3 py-2 font-mono text-sm">{picked.phone}</div>
                  <div className="text-xs text-muted-foreground">{picked.suburb || "No suburb captured"} - {picked.journey_stage}</div>
                  <Button type="button" onClick={() => setOpen(true)} disabled={!picked}>
                    Open outcome drawer
                  </Button>
                </>
              ) : null}
            </CardContent>
          </Card>
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader><CardTitle>Suburb workshops</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-4">
                {workshopsForLead.length > 0 ? (
                  workshopsForLead.map((workshopForLead) => (
                    <div key={workshopForLead.id} className="rounded-lg border bg-background px-3 py-2 space-y-2">
                      <div className="font-medium">{workshopForLead.workshop_name || "Workshop"}</div>
                      <dl className="grid gap-2 sm:grid-cols-2">
                        {workshopForLead.phone_number ? (
                          <div><span className="text-muted-foreground text-xs">Phone</span><div className="font-mono text-xs">{workshopForLead.phone_number}</div></div>
                        ) : null}
                        {workshopForLead.owner_name ? (
                          <div><span className="text-muted-foreground text-xs">Owner</span><div>{workshopForLead.owner_name}</div></div>
                        ) : null}
                        {workshopForLead.owner_email ? (
                          <div><span className="text-muted-foreground text-xs">Owner email</span><div className="break-all text-xs">{workshopForLead.owner_email}</div></div>
                        ) : null}
                        {workshopForLead.location ? (
                          <div className="sm:col-span-2"><span className="text-muted-foreground text-xs">Location</span><div>{workshopForLead.location}</div></div>
                        ) : null}
                        {workshopForLead.website ? (
                          <div className="sm:col-span-2">
                            <a href={workshopForLead.website.startsWith("http") ? workshopForLead.website : `https://${workshopForLead.website}`} className="text-primary underline break-all text-xs" target="_blank" rel="noreferrer">
                              {workshopForLead.website}
                            </a>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <p className="text-muted-foreground">
                      No workshop records for this lead&apos;s suburb.
                    </p>
                    {(() => {
                      const agentObj = props.agents.find((ag) => ag.userId === props.session.userId);
                      const tid = agentObj?.tenantId;
                      if (tid && picked?.suburb) {
                        return (
                          <div className="flex flex-col items-center gap-2">
                            <span className="text-xs text-muted-foreground">Would you like to add one?</span>
                            <AddWorkshopDialog 
                              suburb={picked.suburb} 
                              tenantId={tid} 
                              onSuccess={() => void reload()} 
                            />
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="border-dashed bg-muted/30">
              <CardHeader><CardTitle>Operator hints</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-2">
                <p>1. Dial from Overview / softphone, then log the disposition so supervisors retain a clean audit trail.</p>
                <p>2. Every outcome replaces the CRM “notes” preview with what you typed in that call - use desk notes below for quieter scratchpads.</p>
                <Button type="button" variant="secondary" disabled={!picked} onClick={() => setOpen(true)}>Jump to disposition</Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Desk remarks</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Saved to this lead&apos;s CRM notes immediately. Logging a disposition overwrites notes with that call memo - recap important context after each log if needed.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="desk-notes">Notes visible to admins</Label>
                  <Textarea
                    id="desk-notes"
                    rows={5}
                    value={deskNotes}
                    onChange={(e) => setDeskNotes(e.target.value)}
                    disabled={!picked}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!picked || notesSaving}
                  onClick={() => {
                    if (!picked) return;
                    setNotesSaving(true);
                    void updateSalesLeadDeskNotes(picked.id, deskNotes).then(async () => {
                      toast.success("Desk notes saved");
                      await reload();
                    }).catch((e) => toast.error(e instanceof Error ? e.message : "Could not save")).finally(() => setNotesSaving(false));
                  }}
                >
                  {notesSaving ? "Saving..." : "Save desk notes"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      <LeadOutcomeDrawer lead={picked} open={open} onOpenChange={setOpen} onSaved={reload} />
    </div>
  );
}

export function AgentFollowUpsTab({
  agents,
  session,
  currentAgentDbId,
}: SalesAgentTabProps) {
  const effectiveAgentId = currentAgentDbId ?? resolveAgentId({ agents, session });
  const effectiveTenantId =
    agents.find((agent) => agent.id === effectiveAgentId)?.tenantId ?? session.tenantId ?? null;
  const [workshops, setWorkshops] = useState<SalesSuburbWorkshopWithAgentContact[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
    }
    try {
      const ws = await fetchSalesSuburbWorkshopsWithAgentContact({
        agentId: effectiveAgentId,
        tenantId: effectiveTenantId,
        userId: session.userId,
      });
      setWorkshops(ws);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [effectiveAgentId, effectiveTenantId, session.userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const followUpWorkshops = useMemo(
    () =>
      workshops
        .filter((w) => Boolean(w.agent_follow_up_at) && !w.agent_call_status)
        .slice()
        .sort((a, b) => String(a.agent_follow_up_at!).localeCompare(String(b.agent_follow_up_at!))),
    [workshops],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">My follow-ups</h2>
          <p className="text-sm text-muted-foreground">
            Workshop callback times you set under <span className="font-medium text-foreground">My call list</span>.{" "}
            Mark an outcome (<em>Confirmed</em> or <em>Rejected</em>) to move them to the <strong className="font-medium text-foreground">Completed</strong> tab.
            Clearing the follow-up time moves them back to the call list.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void reload()}>
          Reload
        </Button>
      </div>

      <SuburbWorkshopsTable
        workshops={followUpWorkshops}
        loading={loading}
        onRefresh={() => {
          void reload({ silent: true });
        }}
      />
    </div>
  );
}

export function AgentMyPipelineTab() {
  const [rows, setRows] = useState<SalesLeadRow[]>([]);
  useEffect(() => {
    void fetchSalesLeadsMine().then(setRows);
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, SalesLeadRow[]>();
    for (const r of rows) {
      const g = r.journey_stage;
      const arr = m.get(g) ?? [];
      arr.push(r);
      m.set(g, arr);
    }
    return m;
  }, [rows]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">My pipeline</h2>
      <p className="text-sm text-muted-foreground">Rows grouped automatically by funnel stage assignment.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from(groups.entries()).map(([stage, list]) => (
          <Card key={stage}>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Badge>{stage}</Badge> <span>{list.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {list.map((l) => (
                <div key={l.id} className="rounded border px-3 py-2">{l.display_name}</div>
              ))}
              {list.length === 0 ? <EmptyState message="Quiet stage." /> : null}
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 ? <EmptyState message="Assignments appear after routing." /> : null}
      </div>
    </div>
  );
}

export function AgentPerformanceRewardsTab(props: SalesAgentTabProps) {
  const agentId = props.currentAgentDbId ?? resolveAgentId(props);
  const [leads, setLeads] = useState<SalesLeadRow[]>([]);
  const [coms, setComs] = useState<Awaited<ReturnType<typeof fetchSalesCommissionTenant>>>([]);
  useEffect(() => {
    void fetchSalesLeadsMine().then(async (mine) => {
      setLeads(mine);
      const tids = [...new Set(mine.map((l) => l.tenant_id))];
      let agg: typeof coms = [];
      for (const t of tids) agg = agg.concat(await fetchSalesCommissionTenant(t));
      setComs(agg);
    });
  }, []);

  const mine = coms.filter((c) => !agentId || c.agent_id === agentId);

  const convertedCount = leads.filter((l) => l.journey_stage === "converted").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Performance &amp; rewards</h2>
        <p className="text-sm text-muted-foreground">Self-serve rollup - finance still reviews payouts.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Converted</CardTitle></CardHeader>
        <CardContent><p className="text-3xl font-semibold">{convertedCount}</p></CardContent>
      </Card>
      <div>
        <h3 className="text-sm font-semibold mb-2">Commission events</h3>
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Lead</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {mine.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-xs whitespace-nowrap">{formatTimeAu(c.created_at)}</TableCell>
                <TableCell className="font-mono text-xs truncate max-w-[200px]">{c.lead_id}</TableCell>
                <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
              </TableRow>
            ))}
            {mine.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <EmptyState message="Win conversions to generate Pending Review commissions." />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Shows workshops that have been marked as called AND the agent set a Confirmed or Rejected outcome. */
export function AgentCompletedTab({
  agents,
  session,
  currentAgentDbId,
}: SalesAgentTabProps) {
  const effectiveAgentId = currentAgentDbId ?? resolveAgentId({ agents, session });
  const effectiveTenantId =
    agents.find((agent) => agent.id === effectiveAgentId)?.tenantId ?? session.tenantId ?? null;
  const [workshops, setWorkshops] = useState<SalesSuburbWorkshopWithAgentContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearingId, setClearingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const ws = await fetchSalesSuburbWorkshopsWithAgentContact({
        agentId: effectiveAgentId,
        tenantId: effectiveTenantId,
        userId: session.userId,
      });
      setWorkshops(ws);
    } finally {
      setLoading(false);
    }
  }, [effectiveAgentId, effectiveTenantId, session.userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const completedRows = useMemo(
    () =>
      workshops
        .filter((w) => Boolean(w.agent_first_called_at) && Boolean(w.agent_call_status))
        .slice()
        .sort((a, b) => (b.agent_first_called_at ?? "").localeCompare(a.agent_first_called_at ?? "")),
    [workshops],
  );

  const clearStatus = (workshop: SalesSuburbWorkshopWithAgentContact) => {
    setClearingId(workshop.id);
    void setSalesSuburbWorkshopCallStatus(workshop.id, null, workshop.agent_contact_id)
      .then(async () => {
        toast.success("Moved back to call list");
        await reload();
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not clear outcome"))
      .finally(() => setClearingId(null));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Completed</h2>
          <p className="text-sm text-muted-foreground">
            Workshops you marked <em>Confirmed</em> or <em>Rejected</em> from My call list. Use{" "}
            <strong className="font-medium text-foreground">Reload</strong> to refresh data. You can
            clear an outcome to move a workshop back to My call list.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void reload()}>
          Reload
        </Button>
      </div>

      {loading ? (
        <EmptyState message="Loading..." />
      ) : completedRows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No completed workshops yet - mark a workshop as{" "}
            <strong className="font-medium text-foreground">Confirmed</strong> or{" "}
            <strong className="font-medium text-foreground">Rejected</strong> in My call list to see it here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="w-max min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead>Suburb</TableHead>
                <TableHead>Workshop name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Called at</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {completedRows.map((w) => {
                const status = w.agent_call_status;
                return (
                  <TableRow key={w.id}>
                    <TableCell className="text-sm">{w.suburb?.trim() || "-"}</TableCell>
                    <TableCell className="font-medium">{w.workshop_name?.trim() || "-"}</TableCell>
                    <TableCell className="text-sm">{w.owner_name?.trim() || "-"}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {w.phone_number?.trim() || "-"}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {w.agent_first_called_at
                        ? formatTimeAu(w.agent_first_called_at)
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {status === "confirmed" ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">
                          ✓ Confirmed
                        </Badge>
                      ) : (
                        <Badge className="bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100">
                          ✗ Rejected
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm max-w-xs">
                      {w.agent_remarks?.trim() || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-xs"
                        disabled={clearingId === w.id}
                        onClick={() => clearStatus(w)}
                      >
                        {clearingId === w.id ? "Clearing..." : "Move back to call list"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
