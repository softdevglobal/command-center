/**
 * ═══════════════════════════════════════════════════════════
 * Yeastar PBX Service — Proxy-based API Client
 *
 * This service calls a Supabase Edge Function proxy ('yeastar-api')
 * instead of calling the PBX directly. This solves CORS errors
 * and keeps sensitive credentials on the server.
 * ═══════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import { getAccessToken } from "@/lib/api";
import {
  IpForbiddenError,
  isYeastarEdgeIpBlocked,
  markYeastarEdgeIpBlocked,
} from "@/services/linkusSdkService";

/** Yeastar REST surface (incl. cloud RAS) is `/openapi/v1.0/*`, not bare `/v1.0/*`. */
const OPENAPI = "/openapi/v1.0";

/** Same host the edge function (`YEASTAR_PBX_URL`) uses — RAS URL preferred (matches Linkus/OpenAPI). */
const PBX_PUBLIC_BASE_URL = (
  (import.meta.env.VITE_YEASTAR_PBX_URL as string | undefined)?.trim() ||
  (import.meta.env.VITE_YEASTAR_API_URL as string | undefined)?.trim() ||
  ''
).replace(/\/$/, '');

const CLIENT_ID = import.meta.env.VITE_YEASTAR_CLIENT_ID ?? '';
const CLIENT_SECRET = import.meta.env.VITE_YEASTAR_CLIENT_SECRET ?? '';

/** Linkus SDK app — Linkus succeeds today, so this Open API app is known to pass IP rules. */
const SDK_ACCESS_ID = (import.meta.env.VITE_YEASTAR_SDK_ACCESS_ID as string | undefined) ?? '';
const SDK_ACCESS_KEY = (import.meta.env.VITE_YEASTAR_SDK_ACCESS_KEY as string | undefined) ?? '';

/** Optional dedicated extension-list / OpenAPI app — re-use if present. */
const OPENAPI_ACCESS_ID = (import.meta.env.VITE_YEASTAR_OPENAPI_ACCESS_ID as string | undefined) ?? '';
const OPENAPI_ACCESS_KEY = (import.meta.env.VITE_YEASTAR_OPENAPI_ACCESS_KEY as string | undefined) ?? '';

const YEASTAR_API_IP_RESTRICTION_HINT =
  'Yeastar 70087 (IP forbidden): Supabase yeastar-api calls the PBX from Supabase egress IPs. ' +
    'Either disable IP restriction / whitelist those IPs on **every** Open API app you use ' +
    '(Integrations → API), **or** rely on browser-direct recording auth (dashboard tries this ' +
    'automatically after Edge fails — requires PBX/RAS to allow browser CORS).';

function throwIfYeastarIpForbidden(errcode: number, errmsgRaw: unknown): void {
  const errmsg = String(errmsgRaw ?? '');
  if (errcode === 70087 || /ip forbidden/i.test(errmsg)) {
    throw new IpForbiddenError(YEASTAR_API_IP_RESTRICTION_HINT);
  }
}

// Token cache (proxy — click-to-call, extension polling, etc.)
let _token: string | null = null;
let _tokenExpiry = 0;

/** Recording-only: may use browser→PBX when Edge egress is blocked (70087). */
let _recordingAuth: {
  token: string;
  expiresAt: number;
  browserTransport: boolean;
  credentialLabel: string;
} | null = null;

/** Thrown when Open API reports an expired/invalid access token (errcode 10004). */
class RecordingTokenExpiredError extends Error {
  constructor() {
    super('Yeastar access token expired');
    this.name = 'RecordingTokenExpiredError';
  }
}

/** Thrown when the current API app lacks Recording → Download (errcode 10005). */
class RecordingAccessDeniedError extends Error {
  readonly errcode = 10005;
  constructor(
    public credentialLabel?: string,
    /** PBX labels from Edge when multiple tokens were tried */
    public serverDenied?: string[],
  ) {
    super('ACCESS DENIED (10005)');
    this.name = 'RecordingAccessDeniedError';
  }
}

function isRecordingAccessDeniedError(err: unknown): boolean {
  if (err instanceof RecordingAccessDeniedError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return errcodeFromMessage(msg) === 10005 || /10005|ACCESS DENIED/i.test(msg);
}

function errcodeFromMessage(msg: string): number | undefined {
  const m = msg.match(/\b(10005|10004)\b/);
  return m ? Number(m[1]) : undefined;
}

function clearRecordingAuth(): void {
  _recordingAuth = null;
}

function recordingAuthExpiresAtMs(ttlSec: number): number {
  /** Refresh ≥2 min before PBX expiry — avoids 10004 mid-session on long dashboard tabs. */
  return Date.now() + Math.max(60, ttlSec - 120) * 1000;
}

function isYeastarTokenExpiredErrcode(errcode: number, msg: string): boolean {
  return errcode === 10004 || /token.*expir|access.?token.*invalid/i.test(msg);
}

function isRecordingRelayAuthError(msg: string): boolean {
  return /non-audio|text\/html|bad token|non-audio body|PBX returned non-audio|token.?expir|10004/i.test(
    msg
  );
}

export function isYeastarConfigured(): boolean {
  return Boolean(
    PBX_PUBLIC_BASE_URL &&
      ((CLIENT_ID.trim() && CLIENT_SECRET.trim()) ||
        (SDK_ACCESS_ID.trim() && SDK_ACCESS_KEY.trim()) ||
        (OPENAPI_ACCESS_ID.trim() && OPENAPI_ACCESS_KEY.trim()))
  );
}

// ─── Authentication ───────────────────────────────────────

type YeastarCredential = { label: string; id: string; key: string };

/**
 * Returns each unique credential pair the user provided, in fallback order.
 * Order: Integration → SDK → OpenAPI. The first pair the PBX accepts wins and is cached.
 */
function getYeastarCredentialCandidates(): YeastarCredential[] {
  const raw: YeastarCredential[] = [];
  if (CLIENT_ID.trim() && CLIENT_SECRET.trim()) {
    raw.push({ label: 'VITE_YEASTAR_CLIENT_ID/SECRET', id: CLIENT_ID.trim(), key: CLIENT_SECRET.trim() });
  }
  if (SDK_ACCESS_ID.trim() && SDK_ACCESS_KEY.trim()) {
    raw.push({ label: 'VITE_YEASTAR_SDK_ACCESS_*', id: SDK_ACCESS_ID.trim(), key: SDK_ACCESS_KEY.trim() });
  }
  if (OPENAPI_ACCESS_ID.trim() && OPENAPI_ACCESS_KEY.trim()) {
    raw.push({ label: 'VITE_YEASTAR_OPENAPI_ACCESS_*', id: OPENAPI_ACCESS_ID.trim(), key: OPENAPI_ACCESS_KEY.trim() });
  }
  const seen = new Set<string>();
  return raw.filter((c) => {
    const k = `${c.id}::${c.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Recording needs **Recording → Download** on the API app. Linkus SDK apps often lack it;
 * try dedicated Open API / integration apps before SDK.
 */
function getYeastarCredentialCandidatesForRecordings(): YeastarCredential[] {
  const raw: YeastarCredential[] = [];
  if (OPENAPI_ACCESS_ID.trim() && OPENAPI_ACCESS_KEY.trim()) {
    raw.push({ label: 'VITE_YEASTAR_OPENAPI_ACCESS_*', id: OPENAPI_ACCESS_ID.trim(), key: OPENAPI_ACCESS_KEY.trim() });
  }
  if (CLIENT_ID.trim() && CLIENT_SECRET.trim()) {
    raw.push({ label: 'VITE_YEASTAR_CLIENT_ID/SECRET', id: CLIENT_ID.trim(), key: CLIENT_SECRET.trim() });
  }
  if (SDK_ACCESS_ID.trim() && SDK_ACCESS_KEY.trim()) {
    raw.push({ label: 'VITE_YEASTAR_SDK_ACCESS_*', id: SDK_ACCESS_ID.trim(), key: SDK_ACCESS_KEY.trim() });
  }
  const seen = new Set<string>();
  return raw.filter((c) => {
    const k = `${c.id}::${c.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function tryFetchAccessToken(
  c: YeastarCredential
): Promise<{ token: string; ttlSec: number } | { ipForbidden: true; label: string }> {
  const { data, error } = await supabase.functions.invoke('yeastar-api', {
    body: {
      endpoint: `${OPENAPI}/get_token`,
      method: 'POST',
      body: { username: c.id, password: c.key },
    },
  });

  if (error) throw new Error(`Yeastar auth proxy error (${c.label}): ${error.message}`);

  if (typeof data?.errcode === 'number' && data.errcode !== 0) {
    const msg = String(data.errmsg ?? '');
    if (data.errcode === 70087 || /ip forbidden/i.test(msg)) {
      return { ipForbidden: true, label: c.label };
    }
    throw new Error(`Yeastar auth failed (${c.label}, ${data.errcode}): ${msg}`);
  }

  const accessToken = data?.access_token as string | undefined;
  if (!accessToken) throw new Error(`Yeastar auth failed (${c.label}): ${JSON.stringify(data)}`);

  return {
    token: accessToken,
    ttlSec: Number(data?.access_token_expire_time ?? 1800),
  };
}

async function tryFetchAccessTokenFromBrowser(
  c: YeastarCredential
): Promise<
  | { token: string; ttlSec: number }
  | { ipForbidden: true }
  | null
> {
  try {
    const url = `${PBX_PUBLIC_BASE_URL}${OPENAPI}/get_token`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ username: c.id, password: c.key }),
    });

    const data = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!data || typeof data !== 'object') return null;

    if (typeof data.errcode === 'number' && data.errcode !== 0) {
      const msg = String(data.errmsg ?? '');
      if (data.errcode === 70087 || /ip forbidden/i.test(msg)) {
        return { ipForbidden: true };
      }
      throw new Error(`Yeastar browser auth (${c.label}, ${data.errcode}): ${msg}`);
    }

    const accessToken = data.access_token as string | undefined;
    if (!accessToken) return null;

    return {
      token: accessToken,
      ttlSec: Number(data.access_token_expire_time ?? 1800),
    };
  } catch (e) {
    if (e instanceof Error && e.message.includes('Yeastar browser auth')) throw e;
    return null;
  }
}

/**
 * Obtain a token for one API app (Edge first, then browser). Used by recording playback
 * so we can rotate apps when one returns 10005 ACCESS DENIED.
 */
async function fetchRecordingTokenForCredential(
  c: YeastarCredential,
): Promise<{ token: string; ttlSec: number; browserTransport: boolean } | null> {
  if (!isYeastarEdgeIpBlocked(c.id)) {
    try {
      const edge = await tryFetchAccessToken(c);
      if ('ipForbidden' in edge) {
        markYeastarEdgeIpBlocked(c.id);
      } else {
        return { token: edge.token, ttlSec: edge.ttlSec, browserTransport: false };
      }
    } catch {
      /* try browser */
    }
  }

  try {
    const browser = await tryFetchAccessTokenFromBrowser(c);
    if (browser === null || 'ipForbidden' in browser) return null;
    return { token: browser.token, ttlSec: browser.ttlSec, browserTransport: true };
  } catch {
    return null;
  }
}

function cacheRecordingAuth(
  c: YeastarCredential,
  auth: { token: string; ttlSec: number; browserTransport: boolean },
): void {
  _recordingAuth = {
    token: auth.token,
    expiresAt: recordingAuthExpiresAtMs(auth.ttlSec),
    browserTransport: auth.browserTransport,
    credentialLabel: c.label,
  };
}

/**
 * Used only by recording helpers — tries Edge proxy first, then browser (your office IP).
 */
async function getYeastarTokenForRecordings(): Promise<string> {
  if (_recordingAuth && Date.now() < _recordingAuth.expiresAt) {
    return _recordingAuth.token;
  }

  const candidates = getYeastarCredentialCandidatesForRecordings();
  if (candidates.length === 0) {
    throw new Error('Yeastar not configured — no client id/secret in .env');
  }

  const failures: string[] = [];
  let sawIpForbidden = false;

  for (const c of candidates) {
    const auth = await fetchRecordingTokenForCredential(c);
    if (auth) {
      cacheRecordingAuth(c, auth);
      return auth.token;
    }
    failures.push(`${c.label}: no token (Edge 70087 or browser CORS)`);
    if (isYeastarEdgeIpBlocked(c.id)) sawIpForbidden = true;
  }

  if (sawIpForbidden) {
    throw new IpForbiddenError(
      `${YEASTAR_API_IP_RESTRICTION_HINT} ${failures.join('; ')}`,
    );
  }
  throw new Error(`Yeastar recording auth failed — ${failures.join('; ')}`);
}

export async function getYeastarToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const candidates = getYeastarCredentialCandidates();
  if (candidates.length === 0) {
    throw new Error('Yeastar not configured — no client id/secret in .env');
  }

  const ipForbiddenLabels: string[] = [];
  const skippedLabels: string[] = [];
  for (const c of candidates) {
    if (isYeastarEdgeIpBlocked(c.id)) {
      skippedLabels.push(c.label);
      continue;
    }
    const result = await tryFetchAccessToken(c);
    if ('ipForbidden' in result) {
      markYeastarEdgeIpBlocked(c.id);
      ipForbiddenLabels.push(result.label);
      continue;
    }
    _token = result.token;
    _tokenExpiry = Date.now() + Math.max(60, result.ttlSec - 60) * 1000;
    return _token;
  }

  throw new IpForbiddenError(
    `${YEASTAR_API_IP_RESTRICTION_HINT} (tried: ${ipForbiddenLabels.join(', ') || 'none'}` +
      (skippedLabels.length
        ? `; skipped recently-blocked: ${skippedLabels.join(', ')}`
        : '') +
      `)`,
  );
}

// ─── Call Control ──────────────────────────────────────────

export async function clickToCall(agentExtension: string, callerNumber: string): Promise<void> {
  if (!isYeastarConfigured()) throw new Error('Yeastar not configured');
  const token = await getYeastarToken();

  const { error } = await supabase.functions.invoke('yeastar-api', {
    body: {
      endpoint: `${OPENAPI}/call/dial`,
      method: 'POST',
      body: { caller: agentExtension, callee: callerNumber },
      headers: { Authorization: `Bearer ${token}` }
    }
  });

  if (error) {
    throw new Error(`Click-to-call failed: ${error.message}`);
  }
}

export async function hangupCall(extension: string): Promise<void> {
  if (!isYeastarConfigured()) return;
  const token = await getYeastarToken();

  await supabase.functions.invoke('yeastar-api', {
    body: {
      endpoint: `${OPENAPI}/call/hangup`,
      method: 'POST',
      body: { extension },
      headers: { Authorization: `Bearer ${token}` }
    }
  });
}

// ─── Extension Queries (fallback polling) ─────────────────

export interface YeastarExtension {
  extension: string;
  name: string;
  status: 'Idle' | 'Busy' | 'Ringing' | 'Unregistered';
}

export async function fetchExtensionList(): Promise<YeastarExtension[]> {
  if (!isYeastarConfigured()) return [];
  const token = await getYeastarToken();

  const { data, error } = await supabase.functions.invoke('yeastar-api', {
    body: {
      endpoint: `${OPENAPI}/extensionlist/query`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }
  });

  if (error || !data) return [];
  return (data.extlist ?? []) as YeastarExtension[];
}

export async function fetchExtensionStatus(extension: string): Promise<string> {
  if (!isYeastarConfigured()) return 'unknown';
  const token = await getYeastarToken();

  const { data, error } = await supabase.functions.invoke('yeastar-api', {
    body: {
      endpoint: `${OPENAPI}/extension/query`,
      method: 'GET',
      params: { extension },
      headers: { Authorization: `Bearer ${token}` }
    }
  });

  if (error || !data) return 'unknown';
  return String(data.status ?? 'unknown');
}

// ─── CDR Queries ───────────────────────────────────────────

export interface YeastarCdr {
  id?: string | number;
  new_id?: string;
  cdrid?: string;
  uid?: string;
  call_id?: string;
  callid?: string;
  time?: string;
  timestart?: string;
  time_start?: string;
  timestamp?: number;
  call_from?: string;
  callfrom?: string;
  call_from_number?: string;
  call_from_name?: string;
  call_to?: string;
  callto?: string;
  call_to_number?: string;
  call_to_name?: string;
  duration?: number;
  callduraction?: number;
  call_duration?: number;
  talk_duration?: number;
  talkduraction?: number;
  ring_duration?: number;
  status?: string;
  disposition?: string;
  type?: string;
  call_type?: string;
  direction?: string;
  did?: string;
  did_number?: string;
  did_name?: string;
  record_file?: string;
  recording_file?: string;
  recording?: string;
  file?: string;
  [key: string]: unknown;
}

function extractCdrRows(data: unknown): YeastarCdr[] {
  if (Array.isArray(data)) return data as YeastarCdr[];
  if (!data || typeof data !== 'object') return [];

  const body = data as Record<string, unknown>;
  for (const key of ['cdrlist', 'cdr_list', 'cdrs', 'cdr', 'data', 'items', 'rows', 'records']) {
    const value = body[key];
    if (Array.isArray(value)) return value as YeastarCdr[];
  }

  return [];
}

function buildCdrRequest(params?: {
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): { endpointPath: string; query: Record<string, string> } {
  const useSearch = Boolean(params?.dateFrom || params?.dateTo);
  const pageSize = Math.min(Math.max(params?.limit ?? 200, 1), 10000);

  // `cdr/search` rejects `sort_by` / `order_by` (40002 PARAMETER ERROR) — those are
  // `cdr/list`-only. `cdr/search` instead filters by `start_time` / `end_time`, which
  // MUST match the PBX's date/time display format (else it returns zero rows).
  if (useSearch) {
    return {
      endpointPath: `${OPENAPI}/cdr/search`,
      query: {
        page_size: String(pageSize),
        ...(params?.dateFrom ? { start_time: params.dateFrom } : {}),
        ...(params?.dateTo ? { end_time: params.dateTo } : {}),
      },
    };
  }

  return {
    endpointPath: `${OPENAPI}/cdr/list`,
    query: {
      page_size: String(pageSize),
      sort_by: 'id',
      order_by: 'desc',
    },
  };
}

/** Parse a Yeastar CDR response, surfacing IP-forbidden (70087) so callers can switch transport. */
function parseCdrResponse(data: unknown): YeastarCdr[] {
  const body = (data ?? {}) as Record<string, unknown>;
  if (typeof body.errcode === 'number' && body.errcode !== 0) {
    const msg = String(body.errmsg ?? '');
    throwIfYeastarIpForbidden(body.errcode, msg);
    throw new Error(`Yeastar CDR API ${body.errcode}: ${msg || 'unknown error'}`);
  }
  return extractCdrRows(data);
}

/** Edge proxy (server-to-server). Throws {@link IpForbiddenError} when Supabase egress is blocked. */
async function fetchCdrListViaEdge(
  endpointPath: string,
  query: Record<string, string>,
): Promise<YeastarCdr[]> {
  const token = await getYeastarToken();
  const { data, error } = await supabase.functions.invoke('yeastar-api', {
    body: {
      endpoint: endpointPath,
      method: 'GET',
      params: { access_token: token, ...query },
      headers: { Authorization: `Bearer ${token}` },
    },
  });

  if (error) throw new Error(`Yeastar CDR proxy error: ${error.message}`);
  if (!data) return [];
  return parseCdrResponse(data);
}

/** Browser-direct fallback (your whitelisted office IP) for when Edge egress is IP-blocked. */
async function fetchCdrListViaBrowser(
  endpointPath: string,
  query: Record<string, string>,
): Promise<YeastarCdr[]> {
  const token = await getYeastarTokenForRecordings();
  const qs = new URLSearchParams({ access_token: token, ...query });
  const url = `${PBX_PUBLIC_BASE_URL}${endpointPath}?${qs}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await res.json().catch(() => null)) as unknown;
  if (!data) throw new Error('Yeastar CDR API unreachable from browser (CORS or network).');
  return parseCdrResponse(data);
}

export async function fetchCdrList(params?: {
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<YeastarCdr[]> {
  if (!isYeastarConfigured()) return [];
  const { endpointPath, query } = buildCdrRequest(params);

  try {
    return await fetchCdrListViaEdge(endpointPath, query);
  } catch (e) {
    // Edge egress blocked by PBX IP rules → retry browser-direct (matches recording flow).
    if (e instanceof IpForbiddenError) {
      return await fetchCdrListViaBrowser(endpointPath, query);
    }
    throw e;
  }
}

// ─── Recording File Queries ─────────────────────────────────

export interface YeastarRecordingFile {
  id?: string | number;
  uid?: string;
  time?: string;
  call_from?: string;
  call_to?: string;
  duration?: number;
  size?: number;
  call_type?: string;
  file?: string;
  call_from_number?: string;
  call_from_name?: string;
  call_to_number?: string;
  call_to_name?: string;
  archive_status?: string;
  archive_path?: string;
  archive_type?: string;
  file_path?: string;
  [key: string]: unknown;
}

function extractRecordingRows(data: unknown): YeastarRecordingFile[] {
  if (Array.isArray(data)) return data as YeastarRecordingFile[];
  if (!data || typeof data !== 'object') return [];

  const body = data as Record<string, unknown>;
  for (const key of ['data', 'recordings', 'recordinglist', 'items', 'rows', 'records']) {
    const value = body[key];
    if (Array.isArray(value)) return value as YeastarRecordingFile[];
  }

  return [];
}

function parseRecordingListResponse(data: unknown): YeastarRecordingFile[] {
  const body = (data ?? {}) as Record<string, unknown>;
  if (typeof body.errcode === 'number' && body.errcode !== 0) {
    const msg = String(body.errmsg ?? '');
    throwIfYeastarIpForbidden(body.errcode, msg);
    throw new Error(`Yeastar Recording API ${body.errcode}: ${msg || 'unknown error'}`);
  }
  return extractRecordingRows(data);
}

function buildRecordingListRequest(params?: {
  startUnix?: number;
  endUnix?: number;
  limit?: number;
}): { endpointPath: string; query: Record<string, string> } {
  const hasDateRange = Number.isFinite(params?.startUnix) || Number.isFinite(params?.endUnix);
  const pageSize = Math.min(Math.max(params?.limit ?? 200, 1), 10000);
  return {
    endpointPath: `${OPENAPI}/recording/${hasDateRange ? 'search' : 'list'}`,
    query: {
      page_size: String(pageSize),
      sort_by: 'time',
      order_by: 'desc',
      ...(Number.isFinite(params?.startUnix) ? { start_time: String(params?.startUnix) } : {}),
      ...(Number.isFinite(params?.endUnix) ? { end_time: String(params?.endUnix) } : {}),
    },
  };
}

async function fetchRecordingListViaEdge(
  endpointPath: string,
  query: Record<string, string>,
): Promise<YeastarRecordingFile[]> {
  const token = await getYeastarToken();
  const { data, error } = await supabase.functions.invoke('yeastar-api', {
    body: {
      endpoint: endpointPath,
      method: 'GET',
      params: { access_token: token, ...query },
      headers: { Authorization: `Bearer ${token}` },
    },
  });

  if (error) throw new Error(`Yeastar Recording proxy error: ${error.message}`);
  if (!data) return [];
  return parseRecordingListResponse(data);
}

async function fetchRecordingListViaBrowser(
  endpointPath: string,
  query: Record<string, string>,
): Promise<YeastarRecordingFile[]> {
  const token = await getYeastarTokenForRecordings();
  const qs = new URLSearchParams({ access_token: token, ...query });
  const url = `${PBX_PUBLIC_BASE_URL}${endpointPath}?${qs}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await res.json().catch(() => null)) as unknown;
  if (!data) throw new Error('Yeastar Recording API unreachable from browser (CORS or network).');
  return parseRecordingListResponse(data);
}

export async function fetchRecordingList(params?: {
  startUnix?: number;
  endUnix?: number;
  limit?: number;
}): Promise<YeastarRecordingFile[]> {
  if (!isYeastarConfigured()) return [];
  const { endpointPath, query } = buildRecordingListRequest(params);

  try {
    return await fetchRecordingListViaEdge(endpointPath, query);
  } catch (e) {
    if (e instanceof IpForbiddenError) {
      return await fetchRecordingListViaBrowser(endpointPath, query);
    }
    throw e;
  }
}

// ─── PBX Info ──────────────────────────────────────────────

export async function fetchPbxInfo(): Promise<{ firmware?: string; model?: string } | null> {
  if (!isYeastarConfigured()) return null;
  try {
    const token = await getYeastarToken();
    const { data, error } = await supabase.functions.invoke('yeastar-api', {
      body: {
        endpoint: `${OPENAPI}/deviceinfo/query`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      }
    });
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Recording Access ──────────────────────────────────────

/**
 * Resolve stored `recording_url` / webhook `recording` value into Open API `file` or numeric `id`.
 *
 * DB rows often store `{YEASTAR_RECORDING_BASE_URL}/{filename}`, e.g.
 * `https://host/cdr_recording/recording/foo.wav`.
 *
 * @see https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/download-a-recording-file.html
 */
function extractYeastarRecordingFileKey(recordingPath: string): string {
  const raw = recordingPath.trim();
  if (!raw) throw new Error('Empty recording path');

  try {
    const u = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(raw, 'http://recording.invalid/');

    const fromQuery =
      u.searchParams.get('recording') ?? u.searchParams.get('file');
    if (fromQuery?.trim()) return fromQuery.trim();

    let path = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    const prefix = 'cdr_recording/recording/';
    if (path.startsWith(prefix)) path = path.slice(prefix.length);
    if (path) return path;
  } catch {
    // Bare filename / relative path stored without scheme
  }
  return raw.replace(/^\/+/, '');
}

async function fetchRecordingDownloadJsonViaBrowser(
  params: Record<string, string>
): Promise<unknown | null> {
  try {
    const qs = new URLSearchParams(params);
    const url = `${PBX_PUBLIC_BASE_URL}${OPENAPI}/recording/download?${qs}`;
    const token = params.access_token ?? '';
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return await res.json();
  } catch {
    return null;
  }
}

function parseRecordingDownloadResponse(
  data: unknown,
  token: string
): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  if (typeof d.errcode === 'number' && d.errcode !== 0) {
    const msg = String(d.errmsg ?? '');
    throwIfYeastarIpForbidden(d.errcode, msg);
    if (isYeastarTokenExpiredErrcode(d.errcode, msg)) {
      throw new RecordingTokenExpiredError();
    }
    if (d.errcode === 10005) {
      throw new RecordingAccessDeniedError(_recordingAuth?.credentialLabel);
    }
    return null;
  }

  const relUrl = d.download_resource_url;
  if (typeof relUrl !== 'string' || !relUrl) return null;

  const path = relUrl.startsWith('/') ? relUrl : `/${relUrl}`;
  const joinToken = path.includes('?') ? '&' : '?';
  return `${PBX_PUBLIC_BASE_URL}${path}${joinToken}access_token=${encodeURIComponent(token)}`;
}

/**
 * Official flow: GET `/openapi/v1.0/recording/download` → `download_resource_url`.
 * Returns `null` on any API error or missing scope — caller falls back to `/cdr_recording/…`
 * when the relay can still stream WAV with Bearer + token.
 */
async function requestRecordingDownloadUrl(
  recordingPath: string,
  token: string
): Promise<string | null> {
  let fileKey: string;
  try {
    fileKey = extractYeastarRecordingFileKey(recordingPath);
  } catch {
    return null;
  }

  const params = /^\d+$/.test(fileKey)
    ? { id: fileKey, access_token: token }
    : { file: fileKey, access_token: token };

  const browserTransport = _recordingAuth?.browserTransport === true;

  if (browserTransport) {
    const data = await fetchRecordingDownloadJsonViaBrowser(params);
    if (data === null) return null;
    return parseRecordingDownloadResponse(data, token);
  }

  const { data, error } = await supabase.functions.invoke('yeastar-api', {
    body: {
      endpoint: `${OPENAPI}/recording/download`,
      method: 'GET',
      params,
      headers: { Authorization: `Bearer ${token}` },
    },
  });

  if (error) return null;

  return parseRecordingDownloadResponse(data, token);
}

async function tryRecordingDownloadViaOpenApi(
  recordingPath: string,
  token: string
): Promise<string | null> {
  try {
    return await requestRecordingDownloadUrl(recordingPath, token);
  } catch (e) {
    if (e instanceof RecordingTokenExpiredError) {
      clearRecordingAuth();
      const fresh = await getYeastarTokenForRecordings();
      return await requestRecordingDownloadUrl(recordingPath, fresh);
    }
    throw e;
  }
}

/**
 * Recording download link for open-in-new-tab (Open API temporary URL only).
 * Playback uses {@link getRecordingPlaybackObjectUrl} → `stream_recording` or browser pipeline.
 */
function formatRecordingPermissionError(deniedLabels: string[]): string {
  const uniq = [...new Set(deniedLabels)].filter(Boolean);
  const apps = uniq.length > 0 ? uniq.join(', ') : 'your Yeastar API apps';
  return (
    `Recording → Download is disabled or denied (10005) for: ${apps}. ` +
    'PBX admin → Integrations → API → each listed app → Permissions → enable **Recording → Download** → Save. ' +
    'Use `VITE_YEASTAR_OPENAPI_ACCESS_*` or `CLIENT_ID`/`SECRET` for an app with that permission; Linkus SDK keys alone often fail. ' +
    'Set matching `YEASTAR_*` secrets on Supabase so Edge can use the same Open API app.'
  );
}

async function resolveRecordingDownloadUrl(recordingPath: string): Promise<string> {
  const token = await getYeastarTokenForRecordings();
  const viaOpenApi = await tryRecordingDownloadViaOpenApi(recordingPath, token);
  if (viaOpenApi) return viaOpenApi;
  throw new Error(formatRecordingPermissionError([_recordingAuth?.credentialLabel ?? 'unknown']));
}

export async function getRecordingDownloadUrl(recordingPath: string): Promise<string> {
  if (!isYeastarConfigured())
    throw new Error('Yeastar not configured');

  try {
    return await resolveRecordingDownloadUrl(recordingPath);
  } catch (e) {
    if (e instanceof RecordingTokenExpiredError) {
      clearRecordingAuth();
      return await resolveRecordingDownloadUrl(recordingPath);
    }
    throw e;
  }
}

/**
 * Browser OpenAPI metadata (`recording/download` JSON) + Edge relay for the binary URL.
 * Attachment endpoints omit CORS headers — direct `fetch` from the dashboard origin fails.
 */
async function fetchRecordingViaBrowserPipeline(
  recordingPath: string
): Promise<{ buf: ArrayBuffer; mime: string }> {
  const token = await getYeastarTokenForRecordings();
  const fileKey = extractYeastarRecordingFileKey(recordingPath);
  const params = /^\d+$/.test(fileKey)
    ? { id: fileKey, access_token: token }
    : { file: fileKey, access_token: token };

  const data = await fetchRecordingDownloadJsonViaBrowser(params);
  if (!data || typeof data !== 'object') {
    throw new Error('Recording API unreachable from browser (CORS or network).');
  }

  const d = data as Record<string, unknown>;
  if (typeof d.errcode === 'number' && d.errcode !== 0) {
    const msg = String(d.errmsg ?? '');
    throwIfYeastarIpForbidden(d.errcode, msg);
    if (isYeastarTokenExpiredErrcode(d.errcode, msg)) {
      throw new RecordingTokenExpiredError();
    }
    if (d.errcode === 10005) {
      throw new RecordingAccessDeniedError(_recordingAuth?.credentialLabel);
    }
    throw new Error(`Yeastar recording/download ${d.errcode}: ${msg}`);
  }

  const relUrl = d.download_resource_url;
  if (typeof relUrl !== 'string' || !relUrl) {
    throw new Error('Yeastar recording/download returned no download_resource_url.');
  }

  const path = relUrl.startsWith('/') ? relUrl : `/${relUrl}`;
  const sep = path.includes('?') ? '&' : '?';
  const downloadUrl = `${PBX_PUBLIC_BASE_URL}${path}${sep}access_token=${encodeURIComponent(token)}`;

  /** PBX attachment URLs do not send CORS headers — browser `fetch` fails after preflight (Authorization). */
  return relayPbxDownloadThroughEdge(downloadUrl);
}

/**
 * Stream a PBX `/api/downloadattachment/…` (or `/api/download/…`) URL via Supabase Edge.
 * Same-origin to your app — avoids Yeastar RAS blocking cross-origin reads from localhost.
 */
async function relayPbxDownloadThroughEdge(
  pbxDownloadUrl: string
): Promise<{ buf: ArrayBuffer; mime: string }> {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const bearer = getAccessToken() ?? anonKey;

  const res = await fetch(`${supabaseUrl}/functions/v1/yeastar-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ relay_from_pbx: pbxDownloadUrl }),
  });

  const ct = (res.headers.get('content-type') || '').toLowerCase();

  if (!res.ok || ct.includes('application/json')) {
    const raw = await res.text();
    let parsed: { error?: string; hint?: string; pbx_status?: number; detail?: string } | undefined;
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      /* plain text */
    }
    if (parsed && typeof parsed === 'object') {
      const hint = parsed.hint ? String(parsed.hint).slice(0, 360) : '';
      throw new Error(
        [
          parsed.error ?? `Recording relay HTTP ${res.status}`,
          hint,
          parsed.pbx_status != null ? `PBX ${parsed.pbx_status}` : '',
          parsed.detail && !hint ? String(parsed.detail).slice(0, 200) : '',
        ]
          .filter(Boolean)
          .join(' — ') || raw.slice(0, 240),
      );
    }
    throw new Error(`Recording relay failed (${res.status}): ${raw.slice(0, 240)}`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) {
    throw new Error('Recording relay returned empty body');
  }

  let mime = res.headers.get('content-type')?.split(';')[0].trim() || '';
  if (!mime || mime === 'application/octet-stream') {
    mime = sniffAudioMimeFromUrl(pbxDownloadUrl);
  }

  return { buf, mime };
}

async function streamRecordingThroughEdge(
  recordingPath: string,
  /** Optional token from browser auth — Edge uses its own server secrets first,
   *  but if those aren't configured this lets the browser token act as a fallback. */
  extraToken?: string,
): Promise<{ buf: ArrayBuffer; mime: string }> {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const bearer = getAccessToken() ?? anonKey;

  const streamPayload: Record<string, string> = { recording_path: recordingPath };
  if (extraToken) streamPayload.access_token = extraToken;

  const res = await fetch(`${supabaseUrl}/functions/v1/yeastar-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ stream_recording: streamPayload }),
  });

  const ct = (res.headers.get('content-type') || '').toLowerCase();

  if (!res.ok || ct.includes('application/json')) {
    const raw = await res.text();
    let parsed: {
      error?: string;
      hint?: string;
      errcode?: number;
      detail?: string;
    } | undefined;
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      /* plain text */
    }
    if (parsed && typeof parsed === 'object') {
      if (parsed.errcode === 10005) {
        const deniedRaw = (parsed as { denied?: unknown }).denied;
        const serverDenied = Array.isArray(deniedRaw)
          ? deniedRaw.filter((x): x is string => typeof x === 'string')
          : [];
        throw new RecordingAccessDeniedError(_recordingAuth?.credentialLabel, serverDenied);
      }
      const hint = parsed.hint ? String(parsed.hint).slice(0, 360) : '';
      throw new Error(
        [parsed.error, hint, parsed.detail?.slice(0, 160)]
          .filter(Boolean)
          .join(' — ') || raw.slice(0, 240),
      );
    }
    throw new Error(`Recording stream failed (${res.status}): ${raw.slice(0, 240)}`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) {
    throw new Error('Recording stream returned empty body');
  }

  let mime = res.headers.get('content-type')?.split(';')[0].trim() || '';
  if (!mime || mime === 'application/octet-stream') {
    mime = sniffAudioMimeFromUrl(recordingPath);
  }

  return { buf, mime };
}

/**
 * Same-origin playback URL for `<audio>` via Open API stream.
 *
 * Token acquisition uses the Edge proxy (supabase.functions.invoke → PBX get_token),
 * which is server-to-server and not subject to CORS.  The token is then passed to
 * stream_recording so Edge can use it even when no YEASTAR_* Supabase secrets are set.
 * Edge's own server secrets (if set) are tried first, so the two complement each other.
 */
export async function getRecordingBytes(
  recordingPath: string,
): Promise<{ buf: ArrayBuffer; mime: string }> {
  // ── get a client-side token (via Edge proxy get_token — no CORS) ─────────────
  // Use the cache if still valid; otherwise try each credential through the Edge proxy.
  let clientToken: string | null = null;
  try {
    clientToken = await getYeastarTokenForRecordings();
  } catch {
    // No token available — Edge will still try its own YEASTAR_* Supabase secrets
  }

  // ── 1. Edge stream ────────────────────────────────────────────────────────────
  try {
    return await streamRecordingThroughEdge(recordingPath, clientToken ?? undefined);
  } catch (edgeErr) {
    if (edgeErr instanceof RecordingAccessDeniedError) {
      const denied = edgeErr.serverDenied?.length
        ? edgeErr.serverDenied
        : ['all configured apps'];
      throw new Error(formatRecordingPermissionError(denied));
    }
    if (edgeErr instanceof IpForbiddenError) {
      // Edge egress is blocked by PBX IP rules → fall through to browser pipeline
    } else {
      const msg = edgeErr instanceof Error ? edgeErr.message : String(edgeErr);
      if (!isRecordingRelayAuthError(msg)) throw edgeErr;
      // Auth-related Edge failure → try browser pipeline
    }
  }

  // ── 2. Browser pipeline (office IP, WAV relay through Edge avoids CORS) ──────
  // `fetchRecordingViaBrowserPipeline` calls recording/download JSON directly from
  // the browser (PBX usually allows this from a whitelisted office IP), then relays
  // the actual WAV bytes through the Edge function so the browser doesn't fetch
  // cross-origin audio (which would CORS-fail).
  try {
    return await fetchRecordingViaBrowserPipeline(recordingPath);
  } catch (browserErr) {
    if (browserErr instanceof RecordingTokenExpiredError) {
      clearRecordingAuth();
      return await fetchRecordingViaBrowserPipeline(recordingPath);
    }
    if (browserErr instanceof RecordingAccessDeniedError) {
      const denied = browserErr.serverDenied?.length
        ? browserErr.serverDenied
        : [browserErr.credentialLabel ?? 'unknown'];
      throw new Error(formatRecordingPermissionError(denied));
    }
    throw browserErr;
  }
}

export async function getRecordingPlaybackObjectUrl(
  recordingPath: string
): Promise<string> {
  const { buf, mime } = await getRecordingBytes(recordingPath);
  return URL.createObjectURL(new Blob([buf], { type: mime }));
}

export function recordingExtensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  return 'wav';
}

function sniffAudioMimeFromUrl(url: string): string {
  const path = url.split('?')[0] || url;
  if (/\.mp3$/i.test(path)) return 'audio/mpeg';
  if (/\.wav$/i.test(path)) return 'audio/wav';
  return 'audio/wav';
}

