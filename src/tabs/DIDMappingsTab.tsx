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
import { apiFetch, getAccessToken } from '@/lib/api';
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
  businessTenantId: string;
  businessName: string;
}

interface BlueBusinessOption {
  id: string;
  name: string;
}

const EMPTY_FORM: FormState = {
  did: '',
  label: '',
  tenantId: '',
  queueId: '',
  ownerUid: '',
  branchId: '',
  businessTenantId: '',
  businessName: '',
};

type MappingDialogMode = 'black' | 'blue';
type MappingTableFilter = 'all' | MappingDialogMode;

const BLUE_BUSINESSES_API_URL =
  (import.meta.env.VITE_BLUE_BUSINESSES_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  'http://127.0.0.1:5050/api/businesses';

const CURRENT_BLUE_BUSINESS_ID = '__current_blue_business__';

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
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
  return '';
}

function extractBusinessRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const body = asRecord(raw);

  for (const key of ['businesses', 'data', 'items', 'results']) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }

  const data = asRecord(body.data);
  for (const key of ['businesses', 'items', 'results']) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function normalizeBlueBusiness(raw: unknown): BlueBusinessOption | null {
  const row = asRecord(raw);
  const business = asRecord(row.business);
  const source = Object.keys(business).length > 0 ? business : row;
  const id = pickString(source, ['id', 'businessId', 'business_id', '_id', 'uid']);
  const name = pickString(source, [
    'name',
    'businessName',
    'business_name',
    'displayName',
    'title',
  ]);

  return id && name ? { id, name } : null;
}

async function readBlueBusinessesError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text.trim()) return `Blue businesses API failed (${res.status})`;

  try {
    const body = asRecord(JSON.parse(text) as unknown);
    const detail = body.message ?? body.error ?? body.detail;
    return typeof detail === 'string'
      ? `Blue businesses API failed (${res.status}) - ${detail}`
      : `Blue businesses API failed (${res.status})`;
  } catch {
    return `Blue businesses API failed (${res.status}) - ${text.slice(0, 400)}`;
  }
}

function compactToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isAllServicesTenant(tenant: Tenant): boolean {
  const values = [tenant.id, tenant.name];
  return values.some((value) => {
    const compact = compactToken(value);
    const tokens = splitTokens(value);
    return (
      compact === 'allservices' ||
      (tokens.includes('all') &&
        tokens.some((token) => token === 'service' || token === 'services'))
    );
  });
}

function isQueueKind(queue: Pick<Queue, 'id' | 'name' | 'type'>, kind: MappingDialogMode): boolean {
  return [queue.id, queue.name, queue.type].some((value) => {
    const compact = compactToken(value);
    return compact === kind || splitTokens(value).includes(kind);
  });
}

function findDefaultQueue(
  queues: Queue[],
  kind: MappingDialogMode,
  tenantId: string,
): Queue | null {
  if (tenantId) {
    return queues.find((q) => q.tenantId === tenantId && isQueueKind(q, kind)) ?? null;
  }
  return queues.find((q) => isQueueKind(q, kind)) ?? null;
}

export function DIDMappingsTab({ permissions }: Props) {
  const { toast } = useToast();
  const [mappings, setMappings] = useState<DIDMapping[]>([]);
  const [workshops, setWorkshops] = useState<BmsWorkshopOption[]>([]);
  const [blueBusinesses, setBlueBusinesses] = useState<BlueBusinessOption[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  const [workshopsLoading, setWorkshopsLoading] = useState(false);
  const [blueBusinessesLoading, setBlueBusinessesLoading] = useState(false);
  const [blueBusinessesError, setBlueBusinessesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<MappingDialogMode>('black');
  const [tableFilter, setTableFilter] = useState<MappingTableFilter>('all');
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

  const loadBlueBusinesses = useCallback(async () => {
    setBlueBusinessesLoading(true);
    setBlueBusinessesError(null);
    try {
      if (!getAccessToken()) {
        throw new Error('Sign in as super-admin to load Blue businesses.');
      }

      const res = await apiFetch(BLUE_BUSINESSES_API_URL, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(await readBlueBusinessesError(res));
      }

      const raw = (await res.json()) as unknown;
      const businesses = extractBusinessRows(raw)
        .map(normalizeBlueBusiness)
        .filter((business): business is BlueBusinessOption => Boolean(business))
        .sort((a, b) => a.name.localeCompare(b.name));

      setBlueBusinesses(businesses);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not load Blue businesses';
      setBlueBusinessesError(message);
      toast({
        title: 'Failed to load Blue businesses',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setBlueBusinessesLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!permissions.canManageDIDMappings) return;
    loadAll();
  }, [loadAll, permissions.canManageDIDMappings]);

  const allServicesTenant = useMemo(
    () => tenants.find(isAllServicesTenant) ?? null,
    [tenants],
  );

  const defaultBlackQueue = useMemo(
    () => findDefaultQueue(queues, 'black', allServicesTenant?.id ?? ''),
    [allServicesTenant?.id, queues],
  );

  const defaultBlueQueue = useMemo(
    () => findDefaultQueue(queues, 'blue', allServicesTenant?.id ?? ''),
    [allServicesTenant?.id, queues],
  );

  const getMappingKind = useCallback(
    (mapping: DIDMapping): MappingDialogMode => {
      const queue = queues.find((q) => q.id === mapping.queueId);
      if (queue && isQueueKind(queue, 'blue')) return 'blue';
      if (queue && isQueueKind(queue, 'black')) return 'black';
      return mapping.branchId || mapping.branchName ? 'black' : 'blue';
    },
    [queues],
  );

  const tableFilterCounts = useMemo(() => {
    const counts = { all: mappings.length, black: 0, blue: 0 };
    for (const mapping of mappings) {
      counts[getMappingKind(mapping)] += 1;
    }
    return counts;
  }, [getMappingKind, mappings]);

  const filteredMappings = useMemo(
    () =>
      tableFilter === 'all'
        ? mappings
        : mappings.filter((mapping) => getMappingKind(mapping) === tableFilter),
    [getMappingKind, mappings, tableFilter],
  );

  const blueBusinessOptions = useMemo(() => {
    const currentName = form.businessName.trim();
    const currentId = form.businessTenantId.trim();
    const hasCurrent = blueBusinesses.some(
      (option) => option.id === currentId || option.name === currentName,
    );

    if (currentName && !hasCurrent) {
      return [
        {
          id: currentId && currentId !== CURRENT_BLUE_BUSINESS_ID
            ? currentId
            : CURRENT_BLUE_BUSINESS_ID,
          name: currentName,
        },
        ...blueBusinesses,
      ];
    }

    return blueBusinesses;
  }, [blueBusinesses, form.businessName, form.businessTenantId]);

  const selectedBlueBusiness = useMemo(
    () => blueBusinessOptions.find((option) => option.id === form.businessTenantId) ?? null,
    [blueBusinessOptions, form.businessTenantId],
  );

  const selectedBlueBusinessId = useMemo(() => {
    const id = selectedBlueBusiness?.id ?? form.businessTenantId;
    return id === CURRENT_BLUE_BUSINESS_ID ? '' : id.trim();
  }, [form.businessTenantId, selectedBlueBusiness?.id]);

  const selectedBlueBusinessName = useMemo(() => {
    return (selectedBlueBusiness?.name ?? form.businessName).trim();
  }, [form.businessName, selectedBlueBusiness?.name]);

  const createDefaultForm = useCallback(
    (mode: MappingDialogMode): FormState => ({
      ...EMPTY_FORM,
      tenantId: allServicesTenant?.id ?? '',
      queueId: mode === 'blue' ? defaultBlueQueue?.id ?? '' : defaultBlackQueue?.id ?? '',
    }),
    [allServicesTenant?.id, defaultBlackQueue?.id, defaultBlueQueue?.id],
  );

  useEffect(() => {
    if (!dialogOpen || editingDid) return;
    const defaults = createDefaultForm(dialogMode);
    setForm((prev) => ({
      ...prev,
      tenantId: prev.tenantId || defaults.tenantId,
      queueId: prev.queueId || defaults.queueId,
    }));
  }, [createDefaultForm, dialogMode, dialogOpen, editingDid]);

  const openCreateDialog = (mode: MappingDialogMode) => {
    setDialogMode(mode);
    setEditingDid(null);
    setForm(createDefaultForm(mode));
    setDialogOpen(true);
    if (mode === 'black' && workshops.length === 0) void loadWorkshops();
    if (mode === 'blue' && blueBusinesses.length === 0) void loadBlueBusinesses();
  };

  const openEditDialog = (m: DIDMapping) => {
    const queue = queues.find((q) => q.id === m.queueId);
    const mode: MappingDialogMode = queue && isQueueKind(queue, 'blue') ? 'blue' : 'black';
    const businessName = m.mappingWorkshopName.trim();
    const matchingBusiness = blueBusinesses.find(
      (business) => business.id === m.ownerId || business.name === businessName,
    );

    setDialogMode(mode);
    setEditingDid(m.did);
    setForm({
      did: m.did,
      label: m.label,
      tenantId: m.tenantId,
      queueId: m.queueId,
      ownerUid: m.ownerId,
      branchId: m.branchId,
      businessTenantId:
        matchingBusiness?.id || m.ownerId || (businessName ? CURRENT_BLUE_BUSINESS_ID : ''),
      businessName,
    });
    setDialogOpen(true);
    if (mode === 'black' && workshops.length === 0) void loadWorkshops();
    if (mode === 'blue' && blueBusinesses.length === 0) void loadBlueBusinesses();
  };

  const selectedWorkshop = useMemo(
    () => workshops.find((w) => w.ownerUid === form.ownerUid) ?? null,
    [workshops, form.ownerUid],
  );

  const canSubmit =
    form.did.trim().length > 0 &&
    form.tenantId.length > 0 &&
    form.queueId.length > 0 &&
    (dialogMode === 'blue'
      ? selectedBlueBusinessId.length > 0 && selectedBlueBusinessName.length > 0
      : form.ownerUid.length > 0 && form.branchId.length > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      let payload: DIDMappingInput;

      if (dialogMode === 'blue') {
        payload = {
          did: form.did.trim(),
          label: form.label.trim(),
          tenantId: form.tenantId,
          queueId: form.queueId,
          ownerUid: selectedBlueBusinessId,
          workshopName: selectedBlueBusinessName,
          branchId: '',
          branchName: '',
        };
      } else {
        if (!selectedWorkshop) return;
        const branch = selectedWorkshop.branches.find((b) => b.id === form.branchId);
        if (!branch) return;

        payload = {
          did: form.did.trim(),
          label: form.label.trim(),
          tenantId: form.tenantId,
          queueId: form.queueId,
          ownerUid: selectedWorkshop.ownerUid,
          workshopName: selectedWorkshop.name,
          branchId: branch.id,
          branchName: branch.name,
        };
      }

      if (editingDid) {
        await updateDIDMapping(payload);
      } else {
        await createDIDMapping(payload);
      }
      toast({
        title: editingDid ? 'Mapping updated' : 'Mapping created',
        description:
          dialogMode === 'blue'
            ? `${payload.did} → ${payload.workshopName} · Blue`
            : `${payload.did} → ${payload.workshopName} · ${payload.branchName}`,
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
      `Remove DID mapping for ${did}? Incoming calls on this number will no longer resolve to a workshop or business.`,
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
            DID → Routing Mappings
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Map inbound DIDs to Black workshops or Blue businesses. The Yeastar webhook
            uses these rows to resolve tenant, queue, and screen-pop context for each call.
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
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Black DID Mappings
          </div>
          <h3 className="mt-2 text-base font-semibold text-slate-950">
            Map DID to workshop and branch
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Uses the Black workshop picker and defaults routing to All Services / Black.
          </p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              Default: {allServicesTenant?.name ?? 'All Services'} /{' '}
              {defaultBlackQueue?.name ?? 'Black queue'}
            </div>
            <Button onClick={() => openCreateDialog('black')} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Black DID
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5 shadow-sm">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue-600">
            Blue DID Mappings
          </div>
          <h3 className="mt-2 text-base font-semibold text-blue-950">
            Map DID to a Blue business
          </h3>
          <p className="mt-1 text-sm text-blue-800/70">
            Add a DID, optional label, and business name. Routing is set to All Services / Blue.
          </p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-xs text-blue-700/80">
              Default: {allServicesTenant?.name ?? 'All Services'} /{' '}
              {defaultBlueQueue?.name ?? 'Blue queue'}
            </div>
            <Button
              onClick={() => openCreateDialog('blue')}
              className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add Blue DID
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">DID mapping table</h3>
            <p className="text-xs text-slate-500">
              Filter rows by Black or Blue routing queue.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'black', 'blue'] as const).map((filter) => {
              const active = tableFilter === filter;
              const label =
                filter === 'all' ? 'All' : filter === 'black' ? 'Black' : 'Blue';
              return (
                <Button
                  key={filter}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  onClick={() => setTableFilter(filter)}
                  className={
                    filter === 'blue' && active
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : undefined
                  }
                >
                  {label} ({tableFilterCounts[filter]})
                </Button>
              );
            })}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>DID</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Workshop / Business</TableHead>
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
                  No DID mappings yet. Use the Black or Blue section above to add one.
                </TableCell>
              </TableRow>
            ) : filteredMappings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                  No {tableFilter === 'blue' ? 'Blue' : 'Black'} DID mappings found.
                </TableCell>
              </TableRow>
            ) : (
              filteredMappings.map((m) => {
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
            <DialogTitle>
              {editingDid
                ? `Edit ${dialogMode === 'blue' ? 'Blue' : 'Black'} DID Mapping`
                : `New ${dialogMode === 'blue' ? 'Blue' : 'Black'} DID Mapping`}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === 'blue'
                ? 'Add a Blue DID with a business name. Routing defaults to All Services and the Blue queue.'
                : 'Map an inbound DID to a BMS workshop branch, then link it to a local tenant and queue for routing.'}
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
              <Label htmlFor="label-input">Label (optional)</Label>
              <Input
                id="label-input"
                placeholder="Main inbound line"
                value={form.label}
                onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
              />
            </div>

            {dialogMode === 'blue' ? (
              <>
                <div className="grid gap-2">
                  <Label>Business Name</Label>
                  <Select
                    value={form.businessTenantId}
                    onValueChange={(v) => {
                      const selected = blueBusinessOptions.find((option) => option.id === v);
                      setForm((p) => ({
                        ...p,
                        businessTenantId: v,
                        businessName: selected?.name ?? p.businessName,
                      }));
                    }}
                    disabled={blueBusinessesLoading}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          blueBusinessesLoading ? 'Loading businesses…' : 'Select business'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {blueBusinessOptions.map((business) => (
                        <SelectItem key={business.id} value={business.id}>
                          {business.name}
                        </SelectItem>
                      ))}
                      {!blueBusinessesLoading && blueBusinessOptions.length === 0 && (
                        <div className="px-3 py-2 text-xs text-slate-500">
                          No businesses available
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                  {blueBusinessesError && (
                    <p className="text-xs text-rose-600">{blueBusinessesError}</p>
                  )}
                  {!blueBusinessesLoading &&
                    blueBusinessOptions.length > 0 &&
                    !selectedBlueBusinessId && (
                      <p className="text-xs text-rose-600">
                        Select a business from the Blue businesses API before saving.
                      </p>
                    )}
                </div>

                <div className="grid gap-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label>Tenant</Label>
                    <Input value={allServicesTenant?.name ?? 'All Services'} readOnly />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Queue</Label>
                    <Input value={defaultBlueQueue?.name ?? 'Blue'} readOnly />
                  </div>
                  {(!form.tenantId || !form.queueId) && (
                    <p className="sm:col-span-2 text-xs text-rose-600">
                      All Services tenant or Blue queue was not found. Create them before saving this mapping.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
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

                <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label>Tenant</Label>
                    <Input
                      value={
                        tenants.find((t) => t.id === form.tenantId)?.name ??
                        allServicesTenant?.name ??
                        'All Services'
                      }
                      readOnly
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Queue</Label>
                    <Input
                      value={
                        queues.find((q) => q.id === form.queueId)?.name ??
                        defaultBlackQueue?.name ??
                        'Black'
                      }
                      readOnly
                    />
                  </div>
                  {(!form.tenantId || !form.queueId) && (
                    <p className="sm:col-span-2 text-xs text-rose-600">
                      All Services tenant or Black queue was not found. Create them before saving this mapping.
                    </p>
                  )}
                </div>
              </>
            )}
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
