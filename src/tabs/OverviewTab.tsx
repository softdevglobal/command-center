import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DashboardSummary,
  Queue,
  Agent,
  Call,
  Tenant,
  Permissions,
  UserSession,
  AgentGroup,
  IncomingCall,
} from "@/services/types";
import { 
  getAustralianDateKey, 
  formatAustralianDayShort 
} from "@/utils/australianTime";
import {
  formatDuration,
  formatPhone,
  formatSeconds,
  formatTime,
} from "@/utils/formatters";
import { formatTimeAu } from "@/utils/australianTime";
import {
  buildIncomingCallSnapshot,
  buildLiveCallSnapshot,
  restoreCallDetailFromSession,
  clearCallDetailSession,
  type CallDetailSnapshot,
} from "@/components/dashboard/CallDetailsSheet";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { QueueSummaryCard } from "@/components/dashboard/QueueSummaryCard";
import { LiveDot } from "@/components/dashboard/LiveDot";
import { LoadingSkeleton } from "@/components/dashboard/LoadingSkeleton";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { NotificationsCard } from "@/tabs/NotificationsCard";
import { ResultBadge } from "@/components/dashboard/ResultBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCallNotification } from "@/context/CallNotificationContext";

interface OverviewTabProps {
  summary: DashboardSummary | null;
  queues: Queue[];
  agents: Agent[];
  calls: Call[];
  tenants: Tenant[];
  permissions: Permissions;
  now: number;
  session?: UserSession | null;
  agentGroups?: AgentGroup[];
  incomingCalls?: IncomingCall[];
  /** Merged list for queue cards only (includes ~10 minutes post-end linger). Defaults to `incomingCalls`. */
  incomingCallsForQueueCards?: IncomingCall[];
  queueIncomingLingerEndedAt?: ReadonlyMap<string, number>;
  callDate?: string;
}

export function OverviewTab({
  summary,
  queues,
  agents,
  calls,
  tenants,
  permissions,
  now,
  session,
  agentGroups,
  incomingCalls,
  incomingCallsForQueueCards,
  queueIncomingLingerEndedAt,
  callDate,
}: OverviewTabProps) {
  const isAgentOverview = session?.role === "agent";
  const queueCardIncoming =
    incomingCallsForQueueCards ?? incomingCalls ?? [];
  const { selectedCall, setSelectedCall } = useCallNotification();
  const restoredFromSession = useRef(false);

  const myAnsweredCallsCount = useMemo(() => {
    if (!isAgentOverview || !session) return 0;
    const me = agents.find((a) => a.userId === session.userId);
    if (!me) return summary?.totalCallsToday ?? 0;
    return calls.filter((c) => c.agentId === me.id && c.result === "answered").length;
  }, [isAgentOverview, session, agents, calls, summary?.totalCallsToday]);

  const liveAgents = useMemo(
    () => agents.filter((a) => a.status === "on-call"),
    [agents],
  );
  const ringingAgents = useMemo(
    () => agents.filter((a) => a.status === "ringing"),
    [agents],
  );

  // Restore call detail saved before navigating away (Book Now / Booking Details)
  useEffect(() => {
    const restored = restoreCallDetailFromSession();
    if (restored) {
      restoredFromSession.current = true;
      setSelectedCall(restored);
      clearCallDetailSession();
    }
  }, [setSelectedCall]);

  useEffect(() => {
    if (!selectedCall) return;
    if (restoredFromSession.current) return;

    const isStillActive =
      selectedCall.mode === "incoming"
        ? (incomingCalls || []).some((call) => call.id === selectedCall.id) ||
          Boolean(queueIncomingLingerEndedAt?.has(selectedCall.id))
        : agents.some(
            (agent) =>
              agent.id === selectedCall.id &&
              (agent.status === "on-call" || agent.status === "ringing"),
          );

    if (!isStillActive) {
      setSelectedCall(null);
    }
  }, [
    selectedCall,
    incomingCalls,
    queueIncomingLingerEndedAt,
    agents,
    setSelectedCall,
  ]);

  const queueCallDetails = useMemo(() => {
    const map = new Map<
      string,
      {
        detail: CallDetailSnapshot;
        hint: string;
        isIncoming: boolean;
        isLive: boolean;
        showEndedCallerRecall?: boolean;
        incomingCallers: Array<{
          number: string;
          name: string | null;
          waitingSince?: number | null;
          detail?: CallDetailSnapshot;
          endedAt?: number | null;
        }>;
      }
    >();

    for (const queue of queues) {
      const liveAgentForQueue = liveAgents.find((agent) =>
        agent.queueIds.includes(queue.id),
      );
      const answeredNumbersForQueue = new Set<string>();
      if (liveAgentForQueue?.currentCaller) {
        answeredNumbersForQueue.add(
          normalizeNumber(liveAgentForQueue.currentCaller),
        );
      }

      const allIncomingForQueue = queueCardIncoming.filter(
        (call) => call.queueId === queue.id && call.callerNumber,
      );
      const unansweredIncoming = allIncomingForQueue.filter(
        (call) =>
          !answeredNumbersForQueue.has(normalizeNumber(call.callerNumber)),
      );
      // Split active (still ringing) from "ended but lingering" rows. We want
      // active rings to drive the queue card; lingered rows alone must NOT hide
      // a live agent that's currently on another call.
      const activeUnansweredIncoming = unansweredIncoming.filter(
        (c) => !queueIncomingLingerEndedAt?.has(c.id),
      );
      const lingerUnansweredIncoming = unansweredIncoming.filter(
        (c) => Boolean(queueIncomingLingerEndedAt?.has(c.id)),
      );

      const buildRow = (c: typeof unansweredIncoming[number]) => {
        const showAsEnded = Boolean(queueIncomingLingerEndedAt?.has(c.id));
        return {
          number: c.callerNumber,
          name: c.callerName || null,
          waitingSince: c.waitingSince,
          detail: buildIncomingCallSnapshot(c, now, { showAsEnded }),
          endedAt: queueIncomingLingerEndedAt?.get(c.id) ?? null,
        };
      };

      // Real incoming present — show as incoming, with any linger rows appended
      // below so a freshly-ended call still appears for the 10-minute linger window.
      if (activeUnansweredIncoming.length > 0) {
        const head = activeUnansweredIncoming[0];
        const incomingCallers = [
          ...activeUnansweredIncoming.map(buildRow),
          ...lingerUnansweredIncoming.map(buildRow),
        ];
        map.set(queue.id, {
          detail: buildIncomingCallSnapshot(head, now),
          hint:
            activeUnansweredIncoming.length > 1
              ? "Click a caller below to see their details."
              : "Click to open the incoming caller details.",
          isIncoming: true,
          showEndedCallerRecall: false,
          isLive: false,
          incomingCallers,
        });
        continue;
      }

      const ringingAgentForQueue = ringingAgents.find((agent) => {
        if (!agent.queueIds.includes(queue.id)) return false;
        if (
          agent.currentCaller &&
          answeredNumbersForQueue.has(normalizeNumber(agent.currentCaller))
        ) {
          return false;
        }
        return true;
      });
      if (ringingAgentForQueue) {
        const cPhone = ringingAgentForQueue.currentCaller;
        const detail = buildLiveOrIncomingDetail(
          "incoming",
          null,
          ringingAgentForQueue,
          queues,
          tenants,
          queueCardIncoming,
          now,
        );
        map.set(queue.id, {
          detail,
          hint: "Click to open the incoming caller details.",
          isIncoming: true,
          isLive: false,
          showEndedCallerRecall: false,
          incomingCallers: cPhone
            ? [{ number: cPhone, name: null, waitingSince: null, detail }]
            : [],
        });
        continue;
      }

      if (liveAgentForQueue) {
        const detail = buildLiveOrIncomingDetail(
          "live",
          null,
          liveAgentForQueue,
          queues,
          tenants,
          queueCardIncoming,
          now,
        );
        const incomingMatch = findIncomingCallForAgent(
          liveAgentForQueue,
          queueCardIncoming,
        );
        const cPhone =
          liveAgentForQueue.currentCaller ||
          incomingMatch?.callerNumber ||
          "Unknown";
        const cName =
          incomingMatch?.callerName || `Agent: ${liveAgentForQueue.name}`;

        map.set(queue.id, {
          detail,
          hint: "Click to open the live caller details.",
          isIncoming: false,
          isLive: true,
          showEndedCallerRecall: false,
          incomingCallers: [
            { number: cPhone, name: cName, waitingSince: null, detail },
          ],
        });
        continue;
      }

      // Linger-only fallback: no real incoming and no live/ringing agent — show
      // the recently-ended caller(s) in the recall treatment so the queue card
      // keeps the row visible for up to 10 minutes after the call ends.
      if (lingerUnansweredIncoming.length > 0) {
        const head = lingerUnansweredIncoming[0];
        map.set(queue.id, {
          detail: buildIncomingCallSnapshot(head, now, { showAsEnded: true }),
          hint: "Recently ended — this row clears automatically.",
          isIncoming: false,
          showEndedCallerRecall: true,
          isLive: false,
          incomingCallers: lingerUnansweredIncoming.map(buildRow),
        });
        continue;
      }

      const anyBroadcastForQueue = queueCardIncoming.find(
        (call) => call.queueId === queue.id,
      );
      if (anyBroadcastForQueue) {
        map.set(queue.id, {
          detail: buildLiveOrIncomingDetail(
            "incoming",
            anyBroadcastForQueue,
            null,
            queues,
            tenants,
            queueCardIncoming,
            now,
          ),
          hint: "Click to open the incoming caller details.",
          isIncoming: true,
          isLive: false,
          showEndedCallerRecall: false,
          incomingCallers: [],
        });
      }
    }

    return map;
  }, [
    queueCardIncoming,
    queueIncomingLingerEndedAt,
    liveAgents,
    ringingAgents,
    now,
    queues,
    tenants,
  ]);

  const visibleQueues = useMemo(
    () =>
      queues
        .filter((q) => {
          const isAllowed =
            permissions.allowedQueueIds.length === 0 ||
            permissions.allowedQueueIds.includes(q.id);
          if (!isAllowed) return false;

          if (!isBlueQueue(q)) return true;

          const detail = queueCallDetails.get(q.id);
          return Boolean(detail) || q.activeCalls > 0 || q.waitingCalls > 0;
        })
        .sort((a, b) => {
          const aPri =
            Boolean(queueCallDetails.get(a.id)?.isIncoming) ||
            Boolean(queueCallDetails.get(a.id)?.showEndedCallerRecall);
          const bPri =
            Boolean(queueCallDetails.get(b.id)?.isIncoming) ||
            Boolean(queueCallDetails.get(b.id)?.showEndedCallerRecall);
          if (aPri !== bPri) return bPri ? 1 : -1;

          const waitDelta = b.avgWaitSeconds - a.avgWaitSeconds;
          if (waitDelta !== 0) return waitDelta;

          return b.waitingCalls - a.waitingCalls;
        }),
    [queues, permissions.allowedQueueIds, queueCallDetails],
  );

  if (!summary) return <LoadingSkeleton />;

  return (
    <div className="cc-fade-in space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
          <LiveDot color="var(--cc-color-cyan)" />
          Queue Status
        </div>
        <div className="grid gap-4">
          {visibleQueues.map((q) => {
            const tenant = tenants.find((t) => t.id === q.tenantId);
            const queueDetail = queueCallDetails.get(q.id);
            const incomingRows = queueDetail?.incomingCallers ?? [];
            const selectableIncomingCount = incomingRows.filter(
              (c) => c.detail,
            ).length;
            const multipleIncomingPickers =
              (Boolean(queueDetail?.isIncoming) ||
                Boolean(queueDetail?.showEndedCallerRecall)) &&
              selectableIncomingCount > 1;

            return (
              <QueueSummaryCard
                key={q.id}
                queue={q}
                tenant={tenant}
                showTenant={permissions.canViewTenantNames}
                interactive={Boolean(queueDetail) && !multipleIncomingPickers}
                isIncoming={queueDetail?.isIncoming}
                isLive={queueDetail?.isLive}
                showEndedCallerRecall={queueDetail?.showEndedCallerRecall}
                incomingCallers={queueDetail?.incomingCallers}
                now={now}
                callHint={queueDetail?.hint}
                onClick={
                  queueDetail && !multipleIncomingPickers
                    ? () => setSelectedCall(queueDetail.detail)
                    : undefined
                }
                onIncomingCallerClick={
                  selectableIncomingCount > 0
                    ? (d) => setSelectedCall(d)
                    : undefined
                }
              />
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          {isAgentOverview ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard
                label="Answered Calls"
                value={myAnsweredCallsCount}
                accent="var(--cc-color-green)"
                sub="your calls"
              />
              <MetricCard
                label="Answer Rate"
                value={`${summary.answerRate}%`}
                accent="var(--cc-color-cyan)"
                sub="your calls"
              />
              <MetricCard
                label="Active Calls"
                value={summary.activeCalls}
                accent="var(--cc-color-red)"
                sub="live now"
              />
              <MetricCard
                label="Calls Waiting"
                value={summary.queuedCalls}
                accent="var(--cc-color-amber)"
                sub="in queue"
              />
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
              <MetricCard
                label="Active Calls"
                value={summary.activeCalls}
                accent="var(--cc-color-red)"
                sub="live now"
              />
              <MetricCard
                label="Calls Waiting"
                value={summary.queuedCalls}
                accent="var(--cc-color-amber)"
                sub="in queue"
              />
              <MetricCard
                label="Agents Online"
                value={summary.onlineAgents}
                accent="var(--cc-color-cyan)"
                sub={`${summary.availableAgents} available`}
              />
              <MetricCard
                label={callDate && callDate !== getAustralianDateKey(Date.now()) ? `Calls (${formatAustralianDayShort(callDate)})` : "Calls Today"}
                value={summary.totalCallsToday}
                accent="var(--cc-color-cyan)"
              />
              <MetricCard
                label="Answer Rate"
                value={`${summary.answerRate}%`}
                accent="var(--cc-color-green)"
              />
              <MetricCard
                label="Abandon Rate"
                value={`${summary.abandonRate}%`}
                accent="var(--cc-color-red)"
              />
              <MetricCard
                label="Avg Handle"
                value={formatSeconds(summary.avgHandleTime)}
                accent="var(--cc-color-purple)"
              />
              <MetricCard
                label="SLA %"
                value={`${summary.slaPercent}%`}
                accent="var(--cc-color-green)"
              />
            </div>
          )}
        </div>

        <div>
          <NotificationsCard
            queues={queues}
            agents={agents}
            tenants={tenants}
            summary={summary}
            session={session}
          />
        </div>
      </div>

      <Card className="border-border/80 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <LiveDot />
            Live Calls
          </CardTitle>
        </CardHeader>
        <CardContent>
          {liveAgents.length === 0 ? (
            <EmptyState message="No active calls" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Caller</TableHead>
                  {permissions.canViewTenantNames && (
                    <TableHead>Client</TableHead>
                  )}
                  <TableHead>Queue</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liveAgents.map((a) => {
                  const queueColor =
                    queues.find((q) => a.queueIds.includes(q.id))?.color ||
                    "var(--cc-color-cyan)";
                  const incoming = findIncomingCallForAgent(
                    a,
                    incomingCalls || [],
                  );
                  const callerNum =
                    a.currentCaller || incoming?.callerNumber || "";
                  const tenant = tenants.find((t) => t.id === a.tenantId);
                  const brandColor =
                    tenant?.brandColor || "var(--cc-color-cyan)";

                  return (
                    <TableRow
                      key={a.id}
                      className="cursor-pointer transition-colors hover:bg-slate-50"
                      onClick={() =>
                        setSelectedCall(
                          buildLiveCallSnapshot({
                            agent: a,
                            queues,
                            tenants,
                            incomingCall: incoming,
                            now,
                          }),
                        )
                      }
                    >
                      <TableCell className="font-mono text-xs">
                        {a.callStartTime
                          ? formatTimeAu(new Date(a.callStartTime))
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatPhone(callerNum)}
                        {incoming?.callerName && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {incoming.callerName}
                          </div>
                        )}
                      </TableCell>
                      {permissions.canViewTenantNames && (
                        <TableCell>
                          <span
                            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold"
                            style={{
                              color: brandColor,
                              borderColor: `${brandColor}40`,
                              background: `${brandColor}12`,
                            }}
                          >
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: brandColor }}
                            />
                            {a.tenantName ?? "—"}
                          </span>
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="rounded-full border-0 px-2.5 py-1 text-[11px] font-semibold"
                          style={{
                            color: queueColor,
                            background: `${queueColor}18`,
                          }}
                        >
                          {a.queueName}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-slate-900">
                        {a.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-rose-600">
                        <span className="inline-flex items-center">
                          <LiveDot />
                          {a.callStartTime
                            ? formatDuration(now - a.callStartTime)
                            : "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ResultBadge result="answered" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function buildLiveOrIncomingDetail(
  kind: "incoming" | "live",
  incomingCall: IncomingCall | null,
  agent: Agent | null,
  queues: Queue[],
  tenants: Tenant[],
  incomingCalls: IncomingCall[],
  now: number,
): CallDetailSnapshot {
  if (kind === "incoming" && incomingCall) {
    return buildIncomingCallSnapshot(incomingCall, now);
  }

  if (agent) {
    return buildLiveCallSnapshot({
      agent,
      queues,
      tenants,
      incomingCall: findIncomingCallForAgent(agent, incomingCalls),
      now,
    });
  }

  throw new Error("Queue detail requested without an active call.");
}

function normalizeNumber(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

function isBlueQueue(queue: Pick<Queue, "id" | "name" | "type">): boolean {
  return [queue.id, queue.name, queue.type].some((value) =>
    hasQueueToken(value, "blue"),
  );
}

function hasQueueToken(value: string | null | undefined, token: string): boolean {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized.split(/\s+/).includes(token);
}

function findIncomingCallForAgent(
  agent: Agent,
  incomingCalls: IncomingCall[],
): IncomingCall | null {
  if (!Array.isArray(incomingCalls)) return null;
  const agentQueueIds = new Set(agent.queueIds);
  return (
    incomingCalls.find(
      (call) =>
        call.tenantId === agent.tenantId && agentQueueIds.has(call.queueId),
    ) ||
    incomingCalls.find((call) => call.tenantId === agent.tenantId) ||
    null
  );
}
