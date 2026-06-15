import type { Call, CallResult } from '@/services/types';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'cc_linkus_call_log_v1';
const MAX_ENTRIES = 80;
const AGENT_SESSION_KEY = 'cc_agent_session_v1';

export type CachedAgentSession = {
  agentId: string;
  agentName: string;
  tenantId: string;
  queueId: string;
  queueName: string;
  tenantName: string;
};

export function cacheAgentSession(info: CachedAgentSession): void {
  try { localStorage.setItem(AGENT_SESSION_KEY, JSON.stringify(info)); } catch { /* private mode */ }
}

export function getCachedAgentSession(): CachedAgentSession | null {
  try {
    const raw = localStorage.getItem(AGENT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAgentSession;
    return parsed.agentId && parsed.agentName ? parsed : null;
  } catch { return null; }
}

export const LINKUS_CALL_LOG_EVENT = 'cc:linkus-call-log-updated';

/** Ask `useDashboardData` to refetch (after softphone disposition write). */
export const DASHBOARD_REFRESH_REQUEST_EVENT = 'cc:dashboard-refresh-request';

/**
 * Clears the dashboard incoming-call row immediately when the Linkus leg ends
 * (reject/hangup before CDR / CallHangup). Detail matches {@link dismissIncomingCallOnDashboard}.
 */
export const DASHBOARD_DISMISS_INCOMING_CALLER_EVENT =
  'cc-dashboard-dismiss-incoming-caller';

export type DashboardDismissIncomingDetail = {
  linkusCallId?: string;
  callerNumber?: string;
  tenantId?: string;
};

export function dismissIncomingCallOnDashboard(
  detail: DashboardDismissIncomingDetail,
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(DASHBOARD_DISMISS_INCOMING_CALLER_EVENT, {
      detail,
    }),
  );
}

export type LinkusSessionEndPayload = {
  callId: string;
  direction: 'inbound' | 'outbound';
  number: string;
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  lastCallStatus: 'ringing' | 'calling' | 'talking' | 'connecting';
};

export type SoftphoneCallLogContext = {
  tenantId: string;
  tenantName: string;
  agentId: string | null;
  agentName: string;
  queueId: string;
  queueName: string;
};

/** Fired when the user taps Answer or Reject on an incoming Linkus call (best-effort sync to `calls`). */
export type LinkusCallDispositionPayload = {
  callId: string;
  action: 'answered' | 'rejected';
  number: string;
  name: string;
  direction: 'inbound' | 'outbound';
};

/** PBX CDR rows use `yeastar-<pbx_call_id>`; Linkus `callId` usually matches that `pbx_call_id`. */
export function yeastarCallRowId(linkusCallId: string): string {
  const base = linkusCallId.split('@')[0]?.trim() || linkusCallId;
  return `yeastar-${base}`;
}

function yeastarRowIdFromLocalLinkusCallId(localId: string): string | null {
  if (localId.startsWith('yeastar-')) return localId;
  if (!localId.startsWith('linkus-')) return null;
  const withoutPrefix = localId.slice('linkus-'.length);
  const linkusCallId = withoutPrefix.replace(/-\d{10,}$/, '').trim();
  return linkusCallId ? yeastarCallRowId(linkusCallId) : null;
}

type UntypedSb = {
  from: (table: string) => {
    upsert: (
      rows: Record<string, unknown>,
      opts?: { onConflict?: string },
    ) => Promise<{ error: { message: string; code?: string } | null }>;
  };
};

/**
 * 1) Upsert `softphone_call_dispositions` (always works if RLS + agents.user_id are set).
 * 2) Best-effort patch `calls` (same as PBX row id when ids align).
 */
export async function syncLinkusCallDispositionToSupabase(
  ctx: SoftphoneCallLogContext,
  p: LinkusCallDispositionPayload,
): Promise<void> {
  const cached = getCachedAgentSession();
  const agentId = ctx.agentId?.trim() || cached?.agentId?.trim();
  const agentName = ctx.agentName || cached?.agentName || '';
  const tenantId = ctx.tenantId || cached?.tenantId || '';
  const queueId = ctx.queueId || cached?.queueId || '';
  if (!agentId || !tenantId || !queueId) return;

  const linkusKey = p.callId.split('@')[0]?.trim() || p.callId;
  const callerDigits =
    digitsOnly(p.number) || String(p.number ?? '').trim();
  if (p.direction === 'inbound' && !callerDigits) return;

  const sb = supabase as unknown as UntypedSb;
  const { error: dispErr } = await sb.from('softphone_call_dispositions').upsert(
    {
      linkus_call_id: linkusKey,
      agent_id: agentId,
      agent_name: agentName,
      tenant_id: tenantId,
      action: p.action,
      caller_number: callerDigits,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'linkus_call_id' },
  );

  if (dispErr) {
    console.warn('[linkusCallLog] softphone_call_dispositions upsert failed', dispErr.message);
  }

  const rowId = yeastarCallRowId(linkusKey);
  const { data: updatedRows, error: updErr } = await supabase
    .from('calls')
    .update({ agent_id: agentId })
    .eq('id', rowId)
    .select('id');

  if (updErr) {
    console.warn('[linkusCallLog] calls disposition update failed', updErr.message);
  } else if (updatedRows && updatedRows.length > 0) {
    window.dispatchEvent(new CustomEvent(DASHBOARD_REFRESH_REQUEST_EVENT));
    return;
  }

  if (p.direction !== 'inbound') {
    window.dispatchEvent(new CustomEvent(DASHBOARD_REFRESH_REQUEST_EVENT));
    return;
  }

  const { error: insErr } = await supabase.from('calls').insert({
    id: rowId,
    tenant_id: tenantId,
    queue_id: queueId,
    agent_id: agentId,
    caller_number: callerDigits,
    caller_name: p.name?.trim() || null,
    direction: 'inbound',
    start_time: new Date().toISOString(),
    duration_seconds: 0,
    result: p.action === 'answered' ? 'answered' : 'missed',
    transcript_status: 'none',
    summary_status: 'none',
  });

  if (insErr && insErr.code === '23505') {
    await supabase.from('calls').update({ agent_id: agentId, result: p.action === 'answered' ? 'answered' : 'missed' }).eq('id', rowId);
  } else if (insErr) {
    console.warn('[linkusCallLog] calls stub insert failed', insErr.message);
  }

  window.dispatchEvent(new CustomEvent(DASHBOARD_REFRESH_REQUEST_EVENT));
}

function digitsOnly(num: string): string {
  return String(num ?? '').replace(/\D/g, '');
}

function endResult(last: LinkusSessionEndPayload['lastCallStatus']): CallResult {
  if (last === 'talking') return 'answered';
  return 'missed';
}

export function buildCallFromLinkusSessionEnd(
  ctx: SoftphoneCallLogContext,
  p: LinkusSessionEndPayload,
): Call {
  const cached = getCachedAgentSession();
  const answered = p.lastCallStatus === 'talking';
  const durationSeconds = Math.max(
    0,
    Math.round((p.endTimeMs - p.startTimeMs) / 1000),
  );
  const digits = p.number.replace(/\D/g, '');
  const callerNumber = digits || p.number.trim();

  return {
    id: `linkus-${p.callId}-${p.endTimeMs}`,
    tenantId: ctx.tenantId || cached?.tenantId || '',
    queueId: ctx.queueId || cached?.queueId || '',
    agentId: ctx.agentId || cached?.agentId || null,
    direction: p.direction,
    callerNumber,
    callerName: p.name?.trim() ? p.name : null,
    dialedNumber: null,
    startTime: new Date(p.startTimeMs).toISOString(),
    answerTime: answered ? new Date(p.startTimeMs).toISOString() : null,
    endTime: new Date(p.endTimeMs).toISOString(),
    durationSeconds,
    result: endResult(p.lastCallStatus),
    recordingUrl: null,
    transcriptStatus: 'none',
    summaryStatus: 'none',
    agentName: ctx.agentName || cached?.agentName || '',
    queueName: ctx.queueName || cached?.queueName || '',
    tenantName: ctx.tenantName || cached?.tenantName || '',
  };
}

export function readLinkusCallLog(): Call[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Call[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendLinkusCallLog(entry: Call): void {
  try {
    const prev = readLinkusCallLog();
    const next = [entry, ...prev].slice(0, MAX_ENTRIES);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(LINKUS_CALL_LOG_EVENT));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Persist a finished Linkus call into Supabase `calls` so it survives refreshes
 * and appears in the canonical Calls history.
 */
export async function appendLinkusCallToSupabase(entry: Call): Promise<void> {
  const tenantId = String(entry.tenantId ?? '').trim();
  const queueId = String(entry.queueId ?? '').trim();
  const callerNumber = String(entry.callerNumber ?? '').trim();
  if (!tenantId || !queueId || !callerNumber) {
    // console.warn('[linkusCallLog] Skipping Supabase insert (missing required fields)', {
    //   tenantId,
    //   queueId,
    //   callerNumber,
    // });
    return;
  }

  const rowId = yeastarRowIdFromLocalLinkusCallId(entry.id);
  const payload: Record<string, unknown> = {
    ...(rowId ? { id: rowId } : {}),
    tenant_id: tenantId,
    queue_id: queueId,
    agent_id: entry.agentId ?? null,
    direction: entry.direction,
    caller_number: callerNumber,
    caller_name: entry.callerName ?? null,
    dialed_number: entry.dialedNumber ?? null,
    start_time: entry.startTime,
    answer_time: entry.answerTime ?? null,
    end_time: entry.endTime ?? null,
    duration_seconds: entry.durationSeconds ?? 0,
    result: entry.result,
    recording_url: entry.recordingUrl ?? null,
    transcript_status: entry.transcriptStatus,
    summary_status: entry.summaryStatus,
  };

  // Some environments may lag migrations. Retry insert by removing unknown
  // columns reported by PostgREST until the row can be saved.
  const dynamicPayload: Record<string, unknown> = { ...payload };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { error } = await supabase.from('calls').insert(dynamicPayload);
    if (!error) return;

    const message = String(error.message ?? '');
    const unknownColumnMatch = message.match(/'([^']+)' column/);
    const unknownColumn = unknownColumnMatch?.[1];
    if (error.code === 'PGRST204' && unknownColumn && unknownColumn in dynamicPayload) {
      delete dynamicPayload[unknownColumn];
      continue;
    }

    // console.error('[linkusCallLog] Failed to insert Linkus call in Supabase', error);
    return;
  }
}

/** Same caller across +country / 0-local / raw formats. */
function callerNumbersLikelySame(a: string, b: string): boolean {
  const na = digitsOnly(a);
  const nb = digitsOnly(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.endsWith(nb) || nb.endsWith(na);
}

/**
 * Prefer PBX for most fields; for agent, trust the softphone row when it identifies
 * an agent — CDR often attributes `call_to` to queue / first-rung extension, not who answered.
 */
function mergeLinkusIntoServer(s: Call, l: Call): Call {
  const linkusAgentKnown = l.agentId != null && l.agentName && l.agentName !== '—';
  return {
    ...s,
    agentId: linkusAgentKnown ? l.agentId : (s.agentId ?? l.agentId),
    agentName: linkusAgentKnown ? l.agentName : (s.agentName && s.agentName !== '—' ? s.agentName : l.agentName),
    dialedNumber: s.dialedNumber ?? l.dialedNumber,
    pbxCallId: s.pbxCallId ?? l.pbxCallId,
    callToExtension: s.callToExtension ?? l.callToExtension,
    callerName: s.callerName ?? l.callerName,
    recordingUrl: s.recordingUrl ?? l.recordingUrl,
  };
}

function isServerRowForLinkusSession(s: Call, l: Call, windowMs: number): boolean {
  if (s.direction !== l.direction) return false;
  if (!callerNumbersLikelySame(s.callerNumber, l.callerNumber)) return false;
  const a = new Date(s.startTime).getTime();
  const b = new Date(l.startTime).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < windowMs;
}

/** Merge PBX `calls` with browser Linkus log: one row per call when CDR + softphone match; enrich agent from softphone when PBX row is missing it. */
export function mergeCallsWithLinkusLog(server: Call[], local: Call[]): Call[] {
  const windowMs = 3 * 60_000;
  const linkusLocals = local.filter((l) => l.id.startsWith('linkus-'));
  const consumedLinkus = new Set<string>();

  const mergedServer = server.map((s) => {
    let best: Call | null = null;
    let bestDelta = Infinity;
    for (const l of linkusLocals) {
      if (consumedLinkus.has(l.id)) continue;
      if (!isServerRowForLinkusSession(s, l, windowMs)) continue;
      const delta = Math.abs(
        new Date(s.startTime).getTime() - new Date(l.startTime).getTime(),
      );
      if (delta < bestDelta) {
        bestDelta = delta;
        best = l;
      }
    }
    if (!best) return s;
    consumedLinkus.add(best.id);
    return mergeLinkusIntoServer(s, best);
  });

  const leftover = linkusLocals.filter((l) => !consumedLinkus.has(l.id));
  const out = [...mergedServer, ...leftover];

  return out.sort(
    (a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );
}
