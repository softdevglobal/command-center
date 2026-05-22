/**
 * staffApi.ts — Fetch workshop staff from the BMS API
 *
 * Endpoint: GET /staff?branchId=xxx  (via BMS call-center API)
 *
 * Falls back to collecting staff from selected services if the
 * dedicated endpoint is unavailable.
 */

import {
  BMS_BLACK_API_URL,
  bmsBlackFetch,
  bmsBlackHeaders,
} from '@/services/bmsBlackApi';

const BASE_URL = BMS_BLACK_API_URL;

export interface StaffMember {
  id: string;
  name: string;
}

function apiHeaders(ownerUid: string): HeadersInit {
  return bmsBlackHeaders(ownerUid);
}

/**
 * Fetch all staff for a branch from the BMS API.
 * Falls back to an empty array if the endpoint isn't available.
 */
export async function getStaffByBranch(
  ownerUid: string,
  branchId: string,
): Promise<StaffMember[]> {
  try {
    const url = `${BASE_URL}/staff?branchId=${encodeURIComponent(branchId)}`;
    const res = await bmsBlackFetch(url, { headers: apiHeaders(ownerUid) });
    if (!res.ok) return [];
    const json = await res.json();
    const raw: unknown[] = json.staff ?? json ?? [];
    return raw.map((s: any) => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
    })).filter((s) => s.id && s.name);
  } catch {
    return [];
  }
}
