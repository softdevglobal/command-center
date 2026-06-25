import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  bmsApi,
  type BmsCustomer,
  type BmsService,
  type BmsBooking,
  type CreateBookingPayload,
} from '@/services/bmsApi';

/* ─────────────────────────────────────────────────
   useCreateBooking
   ───────────────────────────────────────────────── */

interface UseCreateBookingOptions {
  ownerUid: string;
}

interface CreateBookingState {
  loading: boolean;
  error: string | null;
  booking: BmsBooking | null;
}

/**
 * Create a booking in BMS via POST /bookings.
 *
 * @example
 *   const { create, loading, error, booking } = useCreateBooking({ ownerUid });
 *   const result = await create({ branchId, date, time, services, client, clientPhone, ... });
 */
export function useCreateBooking({ ownerUid }: UseCreateBookingOptions) {
  const { session } = useAuth();
  const [state, setState] = useState<CreateBookingState>({
    loading: false,
    error: null,
    booking: null,
  });

  const create = useCallback(
    async (payload: Omit<CreateBookingPayload, 'ownerUid'>): Promise<BmsBooking | null> => {
      setState({ loading: true, error: null, booking: null });
      try {
        const api = bmsApi(ownerUid);
        const result = await api.createBooking({ ...payload, ownerUid });
        setState({ loading: false, error: null, booking: result });

        try {
          const { supabase } = await import('@/integrations/supabase/client');
          await (supabase as any).from('bms_bookings').insert({
            bms_booking_id: result.id ?? null,
            owner_uid: ownerUid,
            branch_id: payload.branchId ?? null,
            agent_uid: session?.userId ?? null,
            agent_email: session?.authEmail ?? null,
            client_name: payload.client,
            client_phone: payload.clientPhone ?? null,
            client_email: payload.clientEmail ?? null,
            customer_id: payload.customerId ?? null,
            vehicle_number: payload.vehicleNumber ?? null,
            vehicle_details: payload.vehicleDetails ?? null,
            booking_date: payload.date,
            booking_time: payload.time,
            pickup_time: payload.pickupTime ?? null,
            services: payload.services ?? [],
            notes: payload.notes ?? null,
            bms_status: result.status ?? 'Pending',
            bms_response: result,
          });
        } catch {
          // Don't fail the whole flow if Supabase save fails — BMS booking already created
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Booking failed';
        setState({ loading: false, error: msg, booking: null });
        return null;
      }
    },
    [ownerUid, session?.authEmail, session?.userId],
  );

  return { ...state, create };
}

/* ─────────────────────────────────────────────────
   useAvailability
   ───────────────────────────────────────────────── */

interface UseAvailabilityOptions {
  ownerUid: string;
  branchId: string;
  /** YYYY-MM-DD */
  date: string;
  serviceIds: string[];
}

/**
 * Fetch available time slots for a branch/date/service combination.
 * Call `refetch()` manually (e.g. when the user clicks "Check Availability").
 *
 * @example
 *   const { slots, loading, error, refetch } = useAvailability({ ownerUid, branchId, date, serviceIds });
 *   await refetch();
 */
export function useAvailability({
  ownerUid,
  branchId,
  date,
  serviceIds,
}: UseAvailabilityOptions) {
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refs = useRef({ branchId, date, serviceIds, ownerUid });
  refs.current = { branchId, date, serviceIds, ownerUid };

  const refetch = useCallback(async () => {
    const { branchId, date, serviceIds, ownerUid } = refs.current;
    if (!branchId || !date || serviceIds.length === 0) return;

    setSlots([]);
    setLoading(true);
    setError(null);
    try {
      const api = bmsApi(ownerUid);
      const result = await api.getAvailability({ branchId, date, serviceIds });
      setSlots(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load availability');
    } finally {
      setLoading(false);
    }
  }, []);

  return { slots, loading, error, refetch };
}

/* ─────────────────────────────────────────────────
   useBmsServices
   ───────────────────────────────────────────────── */

/**
 * Load BMS services for a branch.
 * Call `refetch()` manually when needed.
 *
 * @example
 *   const { services, loading, error, refetch } = useBmsServices({ ownerUid, branchId });
 *   await refetch();
 */
export function useBmsServices({
  ownerUid,
  branchId,
}: {
  ownerUid: string;
  branchId?: string;
}) {
  const [services, setServices] = useState<BmsService[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refs = useRef({ ownerUid, branchId });
  refs.current = { ownerUid, branchId };

  const refetch = useCallback(async () => {
    const { ownerUid, branchId } = refs.current;
    setLoading(true);
    setError(null);
    try {
      const api = bmsApi(ownerUid);
      const result = await api.getServices(branchId);
      setServices(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }, []);

  return { services, loading, error, refetch };
}

/* ─────────────────────────────────────────────────
   useCustomerSearch
   ───────────────────────────────────────────────── */

/**
 * Search BMS customers by phone, email, or name.
 * Typically triggered on screen-pop when a call arrives.
 *
 * @example
 *   const { results, loading, error, search } = useCustomerSearch({ ownerUid });
 *   await search(callerPhone, 'phone');
 */
export function useCustomerSearch({ ownerUid }: { ownerUid: string }) {
  const [results, setResults] = useState<BmsCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refs = useRef({ ownerUid });
  refs.current = { ownerUid };

  const search = useCallback(
    async (query: string, by: 'phone' | 'email' | 'name' = 'phone') => {
      if (!query.trim()) return;
      const { ownerUid } = refs.current;
      setLoading(true);
      setError(null);
      try {
        const api = bmsApi(ownerUid);
        const data = await api.searchCustomers(query, by);
        setResults(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Customer search failed');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clear = useCallback(() => setResults([]), []);

  return { results, loading, error, search, clear };
}

/* ─────────────────────────────────────────────────
   useBookingList
   ───────────────────────────────────────────────── */

/**
 * List bookings for a workshop/tenant — useful for agent sidebar.
 *
 * @example
 *   const { bookings, loading, refetch } = useBookingList({ ownerUid });
 *   await refetch({ status: 'Pending', date: '2026-04-10' });
 */
export function useBookingList({ ownerUid }: { ownerUid: string }) {
  const [bookings, setBookings] = useState<BmsBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refs = useRef({ ownerUid });
  refs.current = { ownerUid };

  const refetch = useCallback(
    async (params?: {
      status?: string;
      date?: string;
      branchId?: string;
      customerId?: string;
      limit?: number;
    }) => {
      const { ownerUid } = refs.current;
      setLoading(true);
      setError(null);
      try {
        const api = bmsApi(ownerUid);
        const data = await api.listBookings(params);
        setBookings(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load bookings');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { bookings, loading, error, refetch };
}
