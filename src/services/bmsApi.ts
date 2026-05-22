/**
 * bmsApi.ts — BMS Pro Black  /api/call-center  client
 *
 * Usage:
 *   import { bmsApi } from '@/services/bmsApi';
 *   const api = bmsApi(idToken, ownerUid);   // idToken from useFirebaseAuth()
 *   const slots = await api.getAvailability({ branchId, date, serviceIds });
 *   const booking = await api.createBooking({ ... });
 */

import {
  BMS_BLACK_API_URL,
  bmsBlackFetch,
  bmsBlackHeaders,
} from '@/services/bmsBlackApi';

const BASE_URL = BMS_BLACK_API_URL;

/* ─────────────────────── Types ─────────────────────── */

export interface BmsWorkshop {
  ownerUid: string;
  name: string;
  branches: BmsBranch[];
}

export interface BmsBranch {
  id: string;
  name: string;
  phone?: string;
  address?: string;
}

export interface BmsService {
  id: string;
  name: string;
  price: number;
  duration: number;
  description?: string;
  checklistCount?: number;
  staff: { id: string; name: string }[];
}

export interface BmsCustomer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

export interface BmsAvailabilitySlot {
  time: string;       // e.g. "09:00"
  available: boolean;
}

export interface BmsBookingServiceLine {
  serviceId: string;
  staffId?: string;
  notes?: string;
}

export interface CreateBookingPayload {
  ownerUid: string;
  branchId: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  services: BmsBookingServiceLine[];
  /** Customer name (required) */
  client: string;
  clientEmail?: string;
  clientPhone?: string;
  customerId?: string;
  vehicleNumber?: string;
  vehicleDetails?: string;
  notes?: string;
  pickupTime?: string;
}

export interface BmsBooking {
  id: string;
  status: string;
  date: string;
  time: string;
  client: string;
  clientPhone?: string;
  branchId: string;
  ownerUid: string;
  services: { serviceId: string; name: string }[];
  tasks?: unknown[];
  issues?: unknown[];
  progress?: number;
}

export interface BmsAdditionalIssue {
  id: string;
  description: string;
  price?: number;
  status: string;
  customerResponse?: 'accept' | 'reject';
}

export interface CreateCallLogPayload {
  ownerUid: string;
  callerPhone: string;
  direction: 'inbound' | 'outbound';
  purpose: string;
  branchId?: string;
  customerId?: string;
  bookingId?: string;
  duration?: number;
  notes?: string;
  outcome?: string;
  /** Your internal call id (e.g. from Yeastar) */
  callCenterCallId?: string;
}

/* ─────────────────────── Core fetch helper ─────────────────────── */

async function request<T>(
  path: string,
  options: RequestInit & { token?: string; tenant?: string } = {},
): Promise<T> {
  const { token: _token, tenant, ...init } = options;
  const headers = bmsBlackHeaders(tenant, init.headers);

  // DEBUG: Log exactly what we're sending (remove after fixing)
  // console.log('[BMS API DEBUG]', {
  //   url: `${BASE_URL}${path}`,
  //   method: init.method ?? 'GET',
  //   headers,
  //   body: init.body ? JSON.parse(init.body as string) : undefined,
  // });

  const res = await bmsBlackFetch(`${BASE_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    let message = `BMS API error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

/* ─────────────────────── API factory ─────────────────────── */

/**
 * Create a scoped BMS API client.
 *
 * @param idToken  — Firebase ID token from `useFirebaseAuth().idToken`
 * @param ownerUid — The workshop owner UID (tenant). Pass null/undefined for
 *                   endpoints that don't require a tenant.
 */
export function bmsApi(idToken: string | null, ownerUid?: string | null) {
  const token = idToken ?? undefined;
  const tenant = ownerUid ?? undefined;

  /* ── Auth ── */
  const getAgent = () =>
    request<{ uid: string; name: string; role: string; assignedWorkshops: string[] }>(
      '/auth',
      { token },
    );

  /* ── Workshops ── */
  const getWorkshops = () =>
    request<BmsWorkshop[]>('/workshops', { token });

  const getWorkshop = (uid: string) =>
    request<BmsWorkshop>(`/workshops/${uid}`, { token });

  /* ── DID Lookup ── */
  const didLookup = (did: string) =>
    request<{ ownerUid: string; branchId?: string; label?: string }>(
      `/did-lookup?did=${encodeURIComponent(did)}`,
      { token },
    );

  /* ── Services ── */
  const getServices = (branchId?: string) => {
    if (branchId) {
      const q = `?branchId=${encodeURIComponent(branchId)}`;
      return request<BmsService[]>(`/services-by-branch${q}`, { token, tenant });
    }
    return request<BmsService[]>('/services', { token, tenant });
  };

  const getService = (serviceId: string) =>
    request<BmsService & { checklist: unknown[]; branches: BmsBranch[] }>(
      `/services/${serviceId}`,
      { token, tenant },
    );

  /* ── Customers ── */
  const searchCustomers = (q: string, searchBy?: 'phone' | 'email' | 'name') => {
    const params = new URLSearchParams({ q });
    if (searchBy) params.set('searchBy', searchBy);
    return request<BmsCustomer[]>(`/customers?${params}`, { token, tenant });
  };

  const getCustomer = (customerId: string) =>
    request<BmsCustomer>(`/customers/${customerId}`, { token, tenant });

  const createCustomer = (payload: {
    ownerUid: string;
    name: string;
    email?: string;
    phone?: string;
    vehicleNumber?: string;
    vehicleDetails?: string;
    notes?: string;
  }) =>
    request<BmsCustomer>('/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
      token,
    });

  const getCustomerVehicles = (customerId: string) =>
    request<unknown[]>(`/customers/${customerId}/vehicles?ownerUid=${tenant ?? ''}`, {
      token,
    });

  /* ── Bookings ── */

  /**
   * Check availability slots before creating a booking.
   *
   * @param branchId   - Branch to check
   * @param date       - YYYY-MM-DD
   * @param serviceIds - Comma-separated service IDs (or array)
   */
  const getAvailability = ({
    branchId,
    date,
    serviceIds,
  }: {
    branchId: string;
    date: string;
    serviceIds: string | string[];
  }) => {
    const ids = Array.isArray(serviceIds) ? serviceIds.join(',') : serviceIds;
    const params = new URLSearchParams({ branchId, date, serviceIds: ids });
    return request<BmsAvailabilitySlot[]>(
      `/bookings/availability?${params}`,
      { token, tenant },
    );
  };

  /**
   * Create a new booking in BMS.
   * This stores the job card in Firestore (visible in BMS admin + mobile app).
   */
  const createBooking = (payload: CreateBookingPayload) =>
    request<BmsBooking>('/bookings', {
      method: 'POST',
      body: JSON.stringify(payload),
      token,
      tenant,
    });

  const getBooking = (bookingId: string) =>
    request<BmsBooking>(`/bookings/${bookingId}`, { token, tenant });

  const listBookings = (params?: {
    status?: string;
    date?: string;
    branchId?: string;
    customerId?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.date) q.set('date', params.date);
    if (params?.branchId) q.set('branchId', params.branchId);
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.limit) q.set('limit', String(params.limit));
    return request<BmsBooking[]>(`/getallbooking?${q}`, { token });
  };

  /* ── Additional Issues ── */
  const getAdditionalIssues = (bookingId: string) =>
    request<BmsAdditionalIssue[]>(
      `/bookings/${bookingId}/additional-issues`,
      { token },
    );

  const respondToIssue = (
    bookingId: string,
    issueId: string,
    customerResponse: 'accept' | 'reject',
  ) =>
    request<BmsAdditionalIssue>(
      `/bookings/${bookingId}/additional-issues/${issueId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ customerResponse }),
        token,
      },
    );

  /* ── Call Logs ── */
  const createCallLog = (payload: CreateCallLogPayload) =>
    request<{ id: string }>('/call-logs', {
      method: 'POST',
      body: JSON.stringify(payload),
      token,
    });

  const getCallLogs = (params?: {
    customerId?: string;
    bookingId?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams({ ownerUid: tenant ?? '' });
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.bookingId) q.set('bookingId', params.bookingId);
    if (params?.limit) q.set('limit', String(params.limit));
    return request<unknown[]>(`/call-logs?${q}`, { token });
  };

  return {
    getAgent,
    getWorkshops,
    getWorkshop,
    didLookup,
    getServices,
    getService,
    searchCustomers,
    getCustomer,
    createCustomer,
    getCustomerVehicles,
    getAvailability,
    createBooking,
    getBooking,
    listBookings,
    getAdditionalIssues,
    respondToIssue,
    createCallLog,
    getCallLogs,
  };
}
