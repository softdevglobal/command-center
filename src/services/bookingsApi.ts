import { supabase } from '@/integrations/supabase/client';
import {
  BMS_BLACK_API_URL,
  bmsBlackFetch,
  bmsBlackHeaders,
} from '@/services/bmsBlackApi';
import { getAllBookings as getBlackAllBookings } from '@/lib/bms-black-api';
import type { UserRole } from '@/services/types';
import { getServiceById } from '@/services/servicesApi';

/** Load BMS workshop owner UID for a Supabase tenant (when set in `tenants.bms_owner_uid`). */
export async function resolveBmsOwnerUidForTenant(tenantId: string | null | undefined): Promise<string | null> {
  if (!tenantId) return null;
  const { data, error } = await supabase
    .from('tenants')
    .select('bms_owner_uid')
    .eq('id', tenantId)
    .maybeSingle();
  if (error || !data?.bms_owner_uid) return null;
  const v = String(data.bms_owner_uid).trim();
  return v || null;
}

/** Default BMS branch id for a tenant (`tenants.bms_default_branch_id`). */
export async function resolveBmsDefaultBranchForTenant(tenantId: string | null | undefined): Promise<string | null> {
  if (!tenantId) return null;
  const { data, error } = await supabase
    .from('tenants')
    .select('bms_default_branch_id')
    .eq('id', tenantId)
    .maybeSingle();
  if (error || !data?.bms_default_branch_id) return null;
  const v = String(data.bms_default_branch_id).trim();
  return v || null;
}

/**
 * After navigation state / `cc_last_owner_id`, pass `session.tenantId` to load `tenants.bms_owner_uid`.
 * No env fallback — configure each tenant in Supabase.
 */
export async function resolveOwnerUid(sessionTenantId?: string | null): Promise<string> {
  const fromDb = await resolveBmsOwnerUidForTenant(sessionTenantId);
  return fromDb ?? '';
}

export async function resolveDefaultBranchId(sessionTenantId?: string | null): Promise<string | undefined> {
  const fromDb = await resolveBmsDefaultBranchForTenant(sessionTenantId);
  return fromDb ?? undefined;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type BookingServiceItem = {
  serviceId: string;
  serviceName: string;
  price: number;
  duration: number;
};

export type BookingService = {
  id?: string;
  name: string;
  price: number;
  staffId?: string | null;
  staffName: string | null;
  completionStatus: string;
};

export type Booking = {
  id: string;
  ownerUid: string;
  bookingCode?: string;
  status?: string;
  branchId: string;
  branchName?: string;
  date: string;
  time: string;
  pickupTime?: string;
  services: BookingServiceItem[] | BookingService[];
  client: string;
  clientName?: string;
  clientEmail: string;
  clientPhone: string;
  customerId?: string;
  vehicleNumber?: string;
  vehicleMake?: string;
  notes?: string;
  source?: string;
  totalPrice?: number;
  progress?: { completed: number; total: number; percentage: number };
  additionalIssues?: Record<string, unknown>[];
  additionalIssueCount?: number;
  pendingApprovalCount?: number;
  createdAt?: { _seconds: number; _nanoseconds: number };
};

export type AvailabilityResponse = {
  available: boolean;
  availableSlots: string[];
};

/** Normalize a time label to `HH:mm` for compares, selects, and availability checks. */
export function trimBmsTimeLabel(t: string | undefined): string {
  if (!t?.trim()) return '';
  const s = t.trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s.slice(0, 8);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function minutesFromBmsTimeLabel(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

/** Dedupe + sort GET /bookings/availability slot strings to `HH:mm`. */
export function normalizeBookingAvailabilitySlots(slots: string[]): string[] {
  return [...new Set(slots.map((t) => trimBmsTimeLabel(t)).filter(Boolean))].sort(
    (a, b) => (minutesFromBmsTimeLabel(a) ?? 0) - (minutesFromBmsTimeLabel(b) ?? 0),
  );
}

export type StaffStatus = 'Active' | 'Suspended';
export type StaffRole = 'staff' | 'branch_admin';

export type WorkshopStaff = {
  id: string;
  uid: string;
  name: string;
  email: string | null;
  mobile: string | null;
  role: StaffRole | string;
  staffRole: string | null;
  branchId: string | null;
  branchName: string | null;
  status: StaffStatus | string;
  avatar: string | null;
  timezone: string | null;
  weeklySchedule: Record<string, { branchId: string; branchName: string } | null> | null;
  training: Record<string, boolean> | null;
  createdAt: { _seconds: number; _nanoseconds: number } | null;
  updatedAt: { _seconds: number; _nanoseconds: number } | null;
};

/** Whether GET /getallbooking should list all workshops (Bearer only, no tenant header). */
export function getBookingsListScope(session: {
  role: UserRole;
  tenantId: string | null;
} | null | undefined): 'global' | 'tenant' {
  if (!session) return 'tenant';
  if (session.role === 'super-admin') return 'global';
  if (session.role === 'agent' && !session.tenantId?.trim()) return 'global';
  return 'tenant';
}

export type GetBookingsParams =
  | { scope: 'global'; limit?: number; branchId?: string }
  | {
      scope: 'tenant';
      ownerUid: string;
      limit?: number;
      branchId?: string;
    };

// ─── Config ──────────────────────────────────────────────────────────────────

/** BMS Black REST root. In dev this is proxied by Vite. */
const BASE_URL = BMS_BLACK_API_URL;

/** Build path + query — avoids `new URL('/relative')` throwing when BASE_URL is `/api/...` (dev proxy). */
function ccPathWithSearch(path: string, search?: URLSearchParams): string {
  const q = search?.toString();
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
  return `${base}${p}${q ? `?${q}` : ''}`;
}

function extractBookingsListRows(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (!json || typeof json !== 'object') return [];
  const o = json as Record<string, unknown>;
  const candidates = [o.bookings, o.data, o.items, o.results];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Record<string, unknown>[];
  }
  return [];
}

// ─── Headers Helper ──────────────────────────────────────────────────────────

function apiHeaders(ownerUid: string): HeadersInit {
  return bmsBlackHeaders(ownerUid);
}

/** Dashboard JWT only — omit `X-Tenant-Id` (customer notifications + all-booking list). */
function bearerOnlyHeaders(): HeadersInit {
  return bmsBlackHeaders();
}

/** Log HTTP errors (status + body preview) before throwing — use on every `!res.ok` branch. */
async function bookingsApiHttpError(
  operation: string,
  res: Response,
  url: string,
): Promise<never> {
  let preview = '';
  try {
    preview = (await res.clone().text()).slice(0, 800);
  } catch {
    preview = '';
  }
  // console.error(`[bookingsApi] ${operation}`, {
  //   status: res.status,
  //   statusText: res.statusText,
  //   url,
  //   bodyPreview: preview.length > 0 ? preview : '(empty)',
  // });
  const clipped =
    preview.length > 280 ? `${preview.slice(0, 280)}…` : preview;
  throw new Error(
    `${operation} failed: ${res.status}${clipped ? ` — ${clipped}` : ''}`,
  );
}

async function bookingsApiFetch(
  operation: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await bmsBlackFetch(url, init);
  } catch (e) {
    // console.error(`[bookingsApi] ${operation} fetch failed`, { url, error: e });
    throw e;
  }
}

// ─── 1. GET Availability ─────────────────────────────────────────────────────

/** Branch capacity / open slots for a date and service mix (new booking + reschedule must respect this). */
export async function getBookingAvailability(
  ownerUid: string,
  branchId: string,
  date: string,
  serviceIds: string[],
): Promise<AvailabilityResponse> {
  const search = new URLSearchParams({
    branchId,
    date,
    serviceIds: serviceIds.join(','),
  });
  const url = ccPathWithSearch('/bookings/availability', search);

  const res = await bookingsApiFetch('getBookingAvailability', url, {
    headers: await apiHeaders(ownerUid),
  });

  if (!res.ok) {
    await bookingsApiHttpError('getBookingAvailability', res, url);
  }

  return (await res.json()) as AvailabilityResponse;
}

// ─── 2. GET All Bookings ──────────────────────────────────────────────────────

/** Map GET /getallbooking payload to `Booking` (fills `ownerUid` / `client` when omitted). */
function normalizeBookingListItem(
  raw: Record<string, unknown>,
  fallbackOwnerUid: string,
): Booking {
  const r = raw as Record<string, any>;
  const services = (Array.isArray(r.services) ? r.services : []) as Booking['services'];
  const additionalIssues = r.additionalIssues;
  return {
    id: String(r.id ?? ''),
    ownerUid: String(r.ownerUid ?? r.owner_uid ?? fallbackOwnerUid),
    bookingCode: r.bookingCode,
    status: r.status,
    branchId: String(r.branchId ?? r.branch_id ?? ''),
    branchName: r.branchName,
    date: String(r.date ?? r.booking_date ?? ''),
    time: String(r.time ?? ''),
    pickupTime: r.pickupTime,
    services,
    client: String(r.client ?? r.clientName ?? ''),
    clientName: r.clientName ?? r.client,
    clientEmail: String(r.clientEmail ?? ''),
    clientPhone: String(r.clientPhone ?? ''),
    customerId: r.customerId,
    vehicleNumber: r.vehicleNumber,
    vehicleMake: r.vehicleMake,
    notes: r.notes,
    source: r.source,
    totalPrice: typeof r.totalPrice === 'number' ? r.totalPrice : undefined,
    progress: r.progress,
    additionalIssues: Array.isArray(additionalIssues)
      ? (additionalIssues as Record<string, unknown>[])
      : undefined,
    additionalIssueCount: r.additionalIssueCount,
    pendingApprovalCount: r.pendingApprovalCount,
    createdAt: r.createdAt,
  };
}

export async function getBookings(params: GetBookingsParams): Promise<Booking[]> {
  const limit = params.limit ?? 25;
  const branchId = params.branchId;

  let fallbackOwnerUid: string;

  if (params.scope === 'tenant') {
    const ownerUid = String(params.ownerUid ?? '').trim();
    if (!ownerUid) {
      console.warn('[getBookings] tenant scope requires ownerUid — returning empty.');
      return [];
    }
    fallbackOwnerUid = ownerUid;
  } else {
    fallbackOwnerUid = '';
  }

  let bookings: Booking[] = (await getBlackAllBookings()).map((row) =>
    normalizeBookingListItem(row as Record<string, unknown>, fallbackOwnerUid),
  );

  if (branchId) {
    bookings = bookings.filter((b) => b.branchId === branchId);
  }
  if (params.scope === 'tenant') {
    bookings = bookings.filter((b) => !b.ownerUid || b.ownerUid === fallbackOwnerUid);
  }

  return bookings.slice(0, limit);
}

// ─── 2b. GET Workshop Staff ──────────────────────────────────────────────────

export async function getWorkshopStaff(
  ownerUid: string,
  options?: {
    branchId?: string;
    role?: StaffRole;
    status?: StaffStatus;
  },
): Promise<WorkshopStaff[]> {
  const qs = new URLSearchParams();
  if (options?.branchId) qs.set('branchId', options.branchId);
  if (options?.role) qs.set('role', options.role);
  if (options?.status) qs.set('status', options.status);

  const fetchUrl = ccPathWithSearch('/staff', qs);

  const res = await bookingsApiFetch('getWorkshopStaff', fetchUrl, {
    headers: await apiHeaders(ownerUid),
  });

  if (!res.ok) {
    await bookingsApiHttpError('getWorkshopStaff', res, fetchUrl);
  }

  const json = await res.json();
  const staff = (json.staff ?? []) as WorkshopStaff[];
  // console.log(
  //   '[getWorkshopStaff] Workshop staff list (not service-specific). Count:',
  //   staff.length,
  //   staff.map((s) => ({ id: s.id, uid: s.uid, name: s.name })),
  // );
  return staff;
}

export type ServiceStaffAvailabilityResponse = {
  service?: {
    id?: string;
    name?: string;
    hasStaffAllowList?: boolean;
    staffIds?: string[];
  };
  filter?: {
    branchId?: string | null;
    branchName?: string | null;
    date?: string;
    dayName?: string;
  };
  staff?: WorkshopStaff[];
  total?: number;
};

function workshopStaffFromLite(raw: {
  id?: string;
  uid?: string;
  name?: string;
}): WorkshopStaff {
  const id = String(raw.id ?? raw.uid ?? '');
  const uid = String(raw.uid ?? raw.id ?? id);
  const name = String(raw.name ?? '').trim() || id;
  return {
    id,
    uid,
    name,
    email: null,
    mobile: null,
    role: 'staff',
    staffRole: null,
    branchId: null,
    branchName: null,
    status: 'Active',
    avatar: null,
    timezone: null,
    weeklySchedule: null,
    training: null,
    createdAt: null,
    updatedAt: null,
  };
}

/**
 * When GET /services/:id/staff returns `staff: []` but `service.staffIds` is set,
 * resolve display names from GET /services/:id (`staff[]` on the service record).
 */
async function resolveStaffFromAllowListAndServiceDetail(
  ownerUid: string,
  serviceId: string,
  allowedIds: string[],
): Promise<WorkshopStaff[]> {
  const ids = [...new Set(allowedIds.map(String).filter(Boolean))];
  if (ids.length === 0) return [];

  let detail: Awaited<ReturnType<typeof getServiceById>> = null;
  try {
    detail = await getServiceById(ownerUid, serviceId);
  } catch {
    // console.error(
    //   '[bookingsApi] resolveStaffFromAllowListAndServiceDetail: getServiceById failed',
    //   { ownerUid, serviceId, error: e },
    // );
    detail = null;
  }

  const rosterRaw = (detail as unknown as { staff?: unknown } | null)?.staff;
  const roster = Array.isArray(rosterRaw)
    ? (rosterRaw as { id?: string; uid?: string; name?: string }[])
    : [];

  const idSet = new Set(ids);
  const byId = new Map<string, WorkshopStaff>();
  for (const row of roster) {
    const id = String(row.id ?? row.uid ?? '');
    if (!id || !idSet.has(id)) continue;
    byId.set(id, workshopStaffFromLite(row));
  }

  const ordered: WorkshopStaff[] = [];
  for (const id of ids) {
    const found = byId.get(id);
    if (found) ordered.push(found);
    else {
      ordered.push(
        workshopStaffFromLite({
          id,
          uid: id,
          name: `Staff (${id.length > 8 ? id.slice(-6) : id})`,
        }),
      );
    }
  }
  return ordered;
}

export async function getStaffForService(
  ownerUid: string,
  serviceId: string,
  options: {
    branchId: string;
    date: string;
  },
): Promise<WorkshopStaff[]> {
  const qs = new URLSearchParams({
    branchId: options.branchId,
    date: options.date,
  });
  const fetchUrl = ccPathWithSearch(
    `/services/${encodeURIComponent(serviceId)}/staff`,
    qs,
  );

  const res = await bookingsApiFetch('getStaffForService', fetchUrl, {
    headers: await apiHeaders(ownerUid),
  });

  if (!res.ok) {
    await bookingsApiHttpError('getStaffForService', res, fetchUrl);
  }

  const json = (await res.json()) as ServiceStaffAvailabilityResponse;
  // console.log('[getStaffForService] GET /services/:id/staff — raw envelope', {
  //   serviceId,
  //   branchId: options.branchId,
  //   date: options.date,
  //   url: url.toString(),
  //   serviceName: json.service?.name,
  //   hasStaffAllowList: json.service?.hasStaffAllowList,
  //   staffIds: json.service?.staffIds,
  //   staffArrayLength: (json.staff ?? []).length,
  //   total: json.total,
  // });

  const fromEndpoint = (json.staff ?? []) as WorkshopStaff[];
  if (fromEndpoint.length > 0) {
    // console.log(
    //   '[getStaffForService] Relevant staff who can do this service (from response staff[]).',
    //   {
    //     serviceId,
    //     count: fromEndpoint.length,
    //     staff: fromEndpoint.map((s) => ({ id: s.id, name: s.name })),
    //   },
    // );
    return fromEndpoint;
  }

  const allowList = json.service?.staffIds ?? [];
  if (allowList.length === 0) {
    // console.log(
    //   '[getStaffForService] No staff in response and no staffIds — empty relevant list.',
    //   { serviceId },
    // );
    return [];
  }

  const resolved = await resolveStaffFromAllowListAndServiceDetail(
    ownerUid,
    serviceId,
    allowList,
  );
  // console.log(
  //   '[getStaffForService] Relevant staff who can do this service (resolved from staffIds + GET /services/:id).',
  //   {
  //     serviceId,
  //     count: resolved.length,
  //     staff: resolved.map((s) => ({ id: s.id, name: s.name })),
  //   },
  // );
  return resolved;
}

// ─── 3. POST Create Booking ──────────────────────────────────────────────────

export type VehicleDetails = {
  make?: string;
  model?: string;
  year?: string;
  registrationNumber?: string;
  mileage?: string;
  bodyType?: string;
  colour?: string;
  vinChassis?: string;
  engineNumber?: string;
  notes?: string;
};

export async function createBooking(data: {
  ownerUid: string;
  branchId: string;
  date: string;
  time: string;
  pickupTime?: string;
  services: BookingServiceItem[];
  client: string;
  clientEmail: string;
  clientPhone: string;
  customerId?: string;
  /** BMS catalog key, e.g. `small_car`, when booking is priced by vehicle category. */
  vehicleType?: string;
  vehicleDetails?: VehicleDetails;
  notes?: string;
}): Promise<{ bookingId: string }> {
  const fetchUrl = `${BASE_URL}/bookings`;
  const res = await bookingsApiFetch('createBooking', fetchUrl, {
    method: 'POST',
    headers: await apiHeaders(data.ownerUid),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    await bookingsApiHttpError('createBooking', res, fetchUrl);
  }

  const json = (await res.json()) as { bookingId?: string; id?: string };
  return { bookingId: String(json.bookingId ?? json.id ?? '') };
}

// ─── 4. GET Booking Detail ───────────────────────────────────────────────────

export type BookingTask = {
  id: string;
  serviceId: string;
  serviceName: string;
  name: string;
  description: string;
  done: boolean;
  imageUrl: string;
  staffNote: string;
  completedAt: { _seconds: number; _nanoseconds: number } | null;
};

export type BookingServiceDetail = {
  id: string;
  name: string;
  price: number;
  duration: number;
  staffId: string | null;
  staffName: string | null;
  approvalStatus: string;
  completionStatus: string;
  completedAt: { _seconds: number; _nanoseconds: number } | null;
};

export type BookingActivity = {
  id: string;
  type: string;
  message: string;
  performedByName: string;
  performedByRole: string;
  timestamp: { _seconds: number; _nanoseconds: number } | null;
};

export type BookingDetail = {
  booking: {
    id: string;
    bookingCode: string;
    status: string;
    date: string;
    time: string;
    pickupTime?: string;
    duration?: number;
    totalPrice: number;
    ownerUid: string;
    branchId: string;
    branchName: string;
    client: string;
    clientEmail: string;
    clientPhone: string;
    customerId?: string;
    vehicleNumber?: string;
    vehicleBodyType?: string;
    vehicleColour?: string;
    vehicleMileage?: string;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleYear?: string;
    vehicleVinChassis?: string;
    vehicleEngineNumber?: string;
    notes?: string;
    source?: string;
    createdAt: { _seconds: number; _nanoseconds: number };
    updatedAt: { _seconds: number; _nanoseconds: number };
  };
  services: BookingServiceDetail[];
  tasks: BookingTask[];
  additionalIssues: Record<string, unknown>[];
  progress: {
    services: { completed: number; total: number; percentage: number };
    tasks: { completed: number; total: number; percentage: number };
  };
  activities: BookingActivity[];
};

type DetailProgressSlice = BookingDetail['progress']['tasks'];

function coerceDetailProgressSlice(v: unknown): DetailProgressSlice {
  if (!v || typeof v !== 'object') return { completed: 0, total: 0, percentage: 0 };
  const o = v as Record<string, unknown>;
  const completed = Number(o.completed ?? 0);
  const total = Number(o.total ?? 0);
  let percentage = Number(o.percentage ?? NaN);
  if (!Number.isFinite(percentage)) {
    percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  }
  return { completed, total, percentage };
}

/**
 * Unwrap `{ data?: … }`-style payloads and guarantee arrays/progress so the booking
 * detail page never crashes on partial BMS responses.
 */
function normalizeBookingDetailPayload(raw: unknown): BookingDetail {
  let obj =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : null;
  if (!obj) throw new Error('Invalid booking detail: empty response');

  for (const key of ['data', 'result', 'payload'] as const) {
    const inner = obj[key];
    if (
      inner &&
      typeof inner === 'object' &&
      ('booking' in (inner as object) ||
        typeof (inner as Record<string, unknown>).id === 'string')
    ) {
      obj = inner as Record<string, unknown>;
      break;
    }
  }

  let booking: unknown =
    obj.booking && typeof obj.booking === 'object' ? obj.booking : null;

  const useFlatBooking =
    !booking &&
    typeof obj.id === 'string' &&
    (obj.bookingCode != null ||
      obj.date != null ||
      obj.time != null ||
      obj.status != null);

  if (useFlatBooking) booking = obj;

  if (!booking || typeof booking !== 'object') {
    throw new Error('Invalid booking detail: missing booking payload');
  }

  const bk = booking as Record<string, unknown>;

  const services = (
    Array.isArray(obj.services) ? obj.services : Array.isArray(bk.services) ? bk.services : []
  ) as BookingDetail['services'];

  const tasks = (
    Array.isArray(obj.tasks) ? obj.tasks : Array.isArray(bk.tasks) ? bk.tasks : []
  ) as BookingDetail['tasks'];

  let additionalIssues: BookingDetail['additionalIssues'] =
    Array.isArray(obj.additionalIssues)
      ? (obj.additionalIssues as BookingDetail['additionalIssues'])
      : [];
  if (additionalIssues.length === 0 && Array.isArray(bk.additionalIssues)) {
    additionalIssues = bk.additionalIssues as BookingDetail['additionalIssues'];
  }

  const activities = (
    Array.isArray(obj.activities)
      ? obj.activities
      : Array.isArray(bk.activities)
        ? bk.activities
        : []
  ) as BookingDetail['activities'];

  const progressSrc = obj.progress ?? bk.progress;
  const progressRaw =
    progressSrc && typeof progressSrc === 'object'
      ? (progressSrc as Record<string, unknown>)
      : null;

  let progress: BookingDetail['progress'];
  if (!progressRaw) {
    const doneSv = services.filter((s: BookingServiceDetail) =>
      ['completed', 'done'].includes(
        String(s.completionStatus ?? '').toLowerCase(),
      ),
    ).length;
    const totalTk = tasks.length;
    const doneTk = tasks.filter((t: BookingTask) => t.done === true).length;
    progress = {
      services: {
        completed: doneSv,
        total: services.length,
        percentage:
          services.length > 0
            ? Math.round((doneSv / services.length) * 100)
            : 0,
      },
      tasks: {
        completed: doneTk,
        total: totalTk,
        percentage: totalTk > 0 ? Math.round((doneTk / totalTk) * 100) : 0,
      },
    };
  } else {
    progress = {
      services: coerceDetailProgressSlice(progressRaw.services),
      tasks: coerceDetailProgressSlice(progressRaw.tasks),
    };
  }

  return {
    booking: booking as BookingDetail['booking'],
    services,
    tasks,
    additionalIssues,
    progress,
    activities,
  };
}

export async function getBookingById(
  ownerUid: string,
  bookingId: string,
): Promise<BookingDetail> {
  const fetchUrl = `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}`;
  const res = await bookingsApiFetch('getBookingById', fetchUrl, {
    headers: await apiHeaders(ownerUid),
  });

  if (!res.ok) {
    await bookingsApiHttpError('getBookingById', res, fetchUrl);
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (e) {
    // console.error('[bookingsApi] getBookingById: response is not valid JSON', e);
    throw e;
  }

  try {
    return normalizeBookingDetailPayload(parsed);
  } catch (e) {
    // console.error('[bookingsApi] getBookingById: cannot normalize payload', {
    //   parsed,
    //   error: e,
    // });
    throw e instanceof Error ? e : new Error('Invalid booking detail response');
  }
}

export type UpdateBookingPayload = Partial<{
  branchId: string;
  date: string;
  time: string;
  pickupTime: string;
  services: BookingServiceItem[];
  client: string;
  clientEmail: string;
  clientPhone: string;
  customerId: string;
  vehicleNumber: string;
  vehicleType: string;
  vehicleDetails: VehicleDetails;
  notes: string;
  status: string;
}>;

/** PATCH/PUT /bookings/{bookingId} — generic booking update. */
export async function updateBooking(
  ownerUid: string,
  bookingId: string,
  payload: UpdateBookingPayload,
  method: 'PATCH' | 'PUT' = 'PATCH',
): Promise<unknown> {
  const fetchUrl = `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}`;
  const res = await bookingsApiFetch('updateBooking', fetchUrl, {
    method,
    headers: await apiHeaders(ownerUid),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    await bookingsApiHttpError('updateBooking', res, fetchUrl);
  }

  return await res.json().catch(() => ({}));
}

/** BMS booking workflow values (see CALL_CENTER_API.md). */
export type BmsBookingWorkflowStatus = 'Confirmed' | 'Canceled';

/**
 * PATCH /bookings/{bookingId} — update workflow status (e.g. confirm or cancel request).
 * Body uses BMS capitalization: `Confirmed`, `Canceled`.
 */
export async function patchBookingWorkflowStatus(
  ownerUid: string,
  bookingId: string,
  status: BmsBookingWorkflowStatus,
): Promise<unknown> {
  const fetchUrl = `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}`;
  const res = await bookingsApiFetch('patchBookingWorkflowStatus', fetchUrl, {
    method: 'PATCH',
    headers: await apiHeaders(ownerUid),
    body: JSON.stringify({ status }),
  });

  if (!res.ok) {
    await bookingsApiHttpError('patchBookingWorkflowStatus', res, fetchUrl);
  }

  return await res.json().catch(() => ({}));
}

export type BookingConfirmStaffAssignment = {
  staffId: string;
  staffName: string;
};

/** Keys are booking line service ids (`BookingServiceDetail.id`). */
export type BookingConfirmStaffAssignments = Record<
  string,
  BookingConfirmStaffAssignment
>;

/**
 * POST /bookings/{bookingId}/confirm — confirm pending booking with per-line staff.
 * Body: `{ staffAssignments: { [serviceId]: { staffId, staffName } } }`
 */
export async function confirmBookingWithStaff(
  ownerUid: string,
  bookingId: string,
  staffAssignments: BookingConfirmStaffAssignments,
): Promise<unknown> {
  const fetchUrl = `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}/confirm`;
  const res = await bookingsApiFetch('confirmBookingWithStaff', fetchUrl, {
    method: 'POST',
    headers: await apiHeaders(ownerUid),
    body: JSON.stringify({ staffAssignments }),
  });

  if (!res.ok) {
    await bookingsApiHttpError('confirmBookingWithStaff', res, fetchUrl);
  }

  return await res.json().catch(() => ({}));
}

/** PATCH /bookings/{id}/reschedule — new slot, optional reason, optional staff changes. */
export type BookingReschedulePayload = {
  newDate: string;
  newTime: string;
  newPickupTime?: string;
  reason?: string;
  staffAssignments?: BookingConfirmStaffAssignments;
  newStaffId?: string;
  newStaffName?: string;
};

export async function patchBookingReschedule(
  ownerUid: string,
  bookingId: string,
  payload: BookingReschedulePayload,
): Promise<unknown> {
  const body: Record<string, unknown> = {
    newDate: payload.newDate,
    newTime: payload.newTime,
  };
  if (payload.newPickupTime?.trim()) {
    body.newPickupTime = payload.newPickupTime.trim();
  }
  if (payload.reason?.trim()) {
    body.reason = payload.reason.trim();
  }
  if (
    payload.staffAssignments &&
    Object.keys(payload.staffAssignments).length > 0
  ) {
    body.staffAssignments = payload.staffAssignments;
  }
  if (payload.newStaffId?.trim()) {
    body.newStaffId = payload.newStaffId.trim();
    if (payload.newStaffName?.trim()) {
      body.newStaffName = payload.newStaffName.trim();
    }
  }

  const fetchUrl = `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}/reschedule`;
  const res = await bookingsApiFetch('patchBookingReschedule', fetchUrl, {
    method: 'PATCH',
    headers: await apiHeaders(ownerUid),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await bookingsApiHttpError('patchBookingReschedule', res, fetchUrl);
  }

  return await res.json().catch(() => ({}));
}

/**
 * POST /bookings/{id}/cancel
 * Optional body: { reason?: string }
 */
export async function cancelBooking(
  ownerUid: string,
  bookingId: string,
  reason?: string,
): Promise<unknown> {
  const payload = reason?.trim() ? { reason: reason.trim() } : {};
  const fetchUrl = `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}/cancel`;
  const res = await bookingsApiFetch('cancelBooking', fetchUrl, {
    method: 'POST',
    headers: await apiHeaders(ownerUid),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    await bookingsApiHttpError('cancelBooking', res, fetchUrl);
  }

  return await res.json().catch(() => ({}));
}

// ─── 5. Additional Issues ─────────────────────────────────────────────────────

export async function getAdditionalIssues(
  ownerUid: string,
  bookingId: string,
): Promise<any> {
  const fetchUrl = `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}/additional-issues`;
  const res = await bookingsApiFetch('getAdditionalIssues', fetchUrl, {
    headers: await apiHeaders(ownerUid),
  });

  if (!res.ok) {
    await bookingsApiHttpError('getAdditionalIssues', res, fetchUrl);
  }

  return await res.json();
}

export async function updateIssueDecision(
  ownerUid: string,
  bookingId: string,
  issueId: string,
  customerResponse: 'accept' | 'reject',
): Promise<any> {
  const fetchUrl = `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}/additional-issues/${encodeURIComponent(issueId)}`;
  const res = await bookingsApiFetch('updateIssueDecision', fetchUrl, {
    method: 'PATCH',
    headers: await apiHeaders(ownerUid),
    body: JSON.stringify({ customerResponse }),
  });

  if (!res.ok) {
    await bookingsApiHttpError('updateIssueDecision', res, fetchUrl);
  }

  return await res.json();
}

export type UpdateIssuePricePayload =
  | { status: 'approved'; price: number; customerPhone?: string; customerEmail?: string }
  | { status: 'rejected'; customerPhone?: string; customerEmail?: string };

export async function updateIssuePrice(
  ownerUid: string,
  bookingId: string,
  issueId: string,
  payload: UpdateIssuePricePayload,
): Promise<any> {
  const fetchUrl = `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}/additional-issues/${encodeURIComponent(issueId)}/price`;
  const res = await bookingsApiFetch('updateIssuePrice', fetchUrl, {
    method: 'PATCH',
    headers: await apiHeaders(ownerUid),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    await bookingsApiHttpError('updateIssuePrice', res, fetchUrl);
  }

  return await res.json();
}

// ─── 7. Call Logs ────────────────────────────────────────────────────────────

export async function createCallLog(data: {
  ownerUid: string;
  branchId: string;
  callerPhone: string;
  direction: 'inbound' | 'outbound';
  purpose: string;
  duration: number;
  notes?: string;
  outcome?: string;
  customerId?: string;
  bookingId?: string;
  callCenterCallId?: string;
}): Promise<{ callLogId: string }> {
  const fetchUrl = `${BASE_URL}/call-logs`;
  const res = await bookingsApiFetch('createCallLog', fetchUrl, {
    method: 'POST',
    headers: await apiHeaders(data.ownerUid),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    await bookingsApiHttpError('createCallLog', res, fetchUrl);
  }

  return await res.json();
}

export type CallLog = {
  id: string;
  callerPhone: string;
  direction: string;
  purpose: string;
  duration: number;
  notes?: string;
  outcome?: string;
  createdAt: { _seconds: number; _nanoseconds: number };
};

export async function getCallLogs(
  ownerUid: string,
  limit: number = 10,
): Promise<CallLog[]> {
  const fetchUrl = `${BASE_URL}/call-logs?ownerUid=${ownerUid}&limit=${limit}`;
  const res = await bookingsApiFetch('getCallLogs', fetchUrl, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    await bookingsApiHttpError('getCallLogs', res, fetchUrl);
  }

  const json = await res.json();
  return json.callLogs ?? [];
}

// ─── 7. Webhooks ─────────────────────────────────────────────────────────────

export async function getWebhooks(): Promise<Record<string, unknown>[]> {
  const fetchUrl = `${BASE_URL}/webhooks`;
  const res = await bookingsApiFetch('getWebhooks', fetchUrl, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    await bookingsApiHttpError('getWebhooks', res, fetchUrl);
  }

  const json = await res.json();
  return json.webhooks ?? [];
}
