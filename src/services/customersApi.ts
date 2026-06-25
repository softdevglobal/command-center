import { getBookingsByPhone, type Booking } from '@/lib/bms-black-api';
import { buildPhoneLookupVariants } from './dashboardApi';
import type {
  CallerContext,
  CustomerRecord,
  VehicleRecord,
  ServiceRecord,
} from './types';

type RawBooking = {
  id: string;
  data: Record<string, unknown>;
};

function bookingToRaw(booking: Booking): RawBooking {
  const { id, ...rest } = booking;
  return {
    id: String(id ?? ''),
    data: { ...rest, id } as Record<string, unknown>,
  };
}

function filterBookingsForOwner(bookings: RawBooking[], ownerUid: string): RawBooking[] {
  const owner = ownerUid.trim();
  if (!owner) return bookings;
  return bookings.filter((b) => {
    const docOwner = String(
      b.data.ownerUid ?? b.data.tenantId ?? b.data.owner_uid ?? '',
    );
    return docOwner === owner;
  });
}

function sortBookingsNewestFirst(bookings: RawBooking[]): void {
  bookings.sort((a, b) => {
    const da = String(a.data.date ?? a.data.bookingDate ?? '');
    const db2 = String(b.data.date ?? b.data.bookingDate ?? '');
    return db2.localeCompare(da);
  });
}

/**
 * Look up customer profile, vehicles, and service history via
 * GET /api/bms-black/bookings/by-phone (dashboard JWT).
 */
export async function fetchCallerContextByPhone(
  ownerUid: string,
  callerNumber: string,
): Promise<CallerContext | null> {
  const variants = buildPhoneLookupVariants(callerNumber);
  if (!ownerUid?.trim() || variants.length === 0) return null;

  let bookings = await loadBookingsForPhone(callerNumber, ownerUid);
  bookings = filterBookingsForOwner(bookings, ownerUid);
  if (bookings.length === 0) return null;

  sortBookingsNewestFirst(bookings);
  return buildCallerContextFromBookings(bookings, ownerUid);
}

/** @deprecated Use `fetchCallerContextByPhone` — kept for existing imports. */
export const fetchFirebaseCallerContext = fetchCallerContextByPhone;

async function loadBookingsForPhone(
  callerNumber: string,
  tenantId?: string | null,
): Promise<RawBooking[]> {
  try {
    const rows = await getBookingsByPhone(callerNumber, tenantId);
    return rows.map(bookingToRaw).filter((b) => b.id);
  } catch {
    return [];
  }
}

function buildCallerContextFromBookings(
  bookings: RawBooking[],
  ownerUid: string,
): CallerContext {
  const latest = bookings[0];
  const customer = mapBookingToCustomer(latest.id, latest.data, ownerUid);
  const vehicles = deriveVehiclesFromBookings(bookings, ownerUid, customer.id);
  const services = bookings
    .map((b) => mapBookingToServiceRecord(b.id, b.data, vehicles))
    .filter((s) => Boolean(s.serviceType));

  return { customer, vehicles, services };
}

function mapBookingToCustomer(
  bookingDocId: string,
  data: Record<string, unknown>,
  ownerUid: string,
): CustomerRecord {
  const phone = String(
    data.clientPhone ?? data.customerPhone ?? data.phone ?? '',
  );
  const name = String(
    data.client ?? data.clientName ?? data.customerName ?? data.name ?? '',
  );
  return {
    id: data.customerId ? String(data.customerId) : bookingDocId,
    tenantId: ownerUid,
    name,
    primaryPhone: phone,
    phoneNormalized: phone.replace(/\D/g, ''),
    email:
      data.clientEmail ?? data.customerEmail ?? data.email
        ? String(data.clientEmail ?? data.customerEmail ?? data.email)
        : null,
    address: data.address ? String(data.address) : null,
    notes: data.customerNotes ? String(data.customerNotes) : null,
  };
}

function deriveVehiclesFromBookings(
  bookings: RawBooking[],
  ownerUid: string,
  customerId: string,
): VehicleRecord[] {
  const seen = new Map<string, VehicleRecord>();

  for (const { data } of bookings) {
    const rawRego = String(
      data.vehicleNumber ?? data.registrationNumber ?? data.vehicleRego ?? '',
    ).trim();
    if (!rawRego) continue;

    const key = rawRego.toLowerCase();
    if (seen.has(key)) continue;

    seen.set(key, {
      id: `${customerId}__${key}`,
      tenantId: ownerUid,
      customerId,
      rego: rawRego,
      make: String(data.vehicleMake ?? data.make ?? ''),
      model: String(data.vehicleModel ?? data.model ?? ''),
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

function mapBookingToServiceRecord(
  docId: string,
  data: Record<string, unknown>,
  vehicles: VehicleRecord[],
): ServiceRecord {
  const rawRego = String(
    data.vehicleNumber ?? data.registrationNumber ?? data.vehicleRego ?? '',
  ).toLowerCase();
  const matchedVehicle = vehicles.find(
    (v) => v.rego && v.rego.toLowerCase() === rawRego,
  );

  const serviceNames = Array.isArray(data.services)
    ? data.services
        .map((s) => {
          const row = s as Record<string, unknown>;
          return String(row.serviceName ?? row.name ?? '');
        })
        .filter(Boolean)
        .join(', ')
    : String(data.serviceType ?? data.service ?? 'General Service');

  const totalAmount = Array.isArray(data.services)
    ? data.services.reduce((sum: number, s) => {
        const row = s as Record<string, unknown>;
        return sum + Number(row.price ?? 0);
      }, 0)
    : data.totalPrice
      ? Number(data.totalPrice)
      : null;

  return {
    id: docId,
    tenantId: String(data.ownerUid ?? data.tenantId ?? ''),
    customerId: String(data.customerId ?? ''),
    vehicleId: matchedVehicle?.id ?? '',
    serviceDate: String(data.date ?? data.bookingDate ?? ''),
    serviceType: serviceNames,
    odometerKm: data.mileage ? Number(data.mileage) : null,
    amount: totalAmount,
    advisorNotes: data.notes ? String(data.notes) : null,
  };
}

/**
 * Lightweight name lookup for queue cards — uses GET /bookings/by-phone.
 */
export async function fetchCallerNameByPhone(
  _ownerUid: string,
  callerNumber: string,
): Promise<string | null> {
  const variants = buildPhoneLookupVariants(callerNumber);
  if (variants.length === 0) return null;

  try {
    const bookings = (await loadBookingsForPhone(callerNumber)).map((b) => b.data);
    if (bookings.length === 0) return null;

    bookings.sort((a, b) => {
      const da = String(a.date ?? a.bookingDate ?? '');
      const db2 = String(b.date ?? b.bookingDate ?? '');
      return db2.localeCompare(da);
    });

    for (const data of bookings) {
      const name = String(
        data.client ?? data.clientName ?? data.customerName ?? data.name ?? '',
      ).trim();
      if (name) return name;
    }
    return null;
  } catch {
    return null;
  }
}
