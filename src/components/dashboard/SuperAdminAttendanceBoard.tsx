import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, Tenant } from "@/services/types";
import { formatDuration } from "@/utils/formatters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveDot } from "@/components/dashboard/LiveDot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildAttendanceDaySegments,
  computeWorkedAndBreakMs,
  deriveAttendanceShiftStatus,
  fetchAllAttendanceEventsForDay,
  fetchAllAttendanceEventsForRange,
  isSupabaseAuthUserId,
  subscribeToAllAttendanceInserts,
  type AgentAttendanceEventRow,
} from "@/services/attendanceApi";
import {
  format,
  startOfDay,
  addDays,
  endOfDay,
  parse,
  startOfWeek,
  endOfWeek,
  addWeeks,
  startOfMonth,
  endOfMonth,
  addMonths,
  eachDayOfInterval,
} from "date-fns";
import { ChevronLeft, ChevronRight, Users, Calendar } from "lucide-react";
import {
  formatAustralianDayHeading,
  formatTimeAuShort,
  getAustralianDateKey,
  startOfAustralianDayMs,
} from "@/utils/australianTime";

// ─── View mode ────────────────────────────────────────────────────────────────

type ViewMode = "day" | "week" | "month";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface SuperAdminAttendanceBoardProps {
  agents: Agent[];
  tenants: Tenant[];
  now: number;
}

function displayNameForUser(
  userId: string,
  events: AgentAttendanceEventRow[],
  agents: Agent[],
): string {
  const agentRow = agents.find((a) => a.id === userId || a.userId === userId);
  if (agentRow?.name) return agentRow.name;
  for (let i = events.length - 1; i >= 0; i--) {
    const n = events[i].agent_display_name;
    if (n) return n;
  }
  return userId.slice(0, 8) + "…";
}

function tenantLabel(tenantId: string | null, tenants: Tenant[]): string {
  if (!tenantId) return "—";
  return tenants.find((t) => t.id === tenantId)?.name || tenantId.slice(0, 6);
}

function isCommandCentreAgent(a: Agent): boolean {
  return !String(a.bmsOwnerUid ?? "").trim();
}

/** Given a viewMode and an anchor date, return the [rangeStart, rangeEnd] for fetching. */
function getRangeBounds(mode: ViewMode, anchor: Date): { rangeStart: Date; rangeEnd: Date } {
  if (mode === "day") {
    return { rangeStart: startOfDay(anchor), rangeEnd: endOfDay(anchor) };
  }
  if (mode === "week") {
    return {
      rangeStart: startOfWeek(anchor, { weekStartsOn: 1 }),
      rangeEnd: endOfWeek(anchor, { weekStartsOn: 1 }),
    };
  }
  // month
  return { rangeStart: startOfMonth(anchor), rangeEnd: endOfMonth(anchor) };
}

/** Step anchor by +1/-1 unit for the given mode. */
function stepAnchor(mode: ViewMode, anchor: Date, dir: 1 | -1): Date {
  if (mode === "day") return startOfDay(addDays(anchor, dir));
  if (mode === "week") return startOfDay(addWeeks(anchor, dir));
  return startOfDay(addMonths(anchor, dir));
}

/** Human-readable label for the current range. */
function rangeLabel(mode: ViewMode, anchor: Date): string {
  if (mode === "day") {
    const ymd = getAustralianDateKey(anchor.getTime());
    return formatAustralianDayHeading(ymd);
  }
  if (mode === "week") {
    const s = startOfWeek(anchor, { weekStartsOn: 1 });
    const e = endOfWeek(anchor, { weekStartsOn: 1 });
    return `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`;
  }
  return format(anchor, "MMMM yyyy");
}

/** Is the current anchor's period covering today? */
function isCurrentPeriod(mode: ViewMode, anchor: Date, nowMs: number): boolean {
  const todayYmd = getAustralianDateKey(nowMs);
  const anchorYmd = getAustralianDateKey(anchor.getTime());

  if (mode === "day") return anchorYmd === todayYmd;
  if (mode === "week") {
    const today = new Date(nowMs);
    const s = startOfWeek(anchor, { weekStartsOn: 1 });
    const e = endOfWeek(anchor, { weekStartsOn: 1 });
    return today >= s && today <= e;
  }
  const today = new Date(nowMs);
  return (
    anchor.getFullYear() === today.getFullYear() &&
    anchor.getMonth() === today.getMonth()
  );
}

/** Count distinct days an agent has at least one clock_in event. */
function countDaysPresent(events: AgentAttendanceEventRow[]): number {
  const days = new Set(
    events
      .filter((e) => e.event_type === "clock_in")
      .map((e) => getAustralianDateKey(new Date(e.occurred_at).getTime())),
  );
  return days.size;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SuperAdminAttendanceBoard({
  agents,
  tenants,
  now,
}: SuperAdminAttendanceBoardProps) {
  const [events, setEvents] = useState<AgentAttendanceEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // anchor is the "representative" date for the current view period
  const [anchor, setAnchor] = useState(() => {
    const ymd = getAustralianDateKey(Date.now());
    return new Date(startOfAustralianDayMs(ymd));
  });
  const [viewMode, setViewMode] = useState<ViewMode>("day");

  // Derived
  const { rangeStart, rangeEnd } = useMemo(
    () => getRangeBounds(viewMode, anchor),
    [viewMode, anchor],
  );
  const isLive = isCurrentPeriod(viewMode, anchor, now);

  // For day-view live ticking: use now, else use end of the range
  const segmentNowMs = isLive ? now : rangeEnd.getTime();

  const commandCentreAgents = useMemo(
    () => agents.filter(isCommandCentreAgent),
    [agents],
  );

  const commandCentreUserIds = useMemo(() => {
    const s = new Set<string>();
    for (const a of commandCentreAgents) {
      s.add(a.id);
      if (a.userId && isSupabaseAuthUserId(a.userId)) s.add(a.userId);
    }
    return s;
  }, [commandCentreAgents]);

  // ── Data fetch ──────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let rows: AgentAttendanceEventRow[];
      if (viewMode === "day") {
        rows = await fetchAllAttendanceEventsForDay(rangeStart);
      } else {
        rows = await fetchAllAttendanceEventsForRange(rangeStart, rangeEnd);
      }
      setEvents(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load attendance.");
    } finally {
      setLoading(false);
    }
  }, [viewMode, rangeStart, rangeEnd]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live subscription: only inject rows for day-view when viewing current period
  useEffect(() => {
    if (!isLive || viewMode !== "day") return;
    return subscribeToAllAttendanceInserts((row) => {
      if (!commandCentreUserIds.has(row.user_id)) return;
      const rowDay = getAustralianDateKey(new Date(row.occurred_at).getTime());
      const anchorDay = getAustralianDateKey(anchor.getTime());
      if (rowDay !== anchorDay) return;
      setEvents((prev) => {
        if (prev.some((p) => p.id === row.id)) return prev;
        return [...prev, row].sort(
          (a, b) =>
            new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
        );
      });
    });
  }, [isLive, viewMode, anchor, commandCentreUserIds]);

  // ── Per-agent aggregation ───────────────────────────────────────────────────

  type AgentAttendanceRow = {
    userId: string;
    name: string;
    tenantId: string | null;
    // day-view only
    segments: ReturnType<typeof buildAttendanceDaySegments>;
    status: string;
    // all views
    workedMs: number;
    breakMs: number;
    daysPresent: number;
    lastAt: number;
  };

  const rows: AgentAttendanceRow[] = useMemo(() => {
    const byUser = new Map<string, AgentAttendanceEventRow[]>();
    for (const e of events) {
      if (!commandCentreUserIds.has(e.user_id)) continue;
      const list = byUser.get(e.user_id) || [];
      list.push(e);
      byUser.set(e.user_id, list);
    }

    const rosterIds = [...commandCentreUserIds];

    if (viewMode === "day") {
      // Day view: per-segment detail
      return rosterIds
        .map((userId) => {
          const evs = byUser.get(userId) || [];
          const sorted = [...evs].sort(
            (a, b) =>
              new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
          );
          const segments = buildAttendanceDaySegments(sorted, segmentNowMs);
          const { status } = deriveAttendanceShiftStatus(sorted);
          const { workedMs, breakMs } = computeWorkedAndBreakMs(sorted, segmentNowMs);
          const last = sorted[sorted.length - 1];
          const agentRow = commandCentreAgents.find((a) => a.id === userId || a.userId === userId);
          const tenantId =
            agentRow?.tenantId ||
            last?.tenant_id ||
            evs.find((x) => x.tenant_id)?.tenant_id ||
            null;
          return {
            userId,
            name: displayNameForUser(userId, sorted, commandCentreAgents),
            tenantId,
            segments,
            status,
            workedMs,
            breakMs,
            daysPresent: segments.length > 0 ? 1 : 0,
            lastAt: last ? new Date(last.occurred_at).getTime() : 0,
          };
        })
        .sort((a, b) => {
          const st = (s: string) => (s === "working" ? 0 : s === "on_break" ? 1 : 2);
          const d = st(a.status) - st(b.status);
          if (d !== 0) return d;
          return b.lastAt - a.lastAt;
        });
    }

    // Week / Month view: aggregate across all days in the range
    const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

    return rosterIds
      .map((userId) => {
        const evs = byUser.get(userId) || [];
        const sorted = [...evs].sort(
          (a, b) =>
            new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
        );

        // Aggregate per-day
        let totalWorkedMs = 0;
        let totalBreakMs = 0;

        for (const day of days) {
          const dayYmd = getAustralianDateKey(day.getTime());
          const dayEvs = sorted.filter(
            (e) => getAustralianDateKey(new Date(e.occurred_at).getTime()) === dayYmd,
          );
          if (dayEvs.length === 0) continue;
          const dayNowMs =
            dayYmd === getAustralianDateKey(now)
              ? now
              : endOfDay(day).getTime();
          const { workedMs, breakMs } = computeWorkedAndBreakMs(dayEvs, dayNowMs);
          totalWorkedMs += workedMs;
          totalBreakMs += breakMs;
        }

        const daysPresent = countDaysPresent(evs);
        const last = sorted[sorted.length - 1];
        const agentRow = commandCentreAgents.find((a) => a.id === userId || a.userId === userId);
        const tenantId =
          agentRow?.tenantId ||
          last?.tenant_id ||
          evs.find((x) => x.tenant_id)?.tenant_id ||
          null;

        // Current status from today's events only (for live dot)
        const todayYmd = getAustralianDateKey(now);
        const todayEvs = sorted.filter(
          (e) => getAustralianDateKey(new Date(e.occurred_at).getTime()) === todayYmd,
        );
        const { status } = deriveAttendanceShiftStatus(todayEvs);

        return {
          userId,
          name: displayNameForUser(userId, sorted, commandCentreAgents),
          tenantId,
          segments: [],
          status,
          workedMs: totalWorkedMs,
          breakMs: totalBreakMs,
          daysPresent,
          lastAt: last ? new Date(last.occurred_at).getTime() : 0,
        };
      })
      .sort((a, b) => b.workedMs - a.workedMs);
  }, [
    events,
    commandCentreAgents,
    commandCentreUserIds,
    segmentNowMs,
    viewMode,
    rangeStart,
    rangeEnd,
    now,
  ]);

  // ── Navigation helpers ──────────────────────────────────────────────────────

  const goBack = () => setAnchor((a) => stepAnchor(viewMode, a, -1));
  const goForward = () => {
    if (isLive) return;
    setAnchor((a) => stepAnchor(viewMode, a, 1));
  };
  const goToToday = () => {
    const ymd = getAustralianDateKey(now);
    setAnchor(new Date(startOfAustralianDayMs(ymd)));
  };

  // When switching modes, snap the anchor to today so the new period is sensible
  const switchMode = (m: ViewMode) => {
    setViewMode(m);
    const ymd = getAustralianDateKey(now);
    setAnchor(new Date(startOfAustralianDayMs(ymd)));
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const VIEW_MODES: { key: ViewMode; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
  ];

  return (
    <Card className="border-violet-200/60 bg-gradient-to-br from-white via-violet-50/25 to-white shadow-sm">
      <CardHeader className="border-b border-border/60 space-y-4 pb-4">
        <div>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <Users className="h-5 w-5 text-violet-600" />
            Agent attendance — Command center
          </CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Workshop agents are excluded.{" "}
            {isLive && viewMode === "day"
              ? "Live updates when command center agents clock in, break, or clock out."
              : "Showing historical data (not live)."}
          </p>
        </div>

        {/* ── View mode tabs ── */}
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-1 w-fit">
          {VIEW_MODES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => switchMode(key)}
              className={[
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                viewMode === key
                  ? "bg-white text-violet-700 shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <Calendar className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* ── Date navigation ── */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Previous period"
            onClick={goBack}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="font-mono text-sm font-semibold text-slate-900 min-w-[180px] text-center">
            {rangeLabel(viewMode, anchor)}
          </span>

          {/* Date picker only shown in day view */}
          {viewMode === "day" && (
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm"
              value={getAustralianDateKey(anchor.getTime())}
              max={getAustralianDateKey(now)}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setAnchor(new Date(startOfAustralianDayMs(v)));
              }}
              aria-label="Pick a date"
            />
          )}

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Next period"
            disabled={isLive}
            onClick={goForward}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {!isLive && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9"
              onClick={goToToday}
            >
              Today
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0 sm:p-4">
        {error && (
          <div className="px-4 py-3 text-sm text-rose-700 sm:px-0">{error}</div>
        )}
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No command center agents with a dashboard login (<code>user_id</code>) yet.
            Workshop-linked agents are not listed here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            {viewMode === "day" ? (
              /* ── Day table ── */
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead className="whitespace-nowrap">Clock in</TableHead>
                    <TableHead className="whitespace-nowrap">Clock out</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Worked</TableHead>
                    <TableHead className="text-right">Break</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.userId}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {tenantLabel(r.tenantId, tenants)}
                      </TableCell>
                      <TableCell className="align-top text-xs tabular-nums">
                        {r.segments.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {r.segments.map((s, i) => (
                              <span key={i}>{formatTimeAuShort(s.clockInMs)}</span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-xs tabular-nums">
                        {r.segments.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {r.segments.map((s, i) => (
                              <span
                                key={i}
                                className={s.clockOutMs == null ? "text-amber-700" : ""}
                              >
                                {s.clockOutMs == null
                                  ? "Open"
                                  : formatTimeAuShort(s.clockOutMs)}
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <AgentStatusBadge status={r.status} live={isLive} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {r.workedMs > 0 ? formatDuration(r.workedMs) : "0:00"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-amber-800/90">
                        {r.breakMs > 0 ? formatDuration(r.breakMs) : "0:00"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              /* ── Week / Month aggregated table ── */
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead className="text-center">Days present</TableHead>
                    <TableHead className="text-right">Total worked</TableHead>
                    <TableHead className="text-right">Avg / day</TableHead>
                    <TableHead className="text-right">Total break</TableHead>
                    {isLive && <TableHead>Today's status</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const avgMs =
                      r.daysPresent > 0 ? Math.round(r.workedMs / r.daysPresent) : 0;
                    return (
                      <TableRow key={r.userId}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {tenantLabel(r.tenantId, tenants)}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {r.daysPresent > 0 ? (
                            <span className="inline-flex items-center justify-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                              {r.daysPresent}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {r.workedMs > 0 ? formatDuration(r.workedMs) : "0:00"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {avgMs > 0 ? formatDuration(avgMs) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-amber-800/90">
                          {r.breakMs > 0 ? formatDuration(r.breakMs) : "0:00"}
                        </TableCell>
                        {isLive && (
                          <TableCell>
                            <AgentStatusBadge status={r.status} live />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentStatusBadge({ status, live }: { status: string; live: boolean }) {
  const color =
    status === "working"
      ? "var(--cc-color-green)"
      : status === "on_break"
        ? "var(--cc-color-amber)"
        : "#94a3b8";

  const label =
    status === "working" ? "Working" : status === "on_break" ? "On break" : "Off shift";

  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {live ? (
        <LiveDot color={color} />
      ) : (
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      {label}
    </span>
  );
}
