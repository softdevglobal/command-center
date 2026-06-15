import { useMemo, useState } from 'react';
import type { UserSession, Tenant, Queue, AgentGroup, IncomingCall } from '@/services/types';
import { formatDuration } from '@/utils/formatters';
import { CallDetailsSheet } from '@/components/dashboard/CallDetailsSheet';
import {
  buildIncomingCallSnapshot,
  type CallDetailSnapshot,
} from '@/components/dashboard/callDetailSnapshot';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LiveDot } from './LiveDot';

interface AgentShiftPanelProps {
  session: UserSession;
  tenants: Tenant[];
  queues: Queue[];
  agentGroups: AgentGroup[];
  incomingCalls: IncomingCall[];
  now: number;
}

export function AgentShiftPanel({
  session, tenants, queues, agentGroups, incomingCalls, now,
}: AgentShiftPanelProps) {
  const [selectedCall, setSelectedCall] = useState<CallDetailSnapshot | null>(null);

  const assignedTenants = useMemo(() => {
    const tenantIds = new Set<string>();
    for (const q of queues) {
      if (session.allowedQueueIds.includes(q.id)) {
        tenantIds.add(q.tenantId);
      }
    }
    return tenants.filter((t) => tenantIds.has(t.id));
  }, [session.allowedQueueIds, queues, tenants]);

  const tenantQueues = useMemo(() => {
    const map = new Map<string, Queue[]>();
    for (const t of assignedTenants) {
      map.set(
        t.id,
        queues.filter((q) => q.tenantId === t.id && session.allowedQueueIds.includes(q.id)),
      );
    }
    return map;
  }, [assignedTenants, queues, session.allowedQueueIds]);

  const myGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of agentGroups) {
      if (session.allowedQueueIds.includes(g.queueId)) {
        ids.add(g.id);
      }
    }
    return ids;
  }, [agentGroups, session.allowedQueueIds]);

  const myIncomingCalls = useMemo(
    () => incomingCalls.filter((c) => myGroupIds.has(c.groupId) || session.allowedQueueIds.includes(c.queueId)),
    [incomingCalls, myGroupIds, session.allowedQueueIds],
  );

  return (
    <Card className="cc-fade-in overflow-hidden border-border/80 bg-gradient-to-br from-white via-white to-sky-50/40 shadow-sm">
      <CardHeader className="gap-3 border-b border-border/70 pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-sky-600">My Shift</div>
            <CardTitle className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {session.displayName}
            </CardTitle>
          </div>
          <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <LiveDot color="var(--cc-color-green)" />
            Available
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 p-6">
        <div className="grid gap-4 lg:grid-cols-2">
          {assignedTenants.map((t) => {
            const tQueues = tenantQueues.get(t.id) || [];
            const totalWaiting = tQueues.reduce((s, q) => s + q.waitingCalls, 0);
            const totalActive = tQueues.reduce((s, q) => s + q.activeCalls, 0);

            return (
              <div
                key={t.id}
                className="rounded-2xl border bg-slate-50/70 p-4 shadow-sm"
                style={{ borderColor: `${t.brandColor}40` }}
              >
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold"
                  style={{
                    color: t.brandColor,
                    borderColor: `${t.brandColor}40`,
                    background: `${t.brandColor}12`,
                  }}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.brandColor }} />
                  {t.name}
                </div>
                <div className="mb-4 flex flex-wrap gap-2">
                  {tQueues.map((q) => (
                    <span key={q.id} className="rounded-full border border-border bg-white px-3 py-1 text-xs text-slate-600">
                      {q.icon} {q.name}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white p-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Active</div>
                    <div className="mt-2 text-2xl font-semibold text-rose-600">{totalActive}</div>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Waiting</div>
                    <div className="mt-2 text-2xl font-semibold text-amber-600">{totalWaiting}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {myIncomingCalls.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              <LiveDot color="var(--cc-color-red)" />
              Incoming Calls
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                {myIncomingCalls.length}
              </span>
            </div>
            <div className="space-y-3">
              {myIncomingCalls.map((call) => (
                <div
                  key={call.id}
                  className="cursor-pointer rounded-2xl border bg-white p-4 shadow-sm transition-transform hover:-translate-y-0.5"
                  style={{ borderColor: `${call.tenantBrandColor}40` }}
                  onClick={() => setSelectedCall(buildIncomingCallSnapshot(call, now))}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold"
                      style={{
                        color: call.tenantBrandColor,
                        borderColor: `${call.tenantBrandColor}40`,
                        background: `${call.tenantBrandColor}12`,
                      }}
                    >
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: call.tenantBrandColor }} />
                      {call.tenantName}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">DID: {call.did}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{call.didLabel}</span>
                  </div>

                  <div className="mb-3 font-mono text-sm text-slate-900">
                    {call.callerNumber}
                    {call.callerName && <span className="text-muted-foreground"> ({call.callerName})</span>}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground">
                      Queue: {call.queueName} · Group: {call.groupName}
                    </span>
                    <span className="inline-flex items-center font-mono text-xs font-semibold text-rose-600">
                      <LiveDot color="var(--cc-color-red)" />
                      {formatDuration(now - call.waitingSince)}
                    </span>
                    <Button
                      size="sm"
                      className="ml-auto"
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      Answer
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <CallDetailsSheet
        detail={selectedCall}
        open={Boolean(selectedCall)}
        onOpenChange={(open) => {
          if (!open) setSelectedCall(null);
        }}
      />
    </Card>
  );
}
