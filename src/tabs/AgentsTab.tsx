import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Agent, Queue, Tenant, Permissions } from '@/services/types';
import { formatDuration, formatPhone } from '@/utils/formatters';
import { StatusBadge, STATUS_MAP } from '@/components/dashboard/StatusBadge';
import { LiveDot } from '@/components/dashboard/LiveDot';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { updateAgent, deleteAgent } from '@/services/agentApis';
import { fetchBmsWorkshopOptions } from '@/services/didMappingsApi';
import { Pencil, Trash2, MessageSquare } from 'lucide-react';
import { useDashboard } from '@/context/DashboardDataContext';

const AGENT_ROLES: Agent['role'][] = ['agent', 'senior-agent', 'team-lead'];
const ROLE_LABELS: Record<Agent['role'], string> = {
  agent: 'Agent',
  'senior-agent': 'Senior agent',
  'team-lead': 'Team lead',
};

interface AgentsTabProps {
  agents: Agent[];
  queues: Queue[];
  tenants: Tenant[];
  permissions: Permissions;
  now: number;
  onRefresh: () => void;
}

type AgentGroupTab = 'command-centre' | 'workshop';

export function AgentsTab({ agents, queues, tenants, permissions, now, onRefresh }: AgentsTabProps) {
  const { startInternalChat } = useDashboard();
  const [agentGroupTab, setAgentGroupTab] = useState<AgentGroupTab>('command-centre');
  const [filterWorkshopOwnerUid, setFilterWorkshopOwnerUid] = useState('all');
  const [filterQueue, setFilterQueue] = useState('all');

  const [editOpen, setEditOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [formName, setFormName] = useState('');
  const [formExtension, setFormExtension] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formTenantId, setFormTenantId] = useState<string>('');
  const [formRole, setFormRole] = useState<Agent['role']>('agent');
  const [formQueueIds, setFormQueueIds] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [workshopNameByOwnerUid, setWorkshopNameByOwnerUid] = useState<Map<string, string>>(new Map());
  const [branchNameByOwnerAndBranchId, setBranchNameByOwnerAndBranchId] = useState<Map<string, string>>(new Map());

  const openEdit = useCallback((a: Agent) => {
    setEditingAgent(a);
    setFormName(a.name);
    setFormExtension(a.extension || '');
    setFormEmail(a.email || '');
    setFormPhone(a.phone || '');
    setFormTenantId(a.tenantId || '');
    setFormRole(a.role);
    setFormQueueIds([...a.queueIds]);
    setSaveError(null);
    setEditOpen(true);
  }, []);

  const queuesForFormTenant = useMemo(() => {
    if (!formTenantId) return queues;
    return queues.filter((q) => q.tenantId === formTenantId);
  }, [queues, formTenantId]);

  useEffect(() => {
    if (!editOpen || !formTenantId) return;
    setFormQueueIds((prev) => prev.filter((id) => queuesForFormTenant.some((q) => q.id === id)));
  }, [formTenantId, editOpen, queuesForFormTenant]);

  const toggleQueue = useCallback((queueId: string) => {
    setFormQueueIds((prev) =>
      prev.includes(queueId) ? prev.filter((id) => id !== queueId) : [...prev, queueId],
    );
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingAgent) return;
    const name = formName.trim();
    if (!name) {
      setSaveError('Name is required.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateAgent(editingAgent.id, {
        name,
        extension: formExtension.trim(),
        email: formEmail.trim(),
        phone: formPhone.trim(),
        tenantId: formTenantId || null,
        queueIds: formQueueIds,
        role: formRole,
      });
      setEditOpen(false);
      setEditingAgent(null);
      onRefresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }, [
    editingAgent,
    formName,
    formExtension,
    formEmail,
    formPhone,
    formTenantId,
    formQueueIds,
    formRole,
    onRefresh,
  ]);

  const openDelete = useCallback((a: Agent) => {
    setDeletingAgent(a);
    setDeleteError(null);
    setDeleteOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingAgent) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAgent(deletingAgent.id);
      setDeleteOpen(false);
      setDeletingAgent(null);
      onRefresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }, [deletingAgent, onRefresh]);

  useEffect(() => {
    let cancelled = false;
    fetchBmsWorkshopOptions()
      .then((workshops) => {
        if (cancelled) return;
        const workshopMap = new Map<string, string>();
        const branchMap = new Map<string, string>();
        for (const ws of workshops) {
          const ownerUid = String(ws.ownerUid ?? '').trim();
          if (!ownerUid) continue;
          const wsName = String(ws.name ?? '').trim();
          if (wsName) workshopMap.set(ownerUid, wsName);
          for (const b of ws.branches) {
            const branchId = String(b.id ?? '').trim();
            const branchName = String(b.name ?? '').trim();
            if (!branchId || !branchName) continue;
            branchMap.set(`${ownerUid}::${branchId}`, branchName);
          }
        }
        setWorkshopNameByOwnerUid(workshopMap);
        setBranchNameByOwnerAndBranchId(branchMap);
      })
      .catch(() => {
        // Keep graceful fallback labels when workshop lookup is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Respect agent queue restrictions
  const visibleAgents = useMemo(() => {
    if (permissions.allowedQueueIds.length > 0) {
      return agents.filter((a) => a.queueIds.some((qid) => permissions.allowedQueueIds.includes(qid)));
    }
    return agents;
  }, [agents, permissions.allowedQueueIds]);

  const commandCentreAgents = useMemo(
    () => visibleAgents.filter((a) => !String(a.bmsOwnerUid ?? '').trim()),
    [visibleAgents],
  );

  const workshopAgents = useMemo(
    () => visibleAgents.filter((a) => Boolean(String(a.bmsOwnerUid ?? '').trim())),
    [visibleAgents],
  );

  const tabAgents = useMemo(
    () => (agentGroupTab === 'command-centre' ? commandCentreAgents : workshopAgents),
    [agentGroupTab, commandCentreAgents, workshopAgents],
  );

  const availableWorkshopFilters = useMemo(() => {
    if (agentGroupTab !== 'workshop') return [];
    const ownerUids = new Set(
      workshopAgents
        .map((a) => String(a.bmsOwnerUid ?? '').trim())
        .filter((v) => Boolean(v)),
    );
    return Array.from(ownerUids)
      .map((ownerUid) => ({
        ownerUid,
        name: workshopNameByOwnerUid.get(ownerUid) || ownerUid,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [agentGroupTab, workshopAgents, workshopNameByOwnerUid]);

  const availableQueues = useMemo(() => {
    const qids = new Set(tabAgents.flatMap((a) => a.queueIds));
    return queues.filter((q) => qids.has(q.id));
  }, [tabAgents, queues]);

  const filtered = useMemo(() => {
    let list = tabAgents;
    if (agentGroupTab === 'workshop' && filterWorkshopOwnerUid !== 'all') {
      list = list.filter(
        (a) => String(a.bmsOwnerUid ?? '').trim() === filterWorkshopOwnerUid,
      );
    }
    if (filterQueue !== 'all') list = list.filter((a) => a.queueIds.includes(filterQueue));
    return list;
  }, [tabAgents, agentGroupTab, filterWorkshopOwnerUid, filterQueue]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.keys(STATUS_MAP).forEach((s) => {
      counts[s] = filtered.filter((a) => a.status === s).length;
    });
    return counts;
  }, [filtered]);

  const queueNameById = useMemo(() => {
    return new Map(queues.map((q) => [q.id, q.name]));
  }, [queues]);

  const tenantNameById = useMemo(() => {
    return new Map(tenants.map((t) => [t.id, t.name]));
  }, [tenants]);

  const canManage = permissions.canManageAgents;

  return (
    <div className="cc-fade-in space-y-6">
      <Card className="border-border/80 bg-white shadow-sm">
        <CardContent className="space-y-5 p-5">
          <div>
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Agent Group
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={agentGroupTab === 'command-centre' ? 'default' : 'outline'}
                size="sm"
                className="rounded-full"
                onClick={() => setAgentGroupTab('command-centre')}
              >
                Command Center Agents
                <span className="ml-1 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-bold">
                  {commandCentreAgents.length}
                </span>
              </Button>
              <Button
                variant={agentGroupTab === 'workshop' ? 'default' : 'outline'}
                size="sm"
                className="rounded-full"
                onClick={() => setAgentGroupTab('workshop')}
              >
                Workshop Agents
                <span className="ml-1 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-bold">
                  {workshopAgents.length}
                </span>
              </Button>
            </div>
          </div>

          {agentGroupTab === 'workshop' && (
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Filter by Workshop
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={filterWorkshopOwnerUid === 'all' ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setFilterWorkshopOwnerUid('all')}
                >
                  All Workshops
                </Button>
                {availableWorkshopFilters.map((ws) => (
                  <Button
                    key={ws.ownerUid}
                    variant="outline"
                    size="sm"
                    className="rounded-full bg-white"
                    onClick={() => setFilterWorkshopOwnerUid(ws.ownerUid)}
                    style={
                      filterWorkshopOwnerUid === ws.ownerUid
                        ? { borderColor: '#0f766e', color: '#0f766e', background: '#ccfbf1' }
                        : {}
                    }
                  >
                    {ws.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Filter by Queue
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={filterQueue === 'all' ? 'default' : 'outline'}
                size="sm"
                className="rounded-full"
                onClick={() => setFilterQueue('all')}
              >
                All Queues
              </Button>
              {availableQueues.map((q) => (
                <Button
                  key={q.id}
                  variant="outline"
                  size="sm"
                  className="rounded-full bg-white"
                  onClick={() => setFilterQueue(q.id)}
                  style={filterQueue === q.id ? { borderColor: q.color, color: q.color, background: `${q.color}0a` } : {}}
                >
                  {q.icon} {q.name}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {Object.entries(STATUS_MAP).map(([key, val]) => (
              <div key={key} className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-sm">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: val.color }} />
                <span className="text-muted-foreground">{val.label}</span>
                <span className="font-semibold" style={{ color: val.color }}>
                  {statusCounts[key] || 0}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          message={`No ${
            agentGroupTab === 'command-centre' ? 'command center' : 'workshop'
          } agents match current filters`}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((a) => {
            const isLive = a.status === 'on-call' || a.status === 'ringing';
            const queueNames = a.queueIds
              .map((qid) => queueNameById.get(qid))
              .filter((name): name is string => Boolean(name));
            const tenantDisplay = a.tenantName || (a.tenantId ? tenantNameById.get(a.tenantId) : '') || 'Unassigned';
            const isWorkshopAgent = Boolean(String(a.bmsOwnerUid ?? '').trim());
            const ownerUid = String(a.bmsOwnerUid ?? '').trim();
            const branchId = String(a.bmsBranchId ?? '').trim();
            const workshopName =
              (ownerUid ? workshopNameByOwnerUid.get(ownerUid) : undefined) ||
              tenantDisplay;
            const workshopBranch =
              (ownerUid && branchId
                ? branchNameByOwnerAndBranchId.get(`${ownerUid}::${branchId}`)
                : undefined) ||
              branchId ||
              '-';
            return (
              <Card key={a.id} className="overflow-hidden border-border/80 bg-white shadow-sm">
                {isLive && <div className="h-1 w-full bg-rose-500" />}
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold text-slate-950">{a.name}</div>
                      <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        {queueNames.length > 0 ? queueNames.join(', ') : 'No queue'}
                        {' · '}Ext {a.extension || '-'}
                        {permissions.canViewTenantNames && <> {' · '}{tenantDisplay}</>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-start gap-2">
                      {!isWorkshopAgent && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                          aria-label={`Message ${a.name}`}
                          onClick={() => startInternalChat(a.id)}
                        >
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                      )}
                      {canManage && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Edit ${a.name}`}
                            onClick={() => openEdit(a)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            aria-label={`Delete ${a.name}`}
                            onClick={() => openDelete(a)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <StatusBadge status={a.status} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-sm text-slate-700">
                    <div>
                      <span className="font-medium text-slate-900">Email:</span> {a.email || '-'}
                    </div>
                    <div>
                      <span className="font-medium text-slate-900">Phone:</span> {a.phone || '-'}
                    </div>
                    <div>
                      <span className="font-medium text-slate-900">Role:</span> {a.role}
                    </div>
                    {isWorkshopAgent && (
                      <>
                        <div>
                          <span className="font-medium text-slate-900">Workshop:</span> {workshopName}
                        </div>
                        <div>
                          <span className="font-medium text-slate-900">Branch:</span> {workshopBranch}
                        </div>
                      </>
                    )}
                    <div>
                      <span className="font-medium text-slate-900">Agent ID:</span> {a.id}
                    </div>
                    {a.notes && (
                      <div>
                        <span className="font-medium text-slate-900">Notes:</span> {a.notes}
                      </div>
                    )}
                  </div>
                  {isLive && a.callStartTime && (
                    <div className="flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-3 py-2">
                      <span className="font-mono text-xs text-slate-700">{formatPhone(a.currentCaller)}</span>
                      <span className="inline-flex items-center font-mono text-xs font-semibold text-rose-600">
                        <LiveDot /> {formatDuration(now - a.callStartTime)}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit agent</DialogTitle>
          </DialogHeader>
          {editingAgent && (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input id="agent-name" value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="agent-ext">Extension</Label>
                <Input id="agent-ext" value={formExtension} onChange={(e) => setFormExtension(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="agent-email">Email</Label>
                <Input id="agent-email" type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="agent-phone">Phone</Label>
                <Input id="agent-phone" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="agent-tenant">Tenant</Label>
                <select
                  id="agent-tenant"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={formTenantId}
                  onChange={(e) => setFormTenantId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="agent-role">Role</Label>
                <select
                  id="agent-role"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as Agent['role'])}
                >
                  {AGENT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label>Queues</Label>
                <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-input p-3">
                  {queuesForFormTenant.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No queues for this tenant.</p>
                  ) : (
                    queuesForFormTenant.map((q) => (
                      <label key={q.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={formQueueIds.includes(q.id)}
                          onCheckedChange={() => toggleQueue(q.id)}
                        />
                        <span>
                          {q.icon} {q.name}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              {saveError && <p className="text-sm text-rose-600">{saveError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingAgent
                ? `This removes ${deletingAgent.name} from the directory. Related onboarding rows are removed automatically. This cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-rose-600">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={deleting} onClick={handleConfirmDelete}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
