import { useCallback, useEffect, useMemo, useState } from 'react';
import { Phone, Plus, RefreshCcw, Trash2, Pencil, Loader2 } from 'lucide-react';
import type { DIDMapping, Permissions, Queue, Tenant } from '@/services/types';
import {
  fetchBmsWorkshopOptions,
  listDIDMappings,
  createDIDMapping,
  updateDIDMapping,
  deleteDIDMapping,
  type BmsWorkshopOption,
  type DIDMappingInput,
} from '@/services/didMappingsApi';
import { fetchTenants, fetchQueues } from '@/services/dashboardApi';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

interface Props {
  permissions: Permissions;
}

interface FormState {
  did: string;
  label: string;
  tenantId: string;
  queueId: string;
  ownerUid: string;
  branchId: string;
}

const EMPTY_FORM: FormState = {
  did: '',
  label: '',
  tenantId: '',
  queueId: '',
  ownerUid: '',
  branchId: '',
};

export function DIDMappingsTab({ permissions }: Props) {
  const { toast } = useToast();
  const [mappings, setMappings] = useState<DIDMapping[]>([]);
  const [workshops, setWorkshops] = useState<BmsWorkshopOption[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  const [workshopsLoading, setWorkshopsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDid, setEditingDid] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, t, q] = await Promise.all([
        listDIDMappings(),
        fetchTenants(),
        fetchQueues(null),
      ]);
      setMappings(m);
      setTenants(t);
      setQueues(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load DID mappings');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWorkshops = useCallback(async () => {
    setWorkshopsLoading(true);
    try {
      const w = await fetchBmsWorkshopOptions();
      setWorkshops(w);
    } catch (err) {
      toast({
        title: 'Failed to load workshops',
        description:
          err instanceof Error ? err.message : 'Could not reach BMS Pro API',
        variant: 'destructive',
      });
    } finally {
      setWorkshopsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!permissions.canManageDIDMappings) return;
    loadAll();
  }, [loadAll, permissions.canManageDIDMappings]);

  const openCreateDialog = () => {
    setEditingDid(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
    if (workshops.length === 0) void loadWorkshops();
  };

  const openEditDialog = (m: DIDMapping) => {
    setEditingDid(m.did);
    setForm({
      did: m.did,
      label: m.label,
      tenantId: m.tenantId,
      queueId: m.queueId,
      ownerUid: m.ownerId,
      branchId: m.branchId,
    });
    setDialogOpen(true);
    if (workshops.length === 0) void loadWorkshops();
  };

  const selectedWorkshop = useMemo(
    () => workshops.find((w) => w.ownerUid === form.ownerUid) ?? null,
    [workshops, form.ownerUid],
  );

  const visibleQueues = useMemo(
    () => (form.tenantId ? queues.filter((q) => q.tenantId === form.tenantId) : queues),
    [queues, form.tenantId],
  );

  const canSubmit =
    form.did.trim().length > 0 &&
    form.tenantId.length > 0 &&
    form.queueId.length > 0 &&
    form.ownerUid.length > 0 &&
    form.branchId.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedWorkshop) return;
    const branch = selectedWorkshop.branches.find((b) => b.id === form.branchId);
    if (!branch) return;

    setSubmitting(true);
    try {
      const payload: DIDMappingInput = {
        did: form.did.trim(),
        label: form.label.trim(),
        tenantId: form.tenantId,
        queueId: form.queueId,
        ownerUid: selectedWorkshop.ownerUid,
        workshopName: selectedWorkshop.name,
        branchId: branch.id,
        branchName: branch.name,
      };
      if (editingDid) {
        await updateDIDMapping(payload);
      } else {
        await createDIDMapping(payload);
      }
      toast({
        title: editingDid ? 'Mapping updated' : 'Mapping created',
        description: `${payload.did} → ${payload.workshopName} · ${payload.branchName}`,
      });
      setDialogOpen(false);
      await loadAll();
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save mapping',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (did: string) => {
    const confirmed = window.confirm(
      `Remove DID mapping for ${did}? Incoming calls on this number will no longer resolve to a workshop.`,
    );
    if (!confirmed) return;
    try {
      await deleteDIDMapping(did);
      toast({ title: 'Mapping deleted', description: did });
      await loadAll();
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Could not delete mapping',
        variant: 'destructive',
      });
    }
  };

  if (!permissions.canManageDIDMappings) {
    return <EmptyState message="You do not have permission to manage DID mappings." />;
  }

  return (
    <div className="cc-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            DID Routing
          </div>
          <h2 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-950">
            <Phone className="h-6 w-6 text-slate-700" />
            DID → Workshop Mappings
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Map inbound DIDs to a BMS workshop branch. The Yeastar webhook uses these rows
            to resolve tenant, queue, and screen-pop context for each call.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadAll}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openCreateDialog} className="gap-2">
            <Plus className="h-4 w-4" />
            New Mapping
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>DID</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Workshop</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead>Queue</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-slate-400">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  Loading DID mappings…
                </TableCell>
              </TableRow>
            ) : mappings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                  No DID mappings yet. Click <strong>New Mapping</strong> to add one.
                </TableCell>
              </TableRow>
            ) : (
              mappings.map((m) => {
                const tenant = tenants.find((t) => t.id === m.tenantId);
                const queue = queues.find((q) => q.id === m.queueId);
                return (
                  <TableRow key={m.did}>
                    <TableCell className="font-mono text-sm font-semibold text-slate-900">
                      {m.did}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {m.label || <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium text-slate-900">
                        {m.mappingWorkshopName || (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>
                      {m.ownerId && (
                        <div className="font-mono text-[10px] text-slate-400">
                          {m.ownerId.length > 14 ? `${m.ownerId.slice(0, 14)}…` : m.ownerId}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-slate-700">
                        {m.branchName || <span className="text-slate-400">—</span>}
                      </div>
                      {m.branchId && (
                        <div className="font-mono text-[10px] text-slate-400">
                          {m.branchId.length > 14 ? `${m.branchId.slice(0, 14)}…` : m.branchId}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {tenant?.name ?? m.tenantId}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {queue?.name ?? m.queueId}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditDialog(m)}
                          className="gap-1"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(m.did)}
                          className="gap-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingDid ? 'Edit DID Mapping' : 'New DID Mapping'}</DialogTitle>
            <DialogDescription>
              Map an inbound DID to a BMS workshop branch, then link it to a local tenant
              and queue for routing.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="did-input">DID (phone number)</Label>
              <Input
                id="did-input"
                placeholder="+61291234567"
                value={form.did}
                onChange={(e) => setForm((p) => ({ ...p, did: e.target.value }))}
                disabled={Boolean(editingDid)}
              />
              <p className="text-[11px] text-slate-500">
                Use the exact format Yeastar sends (E.164 preferred).
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="label-input">Label</Label>
              <Input
                id="label-input"
                placeholder="Main inbound line"
                value={form.label}
                onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label>Workshop (Firebase)</Label>
              <Select
                value={form.ownerUid}
                onValueChange={(v) =>
                  setForm((p) => ({ ...p, ownerUid: v, branchId: '' }))
                }
                disabled={workshopsLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      workshopsLoading ? 'Loading workshops…' : 'Select a workshop'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {workshops.map((w) => (
                    <SelectItem key={w.ownerUid} value={w.ownerUid}>
                      {w.name}
                    </SelectItem>
                  ))}
                  {!workshopsLoading && workshops.length === 0 && (
                    <div className="px-3 py-2 text-xs text-slate-500">
                      No workshops available
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Branch</Label>
              <Select
                value={form.branchId}
                onValueChange={(v) => setForm((p) => ({ ...p, branchId: v }))}
                disabled={!selectedWorkshop || selectedWorkshop.branches.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !selectedWorkshop
                        ? 'Select a workshop first'
                        : selectedWorkshop.branches.length === 0
                          ? 'No branches for this workshop'
                          : 'Select a branch'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {selectedWorkshop?.branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Tenant</Label>
                <Select
                  value={form.tenantId}
                  onValueChange={(v) =>
                    setForm((p) => ({ ...p, tenantId: v, queueId: '' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Queue</Label>
                <Select
                  value={form.queueId}
                  onValueChange={(v) => setForm((p) => ({ ...p, queueId: v }))}
                  disabled={!form.tenantId}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        form.tenantId ? 'Select queue' : 'Select tenant first'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleQueues.map((q) => (
                      <SelectItem key={q.id} value={q.id}>
                        {q.name}
                      </SelectItem>
                    ))}
                    {form.tenantId && visibleQueues.length === 0 && (
                      <div className="px-3 py-2 text-xs text-slate-500">
                        No queues for this tenant
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : editingDid ? (
                'Save changes'
              ) : (
                'Create mapping'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
