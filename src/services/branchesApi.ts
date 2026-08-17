import { supabase } from '@/integrations/supabase/client';
import {
  BMS_BLACK_API_URL,
  bmsBlackFetch,
  bmsBlackHeaders,
} from '@/lib/bms-black-api';

/**
 * Always go through the Command Centre backend proxy (`/api/bms-black/...`).
 * Calling BMS Black directly with the Supabase access token returns 401 because
 * BMS Black `/api/call-center/*` expects a Firebase ID token; the backend bridges
 * the Supabase session to a stored Firebase Black token. Do not re-introduce a
 * `VITE_BMS_API_URL` override here unless that variable points at a proxy that
 * performs the same Supabase→Firebase bridging.
 */
const BASE_URL = BMS_BLACK_API_URL;

function apiHeaders(ownerUid: string): HeadersInit {
  return bmsBlackHeaders(ownerUid);
}

export type BmsBranchHoursEntry = {
  open: string;
  close: string;
  closed: boolean;
};

export type BmsBranchDaySchedule = {
  dayOfWeek: string;
  closed: boolean;
  open: string | null;
  close: string | null;
};

export type BmsBranchDetail = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  timezone?: string;
  status?: string;
  hours?: Record<string, BmsBranchHoursEntry>;
  daySchedules?: Record<string, BmsBranchDaySchedule>;
  daySchedule?: BmsBranchDaySchedule | null;
  bookingLimitPerDay?: number;
};

export type BmsBranchesResponse = {
  ownerUid: string;
  total: number;
  branches: BmsBranchDetail[];
};

function parseBranchesResponse(raw: unknown): BmsBranchesResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Branches API returned a non-object body');
  }
  const o = raw as Record<string, unknown>;
  const branchesRaw = o.branches;
  const branches = Array.isArray(branchesRaw)
    ? (branchesRaw as BmsBranchDetail[])
    : [];
  const total =
    typeof o.total === 'number' && Number.isFinite(o.total) ? o.total : branches.length;
  const ownerUid = o.ownerUid != null ? String(o.ownerUid) : '';
  return { ownerUid, total, branches };
}

export type SessionTenantBmsIds = {
  ownerUid: string | null;
  branchId: string | null;
};

export async function resolveSessionTenantBmsIds(
  sessionTenantId: string | null | undefined,
): Promise<SessionTenantBmsIds> {
  if (!sessionTenantId) return { ownerUid: null, branchId: null };
  const { data, error } = await supabase
    .from('tenants')
    .select('bms_owner_uid, bms_default_branch_id')
    .eq('id', sessionTenantId)
    .maybeSingle();
  if (error || !data) return { ownerUid: null, branchId: null };
  const ou = data.bms_owner_uid != null ? String(data.bms_owner_uid).trim() : '';
  const bid = data.bms_default_branch_id != null ? String(data.bms_default_branch_id).trim() : '';
  return { ownerUid: ou || null, branchId: bid || null };
}

export async function getBranchesForOwner(ownerUid: string): Promise<BmsBranchesResponse> {
  const url = `${BASE_URL}/branches?ownerUid=${encodeURIComponent(ownerUid)}`;
  const res = await bmsBlackFetch(url, { headers: apiHeaders(ownerUid) });
  if (!res.ok) {
    throw new Error(`getBranchesForOwner failed: ${res.status}`);
  }
  const parsed = parseBranchesResponse(await res.json());
  return parsed;
}

export async function getBranchById(
  ownerUid: string,
  branchId: string,
): Promise<BmsBranchesResponse> {
  const url = `${BASE_URL}/branches/${encodeURIComponent(branchId)}`;
  const res = await bmsBlackFetch(url, { headers: apiHeaders(ownerUid) });
  if (!res.ok) {
    throw new Error(`getBranchById failed: ${res.status}`);
  }
  return parseBranchesResponse(await res.json());
}

export async function getBranchDetail(
  ownerUid: string,
  branchId: string,
): Promise<BmsBranchDetail | undefined> {
  const listData = await getBranchesForOwner(ownerUid);
  const fromList = listData.branches.find((b) => String(b.id) === String(branchId));
  if (fromList) {
    return fromList;
  }
  const data = await getBranchById(ownerUid, branchId);
  const fromDirect = data.branches[0];
  return fromDirect;
}

async function requireOwnerUidFromTenant(tenantId: string | null | undefined): Promise<string> {
  const { ownerUid } = await resolveSessionTenantBmsIds(tenantId);
  const uid = ownerUid?.trim();
  if (!uid) {
    throw new Error('No bms_owner_uid on tenant — set it in Supabase `tenants`.');
  }
  return uid;
}

export async function getBranchesForTenant(
  sessionTenantId: string | null | undefined,
): Promise<BmsBranchesResponse> {
  const ownerUid = await requireOwnerUidFromTenant(sessionTenantId);
  return getBranchesForOwner(ownerUid);
}

export async function getBranchByIdForTenant(
  sessionTenantId: string | null | undefined,
  branchId?: string | null,
): Promise<BmsBranchesResponse> {
  const { ownerUid, branchId: defaultBranch } = await resolveSessionTenantBmsIds(sessionTenantId);
  const uid = ownerUid?.trim();
  if (!uid) {
    throw new Error('No bms_owner_uid on tenant — set it in Supabase `tenants`.');
  }
  const id = (branchId?.trim() || defaultBranch?.trim()) ?? '';
  if (!id) {
    throw new Error(
      'No branch id: pass branchId or set bms_default_branch_id on the tenant.',
    );
  }
  return getBranchById(uid, id);
}

export async function getBranchDetailForTenant(
  sessionTenantId: string | null | undefined,
  branchId?: string | null,
): Promise<BmsBranchDetail | undefined> {
  const { ownerUid, branchId: defaultBranch } = await resolveSessionTenantBmsIds(sessionTenantId);
  const uid = ownerUid?.trim();
  const id = (branchId?.trim() || defaultBranch?.trim()) ?? '';
  if (!uid || !id) {
    throw new Error('No owner/branch id for tenant — set bms_owner_uid and bms_default_branch_id.');
  }
  const detail = await getBranchDetail(uid, id);
  return detail;
}
