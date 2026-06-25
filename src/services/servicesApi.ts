// ─── Types & REST API (BMS Black backend) ────────────────────────────────────

import {
  BMS_BLACK_API_URL,
  bmsBlackFetch,
  bmsBlackHeaders,
} from '@/services/bmsBlackApi';

const BASE_URL = BMS_BLACK_API_URL;

export type VehicleTypePricingEntry = {
  price: number;
  duration: number;
};

export type ServiceStaffMember = {
  id: string;
  name: string;
  role: string;
  branchId: string | null;
};

export type ChecklistItem = {
  index?: number;
  name: string;
  description: string;
  done: boolean;      // false by default — toggled by staff during bookings
  imageUrl: string;   // staff uploads image after task completion
  section?: string;
};

export type WorkshopService = {
  id: string;
  ownerUid: string;
  name: string;
  description?: string;
  price: number;
  duration: number;   // minutes
  icon?: string | null;
  imageUrl?: string | null;
  reviews?: number | null;
  branches: string[];
  staffIds: string[];
  /** Present on BMS REST payloads when staff are embedded on the service. */
  staff?: ServiceStaffMember[];
  vehicleTypes?: string[];
  vehicleTypePricing?: Record<string, VehicleTypePricingEntry>;
  pricingByVehicleType?: Record<string, VehicleTypePricingEntry>;
  checklistCount?: number;
  checklist: ChecklistItem[];
  completionImageUrl?: string | null;
};

/** Canonical vehicle category keys from BMS workshop catalog. */
export const WORKSHOP_VEHICLE_TYPE_ORDER = [
  'small_car',
  'sedan_wagon',
  'suv',
  'ute_van_4wd',
  'performance_large',
] as const;

export type WorkshopVehicleTypeId = (typeof WORKSHOP_VEHICLE_TYPE_ORDER)[number];

export const WORKSHOP_VEHICLE_TYPE_LABELS: Record<WorkshopVehicleTypeId, string> = {
  small_car: 'Small Car',
  sedan_wagon: 'Sedan / Wagon',
  suv: 'SUV',
  ute_van_4wd: '4WD / Ute / Van',
  performance_large: 'Performance / Large',
};

/** True when the catalog exposes per–vehicle-type pricing or explicit vehicle type lists. */
export function servicesOfferVehicleTiering(services: WorkshopService[]): boolean {
  return services.some(
    (s) =>
      (s.vehicleTypes != null && s.vehicleTypes.length > 0) ||
      (s.pricingByVehicleType != null && Object.keys(s.pricingByVehicleType).length > 0) ||
      (s.vehicleTypePricing != null && Object.keys(s.vehicleTypePricing).length > 0),
  );
}

export function workshopServiceSupportsVehicleType(
  service: WorkshopService,
  vehicleTypeId: string,
): boolean {
  const explicit = service.vehicleTypes;
  if (explicit != null && explicit.length > 0) {
    return explicit.includes(vehicleTypeId);
  }
  const keys = new Set([
    ...Object.keys(service.pricingByVehicleType ?? {}),
    ...Object.keys(service.vehicleTypePricing ?? {}),
  ]);
  if (keys.size > 0) return keys.has(vehicleTypeId);
  return true;
}

export function getWorkshopServicePriceForVehicleType(
  service: WorkshopService,
  vehicleTypeId: string,
): { price: number; duration: number } {
  const tier =
    service.pricingByVehicleType?.[vehicleTypeId] ??
    service.vehicleTypePricing?.[vehicleTypeId];
  if (tier) return { price: tier.price, duration: tier.duration };
  return { price: service.price, duration: service.duration };
}

export type ServiceInput = {
  name: string;
  price: number;
  duration: number;   // minutes
  icon?: string;
  imageUrl?: string;
  reviews?: number;
  branches: string[];
  staffIds: string[];
  checklist?: ChecklistItem[];
  completionImageUrl?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const normalizeChecklist = (raw: unknown[]): ChecklistItem[] =>
  (raw ?? []).map((item) => {
    if (typeof item === 'string') return { name: item, description: '', done: false, imageUrl: '' };
    const i = item as Record<string, unknown>;
    const index = i.index;
    const section = i.section;
    return {
      ...(typeof index === 'number' ? { index } : {}),
      name: String(i.name ?? ''),
      description: String(i.description ?? ''),
      done: !!i.done,
      imageUrl: String(i.imageUrl ?? ''),
      ...(section != null && String(section).length > 0 ? { section: String(section) } : {}),
    };
  });

function normalizeVehicleTypePricing(
  raw: unknown,
): Record<string, VehicleTypePricingEntry> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, VehicleTypePricingEntry> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const e = val as Record<string, unknown>;
    out[key] = {
      price: Number(e.price ?? 0),
      duration: Number(e.duration ?? 0),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeServiceStaff(raw: unknown): ServiceStaffMember[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const list: ServiceStaffMember[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const id = String(o.id ?? '');
    if (!id) continue;
    list.push({
      id,
      name: String(o.name ?? ''),
      role: String(o.role ?? ''),
      branchId: o.branchId == null ? null : String(o.branchId),
    });
  }
  return list.length > 0 ? list : undefined;
}

/** Maps GET /services (and related) JSON rows into `WorkshopService` (tenant id from header). */
function mapApiServiceToWorkshopService(
  raw: unknown,
  ownerUid: string,
): WorkshopService {
  const r = raw as Record<string, unknown>;
  const pricingByVehicleType = normalizeVehicleTypePricing(r.pricingByVehicleType);
  const vehicleTypePricing =
    normalizeVehicleTypePricing(r.vehicleTypePricing) ?? pricingByVehicleType;
  const staff = normalizeServiceStaff(r.staff);
  const staffIdsFromStaff = staff?.map((s) => s.id) ?? [];
  const explicitStaffIds = Array.isArray(r.staffIds)
    ? (r.staffIds as unknown[]).map((id) => String(id)).filter(Boolean)
    : [];
  const staffIds = explicitStaffIds.length > 0 ? explicitStaffIds : staffIdsFromStaff;

  const checklist = normalizeChecklist(Array.isArray(r.checklist) ? r.checklist : []);
  const checklistCount =
    typeof r.checklistCount === 'number'
      ? r.checklistCount
      : checklist.length > 0
        ? checklist.length
        : undefined;

  return {
    id: String(r.id ?? ''),
    ownerUid: String(r.ownerUid ?? ownerUid),
    name: String(r.name ?? ''),
    ...(r.description != null && String(r.description).length > 0
      ? { description: String(r.description) }
      : {}),
    price: Number(r.price ?? 0),
    duration: Number(r.duration ?? 0),
    icon: r.icon !== undefined && r.icon !== null ? String(r.icon) : null,
    imageUrl: r.imageUrl != null && String(r.imageUrl).length > 0 ? String(r.imageUrl) : null,
    reviews: r.reviews != null ? Number(r.reviews) : null,
    branches: Array.isArray(r.branches) ? r.branches.map(String) : [],
    staffIds,
    ...(staff ? { staff } : {}),
    ...(Array.isArray(r.vehicleTypes) && r.vehicleTypes.length > 0
      ? { vehicleTypes: r.vehicleTypes.map(String) }
      : {}),
    ...(vehicleTypePricing ? { vehicleTypePricing } : {}),
    ...(pricingByVehicleType ? { pricingByVehicleType } : {}),
    ...(checklistCount != null ? { checklistCount } : {}),
    checklist,
    completionImageUrl:
      r.completionImageUrl != null && String(r.completionImageUrl).length > 0
        ? String(r.completionImageUrl)
        : null,
  };
}

function extractServiceRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const body = raw as Record<string, unknown>;
  for (const key of ['services', 'data', 'items', 'results']) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function apiHeaders(ownerUid: string): HeadersInit {
  return bmsBlackHeaders(ownerUid);
}

/** GET /services — all services for a workshop */
export async function getServices(ownerUid: string): Promise<WorkshopService[]> {
  const res = await bmsBlackFetch(`${BASE_URL}/services`, { headers: apiHeaders(ownerUid) });
  if (!res.ok) throw new Error(`getServices failed: ${res.status}`);
  const rows = extractServiceRows(await res.json());
  return rows.map((row) => mapApiServiceToWorkshopService(row, ownerUid));
}

/** GET /services-by-branch?branchId=X — services filtered to a specific branch */
export async function getServicesByBranch(ownerUid: string, branchId: string): Promise<WorkshopService[]> {
  const url = `${BASE_URL}/services-by-branch?branchId=${encodeURIComponent(branchId)}`;
  const res = await bmsBlackFetch(url, { headers: apiHeaders(ownerUid) });
  if (!res.ok) throw new Error(`getServicesByBranch failed: ${res.status}`);
  const rows = extractServiceRows(await res.json());
  return rows.map((row) => mapApiServiceToWorkshopService(row, ownerUid));
}

/** GET /services/:id — full service detail with checklist, branches, staff */
export async function getServiceById(ownerUid: string, serviceId: string): Promise<WorkshopService | null> {
  const res = await bmsBlackFetch(`${BASE_URL}/services/${encodeURIComponent(serviceId)}`, { headers: apiHeaders(ownerUid) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getServiceById failed: ${res.status}`);
  const json = (await res.json()) as { service?: unknown };
  const svc = json.service;
  if (svc == null) return null;
  return mapApiServiceToWorkshopService(svc, ownerUid);
}
