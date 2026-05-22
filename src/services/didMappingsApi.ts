/**
 * didMappingsApi.ts — DID ↔ Workshop/Branch mapping (super-admin only)
 *
 *  • Fetches workshops + branches from BMS Pro (Firebase) so super-admins can
 *    pick the correct ownerUid + branchId when creating a mapping.
 *  • Persists mappings in Supabase (`did_mappings`) which the Yeastar webhook
 *    already reads during incoming-call screen pop.
 */

import { API_BASE, apiFetch, getAccessToken } from '@/lib/api';
import {
  AUDIT_ACTION_DID_MAPPING_CREATE,
  AUDIT_ACTION_DID_MAPPING_DELETE,
  AUDIT_ACTION_DID_MAPPING_UPDATE,
  postSystemAuditLog,
} from './auditLogApi';
import type { DIDMapping } from './types';

const BASE_URL =
  (import.meta.env.VITE_BMS_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  `${API_BASE}/bms-black`;

const DID_MAPPINGS_API_URL =
  (import.meta.env.VITE_DID_MAPPINGS_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  `${API_BASE}/did-mappings`;

/* ─── Types ─── */

export interface BmsBranchOption {
  id: string;
  name: string;
  ownerUid: string;
  workshopName: string;
  phone?: string;
  address?: string;
}

export interface BmsWorkshopOption {
  ownerUid: string;
  name: string;
  branches: BmsBranchOption[];
}

export interface DIDMappingInput {
  did: string;
  label: string;
  tenantId: string;
  queueId: string;
  ownerUid: string;
  workshopName: string;
  branchId: string;
  branchName: string;
}

/* ─── BMS API helpers ─── */

function bmsUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_URL}${suffix}`;
}

function bmsHeaders(ownerUid?: string | null): Headers {
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  const tenant = ownerUid?.trim();
  if (tenant) headers.set('X-Tenant-Id', tenant);
  return headers;
}

async function bmsFetch(path: string, ownerUid?: string | null): Promise<Response> {
  return apiFetch(bmsUrl(path), {
    headers: bmsHeaders(ownerUid),
  });
}

interface RawWorkshop {
  ownerUid?: string;
  id?: string;
  uid?: string;
  name?: string;
  businessName?: string;
  workshopName?: string;
}

interface RawBranch {
  id?: string;
  branchId?: string;
  name?: string;
  branchName?: string;
  phone?: string;
  address?: string;
}

function extractOwnerUid(w: RawWorkshop): string {
  return String(w.ownerUid ?? w.uid ?? w.id ?? '');
}

function extractWorkshopName(w: RawWorkshop): string {
  return String(w.name ?? w.businessName ?? w.workshopName ?? '');
}

/** List all workshops the current Firebase user can access (CC-admin = all). */
export async function fetchBmsWorkshops(): Promise<
  Array<{ ownerUid: string; name: string }>
> {
  const res = await bmsFetch('/chats/workshop-owners');
  if (!res.ok) {
    await res.text().catch(() => '');
    // console.error('[DID] fetchBmsWorkshops failed:', res.status);
    throw new Error(`Failed to load workshops (${res.status})`);
  }
  const json = await res.json();

  // New Command Center backend shape: { workshopOwners: [{ ownerUid, name, ... }] }.
  const rawList: Array<Record<string, unknown>> = Array.isArray(json)
    ? json
    : Array.isArray(json?.workshopOwners)
      ? json.workshopOwners
      : Array.isArray(json?.data?.workshopOwners)
        ? json.data.workshopOwners
      : [];

  return rawList
    .map((entry) => {
      const ws = (entry.workshop ?? entry) as RawWorkshop;
      const ownerUid = extractOwnerUid(ws);
      const name = extractWorkshopName(ws) || ownerUid;
      return { ownerUid, name };
    })
    .filter((w) => w.ownerUid)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch a single workshop's detail incl. branches. */
export async function fetchBmsWorkshopBranches(
  ownerUid: string,
): Promise<BmsBranchOption[]> {
  const params = new URLSearchParams({ ownerUid });
  const res = await bmsFetch(`/branches?${params.toString()}`, ownerUid);
  if (!res.ok) {
    await res.text().catch(() => '');
    // console.error('[DID] fetchBmsWorkshopBranches failed for', ownerUid, ':', res.status);
    throw new Error(`Failed to load branches (${res.status})`);
  }
  const json = await res.json();
  // console.log('[DID] fetchBmsWorkshopBranches raw response for', ownerUid, ':', json);
  const workshopName = extractWorkshopName(json?.workshop ?? {}) || extractWorkshopName(json ?? {}) || ownerUid;
  const rawBranches: RawBranch[] = Array.isArray(json?.branches)
    ? json.branches
    : Array.isArray(json?.workshop?.branches)
      ? json.workshop.branches
      : [];
  // console.log('[DID] Parsed branches count for', ownerUid, ':', rawBranches.length);
  return rawBranches
    .map((b) => ({
      id: String(b.id ?? b.branchId ?? ''),
      name: String(b.name ?? b.branchName ?? ''),
      ownerUid,
      workshopName,
      phone: b.phone ? String(b.phone) : undefined,
      address: b.address ? String(b.address) : undefined,
    }))
    .filter((b) => b.id);
}

/**
 * Convenience: load every workshop + its branches in one pass (super-admin UI).
 *
 * The new backend exposes workshop owners and branches separately.
 */
export async function fetchBmsWorkshopOptions(): Promise<BmsWorkshopOption[]> {
  const owners = await fetchBmsWorkshops();
  const results = await Promise.all(
    owners.map(async (owner) => ({
      ownerUid: owner.ownerUid,
      name: owner.name,
      branches: await fetchBmsWorkshopBranches(owner.ownerUid).catch(() => []),
    })),
  );
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/* ─── DID mappings API CRUD ─── */

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function pickString(
  row: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function rowToMapping(d: Record<string, unknown>): DIDMapping {
  return {
    did: pickString(d, ['did']),
    tenantId: pickString(d, ['tenantId', 'tenant_id']),
    queueId: pickString(d, ['queueId', 'queue_id']),
    label: pickString(d, ['label']),
    branchId: pickString(d, ['branchId', 'branch_id']),
    branchName: pickString(d, ['branchName', 'branch_name']),
    mappingWorkshopName: pickString(d, [
      'mappingWorkshopName',
      'workshopName',
      'workshop_name',
    ]),
    ownerId: pickString(d, ['ownerId', 'ownerUid', 'owner_id']),
  };
}

function toApiPayload(input: DIDMappingInput) {
  return {
    did: input.did.trim(),
    label: input.label.trim(),
    tenantId: input.tenantId,
    queueId: input.queueId,
    ownerUid: input.ownerUid,
    workshopName: input.workshopName,
    branchId: input.branchId,
    branchName: input.branchName,
  };
}

function requireDidMappingsAuth(): void {
  if (!getAccessToken()) {
    throw new Error('Sign in as super-admin to manage DID mappings.');
  }
}

function didMappingsUrl(did?: string): string {
  const base = DID_MAPPINGS_API_URL.replace(/\/+$/, '');
  const path = did?.trim() ? `${base}/${encodeURIComponent(did.trim())}` : base;
  const url = new URL(path, window.location.origin);
  return url.toString();
}

async function apiHeaders(): Promise<HeadersInit> {
  requireDidMappingsAuth();
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function readHttpErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  if (!text.trim()) return '';
  try {
    const parsed = JSON.parse(text) as unknown;
    const body = asRecord(parsed);
    const detail = body.message ?? body.error ?? body.detail;
    return typeof detail === 'string' ? detail : text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as unknown;
}

function extractMappingRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const body = asRecord(raw);
  for (const key of ['mappings', 'didMappings', 'data', 'items', 'results']) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function extractMapping(raw: unknown, fallback: DIDMappingInput): DIDMapping {
  const body = asRecord(raw);
  for (const key of ['mapping', 'didMapping', 'data', 'item', 'result']) {
    const value = body[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return rowToMapping(value as Record<string, unknown>);
    }
  }

  const mapped = rowToMapping(body);
  return mapped.did ? mapped : rowToMapping(toApiPayload(fallback));
}

function extractMappingByDid(raw: unknown): DIDMapping | null {
  const body = asRecord(raw);
  for (const key of ['mapping', 'didMapping', 'data', 'item', 'result']) {
    const value = body[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const mapped = rowToMapping(value as Record<string, unknown>);
      return mapped.did ? mapped : null;
    }
  }

  const direct = rowToMapping(body);
  return direct.did ? direct : null;
}

function normalizeDidForCompare(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

function didMatchesCandidate(mappingDid: string, candidate: string): boolean {
  const left = normalizeDidForCompare(mappingDid);
  const right = normalizeDidForCompare(candidate);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

async function requestDidMappings(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  options: { did?: string; body?: unknown } = {},
): Promise<unknown> {
  const res = await apiFetch(didMappingsUrl(options.did), {
    method,
    headers: await apiHeaders(),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `DID mappings API ${method} failed: ${res.status}${detail ? ` - ${detail}` : ''}`,
    );
  }

  return parseJsonBody(res);
}

export async function listDIDMappings(): Promise<DIDMapping[]> {
  const raw = await requestDidMappings('GET');
  return extractMappingRows(raw)
    .map((row) => rowToMapping(asRecord(row)))
    .filter((mapping) => mapping.did)
    .sort((a, b) => a.did.localeCompare(b.did));
}

/**
 * Resolve a DID mapping for a single number/label.
 *
 * The API supports direct lookup on `/did-mappings/:did`; if that route is not
 * available in an older backend, fall back to listing mappings and matching by
 * normalized phone digits.
 */
export async function getDIDMappingByDid(did: string): Promise<DIDMapping | null> {
  const trimmed = did.trim();
  if (!trimmed) return null;

  try {
    const raw = await requestDidMappings('GET', { did: trimmed });
    const direct = extractMappingByDid(raw);
    if (direct?.did) return direct;
  } catch {
    // Fall back to the list endpoint below for API versions without direct lookup.
  }

  const mappings = await listDIDMappings();
  return mappings.find((mapping) => didMatchesCandidate(mapping.did, trimmed)) ?? null;
}

export async function createDIDMapping(input: DIDMappingInput): Promise<DIDMapping> {
  const raw = await requestDidMappings('POST', { body: toApiPayload(input) });
  const mapping = extractMapping(raw, input);
  void postSystemAuditLog({
    action: AUDIT_ACTION_DID_MAPPING_CREATE,
    resourceType: 'did_mapping',
    resourceId: mapping.did,
    details: {
      tenantId: mapping.tenantId,
      queueId: mapping.queueId,
      branchId: mapping.branchId,
      ownerId: mapping.ownerId,
    },
  }).catch(() => {});
  return mapping;
}

export async function updateDIDMapping(input: DIDMappingInput): Promise<DIDMapping> {
  const payload = toApiPayload(input);
  const raw = await requestDidMappings('PATCH', {
    did: input.did,
    body: { ...payload, originalDid: input.did },
  });
  const mapping = extractMapping(raw, input);
  void postSystemAuditLog({
    action: AUDIT_ACTION_DID_MAPPING_UPDATE,
    resourceType: 'did_mapping',
    resourceId: mapping.did,
    details: {
      tenantId: mapping.tenantId,
      queueId: mapping.queueId,
      branchId: mapping.branchId,
      ownerId: mapping.ownerId,
    },
  }).catch(() => {});
  return mapping;
}

/** Backwards-compatible helper for existing callers. */
export async function upsertDIDMapping(input: DIDMappingInput): Promise<DIDMapping> {
  return updateDIDMapping(input);
}

export async function deleteDIDMapping(did: string): Promise<void> {
  await requestDidMappings('DELETE', {
    did,
    body: { did },
  });
  void postSystemAuditLog({
    action: AUDIT_ACTION_DID_MAPPING_DELETE,
    resourceType: 'did_mapping',
    resourceId: did,
    details: { did },
  }).catch(() => {});
}
