import {
  attendanceDayRangeAustralianYmd,
  AU_DASHBOARD_TIMEZONE,
  getAustralianDateKey,
} from "@/utils/australianTime";
import { supabase } from "@/integrations/supabase/client";
import { API_BASE, apiFetch, getAccessToken } from "@/lib/api";
import {
  AUDIT_ACTION_ATTENDANCE_CLOCK_IN,
  AUDIT_ACTION_ATTENDANCE_CLOCK_OUT,
  AUDIT_ACTION_SHIFT_SCHEDULE_UPDATE,
  postSystemAuditLog,
} from "./auditLogApi";
import type { AgentShiftSchedule } from "./types";
import { startOfDay, endOfDay } from "date-fns";

const AGENT_ATTENDANCE_API_URL =
  (import.meta.env.VITE_AGENT_ATTENDANCE_API_URL as string | undefined)?.trim().replace(/\/+$/, "") ||
  `${API_BASE}/agent-attendance`;

const AGENT_SHIFT_SCHEDULES_API_URL =
  (import.meta.env.VITE_AGENT_SHIFT_SCHEDULES_API_URL as string | undefined)?.trim().replace(/\/+$/, "") ||
  `${API_BASE}/agent-shift-schedules`;

const SHIFT_SCHEDULE_QUEUE_ASSIGNMENTS_STORAGE_KEY = "cc_shift_schedule_queue_assignments_v1";

export const ATTENDANCE_EVENT_TYPES = [
  "clock_in",
  "break_start",
  "break_end",
  "clock_out",
] as const;

export type AttendanceEventType = (typeof ATTENDANCE_EVENT_TYPES)[number];

export type AgentAttendanceEventRow = {
  id: string;
  user_id: string;
  tenant_id: string | null;
  agent_display_name: string | null;
  event_type: string;
  occurred_at: string;
  created_at: string;
};

export type AttendanceShiftStatus = "off_clock" | "working" | "on_break";

export type AgentAttendanceStatusResponse = {
  status: AttendanceShiftStatus;
  shiftStartedAt: number | null;
  breakStartedAt: number | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
};

const SHIFT_SCHEDULE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ShiftScheduleDay = (typeof SHIFT_SCHEDULE_DAYS)[number];

/** Melbourne weekday key used by shift schedules (`monday` … `sunday`). */
export function getShiftScheduleWeekday(at: number = Date.now()): ShiftScheduleDay {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: AU_DASHBOARD_TIMEZONE,
    weekday: "long",
  })
    .format(new Date(at))
    .toLowerCase() as ShiftScheduleDay;
}

/**
 * Queue assigned on the shift board for “today” (Melbourne).
 * Returns null when the agent is OFF that day or no queue is set.
 */
export function getTodayShiftQueueId(
  schedule: AgentShiftSchedule | null | undefined,
  at: number = Date.now(),
): string | null {
  if (!schedule) return null;
  const day = getShiftScheduleWeekday(at);
  const todayShift = schedule[day] ?? null;
  if (!todayShift) return null;
  const queueId = schedule.dayQueueIds?.[day]?.trim() || null;
  return queueId || null;
}

type UntypedSupabase = {
  from: (table: string) => UntypedSupabaseQuery;
};

type UntypedSupabaseQuery = PromiseLike<{
  data: Array<Record<string, unknown>> | null;
  error: { message?: string } | null;
}> & {
  select: (...args: unknown[]) => UntypedSupabaseQuery;
  upsert: (...args: unknown[]) => UntypedSupabaseQuery;
  delete: (...args: unknown[]) => UntypedSupabaseQuery;
  eq: (...args: unknown[]) => UntypedSupabaseQuery;
  in: (...args: unknown[]) => UntypedSupabaseQuery;
};

const dynamicSupabase = supabase as unknown as UntypedSupabase;

export function isSupabaseAuthUserId(id: string | null | undefined): boolean {
  if (!id) return false;
  return UUID_RE.test(id);
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
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
  return "";
}

function pickNullableString(
  row: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  const text = pickString(row, keys);
  return text || null;
}

function requireAttendanceAuth(): void {
  if (!getAccessToken()) {
    throw new Error("Sign in with your dashboard account to use attendance.");
  }
}

function attendanceUrl(path: string, params?: Record<string, string | null | undefined>): string {
  const base = AGENT_ATTENDANCE_API_URL.replace(/\/+$/, "");
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`, window.location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    const text = value?.trim();
    if (text) url.searchParams.set(key, text);
  }
  return url.toString();
}

async function attendanceFetch(
  path: string,
  init: RequestInit = {},
  params?: Record<string, string | null | undefined>,
): Promise<Response> {
  requireAttendanceAuth();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return apiFetch(attendanceUrl(path, params), { ...init, headers });
}

function shiftSchedulesUrl(path = ""): string {
  const base = AGENT_SHIFT_SCHEDULES_API_URL.replace(/\/+$/, "");
  const suffix = path.trim() ? (path.startsWith("/") ? path : `/${path}`) : "";
  return new URL(`${base}${suffix}`, window.location.origin).toString();
}

async function shiftSchedulesFetch(path = "", init: RequestInit = {}): Promise<Response> {
  requireAttendanceAuth();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return apiFetch(shiftSchedulesUrl(path), { ...init, headers });
}

function parseTimeMs(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw == null) return null;
  const t = new Date(String(raw)).getTime();
  return Number.isFinite(t) ? t : null;
}

async function readHttpErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  if (!text.trim()) return "";
  try {
    const body = asRecord(JSON.parse(text) as unknown);
    const detail = body.message ?? body.error ?? body.detail;
    return typeof detail === "string" ? detail : text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as unknown) : null;
}

function collectRows(raw: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  const body = asRecord(raw);
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }
  if (Array.isArray(body.data)) return body.data;
  const data = asRecord(body.data);
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeShiftScheduleValue(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text || text.toUpperCase() === "OFF") return null;
  return text;
}

function normalizeShiftScheduleQueueId(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  return text || null;
}

function readLocalShiftScheduleQueueAssignments(): Record<string, Partial<Record<ShiftScheduleDay, string | null>>> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SHIFT_SCHEDULE_QUEUE_ASSIGNMENTS_STORAGE_KEY) ?? "{}",
    ) as unknown;
    const raw = asRecord(parsed);
    return Object.entries(raw).reduce(
      (acc, [agentId, value]) => {
        const dayMap = asRecord(value);
        acc[agentId] = SHIFT_SCHEDULE_DAYS.reduce(
          (days, day) => {
            days[day] = normalizeShiftScheduleQueueId(dayMap[day]);
            return days;
          },
          {} as Partial<Record<ShiftScheduleDay, string | null>>,
        );
        return acc;
      },
      {} as Record<string, Partial<Record<ShiftScheduleDay, string | null>>>,
    );
  } catch {
    return {};
  }
}

function writeLocalShiftScheduleQueueAssignments(
  agentId: string,
  dayQueueIds: Partial<Record<ShiftScheduleDay, string | null>>,
): void {
  if (typeof window === "undefined") return;
  const assignments = readLocalShiftScheduleQueueAssignments();
  assignments[agentId] = {
    ...(assignments[agentId] ?? {}),
    ...dayQueueIds,
  };
  window.localStorage.setItem(
    SHIFT_SCHEDULE_QUEUE_ASSIGNMENTS_STORAGE_KEY,
    JSON.stringify(assignments),
  );
}

function dayQueueKeys(day: (typeof SHIFT_SCHEDULE_DAYS)[number]): string[] {
  const titleDay = `${day[0].toUpperCase()}${day.slice(1)}`;
  return [`${day}QueueId`, `${day}_queue_id`, `${day}Queue`, `${day}_queue`, `queue${titleDay}Id`];
}

function normalizeShiftScheduleDayQueueIds(
  row: Record<string, unknown>,
): Record<(typeof SHIFT_SCHEDULE_DAYS)[number], string | null> {
  const queueMap = asRecord(
    row.dayQueueIds ?? row.day_queue_ids ?? row.queueAssignments ?? row.queue_assignments,
  );

  return SHIFT_SCHEDULE_DAYS.reduce(
    (acc, day) => {
      acc[day] =
        normalizeShiftScheduleQueueId(queueMap[day]) ??
        normalizeShiftScheduleQueueId(queueMap[`${day}QueueId`]) ??
        normalizeShiftScheduleQueueId(queueMap[`${day}_queue_id`]) ??
        pickNullableString(row, dayQueueKeys(day));
      return acc;
    },
    {} as Record<(typeof SHIFT_SCHEDULE_DAYS)[number], string | null>,
  );
}

function normalizeAgentShiftSchedule(raw: unknown): AgentShiftSchedule {
  const row = asRecord(raw);
  const agentId = pickString(row, ["agentId", "agent_id", "agent"]);
  const userId = pickNullableString(row, ["userId", "user_id", "authUserId", "auth_user_id"]);
  const resolvedAgentId = agentId || userId || "";
  return {
    id: pickString(row, ["id", "scheduleId", "schedule_id"]) || resolvedAgentId,
    agentId: resolvedAgentId,
    userId,
    dayQueueIds: normalizeShiftScheduleDayQueueIds(row),
    monday: normalizeShiftScheduleValue(row.monday),
    tuesday: normalizeShiftScheduleValue(row.tuesday),
    wednesday: normalizeShiftScheduleValue(row.wednesday),
    thursday: normalizeShiftScheduleValue(row.thursday),
    friday: normalizeShiftScheduleValue(row.friday),
    saturday: normalizeShiftScheduleValue(row.saturday),
    sunday: normalizeShiftScheduleValue(row.sunday),
    createdAt: pickString(row, ["createdAt", "created_at"]) || undefined,
    updatedAt: pickString(row, ["updatedAt", "updated_at"]) || undefined,
  };
}

function extractShiftSchedules(raw: unknown): AgentShiftSchedule[] {
  return collectRows(raw, [
    "agentShiftSchedules",
    "shiftSchedules",
    "schedules",
    "items",
    "results",
    "rows",
  ])
    .map(normalizeAgentShiftSchedule)
    .filter((row) => row.agentId);
}

function shiftSchedulePayload(
  schedule: Partial<AgentShiftSchedule>,
): Record<string, unknown> {
  const dayQueueIds = {} as Record<ShiftScheduleDay, string | null>;

  const payload = SHIFT_SCHEDULE_DAYS.reduce(
    (acc, day) => {
      const shiftValue = normalizeShiftScheduleValue(schedule[day]);
      const queueId = shiftValue ? normalizeShiftScheduleQueueId(schedule.dayQueueIds?.[day]) : null;
      dayQueueIds[day] = queueId;
      acc[day] = shiftValue;
      acc[`${day}QueueId`] = queueId;
      acc[`${day}_queue_id`] = queueId;
      return acc;
    },
    {} as Record<string, unknown>,
  );

  return {
    ...payload,
    dayQueueIds,
    day_queue_ids: dayQueueIds,
  };
}

function dayQueueIdsFromPayload(payload: Record<string, unknown>): Record<ShiftScheduleDay, string | null> {
  const rawMap = asRecord(payload.dayQueueIds ?? payload.day_queue_ids);
  return SHIFT_SCHEDULE_DAYS.reduce(
    (acc, day) => {
      acc[day] = normalizeShiftScheduleQueueId(rawMap[day]);
      return acc;
    },
    {} as Record<ShiftScheduleDay, string | null>,
  );
}

async function fetchPersistedShiftScheduleQueueAssignments(
  agentIds: string[],
): Promise<Record<string, Partial<Record<ShiftScheduleDay, string | null>>>> {
  const uniqueAgentIds = Array.from(new Set(agentIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueAgentIds.length === 0) return {};
  const localAssignments = readLocalShiftScheduleQueueAssignments();
  const localMatches = uniqueAgentIds.reduce(
    (acc, agentId) => {
      if (localAssignments[agentId]) acc[agentId] = localAssignments[agentId];
      return acc;
    },
    {} as Record<string, Partial<Record<ShiftScheduleDay, string | null>>>,
  );

  let query = dynamicSupabase
    .from("agent_shift_schedules")
    .select(
      "agent_id, monday_queue_id, tuesday_queue_id, wednesday_queue_id, thursday_queue_id, friday_queue_id, saturday_queue_id, sunday_queue_id",
    );
  query = query.in("agent_id", uniqueAgentIds);
  const { data, error } = await query;
  if (error) {
    console.warn("Failed to load persisted shift queue assignments", error.message);
    return localMatches;
  }

  return (data ?? []).reduce(
    (acc, row) => {
      const agentId = pickString(row, ["agent_id", "agentId"]);
      if (!agentId) return acc;
      acc[agentId] = {
        ...(acc[agentId] ?? {}),
        ...SHIFT_SCHEDULE_DAYS.reduce(
          (days, day) => {
            days[day] = normalizeShiftScheduleQueueId(row[`${day}_queue_id`]);
            return days;
          },
          {} as Partial<Record<ShiftScheduleDay, string | null>>,
        ),
      };
      return acc;
    },
    localMatches,
  );
}

function mergePersistedQueueAssignments(
  schedules: AgentShiftSchedule[],
  assignments: Record<string, Partial<Record<ShiftScheduleDay, string | null>>>,
): AgentShiftSchedule[] {
  return schedules.map((schedule) => ({
    ...schedule,
    dayQueueIds: {
      ...(schedule.dayQueueIds ?? {}),
      ...(assignments[schedule.agentId] ?? {}),
    },
  }));
}

async function persistShiftScheduleQueueAssignments(
  agentId: string,
  dayQueueIds: Partial<Record<ShiftScheduleDay, string | null>>,
): Promise<void> {
  writeLocalShiftScheduleQueueAssignments(agentId, dayQueueIds);
  const row = SHIFT_SCHEDULE_DAYS.reduce(
    (acc, day) => {
      acc[`${day}_queue_id`] = normalizeShiftScheduleQueueId(dayQueueIds[day]);
      return acc;
    },
    {
      agent_id: agentId,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>,
  );
  const { error } = await dynamicSupabase
    .from("agent_shift_schedules")
    .upsert(row, { onConflict: "agent_id" });
  if (error) {
    console.warn("Failed to persist shift queue assignments", error.message);
  }
}

function extractShiftSchedule(
  raw: unknown,
  fallbackAgentId: string,
  fallbackPayload: Record<string, unknown>,
): AgentShiftSchedule {
  const fallbackSchedule = { agentId: fallbackAgentId, ...fallbackPayload };
  const body = asRecord(raw);
  for (const key of ["agentShiftSchedule", "shiftSchedule", "schedule", "data", "item", "row", "result"]) {
    const value = body[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const schedule = normalizeAgentShiftSchedule(value);
      return schedule.agentId ? schedule : normalizeAgentShiftSchedule(fallbackSchedule);
    }
  }

  const direct = normalizeAgentShiftSchedule(raw);
  if (direct.agentId) return direct;
  return normalizeAgentShiftSchedule(fallbackSchedule);
}

function normalizeAttendanceEvent(raw: unknown): AgentAttendanceEventRow {
  const row = asRecord(raw);
  const occurredAt =
    pickString(row, ["occurred_at", "occurredAt", "timestamp", "created_at", "createdAt"]) ||
    new Date().toISOString();
  const eventType = pickString(row, ["event_type", "eventType", "type"]);
  return {
    id:
      pickString(row, ["id", "eventId", "event_id"]) ||
      `${pickString(row, ["user_id", "userId", "agentId", "agent_id"])}-${eventType}-${occurredAt}`,
    user_id: pickString(row, ["user_id", "userId", "agentId", "agent_id"]),
    tenant_id: pickNullableString(row, ["tenant_id", "tenantId"]),
    agent_display_name: pickNullableString(row, [
      "agent_display_name",
      "agentDisplayName",
      "agentName",
      "displayName",
    ]),
    event_type: eventType,
    occurred_at: occurredAt,
    created_at: pickString(row, ["created_at", "createdAt"]) || occurredAt,
  };
}

function extractEvents(raw: unknown): AgentAttendanceEventRow[] {
  return collectRows(raw, ["events", "attendanceEvents", "items", "results", "rows"])
    .map(normalizeAttendanceEvent)
    .filter((row) => row.user_id && ATTENDANCE_EVENT_TYPES.includes(row.event_type as AttendanceEventType))
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
}

function filterEventsForRange(
  events: AgentAttendanceEventRow[],
  startIso: string,
  endIso: string,
  userId?: string,
): AgentAttendanceEventRow[] {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  return events.filter((event) => {
    const t = new Date(event.occurred_at).getTime();
    if (Number.isFinite(startMs) && t < startMs) return false;
    if (Number.isFinite(endMs) && t > endMs) return false;
    if (userId && event.user_id !== userId) return false;
    return true;
  });
}

async function fetchAttendanceEventsFromApi(params: {
  userId?: string | null;
  startIso?: string;
  endIso?: string;
} = {}): Promise<AgentAttendanceEventRow[]> {
  const res = await attendanceFetch("/events", {}, {
    userId: params.userId,
    from: params.startIso,
    to: params.endIso,
  });
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`Attendance events API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  return extractEvents(await readJsonBody(res));
}

export async function fetchAttendanceStatus(userId?: string | null): Promise<AgentAttendanceStatusResponse> {
  const res = await attendanceFetch("/status", {}, { userId });
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`Attendance status API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  const body = asRecord(await readJsonBody(res));
  const statusRaw = pickString(body, ["status", "shiftStatus"]);
  const statusKey = statusRaw.trim().toLowerCase().replace(/[-\s]/g, "_");
  const status: AttendanceShiftStatus =
    ["working", "on_shift", "clocked_in", "clock_in", "active"].includes(statusKey)
      ? "working"
      : ["on_break", "break", "break_start"].includes(statusKey)
        ? "on_break"
        : "off_clock";
  const shiftStartedAtRaw = body.shiftStartedAt ?? body.shift_started_at;
  const breakStartedAtRaw = body.breakStartedAt ?? body.break_started_at;
  return {
    status,
    shiftStartedAt: parseTimeMs(shiftStartedAtRaw),
    breakStartedAt: parseTimeMs(breakStartedAtRaw),
    lastEventType: pickNullableString(body, ["lastEventType", "last_event_type"]),
    lastEventAt: pickNullableString(body, ["lastEventAt", "last_event_at"]),
  };
}

function attendanceAuditAction(eventType: AttendanceEventType): string | null {
  if (eventType === "clock_in") return AUDIT_ACTION_ATTENDANCE_CLOCK_IN;
  if (eventType === "clock_out") return AUDIT_ACTION_ATTENDANCE_CLOCK_OUT;
  return null;
}

function logAttendanceAuditEvent(
  eventType: AttendanceEventType,
  details: Record<string, unknown> = {},
): void {
  const action = attendanceAuditAction(eventType);
  if (!action) return;
  const agentId = typeof details.agentId === "string" ? details.agentId : undefined;
  void postSystemAuditLog({
    action,
    resourceType: "agent_attendance",
    resourceId: agentId,
    details: {
      eventType,
      ...details,
    },
  }).catch(() => {});
}

async function postAttendanceEvent(
  eventType: AttendanceEventType,
  auditDetails?: Record<string, unknown>,
): Promise<Response> {
  const res = await attendanceFetch("/events", {
    method: "POST",
    body: JSON.stringify({ eventType }),
  });
  if (res.ok) {
    logAttendanceAuditEvent(eventType, auditDetails);
  }
  return res;
}

function isBeforeTodayMelbourne(ms: number | null): boolean {
  if (ms == null || !Number.isFinite(ms)) return false;
  return getAustralianDateKey(ms) < getAustralianDateKey(Date.now());
}

async function deriveOpenShiftFromEvents(): Promise<{
  status: AttendanceShiftStatus;
  openSince: number | null;
}> {
  const events = await fetchAttendanceEventsFromApi().catch(() => []);
  const status = deriveAttendanceShiftStatus(events);
  return {
    status: status.status,
    openSince: status.shiftStartedAt ?? status.breakStartedAt,
  };
}

async function closeStaleOpenShiftIfNeeded(options?: {
  /**
   * Used only after the backend rejects clock_in with "while on shift".
   * If the backend does not expose any timestamp, close the open shift so the agent can start today.
   */
  closeWhenTimestampUnknown?: boolean;
}): Promise<boolean> {
  const status = await fetchAttendanceStatus();
  if (status.status === "off_clock") return false;

  const lastEventMs = parseTimeMs(status.lastEventAt);
  let currentStatus = status.status;
  let openSince = status.shiftStartedAt ?? status.breakStartedAt ?? lastEventMs;

  if (openSince == null) {
    const fromEvents = await deriveOpenShiftFromEvents();
    if (fromEvents.status !== "off_clock") {
      currentStatus = fromEvents.status;
      openSince = fromEvents.openSince;
    }
  }

  if (!isBeforeTodayMelbourne(openSince)) {
    if (openSince != null || !options?.closeWhenTimestampUnknown) return false;
  }

  if (currentStatus === "on_break") {
    const endBreak = await postAttendanceEvent("break_end", { autoClosedStaleShift: true });
    if (!endBreak.ok) {
      const detail = await readHttpErrorDetail(endBreak);
      throw new Error(`Auto end-break failed: ${endBreak.status}${detail ? ` - ${detail}` : ""}`);
    }
  }

  const clockOut = await postAttendanceEvent("clock_out", { autoClosedStaleShift: true });
  if (!clockOut.ok) {
    const detail = await readHttpErrorDetail(clockOut);
    throw new Error(`Auto clock-out failed: ${clockOut.status}${detail ? ` - ${detail}` : ""}`);
  }

  return true;
}

async function closeBackendOpenShiftFromConflict(detail: string): Promise<boolean> {
  const canClockOut = /allowed next:.*clock_out|clock_out/i.test(detail);
  const canEndBreak = /allowed next:.*break_end|break_end/i.test(detail);

  if (canEndBreak) {
    const endBreak = await postAttendanceEvent("break_end", { resolvedBackendConflict: true });
    if (!endBreak.ok && endBreak.status !== 409) return false;
  }

  if (!canClockOut && !canEndBreak) return false;

  const clockOut = await postAttendanceEvent("clock_out", { resolvedBackendConflict: true });
  return clockOut.ok;
}

/** Melbourne calendar day bounds from a Date instant or yyyy-MM-dd day key. */
export function attendanceDayRange(
  day: Date | string,
): { startIso: string; endIso: string } {
  const ymd =
    typeof day === "string" ? day : getAustralianDateKey(day.getTime());
  return attendanceDayRangeAustralianYmd(ymd);
}

export function deriveAttendanceShiftStatus(
  events: Pick<AgentAttendanceEventRow, "event_type" | "occurred_at">[],
): {
  status: AttendanceShiftStatus;
  shiftStartedAt: number | null;
  breakStartedAt: number | null;
} {
  const sorted = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );
  let status: AttendanceShiftStatus = "off_clock";
  let shiftStartedAt: number | null = null;
  let breakStartedAt: number | null = null;

  for (const e of sorted) {
    const t = new Date(e.occurred_at).getTime();
    switch (e.event_type) {
      case "clock_in":
        status = "working";
        shiftStartedAt = t;
        breakStartedAt = null;
        break;
      case "break_start":
        if (status === "working") {
          status = "on_break";
          breakStartedAt = t;
        }
        break;
      case "break_end":
        if (status === "on_break") {
          status = "working";
          breakStartedAt = null;
        }
        break;
      case "clock_out":
        status = "off_clock";
        shiftStartedAt = null;
        breakStartedAt = null;
        break;
      default:
        break;
    }
  }

  return { status, shiftStartedAt, breakStartedAt };
}

/** Worked time excludes active break; includes in-progress work segment to `nowMs`. */
export function computeWorkedAndBreakMs(
  events: Pick<AgentAttendanceEventRow, "event_type" | "occurred_at">[],
  nowMs: number,
): { workedMs: number; breakMs: number } {
  const sorted = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );
  let worked = 0;
  let onBreak = 0;
  let shiftOpen = false;
  let workSegmentStart: number | null = null;
  let breakStart: number | null = null;

  const closeWorkTo = (t: number) => {
    if (workSegmentStart !== null) {
      worked += t - workSegmentStart;
      workSegmentStart = null;
    }
  };

  for (const e of sorted) {
    const t = new Date(e.occurred_at).getTime();
    switch (e.event_type) {
      case "clock_in":
        shiftOpen = true;
        workSegmentStart = t;
        breakStart = null;
        break;
      case "break_start":
        if (shiftOpen && workSegmentStart !== null) {
          closeWorkTo(t);
          breakStart = t;
        }
        break;
      case "break_end":
        if (breakStart !== null) {
          onBreak += t - breakStart;
          breakStart = null;
          workSegmentStart = t;
        }
        break;
      case "clock_out":
        if (breakStart !== null) {
          onBreak += t - breakStart;
          breakStart = null;
        }
        closeWorkTo(t);
        shiftOpen = false;
        break;
      default:
        break;
    }
  }

  if (shiftOpen) {
    if (breakStart !== null) {
      onBreak += nowMs - breakStart;
    } else if (workSegmentStart !== null) {
      worked += nowMs - workSegmentStart;
    }
  }

  return { workedMs: worked, breakMs: onBreak };
}

/** One row per clock_in → clock_out (or open shift to `nowMs`). */
export type AttendanceDaySegment = {
  clockInMs: number;
  clockOutMs: number | null;
  breakMs: number;
  workedMs: number;
};

/**
 * Build shift segments for a single day from events. Each segment starts at `clock_in` and ends at
 * `clock_out`, or is still open (clockOutMs null) until `nowMs`.
 */
export function buildAttendanceDaySegments(
  events: Pick<AgentAttendanceEventRow, "event_type" | "occurred_at">[],
  nowMs: number,
): AttendanceDaySegment[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );
  const segments: AttendanceDaySegment[] = [];
  let shiftStart: number | null = null;
  let breakAccum = 0;
  let breakOpen: number | null = null;

  const pushOpenShiftTo = (endT: number) => {
    if (shiftStart === null) return;
    let b = breakAccum;
    if (breakOpen !== null) b += endT - breakOpen;
    const span = endT - shiftStart;
    const worked = Math.max(0, span - b);
    segments.push({
      clockInMs: shiftStart,
      clockOutMs: null,
      breakMs: b,
      workedMs: worked,
    });
  };

  const closeShiftAt = (endT: number) => {
    if (shiftStart === null) return;
    let b = breakAccum;
    if (breakOpen !== null) {
      b += endT - breakOpen;
      breakOpen = null;
    }
    const span = endT - shiftStart;
    const worked = Math.max(0, span - b);
    segments.push({
      clockInMs: shiftStart,
      clockOutMs: endT,
      breakMs: b,
      workedMs: worked,
    });
    shiftStart = null;
    breakAccum = 0;
  };

  for (const e of sorted) {
    const t = new Date(e.occurred_at).getTime();
    switch (e.event_type) {
      case "clock_in":
        if (shiftStart !== null) {
          closeShiftAt(t);
        }
        shiftStart = t;
        breakAccum = 0;
        breakOpen = null;
        break;
      case "break_start":
        if (shiftStart !== null && breakOpen === null) breakOpen = t;
        break;
      case "break_end":
        if (breakOpen !== null) {
          breakAccum += t - breakOpen;
          breakOpen = null;
        }
        break;
      case "clock_out":
        closeShiftAt(t);
        break;
      default:
        break;
    }
  }

  if (shiftStart !== null) {
    pushOpenShiftTo(nowMs);
  }

  return segments;
}

export async function fetchAttendanceEventsForDay(
  userId: string,
  day: Date | string,
): Promise<AgentAttendanceEventRow[]> {
  const { startIso, endIso } = attendanceDayRange(day);
  const apiUserId = isSupabaseAuthUserId(userId) ? undefined : userId;
  const rows = await fetchAttendanceEventsFromApi({
    userId: apiUserId,
    startIso,
    endIso,
  });
  return filterEventsForRange(rows, startIso, endIso, apiUserId);
}

export async function fetchAllAttendanceEventsForDay(
  day: Date | string,
): Promise<AgentAttendanceEventRow[]> {
  const { startIso, endIso } = attendanceDayRange(day);
  const rows = await fetchAttendanceEventsFromApi({ startIso, endIso });
  return filterEventsForRange(rows, startIso, endIso);
}

/** Fetch all attendance events for any arbitrary date range (used for weekly/monthly views). */
export async function fetchAllAttendanceEventsForRange(
  rangeStart: Date,
  rangeEnd: Date,
): Promise<AgentAttendanceEventRow[]> {
  const startIso = startOfDay(rangeStart).toISOString();
  const endIso = endOfDay(rangeEnd).toISOString();
  const rows = await fetchAttendanceEventsFromApi({ startIso, endIso });
  return filterEventsForRange(rows, startIso, endIso);
}

export async function insertAttendanceEvent(
  eventType: AttendanceEventType,
  opts: {
    userId: string;
    tenantId: string | null;
    displayName: string;
  },
): Promise<void> {
  void opts;
  if (eventType === "clock_in") {
    await closeStaleOpenShiftIfNeeded();
  }

  const auditDetails = {
    agentId: opts.userId,
    tenantId: opts.tenantId,
    displayName: opts.displayName,
  };

  const res = await postAttendanceEvent(eventType, auditDetails);
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    if (
      eventType === "clock_in" &&
      res.status === 409 &&
      /while on shift|allowed next/i.test(detail) &&
      ((await closeStaleOpenShiftIfNeeded({ closeWhenTimestampUnknown: true })) ||
        (await closeBackendOpenShiftFromConflict(detail)))
    ) {
      const retry = await postAttendanceEvent(eventType, {
        ...auditDetails,
        retriedAfterStaleShiftClose: true,
      });
      if (retry.ok) return;
      const retryDetail = await readHttpErrorDetail(retry);
      throw new Error(
        `Attendance event API failed: ${retry.status}${retryDetail ? ` - ${retryDetail}` : ""}`,
      );
    }
    throw new Error(`Attendance event API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
}

export async function ensureClockedOut(opts: {
  userId: string;
  tenantId: string | null;
  displayName: string;
}): Promise<void> {
  void opts;
  const { status } = await fetchAttendanceStatus().catch(() => ({
    status: "off_clock" as AttendanceShiftStatus,
  }));
  if (status === "off_clock") return;
  if (status === "on_break") {
    await postAttendanceEvent("break_end", {
      agentId: opts.userId,
      tenantId: opts.tenantId,
      displayName: opts.displayName,
      autoClockOutOnSignOut: true,
    }).catch(() => {});
  }
  await postAttendanceEvent("clock_out", {
    agentId: opts.userId,
    tenantId: opts.tenantId,
    displayName: opts.displayName,
    autoClockOutOnSignOut: true,
  }).catch(() => {});
}


export function subscribeToMyAttendanceEvents(
  userId: string,
  onEvent: (row: AgentAttendanceEventRow) => void,
  channelSuffix?: string,
): () => void {
  const channel = supabase
    .channel(`attendance-self-${userId}${channelSuffix ? `-${channelSuffix}` : ""}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "agent_attendance_events",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as AgentAttendanceEventRow;
        if (row) onEvent(row);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToAllAttendanceInserts(
  onInsert: (row: AgentAttendanceEventRow) => void,
): () => void {
  const channel = supabase
    .channel("attendance-super-admin")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "agent_attendance_events",
      },
      (payload) => {
        const row = payload.new as AgentAttendanceEventRow;
        if (row) onInsert(row);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function fetchAgentShiftSchedules(): Promise<AgentShiftSchedule[]> {
  const res = await shiftSchedulesFetch();
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`Shift schedules API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  const schedules = extractShiftSchedules(await readJsonBody(res));
  const assignments = await fetchPersistedShiftScheduleQueueAssignments(
    schedules.map((schedule) => schedule.agentId),
  );
  return mergePersistedQueueAssignments(schedules, assignments);
}

type MyShiftScheduleLookup =
  | string
  | string[]
  | {
      agentId?: string | null;
      userId?: string | null;
      candidateIds?: Array<string | null | undefined>;
    };

function shiftScheduleLookupIds(lookup: MyShiftScheduleLookup): string[] {
  const rawIds =
    typeof lookup === "string"
      ? [lookup]
      : Array.isArray(lookup)
        ? lookup
        : [lookup.agentId, lookup.userId, ...(lookup.candidateIds ?? [])];

  return Array.from(
    new Set(
      rawIds
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  );
}

export async function fetchMyShiftSchedule(lookup: MyShiftScheduleLookup): Promise<AgentShiftSchedule | null> {
  const schedules = await fetchAgentShiftSchedules();
  const ids = shiftScheduleLookupIds(lookup);

  const match = schedules.find((schedule) =>
    ids.some((id) => schedule.agentId === id || schedule.userId === id),
  );
  if (match) return match;

  // Agent tokens may receive only their own schedule even if the row uses an
  // internal agent id that the agent-only dashboard cannot load separately.
  return schedules.length === 1 ? schedules[0] : null;
}

export async function upsertAgentShiftSchedule(
  schedule: Partial<AgentShiftSchedule> & { agentId: string },
): Promise<AgentShiftSchedule> {
  if (!schedule.agentId?.trim()) {
    throw new Error("Choose an agent before saving a shift schedule.");
  }

  const agentId = schedule.agentId.trim();
  const payload = shiftSchedulePayload(schedule);
  const dayQueueIds = dayQueueIdsFromPayload(payload);
  const res = await shiftSchedulesFetch(`/${encodeURIComponent(agentId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(`Shift schedule API failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }

  const saved = extractShiftSchedule(await readJsonBody(res), agentId, payload);
  await persistShiftScheduleQueueAssignments(agentId, dayQueueIds);
  const savedWithPersistedQueues = {
    ...saved,
    dayQueueIds: {
      ...(saved.dayQueueIds ?? {}),
      ...dayQueueIds,
    },
  };
  void postSystemAuditLog({
    action: AUDIT_ACTION_SHIFT_SCHEDULE_UPDATE,
    resourceType: "agent_shift_schedule",
    resourceId: agentId,
    details: { schedule: payload },
  }).catch(() => {});
  return savedWithPersistedQueues;
}
