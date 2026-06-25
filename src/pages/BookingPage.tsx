import "@/styles/dashboard.css";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { format, addDays, isBefore, startOfDay } from "date-fns";
import {
  ArrowLeft,
  CalendarPlus2,
  Car,
  CarFront,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
  Plus,
  CheckCircle2,
  Bus,
  Rocket,
  Truck,
} from "lucide-react";
import type { VehicleRecord } from "@/services/types";
import {
  createBooking,
  getBookingAvailability,
  normalizeBookingAvailabilitySlots,
  trimBmsTimeLabel,
  type BookingServiceItem,
  type VehicleDetails,
} from "@/services/bookingsApi";
import { useAuth } from "@/hooks/useAuth";
import { logSystemActivity } from "@/services/auditLogApi";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  getServices,
  getServicesByBranch,
  getWorkshopServicePriceForVehicleType,
  servicesOfferVehicleTiering,
  workshopServiceSupportsVehicleType,
  WORKSHOP_VEHICLE_TYPE_LABELS,
  WORKSHOP_VEHICLE_TYPE_ORDER,
  type WorkshopService,
  type WorkshopVehicleTypeId,
} from "@/services/servicesApi";
import {
  getBranchDetail,
  getBranchDetailForTenant,
  resolveSessionTenantBmsIds,
  type BmsBranchDetail,
} from "@/services/branchesApi";

interface BookingPageState {
  tenantId: string;
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  availableVehicles: VehicleRecord[];
  workshopName?: string;
  workshopColor?: string;
  branchId?: string;
  ownerId?: string;
}

interface ServiceType {
  value: string;
  label: string;
  duration: string;
  price: string;
  included: string[];
  color: string;
  image?: string;
}


function formatDurationMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
}

function vehicleTypeIcon(id: WorkshopVehicleTypeId, className: string) {
  switch (id) {
    case "small_car":
      return <CarFront className={className} />;
    case "sedan_wagon":
      return <Car className={className} />;
    case "suv":
      return <Truck className={className} />;
    case "ute_van_4wd":
      return <Bus className={className} />;
    case "performance_large":
      return <Rocket className={className} />;
    default:
      return <CarFront className={className} />;
  }
}

function generateTimeSlots(start: string, end: string, step = 30): string[] {
  const slots: string[] = [];
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let total = sh * 60 + sm;
  const endTotal = eh * 60 + em;
  while (total <= endTotal) {
    const h = Math.floor(total / 60)
      .toString()
      .padStart(2, "0");
    const m = (total % 60).toString().padStart(2, "0");
    slots.push(`${h}:${m}`);
    total += step;
  }
  return slots;
}

function toMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToSlot(total: number): string {
  const h = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** Latest drop-off time shown; pick-up list starts at this time. */
const DROP_OFF_LATEST_MINUTES = 11 * 60;
const PICKUP_EARLIEST_MINUTES = 14 * 60;

function filterSlotsInInclusiveMinuteRange(
  slots: string[],
  lo: number,
  hi: number,
): string[] {
  if (lo > hi) return [];
  return slots.filter((s) => {
    const m = toMinutes(trimBmsTimeLabel(s));
    return m != null && m >= lo && m <= hi;
  });
}

function isTimeWithinWindow(time: string, open?: string | null, close?: string | null): boolean {
  const t = toMinutes(time);
  const o = toMinutes(open);
  const c = toMinutes(close);
  if (t == null || o == null || c == null) return false;
  return t >= o && t <= c;
}

/** Anchor calendar day at local noon (same basis as branch weekday lookup). */
function calendarDayNoonLocal(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12,
    0,
    0,
    0,
  );
}

function getWeekdayForBranch(date: Date, timezone?: string): string {
  const localNoon = calendarDayNoonLocal(date);
  if (!timezone) return format(localNoon, "EEEE");
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: timezone,
  }).format(localNoon);
}

/** `yyyy-MM-dd` for an instant, in `timeZone`, or browser-local when timezone is missing. */
function formatYyyyMmDdInTimeZone(instant: Date, timeZone?: string | null): string {
  const tz = timeZone?.trim();
  if (!tz) return format(instant, "yyyy-MM-dd");
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return format(instant, "yyyy-MM-dd");
  return `${y}-${m}-${d}`;
}

/** Booking / availability API date: selected calendar day, expressed in the branch timezone. */
function formatBookingDateForBranchApi(date: Date, branchTimezone?: string | null): string {
  return formatYyyyMmDdInTimeZone(calendarDayNoonLocal(date), branchTimezone);
}

type SimpleHoursShape = {
  open?: string | null;
  close?: string | null;
  closed?: boolean;
};

/**
 * Local-parts and domains agents commonly type when the customer has no email,
 * mirrored on the BMS Black backend (`isPlaceholderCustomerEmail`). We strip
 * these client-side so the booking request omits `clientEmail` entirely instead
 * of provisioning a customer + sending a SendGrid welcome email to a fake inbox.
 */
const PLACEHOLDER_EMAIL_LOCAL_PARTS = new Set([
  "unknown",
  "none",
  "no",
  "noemail",
  "no-email",
  "n/a",
  "na",
  "nil",
  "nomail",
  "no-mail",
  "test",
  "dummy",
  "fake",
  "placeholder",
  "tbd",
  "tba",
  "x",
]);

const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  "email.com",
  "noemail.com",
  "no-email.com",
  "none.com",
  "test.com",
  "example.com",
  "example.org",
  "test.test",
  "dummy.com",
  "fake.com",
  "placeholder.com",
]);

function isPlaceholderCustomerEmail(email: string | null | undefined): boolean {
  const raw = String(email ?? "").trim().toLowerCase();
  if (!raw) return false;
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return false;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (PLACEHOLDER_EMAIL_DOMAINS.has(domain)) return true;
  if (PLACEHOLDER_EMAIL_LOCAL_PARTS.has(local)) return true;
  return false;
}

/** Empty string when the agent typed a placeholder; otherwise the trimmed email. */
function sanitizeCustomerEmailForBooking(email: string | null | undefined): string {
  const raw = String(email ?? "").trim();
  if (!raw) return "";
  if (isPlaceholderCustomerEmail(raw)) return "";
  return raw;
}

function getInlineSchedule(detail: unknown): SimpleHoursShape | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const hasAny = "open" in d || "close" in d || "closed" in d;
  if (!hasAny) return null;
  return {
    open: typeof d.open === "string" ? d.open : null,
    close: typeof d.close === "string" ? d.close : null,
    closed: Boolean(d.closed),
  };
}

function ServiceCard({
  service,
  selected,
  onToggle,
  disabled,
  unavailableReason,
}: {
  service: ServiceType;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  unavailableReason?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const inactive = !!disabled;
  return (
    <div
      onClick={inactive ? undefined : onToggle}
      className={`rounded-2xl border-2 bg-white transition-all ${
        inactive
          ? "cursor-not-allowed border-slate-100 opacity-60"
          : `cursor-pointer ${selected ? "border-amber-400 shadow-md" : "border-slate-200 hover:border-slate-300"}`
      }`}
    >
      <div className="flex items-center gap-4 p-4">
        {/* Thumbnail */}
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl text-2xl font-bold"
          style={{
            background: service.color + "22",
            border: `2px solid ${service.color}44`,
          }}
        >
          {service.image ? (
            <img
              src={service.image}
              alt={service.label}
              className="h-full w-full object-cover"
            />
          ) : (
            <span style={{ color: service.color }}>
              {service.label.charAt(0)}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900">{service.label}</div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {service.duration}
            </span>
            <span className="flex items-center gap-1">
              <Check className="h-3 w-3" />
              {service.included.length} tasks
            </span>
            {unavailableReason ? (
              <span className="text-rose-600">{unavailableReason}</span>
            ) : null}
          </div>
        </div>

        {/* Price */}
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-slate-900">
            {service.price}
          </div>
        </div>

        {/* Add/Remove button */}
        <button
          type="button"
          disabled={inactive}
          onClick={(e) => {
            e.stopPropagation();
            if (!inactive) onToggle();
          }}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all ${inactive ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300" : selected ? "border-amber-400 bg-amber-400 text-white" : "border-slate-300 bg-white text-slate-400 hover:border-amber-400 hover:text-amber-400"}`}
        >
          {selected ? (
            <Check className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Toggle details */}
      <div className="px-4 pb-2">
        <button
          type="button"
          disabled={inactive}
          onClick={(e) => {
            e.stopPropagation();
            if (!inactive) setExpanded((v) => !v);
          }}
          className={`flex items-center gap-1 text-xs font-medium ${inactive ? "cursor-not-allowed text-slate-400" : "text-amber-600 hover:text-amber-700"}`}
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {expanded ? "Hide details" : "Show details"}
        </button>
      </div>

      {expanded && (
        <div className="mx-4 mb-4 rounded-xl bg-amber-50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-400">
              <Check className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-700">
              What's included
            </span>
          </div>
          <ul className="space-y-1.5">
            {service.included.map((item) => (
              <li
                key={item}
                className="flex items-center gap-2 text-sm text-slate-700"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded border-2 border-amber-400 bg-white">
                  <Check className="h-2.5 w-2.5 text-amber-500" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function BookingPage() {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const state = location.state as BookingPageState | null;
  const [submitting, setSubmitting] = useState(false);

  // Customer
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  // Vehicle
  const [selectedVehicleId, setSelectedVehicleId] = useState("new");
  const [vehicleRego, setVehicleRego] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleVin, setVehicleVin] = useState("");
  const [vehicleMileage, setVehicleMileage] = useState("");
  const [vehicleBodyType, setVehicleBodyType] = useState("");
  const [vehicleEngineNumber, setVehicleEngineNumber] = useState("");

  // Booking
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [dropOffTime, setDropOffTime] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [notes, setNotes] = useState("");

  // Services from Firebase API
  const [services, setServices] = useState<WorkshopService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [selectedVehicleType, setSelectedVehicleType] = useState<WorkshopVehicleTypeId | null>(null);
  const [branchDetail, setBranchDetail] = useState<BmsBranchDetail | null>(null);
  const [branchHoursError, setBranchHoursError] = useState<string | null>(null);

  /** GET /bookings/availability — live capacity for branch + date + selected services. */
  const [bmsAvailSlotsRaw, setBmsAvailSlotsRaw] = useState<string[]>([]);
  const [bmsAvailLoading, setBmsAvailLoading] = useState(false);
  const [bmsAvailError, setBmsAvailError] = useState<string | null>(null);
  const [bmsAvailFetched, setBmsAvailFetched] = useState(false);

  const hasVehicleTiering = useMemo(() => servicesOfferVehicleTiering(services), [services]);

  const pricingVehicleType = useMemo((): WorkshopVehicleTypeId | null => {
    if (!hasVehicleTiering || services.length === 0) return null;
    if (
      selectedVehicleType != null &&
      services.some((s) => workshopServiceSupportsVehicleType(s, selectedVehicleType))
    ) {
      return selectedVehicleType;
    }
    return (
      WORKSHOP_VEHICLE_TYPE_ORDER.find((k) =>
        services.some((s) => workshopServiceSupportsVehicleType(s, k)),
      ) ?? null
    );
  }, [hasVehicleTiering, selectedVehicleType, services]);

  useEffect(() => {
    if (!hasVehicleTiering) {
      setSelectedVehicleType(null);
      return;
    }
    setSelectedVehicleType((prev) => {
      if (prev != null && services.some((s) => workshopServiceSupportsVehicleType(s, prev))) {
        return prev;
      }
      return (
        WORKSHOP_VEHICLE_TYPE_ORDER.find((k) =>
          services.some((s) => workshopServiceSupportsVehicleType(s, k)),
        ) ?? null
      );
    });
  }, [services, hasVehicleTiering]);

  useEffect(() => {
    if (!pricingVehicleType) return;
    setSelectedServices((prev) =>
      prev.filter((id) => {
        const svc = services.find((x) => x.id === id);
        return !!svc && workshopServiceSupportsVehicleType(svc, pricingVehicleType);
      }),
    );
  }, [pricingVehicleType, services]);

  useEffect(() => {
    // console.log("[BookingPage] branchDetail state", branchDetail);
  }, [branchDetail]);

  useEffect(() => {
    const ownerIdToUse = state?.ownerId;
    const branchIdToUse = state?.branchId;

    if (!ownerIdToUse) {
      setServicesError("No Owner ID available. Please start booking from an active call session.");
      setServicesLoading(false);
      return;
    }

    const fetchPromise = branchIdToUse
      ? getServicesByBranch(ownerIdToUse, branchIdToUse)
      : getServices(ownerIdToUse);

    fetchPromise
      .then((data) => {
        setServices(data);
      })
      .catch((err: Error) => setServicesError(err.message))
      .finally(() => setServicesLoading(false));
  }, [state?.branchId, state?.ownerId]);

  const availableVehicles: VehicleRecord[] = state?.availableVehicles ?? [];
  const workshopColor = state?.workshopColor || "var(--cc-color-cyan)";
  const chosenServices = services.filter((s) =>
    selectedServices.includes(s.id),
  );

  const quoteFor = (s: WorkshopService) => {
    if (pricingVehicleType) {
      return getWorkshopServicePriceForVehicleType(s, pricingVehicleType);
    }
    return { price: s.price, duration: s.duration };
  };
  const activeBranchId = state?.branchId || (chosenServices[0]?.branches?.[0] ?? "");
  const weekday = selectedDate
    ? getWeekdayForBranch(selectedDate, branchDetail?.timezone)
    : null;
  const daySchedule = weekday
    ? branchDetail?.daySchedules?.[weekday] ??
      (branchDetail?.hours?.[weekday]
        ? {
            dayOfWeek: weekday,
            closed: !!branchDetail?.hours?.[weekday]?.closed,
            open: branchDetail?.hours?.[weekday]?.open ?? null,
            close: branchDetail?.hours?.[weekday]?.close ?? null,
          }
        : undefined) ??
      (getInlineSchedule(branchDetail)
        ? {
            dayOfWeek: weekday,
            closed: !!getInlineSchedule(branchDetail)?.closed,
            open: getInlineSchedule(branchDetail)?.open ?? null,
            close: getInlineSchedule(branchDetail)?.close ?? null,
          }
        : undefined)
    : undefined;
  const branchClosedOnSelectedDay = !!selectedDate && !!daySchedule?.closed;

  const branchSlotGrid = useMemo(() => {
    if (!daySchedule?.open || !daySchedule?.close) return [];
    return generateTimeSlots(daySchedule.open, daySchedule.close);
  }, [daySchedule?.open, daySchedule?.close]);

  const apiSlotsNormalized = useMemo(
    () => normalizeBookingAvailabilitySlots(bmsAvailSlotsRaw),
    [bmsAvailSlotsRaw],
  );

  /** Branch day grid merged with BMS availability when services + date are set. */
  const mergedCapacitySlots = useMemo(() => {
    let base: string[];
    if (selectedServices.length === 0 || !selectedDate) {
      base = branchSlotGrid;
    } else if (!bmsAvailFetched || bmsAvailLoading) {
      base = branchSlotGrid;
    } else if (bmsAvailError) {
      base = [];
    } else if (apiSlotsNormalized.length === 0) {
      base = [];
    } else if (branchSlotGrid.length === 0) {
      base = apiSlotsNormalized;
    } else {
      const branchSet = new Set(branchSlotGrid);
      const intersection = apiSlotsNormalized.filter((t) => branchSet.has(t));
      base = intersection.length > 0 ? intersection : apiSlotsNormalized;
    }
    return base;
  }, [
    selectedServices.length,
    selectedDate,
    branchSlotGrid,
    bmsAvailFetched,
    bmsAvailLoading,
    bmsAvailError,
    apiSlotsNormalized,
  ]);

  const dropOffScheduleStrings = useMemo(() => {
    if (!daySchedule?.open || !daySchedule?.close) return null;
    const openM = toMinutes(daySchedule.open);
    const closeM = toMinutes(daySchedule.close);
    if (openM == null || closeM == null) return null;
    const endM = Math.min(DROP_OFF_LATEST_MINUTES, closeM);
    if (openM > endM) return null;
    return {
      start: daySchedule.open,
      end: minutesToSlot(endM),
    };
  }, [daySchedule?.open, daySchedule?.close]);

  const pickupScheduleStrings = useMemo(() => {
    if (!daySchedule?.open || !daySchedule?.close) return null;
    const openM = toMinutes(daySchedule.open);
    const closeM = toMinutes(daySchedule.close);
    if (openM == null || closeM == null) return null;
    const startM = Math.max(PICKUP_EARLIEST_MINUTES, openM);
    if (startM > closeM) return null;
    return {
      start: minutesToSlot(startM),
      end: daySchedule.close,
    };
  }, [daySchedule?.open, daySchedule?.close]);

  const dropOffSlots = useMemo(() => {
    if (mergedCapacitySlots.length === 0) return [];
    if (dropOffScheduleStrings) {
      const lo = toMinutes(dropOffScheduleStrings.start);
      const hi = toMinutes(dropOffScheduleStrings.end);
      if (lo == null || hi == null) return [];
      return filterSlotsInInclusiveMinuteRange(mergedCapacitySlots, lo, hi);
    }
    return filterSlotsInInclusiveMinuteRange(
      mergedCapacitySlots,
      0,
      DROP_OFF_LATEST_MINUTES,
    );
  }, [mergedCapacitySlots, dropOffScheduleStrings]);

  const pickupSlots = useMemo(() => {
    if (mergedCapacitySlots.length === 0) return [];
    if (pickupScheduleStrings) {
      const lo = toMinutes(pickupScheduleStrings.start);
      const hi = toMinutes(pickupScheduleStrings.end);
      if (lo == null || hi == null) return [];
      return filterSlotsInInclusiveMinuteRange(mergedCapacitySlots, lo, hi);
    }
    let hi = PICKUP_EARLIEST_MINUTES;
    for (const s of mergedCapacitySlots) {
      const m = toMinutes(trimBmsTimeLabel(s));
      if (m != null) hi = Math.max(hi, m);
    }
    return filterSlotsInInclusiveMinuteRange(
      mergedCapacitySlots,
      PICKUP_EARLIEST_MINUTES,
      hi,
    );
  }, [mergedCapacitySlots, pickupScheduleStrings]);

  const dropNorm = dropOffTime ? trimBmsTimeLabel(dropOffTime) : "";
  const outsideBranchHours =
    !!dropOffTime &&
    !!selectedDate &&
    !branchClosedOnSelectedDay &&
    !!dropOffScheduleStrings &&
    !isTimeWithinWindow(
      dropOffTime,
      dropOffScheduleStrings.start,
      dropOffScheduleStrings.end,
    );
  const outsideCapacitySlots =
    !!dropOffTime &&
    selectedServices.length > 0 &&
    bmsAvailFetched &&
    !bmsAvailLoading &&
    !bmsAvailError &&
    dropOffSlots.length > 0 &&
    !dropOffSlots.includes(dropNorm);
  const dropOffOutsideHours = outsideBranchHours || outsideCapacitySlots;

  const pickupNorm = pickupTime ? trimBmsTimeLabel(pickupTime) : "";
  const pickupOutsideBranchHours =
    !!pickupTime &&
    !!selectedDate &&
    !branchClosedOnSelectedDay &&
    !!pickupScheduleStrings &&
    !isTimeWithinWindow(
      pickupTime,
      pickupScheduleStrings.start,
      pickupScheduleStrings.end,
    );
  const pickupOutsideCapacitySlots =
    !!pickupTime &&
    selectedServices.length > 0 &&
    bmsAvailFetched &&
    !bmsAvailLoading &&
    !bmsAvailError &&
    pickupSlots.length > 0 &&
    !pickupSlots.includes(pickupNorm);
  const pickupOutsideHours = pickupOutsideBranchHours || pickupOutsideCapacitySlots;
  const pickupBeforeDropOff =
    !!pickupTime &&
    !!dropOffTime &&
    toMinutes(pickupTime) != null &&
    toMinutes(dropOffTime) != null &&
    (toMinutes(pickupTime) as number) < (toMinutes(dropOffTime) as number);
  const availabilityMessage = branchClosedOnSelectedDay
    ? `${branchDetail?.name || "Branch"} is closed on ${weekday}.`
    : daySchedule?.open && daySchedule?.close
      ? `Open hours on ${weekday}: ${daySchedule.open} - ${daySchedule.close}`
      : null;

  const capacityMessage = useMemo(() => {
    if (selectedServices.length === 0 || !selectedDate) return null;
    if (bmsAvailLoading) return "Checking live capacity for the selected services…";
    if (bmsAvailError) return `Capacity check failed: ${bmsAvailError}`;
    if (bmsAvailFetched && apiSlotsNormalized.length === 0 && !bmsAvailError) {
      return "No open slots on this date for these services. Try another day or adjust your selection.";
    }
    return null;
  }, [
    selectedServices.length,
    selectedDate,
    bmsAvailLoading,
    bmsAvailError,
    bmsAvailFetched,
    apiSlotsNormalized.length,
  ]);

  const availabilityBlocksConfirm = useMemo(() => {
    if (selectedServices.length === 0 || !selectedDate) return false;
    if (!bmsAvailFetched || bmsAvailLoading) return false;
    return !!bmsAvailError || dropOffSlots.length === 0;
  }, [
    selectedServices.length,
    selectedDate,
    bmsAvailFetched,
    bmsAvailLoading,
    bmsAvailError,
    dropOffSlots.length,
  ]);

  /** Same calendar day as the picker, as `yyyy-MM-dd` in the branch timezone (availability + POST). */
  const bookingCalendarDateStr = useMemo(
    () =>
      selectedDate
        ? formatBookingDateForBranchApi(selectedDate, branchDetail?.timezone)
        : "",
    [selectedDate, branchDetail?.timezone],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadBranchHours() {
      try {
        const owner = state?.ownerId;
        const tenantBranch = activeBranchId
          ? activeBranchId
          : (await resolveSessionTenantBmsIds(session?.tenantId)).branchId || "";
        const branchIdToUse = tenantBranch;
        // console.log("[BookingPage] branch-hours lookup", { ownerId: owner, branchId: branchIdToUse || null, tenantId: session?.tenantId ?? null });
        const detail = owner && branchIdToUse
          ? await getBranchDetail(owner, branchIdToUse)
          : await getBranchDetailForTenant(session?.tenantId, branchIdToUse || undefined);
        // console.log("[BookingPage] branch details", detail ?? null);
        if (!cancelled) {
          setBranchDetail(detail ?? null);
          setBranchHoursError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setBranchDetail(null);
          setBranchHoursError(
            err instanceof Error ? err.message : "Failed to load branch open hours.",
          );
        }
      }
    }
    loadBranchHours();
    return () => {
      cancelled = true;
    };
  }, [state?.ownerId, session?.tenantId, activeBranchId]);

  useEffect(() => {
    const ownerUid = state?.ownerId;
    const branchId = activeBranchId;
    const dateStr = bookingCalendarDateStr;

    if (!ownerUid || !branchId || !dateStr || selectedServices.length === 0) {
      setBmsAvailSlotsRaw([]);
      setBmsAvailError(null);
      setBmsAvailLoading(false);
      setBmsAvailFetched(true);
      return;
    }

    let cancelled = false;
    setBmsAvailLoading(true);
    setBmsAvailError(null);
    setBmsAvailFetched(false);

    getBookingAvailability(ownerUid, branchId, dateStr, selectedServices)
      .then((json) => {
        if (cancelled) return;
        const slots = Array.isArray(json.availableSlots) ? json.availableSlots : [];
        setBmsAvailSlotsRaw(slots);
      })
      .catch((e) => {
        if (cancelled) return;
        setBmsAvailSlotsRaw([]);
        setBmsAvailError(
          e instanceof Error ? e.message : "Could not load booking availability.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setBmsAvailLoading(false);
          setBmsAvailFetched(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state?.ownerId, activeBranchId, bookingCalendarDateStr, selectedServices]);

  useEffect(() => {
    if (!dropOffTime) return;
    if (dropOffSlots.length === 0) {
      setDropOffTime("");
      return;
    }
    const norm = trimBmsTimeLabel(dropOffTime);
    if (!dropOffSlots.includes(norm)) {
      setDropOffTime("");
    }
  }, [dropOffSlots, dropOffTime]);

  useEffect(() => {
    if (!pickupTime) return;
    if (!dropOffTime) {
      setPickupTime("");
      return;
    }
    if (pickupSlots.length === 0) {
      setPickupTime("");
      return;
    }
    const pNorm = trimBmsTimeLabel(pickupTime);
    if (!pickupSlots.includes(pNorm)) {
      setPickupTime("");
      return;
    }
    const pm = toMinutes(pickupTime);
    const dm = toMinutes(dropOffTime);
    if (pm != null && dm != null && pm < dm) {
      setPickupTime("");
    }
  }, [dropOffTime, pickupTime, pickupSlots]);

  const toggleService = (value: string) =>
    setSelectedServices((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );

  useEffect(() => {
    if (!state) return;
    setCustomerName(state.customerName || "");
    setCustomerPhone(state.customerPhone || "");
    setCustomerEmail(state.customerEmail || "");
    const v = availableVehicles[0];
    if (v) {
      setSelectedVehicleId(v.id);
      setVehicleRego(v.rego || "");
      setVehicleMake(v.make || "");
      setVehicleModel(v.model || "");
      setVehicleYear(v.year ? String(v.year) : "");
      setVehicleColor(v.color || "");
      setVehicleVin(v.vin || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVehicleSelect = (vehicleId: string) => {
    setSelectedVehicleId(vehicleId);
    if (vehicleId === "new") {
      setVehicleRego("");
      setVehicleMake("");
      setVehicleModel("");
      setVehicleYear("");
      setVehicleColor("");
      setVehicleVin("");
      setVehicleMileage("");
      setVehicleBodyType("");
      setVehicleEngineNumber("");
      return;
    }
    const v = availableVehicles.find((x) => x.id === vehicleId);
    if (!v) return;
    setVehicleRego(v.rego || "");
    setVehicleMake(v.make || "");
    setVehicleModel(v.model || "");
    setVehicleYear(v.year ? String(v.year) : "");
    setVehicleColor(v.color || "");
    setVehicleVin(v.vin || "");
    setVehicleMileage("");
    setVehicleBodyType("");
    setVehicleEngineNumber("");
  };

  const handleSubmit = async () => {
    if (
      !customerName ||
      !customerPhone ||
      selectedServices.length === 0 ||
      !selectedDate ||
      !dropOffTime
    ) {
      toast({
        title: "Missing required fields",
        description: "Please complete all required fields.",
      });
      return;
    }

    if (branchClosedOnSelectedDay || dropOffOutsideHours || pickupOutsideHours || pickupBeforeDropOff) {
      toast({
        title: "Branch not available",
        description:
          branchClosedOnSelectedDay
            ? `${branchDetail?.name || "Branch"} is closed on ${weekday}.`
            : pickupBeforeDropOff
              ? "Pick-up time cannot be before drop-off time."
              : outsideCapacitySlots || pickupOutsideCapacitySlots
                ? "Selected time is not in the available slots for this date and service mix."
                : "Selected time is outside the drop-off window (opening through 11:00) or the pick-up window (14:00 through close).",
        variant: "destructive",
      });
      return;
    }

    if (availabilityBlocksConfirm) {
      toast({
        title: "No availability",
        description: bmsAvailError
          ? bmsAvailError
          : "No open slots on this date for the selected services.",
        variant: "destructive",
      });
      return;
    }

    const dropNormSubmit = trimBmsTimeLabel(dropOffTime);
    if (
      selectedServices.length > 0 &&
      bmsAvailFetched &&
      !bmsAvailLoading &&
      !bmsAvailError &&
      dropOffSlots.length > 0 &&
      !dropOffSlots.includes(dropNormSubmit)
    ) {
      toast({
        title: "Invalid drop-off time",
        description: "Choose a drop-off time from the available slots for this date.",
        variant: "destructive",
      });
      return;
    }

    if (pickupTime) {
      const pickNormSubmit = trimBmsTimeLabel(pickupTime);
      if (pickupSlots.length > 0 && !pickupSlots.includes(pickNormSubmit)) {
        toast({
          title: "Invalid pick-up time",
          description:
            "Choose a pick-up time from the afternoon slots (14:00 through close) for this date.",
          variant: "destructive",
        });
        return;
      }
    }

    // Build services payload from selected service objects
    const serviceItems: BookingServiceItem[] = chosenServices.map((s) => {
      const q = quoteFor(s);
      return {
        serviceId: s.id,
        serviceName: s.name,
        price: q.price,
        duration: q.duration,
      };
    });

    // Use branchId from state, fallback to first branch from selected service
    const branchId = activeBranchId;
    const ownerUidToUse = state?.ownerId;
    // console.log("[BookingPage] submit ids", { ownerId: ownerUidToUse ?? null, branchId: branchId || null });

    if (!ownerUidToUse) {
      toast({
        title: "Booking Failed",
        description: "Missing Owner ID. Bookings must be initiated from a call session.",
        variant: "destructive",
      });
      return;
    }

    const vehicleDetails: VehicleDetails = {
      make: vehicleMake || undefined,
      model: vehicleModel || undefined,
      year: vehicleYear || undefined,
      registrationNumber: vehicleRego || undefined,
      mileage: vehicleMileage || undefined,
      bodyType: vehicleBodyType || undefined,
      colour: vehicleColor || undefined,
      vinChassis: vehicleVin || undefined,
      engineNumber: vehicleEngineNumber || undefined,
    };

    const sanitizedCustomerEmail = sanitizeCustomerEmailForBooking(customerEmail);

    const payload = {
      ownerUid: ownerUidToUse,
      branchId,
      date: bookingCalendarDateStr,
      time: dropOffTime,
      pickupTime: pickupTime || undefined,
      services: serviceItems,
      client: customerName,
      clientEmail: sanitizedCustomerEmail,
      clientPhone: customerPhone,
      customerId: state?.customerId ?? undefined,
      ...(pricingVehicleType ? { vehicleType: pricingVehicleType } : {}),
      vehicleDetails,
      notes: notes || undefined,
    };

    // console.log("[BookingPage] submitting payload:", payload);

    setSubmitting(true);
    try {
      const result = await createBooking(payload);
      // console.log("[BookingPage] booking created:", result);

      // ── Save a local copy to Supabase with agent details ──
      try {
        const { supabase } = await import("@/integrations/supabase/client");

        await (supabase as any).from("bms_bookings").insert({
          bms_booking_id: result.bookingId ?? null,
          owner_uid: ownerUidToUse,
          branch_id: branchId || null,
          agent_uid: session?.userId ?? null,
          agent_email: session?.authEmail ?? null,
          client_name: customerName,
          client_phone: customerPhone || null,
          client_email: sanitizedCustomerEmail || null,
          customer_id: state?.customerId ?? null,
          vehicle_number: vehicleRego || null,
          vehicle_details: [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ") || null,
          booking_date: bookingCalendarDateStr,
          booking_time: dropOffTime,
          pickup_time: pickupTime || null,
          services: serviceItems,
          notes: notes || null,
          bms_status: "Pending",
          bms_response: result,
        });
        // console.log(
        //   "[Supabase] Booking saved locally with agent:",
        //   firebaseUser?.email,
        // );
      } catch (sbErr) {
        // Don't fail the whole flow if Supabase save fails — BMS booking already created
        // console.warn("[Supabase] Failed to save local booking copy:", sbErr);
      }

      await logSystemActivity(session, 'CREATE_BOOKING', 'BOOKING', result.bookingId, {
        customerName,
        service: chosenServices.map((s) => s.name).join(", "),
        date: bookingCalendarDateStr,
        time: dropOffTime
      });

      toast({
        title: "Booking confirmed!",
        description: `${chosenServices.map((s) => s.name).join(", ")} on ${format(selectedDate, "dd MMM yyyy")} at ${dropOffTime}`,
      });
      navigate(-1);
    } catch (error) {
      toast({
        title: "Booking failed",
        description:
          error instanceof Error ? error.message : "Could not save booking.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const bookingDateStr = selectedDate
    ? format(selectedDate, "EEE, dd MMM yyyy")
    : null;
  const canConfirm = !!(
    customerName &&
    customerPhone &&
    selectedServices.length > 0 &&
    selectedDate &&
    dropOffTime &&
    !branchClosedOnSelectedDay &&
    !dropOffOutsideHours &&
    !pickupOutsideHours &&
    !pickupBeforeDropOff &&
    dropOffSlots.length > 0 &&
    !availabilityBlocksConfirm &&
    (!hasVehicleTiering || pricingVehicleType != null)
  );

  return (
    <div className="cc-fade-in min-h-screen bg-[#f5f5f5] text-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50 shadow-sm">
              <CalendarPlus2 className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight">
                {state?.workshopName || "Workshop"}
              </div>
              <div className="text-xs text-muted-foreground">
                Online Booking
              </div>
            </div>
          </div>
          {state?.workshopName && (
            <Badge
              variant="outline"
              className="hidden rounded-full border-0 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] sm:inline-flex"
              style={{ color: workshopColor, background: workshopColor + "18" }}
            >
              {state.workshopName}
            </Badge>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: 2/3 */}
          <div className="space-y-6 lg:col-span-2">
            {/* Services */}
            <div>
              <h1 className="text-2xl font-bold text-slate-950">
                Pick your services
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Select one or more services for your visit
              </p>

              {!servicesLoading &&
                !servicesError &&
                services.length > 0 &&
                hasVehicleTiering &&
                pricingVehicleType != null && (
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100">
                          <CarFront className="h-5 w-5 text-amber-600" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-950">
                            Your vehicle type
                          </h2>
                          <p className="text-sm text-slate-500">
                            Tap another size to re-price the services below.
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="shrink-0 gap-1.5 rounded-full border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-amber-600" />
                        {WORKSHOP_VEHICLE_TYPE_LABELS[pricingVehicleType]}
                      </Badge>
                    </div>
                    <div className="mt-4 grid w-full grid-cols-5 gap-1 sm:gap-2">
                      {WORKSHOP_VEHICLE_TYPE_ORDER.map((key) => {
                        const count = services.filter((s) =>
                          workshopServiceSupportsVehicleType(s, key),
                        ).length;
                        const selected = pricingVehicleType === key;
                        const label = WORKSHOP_VEHICLE_TYPE_LABELS[key];
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={count === 0}
                            aria-label={`${label}, ${count} service${count !== 1 ? "s" : ""} available`}
                            onClick={() => setSelectedVehicleType(key)}
                            className={cn(
                              "relative flex min-h-0 min-w-0 flex-col items-center rounded-lg border-2 px-0.5 py-1.5 text-center transition-all sm:rounded-xl sm:px-2 sm:py-3",
                              count === 0
                                ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-50"
                                : selected
                                  ? "border-amber-400 bg-amber-50/80 shadow-sm"
                                  : "border-slate-200 bg-white hover:border-amber-200",
                            )}
                          >
                            {selected && count > 0 ? (
                              <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm sm:right-1.5 sm:top-1.5 sm:h-6 sm:w-6">
                                <Check className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5" />
                              </span>
                            ) : null}
                            <div
                              className={cn(
                                "mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md sm:mb-2 sm:h-10 sm:w-10 sm:rounded-lg",
                                selected && count > 0 ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-700",
                              )}
                            >
                              {vehicleTypeIcon(
                                key,
                                cn(
                                  "h-3.5 w-3.5 sm:h-5 sm:w-5",
                                  selected && count > 0 ? "text-white" : "text-slate-700",
                                ),
                              )}
                            </div>
                            <div
                              className={cn(
                                "line-clamp-3 min-h-[2.25rem] w-full px-0.5 text-[9px] font-bold leading-[1.15] sm:min-h-0 sm:px-0 sm:text-sm sm:leading-tight",
                                selected && count > 0 ? "text-amber-800" : "text-slate-900",
                              )}
                            >
                              {label}
                            </div>
                            <div
                              className={cn(
                                "mt-0.5 line-clamp-2 w-full px-0.5 text-[9px] leading-tight sm:mt-1 sm:text-xs sm:leading-normal",
                                selected && count > 0 ? "text-amber-700" : "text-slate-500",
                              )}
                            >
                              <span className="sm:hidden tabular-nums">
                                {count} avail.
                              </span>
                              <span className="hidden sm:inline">
                                {count} service{count !== 1 ? "s" : ""} available
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

              {servicesLoading && (
                <p className="mt-6 text-sm text-slate-400">Loading services…</p>
              )}

              {servicesError && (
                <p className="mt-6 text-sm text-red-500">
                  Failed to load services: {servicesError}
                </p>
              )}

              <div className="mt-4 space-y-3">
                {services.map((s) => {
                  const tierOk =
                    !pricingVehicleType ||
                    workshopServiceSupportsVehicleType(s, pricingVehicleType);
                  const q = quoteFor(s);
                  return (
                    <ServiceCard
                      key={s.id}
                      service={{
                        value: s.id,
                        label: s.name,
                        image: s.imageUrl ?? undefined,
                        duration: formatDurationMinutes(q.duration),
                        price: `$${q.price.toLocaleString()}`,
                        color: "#f59e0b",
                        included: s.checklist?.map((c) => c.name) ?? [],
                      }}
                      selected={selectedServices.includes(s.id)}
                      onToggle={() => toggleService(s.id)}
                      disabled={!tierOk}
                      unavailableReason={
                        !tierOk ? "Not available for this vehicle size" : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>

            {/* Date & Time */}
            <Card className="border-0 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  When would you like to visit?{" "}
                  <span className="text-rose-500">*</span>
                </CardTitle>
              </CardHeader>
              <Separator />
              <CardContent className="pt-4">
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Date
                    </div>
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(d) => {
                        setSelectedDate(d);
                        setDropOffTime("");
                        setPickupTime("");
                      }}
                      disabled={(d) => {
                        const inPast = isBefore(startOfDay(d), startOfDay(new Date()));
                        if (inPast) return true;
                        const branchDay = getWeekdayForBranch(d, branchDetail?.timezone);
                        const daily =
                          branchDetail?.daySchedules?.[branchDay] ??
                          (branchDetail?.hours?.[branchDay]
                            ? {
                                closed: !!branchDetail?.hours?.[branchDay]?.closed,
                              }
                            : getInlineSchedule(branchDetail));
                        return !!daily?.closed;
                      }}
                      fromDate={new Date()}
                      toDate={addDays(new Date(), 90)}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                    />
                  </div>
                  <div className="space-y-5">
                    {(availabilityMessage || branchHoursError || capacityMessage) && (
                      <div className="space-y-2">
                        {(availabilityMessage || branchHoursError) && (
                          <div
                            className={`rounded-lg border px-3 py-2 text-xs ${
                              branchClosedOnSelectedDay || branchHoursError
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {branchHoursError || availabilityMessage}
                          </div>
                        )}
                        {capacityMessage && (
                          <div
                            className={`rounded-lg border px-3 py-2 text-xs ${
                              bmsAvailError ||
                              (bmsAvailFetched &&
                                apiSlotsNormalized.length === 0 &&
                                selectedServices.length > 0)
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-slate-200 bg-slate-50 text-slate-600"
                            }`}
                          >
                            {capacityMessage}
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                        Drop-off time
                      </div>
                      <p className="mb-3 text-xs text-slate-400">
                        Drop-off slots run from opening through{" "}
                        <span className="font-medium text-slate-600">11:00</span>
                        {dropOffScheduleStrings ? (
                          <>
                            {" "}
                            (here{" "}
                            <span className="font-medium text-slate-600">
                              {dropOffScheduleStrings.start}
                            </span>{" "}
                            – {dropOffScheduleStrings.end}).
                          </>
                        ) : (
                          " (branch hours needed to align with opening)."
                        )}
                      </p>
                      {!selectedDate ? null : dropOffSlots.length === 0 ? (
                        <p className="mb-3 text-xs text-rose-600">
                          {selectedServices.length > 0 &&
                          bmsAvailFetched &&
                          !bmsAvailLoading
                            ? bmsAvailError
                              ? "Could not verify live capacity. See the message above."
                              : "No open slots for this date with the selected services."
                            : "No open hours available for the selected date."}
                        </p>
                      ) : null}
                      <div className="grid grid-cols-3 gap-2">
                        {dropOffSlots.map((slot) => (
                          <button
                            key={slot}
                            type="button"
                            disabled={
                              !selectedDate ||
                              branchClosedOnSelectedDay ||
                              (dropOffScheduleStrings
                                ? !isTimeWithinWindow(
                                    slot,
                                    dropOffScheduleStrings.start,
                                    dropOffScheduleStrings.end,
                                  )
                                : toMinutes(slot) != null &&
                                  (toMinutes(slot) as number) > DROP_OFF_LATEST_MINUTES)
                            }
                            onClick={() => setDropOffTime(slot)}
                            className={`rounded-lg border px-2 py-2 text-sm font-medium transition-all ${dropOffTime === slot ? "border-amber-400 bg-amber-400 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50 disabled:opacity-40"}`}
                          >
                            {slot}
                          </button>
                        ))}
                      </div>
                      {dropOffOutsideHours && (
                        <p className="mt-2 text-xs text-rose-600">
                          {outsideCapacitySlots && !outsideBranchHours
                            ? "Selected drop-off is not in the available slots for this date."
                            : "Selected drop-off is outside the morning window (opening through 11:00)."}
                        </p>
                      )}
                    </div>
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        <span className="inline-block h-2 w-2 rounded-full bg-sky-400" />
                        Pick-up time
                        <span className="ml-1 font-normal text-slate-400">
                          (optional)
                        </span>
                      </div>
                      <p className="mb-3 text-xs text-slate-400">
                        Pick-up slots from{" "}
                        <span className="font-medium text-slate-600">14:00</span> through close
                        {pickupScheduleStrings ? (
                          <>
                            {" "}
                            (here{" "}
                            <span className="font-medium text-slate-600">
                              {pickupScheduleStrings.start}
                            </span>{" "}
                            – {pickupScheduleStrings.end}).
                          </>
                        ) : (
                          " (branch hours needed)."
                        )}
                      </p>
                      {!selectedDate ? null : pickupSlots.length === 0 ? (
                        <p className="mb-3 text-xs text-rose-600">
                          No pick-up slots in the 14:00–close window for the selected date.
                        </p>
                      ) : null}
                      <div className="grid grid-cols-3 gap-2">
                        {pickupSlots.map((slot) => (
                          <button
                            key={slot}
                            type="button"
                            disabled={
                              !selectedDate ||
                              !dropOffTime ||
                              branchClosedOnSelectedDay ||
                              toMinutes(slot) == null ||
                              toMinutes(dropOffTime) == null ||
                              (toMinutes(slot) as number) < (toMinutes(dropOffTime) as number) ||
                              (pickupScheduleStrings
                                ? !isTimeWithinWindow(
                                    slot,
                                    pickupScheduleStrings.start,
                                    pickupScheduleStrings.end,
                                  )
                                : toMinutes(slot) != null &&
                                  (toMinutes(slot) as number) < PICKUP_EARLIEST_MINUTES)
                            }
                            onClick={() =>
                              setPickupTime(pickupTime === slot ? "" : slot)
                            }
                            className={`rounded-lg border px-2 py-2 text-sm font-medium transition-all ${pickupTime === slot ? "border-sky-400 bg-sky-400 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50 disabled:opacity-40"}`}
                          >
                            {slot}
                          </button>
                        ))}
                      </div>
                      {pickupOutsideHours && (
                        <p className="mt-2 text-xs text-rose-600">
                          {pickupOutsideCapacitySlots && !pickupOutsideBranchHours
                            ? "Selected pick-up is not in the available slots for this date."
                            : "Selected pick-up is outside the afternoon window (14:00 through close)."}
                        </p>
                      )}
                      {pickupBeforeDropOff && (
                        <p className="mt-2 text-xs text-rose-600">
                          Pick-up time cannot be before drop-off time.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Your Information */}
            <Card className="border-0 bg-white shadow-sm">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Client information
                  </div>
                </div>
                <Separator className="mb-4" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="customer-name">
                      Full name <span className="text-rose-500">*</span>
                    </Label>
                    <Input
                      id="customer-name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Customer name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="customer-phone">
                      Phone <span className="text-rose-500">*</span>
                    </Label>
                    <Input
                      id="customer-phone"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="Phone number"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="customer-email">
                      Email <span className="text-slate-400">(optional)</span>
                    </Label>
                    <Input
                      id="customer-email"
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="name@example.com — leave blank if unknown"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Vehicle Details */}
            <Card className="border-0 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <CarFront className="h-4 w-4" /> Vehicle Details
                </CardTitle>
              </CardHeader>
              <Separator />
              <CardContent className="space-y-4 pt-4">
                <div className="space-y-1.5">
                  <Label>Select vehicle or add new</Label>
                  <Select
                    value={selectedVehicleId}
                    onValueChange={handleVehicleSelect}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a vehicle" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">+ New vehicle</SelectItem>
                      {availableVehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {[
                            v.rego,
                            v.make,
                            v.model,
                            v.year ? String(v.year) : "",
                            v.color ? `(${v.color})` : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-300 text-[10px] text-slate-400">
                    i
                  </span>
                  All vehicle fields are optional. Add at least one identifier
                  (e.g. registration, make/model).
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>
                      Make{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      value={vehicleMake}
                      onChange={(e) => setVehicleMake(e.target.value)}
                      placeholder="Toyota"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Model{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      placeholder="Corolla"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Year{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      value={vehicleYear}
                      onChange={(e) => setVehicleYear(e.target.value)}
                      placeholder="2020"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>
                      Registration number{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      value={vehicleRego}
                      onChange={(e) => setVehicleRego(e.target.value)}
                      placeholder="ABC-1234"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Mileage{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      value={vehicleMileage}
                      onChange={(e) => setVehicleMileage(e.target.value)}
                      placeholder="1234"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>
                      Body type{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      value={vehicleBodyType}
                      onChange={(e) => setVehicleBodyType(e.target.value)}
                      placeholder="Sedan"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Colour{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      value={vehicleColor}
                      onChange={(e) => setVehicleColor(e.target.value)}
                      placeholder="White"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>
                      VIN / Chassis{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      value={vehicleVin}
                      onChange={(e) => setVehicleVin(e.target.value)}
                      placeholder="1HGBH41JXMN109186"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Engine number{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      value={vehicleEngineNumber}
                      onChange={(e) => setVehicleEngineNumber(e.target.value)}
                      placeholder="Engine number"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Notes */}
            <Card className="border-0 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Notes{" "}
                  <span className="text-[11px] font-normal text-slate-400">
                    (optional)
                  </span>
                </CardTitle>
              </CardHeader>
              <Separator />
              <CardContent className="pt-4">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Vehicle details, special requests..."
                  rows={4}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right: Order Summary */}
          <div>
            <div className="sticky top-24">
              <Card className="border-0 bg-slate-900 text-white shadow-lg">
                <CardContent className="p-5">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Order Summary
                  </div>
                  <div className="mb-4 text-xs text-slate-500">
                    {selectedServices.length > 0
                      ? `${selectedServices.length} service${selectedServices.length > 1 ? "s" : ""} selected`
                      : "No service selected"}
                  </div>
                  {/* <Separator className="mb-4 bg-slate-700" /> */}

                  {state?.workshopName && (
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm text-slate-300">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        {state.workshopName}
                      </div>
                    </div>
                  )}

                  {chosenServices.map((s) => {
                    const q = quoteFor(s);
                    return (
                      <div
                        key={s.id}
                        className="mb-2 rounded-xl bg-slate-800 px-3 py-2"
                      >
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 text-slate-200">
                            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                            {s.name}
                          </div>
                          <span className="font-bold text-amber-400">
                            ${q.price.toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                          <Clock className="h-3 w-3" />
                          {formatDurationMinutes(q.duration)}
                        </div>
                      </div>
                    );
                  })}

                  {bookingDateStr && (
                    <div className="mb-3 rounded-xl bg-slate-800 px-3 py-2 text-xs text-slate-400">
                      {bookingDateStr}
                      {dropOffTime && (
                        <div className="mt-0.5 font-semibold text-white">
                          Drop-off {dropOffTime}
                        </div>
                      )}
                      {pickupTime && (
                        <div className="mt-0.5 text-sky-400">
                          Pick-up {pickupTime}
                        </div>
                      )}
                    </div>
                  )}

                  {(vehicleRego || vehicleMake) && (
                    <div className="mb-3 rounded-xl bg-slate-800 px-3 py-2 text-xs text-slate-400">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CarFront className="h-3.5 w-3.5" />
                        <span className="font-medium text-slate-300">
                          {[vehicleMake, vehicleModel, vehicleYear]
                            .filter(Boolean)
                            .join(" ") || "Vehicle"}
                        </span>
                      </div>
                      {vehicleRego && (
                        <div>
                          Reg: <span className="text-white">{vehicleRego}</span>
                        </div>
                      )}
                      {vehicleColor && (
                        <div>
                          Colour:{" "}
                          <span className="text-white">{vehicleColor}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {chosenServices.length > 0 && (
                    <div className="mb-4 flex items-center justify-between rounded-xl bg-amber-400/10 px-3 py-2">
                      <span className="text-sm font-semibold text-slate-300">
                        Total
                      </span>
                      <span className="text-lg font-bold text-amber-400">
                        $
                        {chosenServices
                          .reduce((sum, s) => sum + quoteFor(s).price, 0)
                          .toLocaleString()}
                      </span>
                    </div>
                  )}

                  <Separator className="mb-4 bg-slate-700" />

                  <Button
                    className="w-full bg-amber-400 font-semibold text-slate-950 hover:bg-amber-500"
                    disabled={!canConfirm || submitting}
                    onClick={handleSubmit}
                  >
                    {submitting ? "Saving…" : "Confirm Booking"}
                  </Button>
                  <p className="mt-3 text-center text-[11px] text-slate-500">
                    By confirming, the booking will be saved to the system.
                  </p>
                </CardContent>
              </Card>
              <Button
                variant="outline"
                className="mt-3 w-full"
                disabled={submitting}
                onClick={() => navigate(-1)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
