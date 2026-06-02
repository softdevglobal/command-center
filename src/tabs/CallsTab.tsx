import { useState, useEffect, useRef, useMemo, useLayoutEffect, type UIEvent } from 'react';
import type { Agent, Call, CallResult, Queue, Tenant, Permissions, UserSession } from '@/services/types';
import { fetchCallerNameByPhone } from '@/services/customersApi';
import { fetchDIDMappings } from '@/services/dashboardApi';
import {
  mergeCallsWithLinkusLog,
  readLinkusCallLog,
  LINKUS_CALL_LOG_EVENT,
} from '@/services/linkusCallLog';
import { formatTime, formatPhone, formatSeconds } from '@/utils/formatters';
import { formatTimeAu } from '@/utils/australianTime';
import { RESULT_MAP } from '@/components/dashboard/ResultBadge';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar,
  RotateCcw
} from 'lucide-react';
import { 
  getAustralianDateKey, 
  addAustralianCalendarDays,
  formatAustralianDayHeading 
} from '@/utils/australianTime';
import { CallRecordingPlayer } from '@/components/dashboard/CallRecordingPlayer';

interface CallsTabProps {
  calls: Call[];
  queues: Queue[];
  tenants: Tenant[];
  agents: Agent[];
  session: UserSession;
  permissions: Permissions;
  callDate: string;
  onDateChange: (ymd: string) => void;
}

// ── Caller-name resolution hook ──────────────────────────────────────────────

/**
 * Fetches real customer names from Firebase for every unique callerNumber
 * in the calls list, keyed by callerNumber for O(1) lookup in the table.
 * Results are cached across re-renders so the same number is never fetched twice.
 *
 * Owner UID resolution order (mirrors CallDetailsSheet):
 *   1. DID mapping ownerId (looked up by call.dialedNumber)
 *   2. tenant.bmsOwnerUid
 *   3. call.tenantId (final fallback — works when tenantId IS the Firebase owner UID)
 */
function useCallerNames(calls: Call[], tenants: Tenant[]) {
  // Map<callerNumber, resolvedName | null>
  const [nameMap, setNameMap] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(false);
  // Persistent cache keyed by "ownerUid::callerNumber" so it invalidates when ownerUid changes
  const cacheRef = useRef<Map<string, string | null>>(new Map());
  // DID → ownerId from did_mappings table
  const [didOwnerMap, setDidOwnerMap] = useState<Map<string, string>>(new Map());
  // DID → "Workshop - Branch" display label from did_mappings
  const [didTenantLabelMap, setDidTenantLabelMap] = useState<Map<string, string>>(new Map());
  const [didMapLoaded, setDidMapLoaded] = useState(false);
  const didMapLoadedRef = useRef(false);

  // Build tenantId → bmsOwnerUid lookup
  const ownerByTenant = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tenants) {
      if (t.bmsOwnerUid) m.set(t.id, t.bmsOwnerUid);
    }
    return m;
  }, [tenants]);

  // Load DID mappings once to resolve ownerId from dialedNumber
  useEffect(() => {
    if (didMapLoadedRef.current) return;
    didMapLoadedRef.current = true;

    fetchDIDMappings()
      .then((mappings) => {
        const ownerMap = new Map<string, string>();
        const tenantLabelMap = new Map<string, string>();
        for (const d of mappings) {
          if (d.ownerId) ownerMap.set(d.did, d.ownerId);
          const workshop = d.mappingWorkshopName?.trim();
          const branch = d.branchName?.trim();
          const tenantLabel =
            workshop && branch
              ? `${workshop} - ${branch}`
              : workshop || branch || '';
          if (tenantLabel) tenantLabelMap.set(d.did, tenantLabel);
        }
        setDidOwnerMap(ownerMap);
        setDidTenantLabelMap(tenantLabelMap);
        // Clear any names cached with the wrong ownerUid (fallback tenantId)
        cacheRef.current.clear();
        setDidMapLoaded(true);
      })
      .catch(() => {
        // DID mappings may not be accessible for non-super-admin — continue without
        setDidMapLoaded(true);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Collect unique (ownerUid, callerNumber) pairs that aren't cached yet
    const lookups = new Map<string, string>(); // callerNumber → ownerUid
    for (const call of calls) {
      // Resolve owner UID in priority order (matches CallDetailsSheet logic):
      // 1. DID mapping ownerId (from dialedNumber)
      // 2. tenant.bmsOwnerUid
      // 3. tenantId itself (fallback — many setups use tenantId as the Firebase UID)
      const didOwner =
        call.direction === 'inbound' && call.dialedNumber
          ? didOwnerMap.get(call.dialedNumber)
          : undefined;
      const tenantOwner = ownerByTenant.get(call.tenantId);
      const ownerUid = didOwner || tenantOwner || call.tenantId;

      // Cache key includes ownerUid so if it changes (e.g. DID map loads), we re-fetch
      const cacheKey = `${ownerUid}::${call.callerNumber}`;
      if (cacheRef.current.has(cacheKey)) continue;
      if (lookups.has(call.callerNumber)) continue;

      if (ownerUid) {
        lookups.set(call.callerNumber, ownerUid);
      }
    }

    if (lookups.size === 0) {
      // Nothing new to fetch — rebuild nameMap from cache
      const next = new Map<string, string | null>();
      for (const [key, val] of cacheRef.current) {
        const phone = key.split('::')[1];
        if (phone) next.set(phone, val);
      }
      setNameMap(next);
      return;
    }

    setLoading(true);

    // Fire all lookups in parallel
    const entries = Array.from(lookups.entries());
    Promise.allSettled(
      entries.map(([phone, ownerUid]) =>
        fetchCallerNameByPhone(ownerUid, phone).then((name) => ({
          phone,
          ownerUid,
          name,
        })),
      ),
    ).then((results) => {
      if (cancelled) return;

      for (const r of results) {
        if (r.status === 'fulfilled') {
          const cacheKey = `${r.value.ownerUid}::${r.value.phone}`;
          cacheRef.current.set(cacheKey, r.value.name);
        }
      }

      // Rebuild phone → name map from cache
      const next = new Map<string, string | null>();
      for (const [key, val] of cacheRef.current) {
        const phone = key.split('::')[1];
        if (phone) next.set(phone, val);
      }
      setNameMap(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [calls, ownerByTenant, didOwnerMap, didMapLoaded]);

  return { nameMap, loading, didTenantLabelMap };
}

function CallStatusBadge({ result }: { result: CallResult }) {
  const r = RESULT_MAP[result] ?? RESULT_MAP.missed;
  return (
    <Badge
      variant="outline"
      className="rounded-full border-0 px-2.5 py-1 text-[11px] font-semibold"
      style={{ color: r.color, background: r.bg }}
    >
      {callResultLabel(result)}
    </Badge>
  );
}

function callResultLabel(result: CallResult): string {
  return result === 'abandoned' ? 'Hung up' : RESULT_MAP[result]?.label ?? 'Missed';
}

function isAgentVisibleCallResult(result: CallResult): boolean {
  return result === 'answered' || result === 'abandoned' || result === 'missed';
}

// ── Component ────────────────────────────────────────────────────────────────

export function CallsTab({ 
  calls, 
  queues, 
  tenants,
  agents,
  session,
  permissions,
  callDate,
  onDateChange 
}: CallsTabProps) {
  const isAgentView = session.role === 'agent';
  const [filterResult, setFilterResult] = useState('all');
  const [filterQueue, setFilterQueue] = useState('all');
  const [filterDirection, setFilterDirection] = useState<'all' | 'inbound' | 'outbound'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [linkusLog, setLinkusLog] = useState<Call[]>(() => readLinkusCallLog());

  useEffect(() => {
    const sync = () => setLinkusLog(readLinkusCallLog());
    window.addEventListener(LINKUS_CALL_LOG_EVENT, sync);
    return () => window.removeEventListener(LINKUS_CALL_LOG_EVENT, sync);
  }, []);

  const allCalls = useMemo(() => {
    const merged = mergeCallsWithLinkusLog(calls, linkusLog);
    // Filter to only the selected Melbourne day (server-side 'calls' are already filtered, but 'linkusLog' is not)
    return merged.filter((c) => getAustralianDateKey(new Date(c.startTime).getTime()) === callDate);
  }, [calls, linkusLog, callDate]);

  const roleScopedCalls = useMemo(() => {
    if (!isAgentView) return allCalls;
    const me = agents.find((a) => a.userId === session.userId);
    const agentCalls = me ? allCalls.filter((c) => c.agentId === me.id) : allCalls;
    return agentCalls.filter((c) => isAgentVisibleCallResult(c.result));
  }, [allCalls, agents, isAgentView, session.userId]);

  const agentAnsweredCount = useMemo(
    () => roleScopedCalls.filter((c) => c.result === 'answered').length,
    [roleScopedCalls],
  );

  const agentHungUpCount = useMemo(
    () => roleScopedCalls.filter((c) => c.result === 'abandoned' || c.result === 'missed').length,
    [roleScopedCalls],
  );

  const { nameMap, loading: namesLoading, didTenantLabelMap } = useCallerNames(roleScopedCalls, tenants);

  const availableQueues = useMemo(() => {
    const qids = new Set(roleScopedCalls.map((c) => c.queueId));
    return queues.filter((q) => qids.has(q.id));
  }, [roleScopedCalls, queues]);

  const filtered = useMemo(() => {
    let list = roleScopedCalls;
    if (filterDirection !== 'all') {
      list = list.filter((c) => c.direction === filterDirection);
    }
    if (filterResult !== 'all') list = list.filter((c) => c.result === filterResult);
    if (filterQueue !== 'all') list = list.filter((c) => c.queueId === filterQueue);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      list = list.filter((c) => {
        const resolvedName = nameMap.get(c.callerNumber);
        const mappedTenantLabel =
          c.direction === 'inbound' && c.dialedNumber
            ? didTenantLabelMap.get(c.dialedNumber)
            : undefined;
        const dirLabel = c.direction === 'outbound' ? 'outbound' : 'inbound';
        return (
          c.callerNumber.includes(s) ||
          (c.dialedNumber && c.dialedNumber.includes(s)) ||
          (mappedTenantLabel && mappedTenantLabel.toLowerCase().includes(s)) ||
          c.agentName.toLowerCase().includes(s) ||
          c.queueName.toLowerCase().includes(s) ||
          c.tenantName.toLowerCase().includes(s) ||
          dirLabel.includes(s) ||
          (c.callerName && c.callerName.toLowerCase().includes(s)) ||
          (resolvedName && resolvedName.toLowerCase().includes(s))
        );
      });
    }
    return list;
  }, [roleScopedCalls, filterDirection, filterResult, filterQueue, searchTerm, nameMap, didTenantLabelMap]);

  const callTableColSpan =
    8 +
    (permissions.canViewTenantNames ? 1 : 0) +
    (permissions.canViewCallRecordings ? 1 : 0);
  const virtualMinRows = 36;
  const virtualRowPx = 64;
  const virtualOverscan = 8;
  const useVirtualTable = filtered.length >= virtualMinRows;

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(560);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setScrollTop(0);
  }, [callDate, filterDirection, filterResult, filterQueue, searchTerm]);

  useLayoutEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [filtered.length]);

  const onCallsTableScroll = (e: UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const { topPad, bottomPad, visibleCalls } = useMemo(() => {
    if (!useVirtualTable) {
      return { topPad: 0, bottomPad: 0, visibleCalls: filtered };
    }
    const startI = Math.max(0, Math.floor(scrollTop / virtualRowPx) - virtualOverscan);
    const endI = Math.min(
      filtered.length,
      Math.ceil((scrollTop + Math.max(viewportH, 240)) / virtualRowPx) + virtualOverscan,
    );
    return {
      topPad: startI * virtualRowPx,
      bottomPad: (filtered.length - endI) * virtualRowPx,
      visibleCalls: filtered.slice(startI, endI),
    };
  }, [filtered, scrollTop, viewportH, useVirtualTable, virtualRowPx, virtualOverscan]);

  function renderCallRow(c: Call) {
    const tenant = tenants.find((t) => t.id === c.tenantId);
    const brandColor = tenant?.brandColor || 'var(--cc-color-cyan)';
    const resolvedName = nameMap.get(c.callerNumber) || c.callerName;
    const hasDid = Boolean(c.dialedNumber?.trim());
    const mappedTenantLabel =
      c.direction === 'inbound' && hasDid
        ? didTenantLabelMap.get(c.dialedNumber)
        : undefined;
    const tenantDisplayName =
      hasDid ? (c.direction === 'outbound' ? c.tenantName : mappedTenantLabel || c.tenantName) : '';

    return (
      <TableRow
        key={c.id}
        className={useVirtualTable ? 'align-top [&>td]:py-2' : undefined}
        style={useVirtualTable ? { height: virtualRowPx } : undefined}
      >
        <TableCell className="font-mono text-xs">{formatTimeAu(c.startTime)}</TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-1">
            <Badge
              variant="outline"
              className={
                c.direction === 'outbound'
                  ? 'rounded-full border-violet-300 bg-violet-50 text-[11px] font-semibold text-violet-800'
                  : 'rounded-full border-sky-300 bg-sky-50 text-[11px] font-semibold text-sky-800'
              }
            >
              {c.direction === 'outbound' ? 'Outbound' : 'Inbound'}
            </Badge>
            {c.id.startsWith('linkus-') && (
              <Badge
                variant="outline"
                className="rounded-full border-amber-200 bg-amber-50 text-[10px] font-medium text-amber-900"
                title="Logged from this browser until PBX CDR appears in Supabase"
              >
                Softphone
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm">
          {resolvedName ? (
            <span className="font-medium text-foreground">{resolvedName}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="font-mono text-xs tabular-nums">
          {formatPhone(c.callerNumber)}
        </TableCell>
        <TableCell className="font-mono text-xs tabular-nums">
          {c.direction === 'inbound' && c.dialedNumber ? formatPhone(c.dialedNumber) : '—'}
        </TableCell>
        {permissions.canViewTenantNames && (
          <TableCell>
            {tenantDisplayName ? (
              <span
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold"
                style={{
                  color: brandColor,
                  borderColor: `${brandColor}40`,
                  background: `${brandColor}12`,
                }}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: brandColor }} />
                {tenantDisplayName}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
        )}
        <TableCell className="max-w-[200px]">
          {c.agentId || c.agentName.trim() ? (
            <span className="font-medium text-foreground">{c.agentName}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="font-mono text-xs">
          {c.durationSeconds > 0 ? formatSeconds(c.durationSeconds) : '—'}
        </TableCell>
        <TableCell>
          <CallStatusBadge result={c.result} />
        </TableCell>
        {permissions.canViewCallRecordings && (
          <TableCell>
            {c.recordingUrl ? (
              <CallRecordingPlayer recordingPath={c.recordingUrl} />
            ) : (
              <span className="text-muted-foreground text-[10px]">—</span>
            )}
          </TableCell>
        )}
      </TableRow>
    );
  }

  return (
    <div className="cc-fade-in space-y-6">
      <Card className="border-border/80 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Search Calls</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            className="max-w-md bg-white"
            type="text"
            placeholder="Search by customer name, phone, DID, agent, queue, tenant, inbound / outbound…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-white shadow-sm">
        <CardHeader className="gap-4 pb-3">
          <div className="space-y-4">
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Filter by Date (Melbourne)
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-slate-50/50 p-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-md hover:bg-white hover:shadow-sm"
                    onClick={() => onDateChange(addAustralianCalendarDays(callDate, -1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="flex items-center gap-2 px-3">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold tabular-nums">
                      {formatAustralianDayHeading(callDate)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-md hover:bg-white hover:shadow-sm"
                    onClick={() => onDateChange(addAustralianCalendarDays(callDate, 1))}
                    disabled={callDate >= getAustralianDateKey(Date.now())}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                {callDate !== getAustralianDateKey(Date.now()) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg bg-white"
                    onClick={() => onDateChange(getAustralianDateKey(Date.now()))}
                  >
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    Today
                  </Button>
                )}

                <Input
                  type="date"
                  className="h-9 w-[150px] bg-white"
                  value={callDate}
                  onChange={(e) => {
                    if (e.target.value) onDateChange(e.target.value);
                  }}
                  max={getAustralianDateKey(Date.now())}
                />
              </div>
            </div>

            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Filter by Direction
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={filterDirection === 'all' ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setFilterDirection('all')}
                >
                  All calls
                </Button>
                <Button
                  variant={filterDirection === 'inbound' ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full bg-white"
                  onClick={() => setFilterDirection('inbound')}
                >
                  Inbound
                </Button>
                <Button
                  variant={filterDirection === 'outbound' ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full bg-white"
                  onClick={() => setFilterDirection('outbound')}
                >
                  Outbound
                </Button>
              </div>
            </div>

            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Filter by Result
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={filterResult === 'all' ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setFilterResult('all')}
                >
                  All Results
                </Button>
                {Object.entries(RESULT_MAP).map(([key, val]) => (
                  <Button
                    key={key}
                    variant="outline"
                    size="sm"
                    className="rounded-full bg-white"
                    onClick={() => setFilterResult(key)}
                    style={filterResult === key ? { borderColor: val.color, color: val.color, background: val.bg } : {}}
                  >
                    {callResultLabel(key as CallResult)}
                  </Button>
                ))}
              </div>
            </div>

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
          </div>
        </CardHeader>
      </Card>

      <Card className="border-border/80 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-3 text-base">
            Call History
            {isAgentView && (
              <>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-normal text-emerald-700">
                  Answered {agentAnsweredCount}
                </span>
                <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-normal text-rose-700">
                  Hung up {agentHungUpCount}
                </span>
              </>
            )}
            {namesLoading && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-normal text-slate-500">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                Resolving names…
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState message="No calls match filters" />
          ) : (
            <div
              ref={tableScrollRef}
              onScroll={useVirtualTable ? onCallsTableScroll : undefined}
              className="max-h-[min(70vh,560px)] w-full min-w-0 overflow-auto rounded-md border border-border/60"
            >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>DID</TableHead>
                  {permissions.canViewTenantNames && (
                    <TableHead>Tenant</TableHead>
                  )}
                  <TableHead>Agent</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  {permissions.canViewCallRecordings && (
                    <TableHead>Recording</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {useVirtualTable && topPad > 0 && (
                  <TableRow className="hover:bg-transparent" aria-hidden>
                    <TableCell
                      colSpan={callTableColSpan}
                      className="border-0 p-0"
                      style={{ height: topPad }}
                    />
                  </TableRow>
                )}
                {visibleCalls.map((c) => renderCallRow(c))}
                {useVirtualTable && bottomPad > 0 && (
                  <TableRow className="hover:bg-transparent" aria-hidden>
                    <TableCell
                      colSpan={callTableColSpan}
                      className="border-0 p-0"
                      style={{ height: bottomPad }}
                    />
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

