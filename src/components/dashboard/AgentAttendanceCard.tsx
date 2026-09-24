import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserSession } from "@/services/types";
import { useAgentAttendanceToday } from "@/context/AgentAttendanceTodayContext";
import { formatDuration } from "@/utils/formatters";
import {
  addAustralianCalendarDays,
  endOfAustralianDayMs,
  formatAustralianDayHeading,
  formatAustralianDayShort,
  formatTimeAu,
  formatTimeAuShort,
  getAustralianDateKey,
} from "@/utils/australianTime";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LiveDot } from "@/components/dashboard/LiveDot";
import {
  buildAttendanceDaySegments,
  computeWorkedAndBreakMs,
  deriveAttendanceShiftStatus,
  fetchAttendanceEventsForDay,
  insertAttendanceEvent,
  subscribeToMyAttendanceEvents,
  type AgentAttendanceEventRow,
  type AttendanceEventType,
} from "@/services/attendanceApi";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coffee,
  LogIn,
  LogOut,
  Timer,
} from "lucide-react";

interface AgentAttendanceCardProps {
  session: UserSession;
  now: number;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function statusLabel(status: string): string {
  switch (status) {
    case "working":
      return "Working";
    case "on_break":
      return "On break";
    default:
      return "Off shift";
  }
}

function statusDotColor(status: string): string {
  switch (status) {
    case "working":
      return "var(--cc-color-green)";
    case "on_break":
      return "var(--cc-color-amber)";
    default:
      return "var(--cc-color-slate, #94a3b8)";
  }
}

/**
 * Returns the Monday of the ISO week that contains `dateKey` (YYYY-MM-DD).
 * Works purely with date arithmetic — no timezone issues.
 */
function getMondayOfWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0 = Sun
  const daysBack = dow === 0 ? 6 : dow - 1; // Mon = 0 offset
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

/** All 7 day-keys (Mon–Sun) for the week containing `dateKey`. */
function weekDayKeys(dateKey: string): string[] {
  const monday = getMondayOfWeek(dateKey);
  return Array.from({ length: 7 }, (_, i) =>
    addAustralianCalendarDays(monday, i),
  );
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── component ──────────────────────────────────────────────────────────────

type Tab = "day" | "week";

export function AgentAttendanceCard({
  session,
  now,
}: AgentAttendanceCardProps) {
  const {
    supabaseUserId,
    todayKey,
    todayEvents,
    todayLoading,
    todayError,
    touchToday,
  } = useAgentAttendanceToday();

  // ── day-view state ──────────────────────────────────────────────────────
  const [pastEvents, setPastEvents] = useState<AgentAttendanceEventRow[]>([]);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewDayKey, setViewDayKey] = useState(() => getAustralianDateKey(now));

  // ── week-view state ─────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>("day");
  /**
   * weekAnchor is any date key inside the week we want to show.
   * We keep it in sync with viewDayKey when the user navigates days.
   */
  const [weekAnchor, setWeekAnchor] = useState(() => getAustralianDateKey(now));
  const [weekEvents, setWeekEvents] = useState<
    Record<string, AgentAttendanceEventRow[]>
  >({});
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekError, setWeekError] = useState<string | null>(null);

  // ── derived ─────────────────────────────────────────────────────────────
  const isViewingToday = viewDayKey === todayKey;
  const segmentNowMs = isViewingToday ? now : endOfAustralianDayMs(viewDayKey);

  const events = isViewingToday ? todayEvents : pastEvents;
  const loading = isViewingToday ? todayLoading : pastLoading;
  const fetchError = isViewingToday ? todayError : pastError;

  const days = useMemo(() => weekDayKeys(weekAnchor), [weekAnchor]);
  const isCurrentWeek = days.includes(todayKey);

  // ── load past day ───────────────────────────────────────────────────────
  const reloadPast = useCallback(async () => {
    if (!supabaseUserId) return;
    setPastLoading(true);
    setPastError(null);
    try {
      const rows = await fetchAttendanceEventsForDay(
        supabaseUserId,
        viewDayKey,
      );
      setPastEvents(rows);
    } catch (e: unknown) {
      setPastError(
        e instanceof Error ? e.message : "Could not load attendance.",
      );
    } finally {
      setPastLoading(false);
    }
  }, [supabaseUserId, viewDayKey]);

  useEffect(() => {
    if (isViewingToday) return;
    void reloadPast();
  }, [isViewingToday, reloadPast]);

  useEffect(() => {
    if (!supabaseUserId || isViewingToday) return;
    const vk = viewDayKey;
    return subscribeToMyAttendanceEvents(
      supabaseUserId,
      (row) => {
        const rowDay = getAustralianDateKey(
          new Date(row.occurred_at).getTime(),
        );
        if (rowDay !== vk) return;
        setPastEvents((prev) => {
          if (prev.some((p) => p.id === row.id)) return prev;
          return [...prev, row].sort(
            (a, b) =>
              new Date(a.occurred_at).getTime() -
              new Date(b.occurred_at).getTime(),
          );
        });
      },
      `past-${vk}`,
    );
  }, [supabaseUserId, isViewingToday, viewDayKey]);

  // ── load week ───────────────────────────────────────────────────────────
  const reloadWeek = useCallback(async () => {
    if (!supabaseUserId) return;
    setWeekLoading(true);
    setWeekError(null);
    try {
      const results = await Promise.all(
        days.map((dk) => fetchAttendanceEventsForDay(supabaseUserId, dk)),
      );
      const map: Record<string, AgentAttendanceEventRow[]> = {};
      days.forEach((dk, i) => {
        map[dk] = results[i];
      });
      setWeekEvents(map);
    } catch (e: unknown) {
      setWeekError(e instanceof Error ? e.message : "Could not load week.");
    } finally {
      setWeekLoading(false);
    }
  }, [supabaseUserId, days]);

  useEffect(() => {
    if (tab !== "week") return;
    void reloadWeek();
  }, [tab, reloadWeek]);

  // Live-update week view when new events arrive for any day in the week
  useEffect(() => {
    if (!supabaseUserId || tab !== "week") return;
    return subscribeToMyAttendanceEvents(
      supabaseUserId,
      (row) => {
        const rowDay = getAustralianDateKey(
          new Date(row.occurred_at).getTime(),
        );
        if (!days.includes(rowDay)) return;
        setWeekEvents((prev) => {
          const list = prev[rowDay] ?? [];
          if (list.some((p) => p.id === row.id)) return prev;
          const next = [...list, row].sort(
            (a, b) =>
              new Date(a.occurred_at).getTime() -
              new Date(b.occurred_at).getTime(),
          );
          return { ...prev, [rowDay]: next };
        });
      },
      `week-${days[0]}`,
    );
  }, [supabaseUserId, tab, days]);

  // ── day-view derived ────────────────────────────────────────────────────
  const { status, shiftStartedAt, breakStartedAt } = useMemo(
    () => deriveAttendanceShiftStatus(events),
    [events],
  );
  const { workedMs, breakMs } = useMemo(
    () => computeWorkedAndBreakMs(events, segmentNowMs),
    [events, segmentNowMs],
  );
  const segments = useMemo(
    () => buildAttendanceDaySegments(events, segmentNowMs),
    [events, segmentNowMs],
  );

  // ── week-view derived ───────────────────────────────────────────────────
  type WeekRow = {
    dayKey: string;
    label: string;
    workedMs: number;
    breakMs: number;
    isFuture: boolean;
    isToday: boolean;
    clockIn: number | null;
    clockOut: number | null;
  };

  const weekRows: WeekRow[] = useMemo(() => {
    return days.map((dk, idx) => {
      const evs = weekEvents[dk] ?? [];
      const isFuture = dk > todayKey;
      const isToday = dk === todayKey;
      // For today use live todayEvents so clock-in/out buttons update the week view too
      const effectiveEvs = isToday ? todayEvents : evs;
      const capMs = isToday ? now : endOfAustralianDayMs(dk);
      const { workedMs, breakMs } = computeWorkedAndBreakMs(
        effectiveEvs,
        capMs,
      );
      const segs = buildAttendanceDaySegments(effectiveEvs, capMs);
      return {
        dayKey: dk,
        label: DAY_LABELS[idx],
        workedMs,
        breakMs,
        isFuture,
        isToday,
        clockIn: segs[0]?.clockInMs ?? null,
        clockOut: segs[segs.length - 1]?.clockOutMs ?? null,
      };
    });
  }, [days, weekEvents, todayKey, todayEvents, now]);

  const weekTotalWorkedMs = useMemo(
    () => weekRows.reduce((sum, r) => sum + r.workedMs, 0),
    [weekRows],
  );
  const weekTotalBreakMs = useMemo(
    () => weekRows.reduce((sum, r) => sum + r.breakMs, 0),
    [weekRows],
  );

  // ── actions ─────────────────────────────────────────────────────────────
  if (supabaseUserId === undefined) {
    return (
      <Card className="border-border/80 bg-white/80 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading attendance…
        </CardContent>
      </Card>
    );
  }

  if (supabaseUserId === null) {
    return (
      <Card className="border-amber-200/80 bg-amber-50/40 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-amber-950">
            Attendance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-amber-900/90">
          <p>
            No Supabase session detected. Sign in with your{" "}
            <strong>Command Centre email and password</strong> (the same one
            used for this dashboard) so attendance can be saved.
          </p>
          <p className="text-amber-900/80">
            If you only use a legacy Firebase-only agent login, ask your admin
            to provision a dashboard account and link it to your agent profile.
          </p>
        </CardContent>
      </Card>
    );
  }

  const uid = supabaseUserId;

  const fireEvent = async (eventType: AttendanceEventType) => {
    setSubmitting(true);
    setMutationError(null);
    try {
      await insertAttendanceEvent(eventType, {
        userId: uid,
        tenantId: session.tenantId,
        displayName: session.displayName,
      });
      await touchToday();
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSubmitting(false);
    }
  };

  const onClockIn = () => void fireEvent("clock_in");
  const onTakeBreak = () => void fireEvent("break_start");
  const onEndBreak = () => void fireEvent("break_end");
  const onClockOut = async () => {
    setSubmitting(true);
    setMutationError(null);
    try {
      const { status: s } = deriveAttendanceShiftStatus(events);
      if (s === "on_break") {
        await insertAttendanceEvent("break_end", {
          userId: uid,
          tenantId: session.tenantId,
          displayName: session.displayName,
        });
      }
      await insertAttendanceEvent("clock_out", {
        userId: uid,
        tenantId: session.tenantId,
        displayName: session.displayName,
      });
      await touchToday();
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = mutationError ?? fetchError;

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <Card className="cc-fade-in border-border/80 bg-gradient-to-br from-white via-white to-emerald-50/30 shadow-sm">
      <CardHeader className="gap-3 border-b border-border/70 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-emerald-700">
                Attendance
              </div>
              <CardTitle className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-950">
                <Timer className="h-5 w-5 shrink-0 text-emerald-600" />
                Shifts by day
              </CardTitle>
            </div>

            {/* ── Tab switcher ── */}
            <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-slate-50/80 p-1 w-fit">
              <button
                type="button"
                onClick={() => setTab("day")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === "day"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-muted-foreground hover:text-slate-700"
                }`}
              >
                <Timer className="h-3.5 w-3.5" />
                Day
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("week");
                  // Sync week anchor to current day view
                  setWeekAnchor(viewDayKey);
                }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === "week"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-muted-foreground hover:text-slate-700"
                }`}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                Week
              </button>
            </div>

            {/* ── Day nav (shown for day tab) ── */}
            {tab === "day" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  aria-label="Previous day"
                  onClick={() =>
                    setViewDayKey((k) => addAustralianCalendarDays(k, -1))
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-900">
                    {formatAustralianDayHeading(viewDayKey)}
                  </span>
                  <input
                    type="date"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                    value={viewDayKey}
                    max={todayKey}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setViewDayKey(v);
                    }}
                    aria-label="Pick a date"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  aria-label="Next day"
                  disabled={viewDayKey >= todayKey}
                  onClick={() => {
                    if (viewDayKey >= todayKey) return;
                    setViewDayKey((k) => addAustralianCalendarDays(k, 1));
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {!isViewingToday && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-9"
                    onClick={() => setViewDayKey(getAustralianDateKey(now))}
                  >
                    Today
                  </Button>
                )}
              </div>
            )}

            {/* ── Week nav (shown for week tab) ── */}
            {tab === "week" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  aria-label="Previous week"
                  onClick={() =>
                    setWeekAnchor((k) => addAustralianCalendarDays(k, -7))
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="font-mono text-sm font-semibold text-slate-900">
                  {formatAustralianDayShort(days[0])} –{" "}
                  {formatAustralianDayShort(days[6])}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  aria-label="Next week"
                  disabled={isCurrentWeek}
                  onClick={() => {
                    if (isCurrentWeek) return;
                    setWeekAnchor((k) => addAustralianCalendarDays(k, 7));
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {!isCurrentWeek && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-9"
                    onClick={() => setWeekAnchor(getAustralianDateKey(now))}
                  >
                    This week
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* ── Status badge (day tab only) ── */}
          {tab === "day" &&
            (isViewingToday ? (
              <div
                className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-sm font-medium ring-1 ring-inset ring-border/60"
                style={{
                  color: status === "off_clock" ? "#475569" : undefined,
                }}
              >
                <LiveDot color={statusDotColor(status)} />
                {statusLabel(status)}
              </div>
            ) : (
              <div className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border/60">
                Viewing history
              </div>
            ))}

          {/* ── Week badge ── */}
          {tab === "week" && (
            <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200/60">
              {isCurrentWeek ? "Current week" : "Past week"}
            </div>
          )}
        </div>

        {tab === "day" &&
          isViewingToday &&
          (shiftStartedAt || breakStartedAt) && (
            <div className="font-mono text-xs text-muted-foreground">
              {status === "on_break" && breakStartedAt
                ? `Break since ${formatTimeAuShort(breakStartedAt)}`
                : shiftStartedAt
                  ? `Shift since ${formatTimeAuShort(shiftStartedAt)}`
                  : null}
            </div>
          )}
      </CardHeader>

      <CardContent className="space-y-5 p-6">
        {displayError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {displayError}
          </div>
        )}

        {/* ════════════════════════════════ DAY TAB ══════════════════════════ */}
        {tab === "day" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-white p-4 shadow-sm">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Worked (net)
                </div>
                <div className="mt-2 font-mono text-2xl font-semibold text-emerald-700">
                  {loading
                    ? "…"
                    : workedMs > 0
                      ? formatDuration(workedMs)
                      : "0:00"}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-white p-4 shadow-sm">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Break time
                </div>
                <div className="mt-2 font-mono text-2xl font-semibold text-amber-700">
                  {loading
                    ? "…"
                    : breakMs > 0
                      ? formatDuration(breakMs)
                      : "0:00"}
                </div>
              </div>
            </div>

            {!isViewingToday && (
              <p className="text-xs text-muted-foreground">
                Clock in / out and breaks are only available when today is
                selected.
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              {!isViewingToday ? (
                <>
                  <Button type="button" size="sm" className="gap-1.5" disabled>
                    <LogIn className="h-4 w-4" />
                    Clock in
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled
                  >
                    <LogOut className="h-4 w-4" />
                    Clock out
                  </Button>
                </>
              ) : (
                <>
                  {status === "off_clock" ? (
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      disabled={submitting || loading}
                      onClick={onClockIn}
                    >
                      <LogIn className="h-4 w-4" />
                      Clock in
                    </Button>
                  ) : status === "working" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="gap-1.5"
                      disabled={submitting || loading}
                      onClick={onTakeBreak}
                    >
                      <Coffee className="h-4 w-4" />
                      Take break
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      disabled={submitting || loading}
                      onClick={onEndBreak}
                    >
                      <LogIn className="h-4 w-4" />
                      End break
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={submitting || loading || status === "off_clock"}
                    onClick={() => void onClockOut()}
                  >
                    <LogOut className="h-4 w-4" />
                    Clock out
                  </Button>
                </>
              )}
            </div>

            <div className="rounded-xl border border-border/80 bg-white shadow-sm">
              <div className="border-b border-border/60 bg-slate-50/80 px-4 py-2.5">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Shifts · {formatAustralianDayShort(viewDayKey)}
                </div>
              </div>
              {loading && events.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Loading…
                </p>
              ) : segments.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {isViewingToday
                    ? "Clock in to see clock in, clock out, breaks, and working hours in the table below."
                    : "No attendance recorded for this day."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-10 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          #
                        </TableHead>
                        <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Clock in
                        </TableHead>
                        <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Clock out
                        </TableHead>
                        <TableHead className="text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Break
                        </TableHead>
                        <TableHead className="text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Working hours
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {segments.map((seg, i) => (
                        <TableRow key={`${seg.clockInMs}-${i}`}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {i + 1}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {formatTimeAuShort(seg.clockInMs)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {seg.clockOutMs == null ? (
                              <span className="text-amber-700">Open</span>
                            ) : (
                              formatTimeAuShort(seg.clockOutMs)
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-amber-800/90">
                            {seg.breakMs > 0
                              ? formatDuration(seg.breakMs)
                              : "0:00"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium text-emerald-800">
                            {seg.workedMs > 0
                              ? formatDuration(seg.workedMs)
                              : "0:00"}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 border-border/80 bg-slate-50/60 font-medium hover:bg-slate-50/60">
                        <TableCell
                          colSpan={3}
                          className="text-right text-sm text-slate-700"
                        >
                          Totals · {formatAustralianDayShort(viewDayKey)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-amber-800/90">
                          {breakMs > 0 ? formatDuration(breakMs) : "0:00"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-emerald-800">
                          {workedMs > 0 ? formatDuration(workedMs) : "0:00"}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ════════════════════════════════ WEEK TAB ═════════════════════════ */}
        {tab === "week" && (
          <>
            {/* Weekly totals summary */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-4 shadow-sm">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-700">
                  Week total (worked)
                </div>
                <div className="mt-2 font-mono text-2xl font-semibold text-emerald-700">
                  {weekLoading
                    ? "…"
                    : weekTotalWorkedMs > 0
                      ? formatDuration(weekTotalWorkedMs)
                      : "0:00"}
                </div>
              </div>
              <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-4 shadow-sm">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-700">
                  Week total (break)
                </div>
                <div className="mt-2 font-mono text-2xl font-semibold text-amber-700">
                  {weekLoading
                    ? "…"
                    : weekTotalBreakMs > 0
                      ? formatDuration(weekTotalBreakMs)
                      : "0:00"}
                </div>
              </div>
            </div>

            {weekError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {weekError}
              </div>
            )}

            <div className="rounded-xl border border-border/80 bg-white shadow-sm">
              <div className="border-b border-border/60 bg-slate-50/80 px-4 py-2.5">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Daily breakdown · {formatAustralianDayShort(days[0])} –{" "}
                  {formatAustralianDayShort(days[6])}
                </div>
              </div>
              {weekLoading ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Loading…
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Day
                        </TableHead>
                        <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Date
                        </TableHead>
                        <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                          Clock in
                        </TableHead>
                        <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                          Clock out
                        </TableHead>
                        <TableHead className="text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Break
                        </TableHead>
                        <TableHead className="text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                          Working hrs
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {weekRows.map((row) => (
                        <TableRow
                          key={row.dayKey}
                          className={
                            row.isToday
                              ? "bg-emerald-50/40 hover:bg-emerald-50/60"
                              : row.isFuture
                                ? "opacity-40"
                                : ""
                          }
                        >
                          <TableCell className="font-mono text-sm font-medium text-slate-800">
                            <span className="flex items-center gap-1.5">
                              {row.label}
                              {row.isToday && (
                                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  Today
                                </span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {formatAustralianDayShort(row.dayKey)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {row.clockIn != null ? (
                              formatTimeAuShort(row.clockIn)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {row.clockIn == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : row.clockOut == null ? (
                              <span className="text-amber-700">Open</span>
                            ) : (
                              formatTimeAuShort(row.clockOut)
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-amber-800/90">
                            {row.breakMs > 0
                              ? formatDuration(row.breakMs)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium text-emerald-800">
                            {row.workedMs > 0
                              ? formatDuration(row.workedMs)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Totals row */}
                      <TableRow className="border-t-2 border-border/80 bg-slate-50/60 font-medium hover:bg-slate-50/60">
                        <TableCell
                          colSpan={4}
                          className="text-right text-sm text-slate-700"
                        >
                          Week totals
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-amber-800/90">
                          {weekTotalBreakMs > 0
                            ? formatDuration(weekTotalBreakMs)
                            : "0:00"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-emerald-800">
                          {weekTotalWorkedMs > 0
                            ? formatDuration(weekTotalWorkedMs)
                            : "0:00"}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Week runs Mon–Sun (Australia/Melbourne time). Today's hours update
              live.
              {!isCurrentWeek &&
                " Navigate to the current week to clock in or out."}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
