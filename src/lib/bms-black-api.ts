import { API_BASE, apiFetch, getAccessToken, logout } from '@/lib/api';

export const BMS_BLACK_API_BASE = `${API_BASE}/bms-black`;

export type BmsBlackHttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type BmsBlackRequestOptions = {
  method?: BmsBlackHttpMethod;
  tenantId?: string | null;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
};

export class BmsBlackApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`BMS Black API failed: ${status}${detail ? ` - ${detail}` : ''}`);
    this.name = 'BmsBlackApiError';
    this.status = status;
    this.detail = detail;
  }
}

export type CustomerNotification = {
  id: string;
  source?: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  bookingId?: string | null;
  bookingCode?: string | null;
  issueId?: string | null;
  issueTitle?: string | null;
  price?: number | null;
  estimateId?: string | null;
  customerId?: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  workshopName?: string;
  ownerUid?: string | null;
  notificationReviewed?: boolean;
  calledCustomer?: boolean;
  calledCustomerByName?: string | null;
  calledCustomerByDisplayName?: string | null;
  notificationReviewedByName?: string | null;
  notificationReviewedByDisplayName?: string | null;
  [key: string]: unknown;
};

export type BookingAvailabilityParams = {
  branchId: string;
  date: string;
  serviceIds: string[];
  tenantId: string;
};

export type BookingAvailabilityResponse = {
  available: boolean;
  availableSlots: string[];
  [key: string]: unknown;
};

export type StaffQuery = {
  branchId: string;
  role?: string;
  status?: string;
  tenantId: string;
};

export type WorkshopStaff = {
  id: string;
  uid?: string;
  name: string;
  email?: string | null;
  mobile?: string | null;
  role?: string;
  staffRole?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  status?: string;
  [key: string]: unknown;
};

export type BookingServiceItem = {
  serviceId: string;
  serviceName?: string;
  price?: number;
  duration?: number;
  staffId?: string;
  notes?: string;
  [key: string]: unknown;
};

export type CreateBookingBody = {
  ownerUid?: string;
  branchId: string;
  date: string;
  time: string;
  pickupTime?: string;
  services: BookingServiceItem[];
  client: string;
  clientEmail?: string;
  clientPhone?: string;
  customerId?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  vehicleDetails?: unknown;
  notes?: string;
  [key: string]: unknown;
};

export type Booking = {
  id: string;
  ownerUid?: string;
  bookingCode?: string;
  status?: string;
  branchId?: string;
  branchName?: string;
  date?: string;
  time?: string;
  pickupTime?: string;
  services?: unknown[];
  client?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  customerId?: string;
  vehicleNumber?: string;
  vehicleMake?: string;
  notes?: string;
  totalPrice?: number;
  progress?: unknown;
  [key: string]: unknown;
};

export type BookingDetail = {
  booking?: Booking & Record<string, unknown>;
  services?: unknown[];
  tasks?: unknown[];
  additionalIssues?: unknown[];
  progress?: unknown;
  activities?: unknown[];
  [key: string]: unknown;
};

export type UpdateBookingStatusBody = {
  status: string;
  reason?: string;
};

export type ConfirmBookingBody = {
  staffAssignments: Record<string, { staffId: string; staffName: string }>;
};

export type RescheduleBookingBody = {
  newDate: string;
  newTime: string;
  reason?: string;
  newPickupTime?: string;
  staffAssignments?: ConfirmBookingBody['staffAssignments'];
  [key: string]: unknown;
};

export type CancelBookingBody = {
  reason?: string;
};

export type IssueResponseBody = {
  customerResponse: 'accept' | 'reject';
};

export type IssuePriceReviewBody = {
  status: 'approved' | 'rejected';
  price?: number;
  customerPhone?: string;
  customerEmail?: string;
};

export type WorkshopService = {
  id: string;
  ownerUid?: string;
  name: string;
  price?: number;
  duration?: number;
  branches?: string[];
  staffIds?: string[];
  staff?: unknown[];
  checklist?: unknown[];
  [key: string]: unknown;
};

export type ServiceStaffQuery = {
  branchId: string;
  date: string;
};

function buildUrl(path: string, query?: BmsBlackRequestOptions['query']): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${BMS_BLACK_API_BASE}${suffix}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function requestHeaders(tenantId?: string | null): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json',
  });

  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const tenant = tenantId?.trim();
  if (tenant) headers.set('X-Tenant-Id', tenant);

  return headers;
}

async function readErrorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text.trim()) return res.statusText || '';
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const detail = parsed.message ?? parsed.error ?? parsed.detail;
    return typeof detail === 'string' ? detail : text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

function isFirebaseTokenError(detail: string): boolean {
  return /firebase/i.test(detail) && /token|auth|unauthori[sz]ed|forbidden/i.test(detail);
}

async function bmsBlackRequest<T>(
  path: string,
  options: BmsBlackRequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const res = await apiFetch(buildUrl(path, options.query), {
    method,
    headers: requestHeaders(options.tenantId),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (res.status === 403) {
    const detail = await readErrorDetail(res);
    if (isFirebaseTokenError(detail)) {
      logout();
    }
    throw new BmsBlackApiError(res.status, detail);
  }

  if (!res.ok) {
    throw new BmsBlackApiError(res.status, await readErrorDetail(res));
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text.trim() ? (JSON.parse(text) as T) : (undefined as T);
}

function unwrapArray<T>(raw: unknown, keys: string[]): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (!raw || typeof raw !== 'object') return [];
  const body = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

// NOTIFICATIONS — no X-Tenant-Id.
export async function getCustomerNotifications(
  all = false,
): Promise<CustomerNotification[]> {
  const raw = await bmsBlackRequest<unknown>('/customer-notifications', {
    query: all ? { all: 1 } : undefined,
  });
  return unwrapArray<CustomerNotification>(raw, ['notifications', 'data', 'items', 'results']);
}

export function markNotificationReviewed(
  notificationId: string,
  reviewed: boolean,
): Promise<unknown> {
  return bmsBlackRequest(
    `/customer-notifications/${encodeURIComponent(notificationId)}/notification-reviewed`,
    {
      method: 'POST',
      body: { notificationReviewed: reviewed },
    },
  );
}

export function markCustomerCalled(notificationId: string): Promise<unknown> {
  return bmsBlackRequest(
    `/customer-notifications/${encodeURIComponent(notificationId)}/called-customer`,
    { method: 'POST' },
  );
}

// BOOKINGS.
export async function getAllBookings(): Promise<Booking[]> {
  const raw = await bmsBlackRequest<unknown>('/getallbooking');
  return unwrapArray<Booking>(raw, ['bookings', 'data', 'items', 'results']);
}

export function getBookingAvailability(
  params: BookingAvailabilityParams,
): Promise<BookingAvailabilityResponse> {
  const { tenantId, branchId, date, serviceIds } = params;
  return bmsBlackRequest('/bookings/availability', {
    tenantId,
    query: {
      branchId,
      date,
      serviceIds: serviceIds.join(','),
    },
  });
}

export async function getStaff(params: StaffQuery): Promise<WorkshopStaff[]> {
  const { tenantId, branchId, role, status } = params;
  const raw = await bmsBlackRequest<unknown>('/staff', {
    tenantId,
    query: { branchId, role, status },
  });
  return unwrapArray<WorkshopStaff>(raw, ['staff', 'data', 'items', 'results']);
}

export function createBooking(
  body: CreateBookingBody,
  tenantId: string,
): Promise<{ bookingId?: string; id?: string; [key: string]: unknown }> {
  return bmsBlackRequest('/bookings', {
    method: 'POST',
    tenantId,
    body,
  });
}

export function getBookingById(
  bookingId: string,
  tenantId: string,
): Promise<BookingDetail> {
  return bmsBlackRequest(`/bookings/${encodeURIComponent(bookingId)}`, {
    tenantId,
  });
}

export function updateBookingStatus(
  bookingId: string,
  body: UpdateBookingStatusBody,
  tenantId: string,
): Promise<unknown> {
  return bmsBlackRequest(`/bookings/${encodeURIComponent(bookingId)}`, {
    method: 'PATCH',
    tenantId,
    body,
  });
}

export function confirmBooking(
  bookingId: string,
  body: ConfirmBookingBody,
  tenantId: string,
): Promise<unknown> {
  return bmsBlackRequest(`/bookings/${encodeURIComponent(bookingId)}/confirm`, {
    method: 'POST',
    tenantId,
    body,
  });
}

export function rescheduleBooking(
  bookingId: string,
  body: RescheduleBookingBody,
  tenantId: string,
): Promise<unknown> {
  return bmsBlackRequest(`/bookings/${encodeURIComponent(bookingId)}/reschedule`, {
    method: 'PATCH',
    tenantId,
    body,
  });
}

export function cancelBooking(
  bookingId: string,
  body: CancelBookingBody,
  tenantId: string,
): Promise<unknown> {
  return bmsBlackRequest(`/bookings/${encodeURIComponent(bookingId)}/cancel`, {
    method: 'POST',
    tenantId,
    body,
  });
}

export async function getAdditionalIssues(
  bookingId: string,
  tenantId: string,
): Promise<unknown[]> {
  const raw = await bmsBlackRequest<unknown>(
    `/bookings/${encodeURIComponent(bookingId)}/additional-issues`,
    { tenantId },
  );
  return unwrapArray<unknown>(raw, ['additionalIssues', 'issues', 'data', 'items', 'results']);
}

export function respondToIssue(
  bookingId: string,
  issueId: string,
  body: IssueResponseBody,
  tenantId: string,
): Promise<unknown> {
  return bmsBlackRequest(
    `/bookings/${encodeURIComponent(bookingId)}/additional-issues/${encodeURIComponent(issueId)}`,
    {
      method: 'PATCH',
      tenantId,
      body,
    },
  );
}

export function reviewIssuePrice(
  bookingId: string,
  issueId: string,
  body: IssuePriceReviewBody,
  tenantId: string,
): Promise<unknown> {
  return bmsBlackRequest(
    `/bookings/${encodeURIComponent(bookingId)}/additional-issues/${encodeURIComponent(issueId)}/price`,
    {
      method: 'PATCH',
      tenantId,
      body,
    },
  );
}

// SERVICES — all require X-Tenant-Id.
export async function getServices(tenantId: string): Promise<WorkshopService[]> {
  const raw = await bmsBlackRequest<unknown>('/services', { tenantId });
  return unwrapArray<WorkshopService>(raw, ['services', 'data', 'items', 'results']);
}

export async function getServicesByBranch(
  branchId: string,
  tenantId: string,
): Promise<WorkshopService[]> {
  const raw = await bmsBlackRequest<unknown>('/services-by-branch', {
    tenantId,
    query: { branchId },
  });
  return unwrapArray<WorkshopService>(raw, ['services', 'data', 'items', 'results']);
}

export function getServiceById(
  serviceId: string,
  tenantId: string,
): Promise<WorkshopService | null> {
  return bmsBlackRequest<WorkshopService | { service?: WorkshopService }>(
    `/services/${encodeURIComponent(serviceId)}`,
    { tenantId },
  ).then((raw) => {
    if (raw && typeof raw === 'object' && 'service' in raw) {
      return raw.service ?? null;
    }
    return raw as WorkshopService;
  });
}

export async function getServiceStaff(
  serviceId: string,
  params: ServiceStaffQuery,
  tenantId: string,
): Promise<WorkshopStaff[]> {
  const raw = await bmsBlackRequest<unknown>(
    `/services/${encodeURIComponent(serviceId)}/staff`,
    {
      tenantId,
      query: params,
    },
  );
  return unwrapArray<WorkshopStaff>(raw, ['staff', 'data', 'items', 'results']);
}
