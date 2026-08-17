import { apiFetch } from "@/lib/api";
import { BMS_BLACK_API_URL, bmsBlackHeaders } from "@/lib/bms-black-api";
import type {
  CallerContext,
  CustomerRecord,
  VehicleRecord,
  ServiceRecord,
} from "./types";

// ─── Main: Fetch Caller Context via backend bookings-by-phone API ────────────

type BookingDocData = Record<string, any>;

/**
 * Look up a customer by owner UID and phone number via the backend
 * `/bms-black/bookings/by-phone` endpoint (which queries Firestore with the
 * Admin SDK — no client-side Firebase session required).
 *
 * Strategy:
 * 1. Fetch bookings matching the phone number, scoped to the ownerUid.
 * 2. Derive customer info, vehicles, and service history directly from those
 *    booking documents — no separate customers subcollection needed.
 */
export async function fetchFirebaseCallerContext(
  ownerUid: string,
  callerNumber: string,
): Promise<CallerContext | null> {
  const phone = String(callerNumber ?? "").trim();
  if (!ownerUid || !phone) return null;

  const allBookings = await fetchBookingsByPhoneApi(phone, ownerUid);
  if (allBookings.length === 0) return null;

  // Sort descending by date — most recent booking first
  allBookings.sort((a, b) => {
    const da = String(a.data.date ?? a.data.bookingDate ?? "");
    const db2 = String(b.data.date ?? b.data.bookingDate ?? "");
    return db2.localeCompare(da);
  });

  // Derive customer from the most recent booking
  const latest = allBookings[0];
  const customer = mapBookingToCustomer(latest.id, latest.data, ownerUid);

  // Derive unique vehicles by rego from all bookings
  const vehicles = deriveVehiclesFromBookings(allBookings, ownerUid, customer.id);

  // Map every booking → ServiceRecord and link to matched vehicle by rego
  const services = allBookings
    .map((b) => mapBookingToServiceRecord(b.id, b.data, vehicles))
    .filter((s) => Boolean(s.serviceType));

  return { customer, vehicles, services };
}

// ─── Internal: fetch bookings for a phone via the backend API ────────────────

interface RawBooking {
  id: string;
  data: BookingDocData;
}

/**
 * Calls `GET /bms-black/bookings/by-phone?phone=...[&ownerUid=...]`.
 * The backend builds the phone format variants, queries the Firestore
 * `bookings` collection with the Admin SDK, and (when ownerUid is given)
 * filters results to that workshop.
 */
async function fetchBookingsByPhoneApi(
  callerNumber: string,
  ownerUid?: string | null,
): Promise<RawBooking[]> {
  const phone = String(callerNumber ?? "").trim();
  if (!phone) return [];

  const params = new URLSearchParams({ phone });
  const owner = ownerUid?.trim();
  if (owner) params.set("ownerUid", owner);

  try {
    // Caller lookup is a non-critical display feature — never log the user
    // out if this request fails (logoutOnSessionExpired: false).
    const res = await apiFetch(`${BMS_BLACK_API_URL}/bookings/by-phone?${params.toString()}`, {
      headers: bmsBlackHeaders(),
      logoutOnSessionExpired: false,
    });
    if (!res.ok) return [];

    const json = (await res.json()) as {
      bookings?: Array<{ id?: unknown } & BookingDocData>;
    };
    if (!Array.isArray(json.bookings)) return [];

    return json.bookings
      .filter((b) => b && b.id != null)
      .map(({ id, ...data }) => ({ id: String(id), data }));
  } catch {
    return [];
  }
}

// ─── Derive customer info from booking ───────────────────────────────────────

function mapBookingToCustomer(
  bookingDocId: string,
  data: BookingDocData,
  ownerUid: string,
): CustomerRecord {
  const phone = String(
    data.clientPhone ?? data.customerPhone ?? data.phone ?? "",
  );
  const name = String(
    data.client ?? data.clientName ?? data.customerName ?? data.name ?? "",
  );
  return {
    id: data.customerId ? String(data.customerId) : bookingDocId,
    tenantId: ownerUid,
    name,
    primaryPhone: phone,
    phoneNormalized: phone.replace(/\D/g, ""),
    email:
      data.clientEmail ?? data.customerEmail ?? data.email
        ? String(data.clientEmail ?? data.customerEmail ?? data.email)
        : null,
    address: data.address ? String(data.address) : null,
    notes: data.customerNotes ? String(data.customerNotes) : null,
  };
}

// ─── Derive unique vehicles from bookings ─────────────────────────────────────

/**
 * Builds a deduplicated VehicleRecord list from booking documents.
 * Each unique registration number (vehicleNumber/registrationNumber) becomes
 * one vehicle entry. No subcollection needed.
 */
function deriveVehiclesFromBookings(
  bookings: RawBooking[],
  ownerUid: string,
  customerId: string,
): VehicleRecord[] {
  const seen = new Map<string, VehicleRecord>(); // keyed by normalised rego

  for (const { data } of bookings) {
    const rawRego = String(
      data.vehicleNumber ?? data.registrationNumber ?? data.vehicleRego ?? "",
    ).trim();
    if (!rawRego) continue;

    const key = rawRego.toLowerCase();
    if (seen.has(key)) continue;

    seen.set(key, {
      id: `${customerId}__${key}`,
      tenantId: ownerUid,
      customerId,
      rego: rawRego,
      make: String(data.vehicleMake ?? data.make ?? ""),
      model: String(data.vehicleModel ?? data.model ?? ""),
      year: data.vehicleYear ? Number(data.vehicleYear) : null,
      color:
        data.vehicleColor ?? data.colour
          ? String(data.vehicleColor ?? data.colour)
          : null,
      vin:
        data.vinChassis ?? data.vin
          ? String(data.vinChassis ?? data.vin)
          : null,
      notes: null,
    });
  }

  return Array.from(seen.values());
}

// ─── Map booking → ServiceRecord ─────────────────────────────────────────────

function mapBookingToServiceRecord(
  docId: string,
  data: BookingDocData,
  vehicles: VehicleRecord[],
): ServiceRecord {
  const rawRego = String(
    data.vehicleNumber ?? data.registrationNumber ?? data.vehicleRego ?? "",
  ).toLowerCase();
  const matchedVehicle = vehicles.find(
    (v) => v.rego && v.rego.toLowerCase() === rawRego,
  );

  const serviceNames = Array.isArray(data.services)
    ? data.services
        .map((s: Record<string, unknown>) =>
          String(s.serviceName ?? s.name ?? ""),
        )
        .filter(Boolean)
        .join(", ")
    : String(data.serviceType ?? data.service ?? "General Service");

  const totalAmount = Array.isArray(data.services)
    ? data.services.reduce(
        (sum: number, s: Record<string, unknown>) => sum + Number(s.price ?? 0),
        0,
      )
    : data.totalPrice
      ? Number(data.totalPrice)
      : null;

  return {
    id: docId,
    tenantId: String(data.ownerUid ?? data.tenantId ?? ""),
    customerId: String(data.customerId ?? ""),
    vehicleId: matchedVehicle?.id ?? "",
    serviceDate: String(data.date ?? data.bookingDate ?? ""),
    serviceType: serviceNames,
    odometerKm: data.mileage ? Number(data.mileage) : null,
    amount: totalAmount,
    advisorNotes: data.notes ? String(data.notes) : null,
  };
}

// ─── Lightweight name-only lookup (for batch/table use) ──────────────────────

/**
 * Look up just the customer name from bookings by phone number.
 * Much cheaper to consume than fetchFirebaseCallerContext — skips vehicles &
 * service history.
 *
 * Queries by phone alone (no ownerUid filter): the ownerUid passed from
 * CallsTab is typically a Supabase tenant ID (e.g. "t-xxx") which doesn't
 * match the Firebase document's ownerUid field, so filtering by it would
 * return zero results. The phone number is sufficient for display names.
 */
export async function fetchCallerNameByPhone(
  callerNumber: string,
): Promise<string | null> {
  const phone = String(callerNumber ?? "").trim();
  if (!phone) return null;

  try {
    const bookings = await fetchBookingsByPhoneApi(phone);
    if (bookings.length === 0) return null;

    // Sort descending by date — most recent booking first
    bookings.sort((a, b) => {
      const da = String(a.data.date ?? a.data.bookingDate ?? "");
      const db2 = String(b.data.date ?? b.data.bookingDate ?? "");
      return db2.localeCompare(da);
    });

    // Find the first booking that has a valid name
    const bookingWithName = bookings.find((b) => {
      const d = b.data;
      const n = String(
        d.client ?? d.clientName ?? d.customerName ?? d.name ?? "",
      ).trim();
      return n.length > 0;
    });

    if (!bookingWithName) return null;

    const data = bookingWithName.data;
    return String(
      data.client ?? data.clientName ?? data.customerName ?? data.name ?? "",
    ).trim();
  } catch {
    return null;
  }
}
