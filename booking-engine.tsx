"use client";

import type { BookingBusiness, BookingService } from "@/app/booknow/[slug]/page";
import { iconForBusinessType } from "@/lib/onboarding/types";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  CUSTOMER_FIXED_NAV_BAR_CLASS,
  CUSTOMER_FIXED_NAV_INNER_CLASS,
  CustomerBookingShell,
  CustomerNavSpacer,
} from "@/components/customer-booking-shell";
import {
  CustomerAccountNav,
  CustomerGuestNav,
} from "@/components/customer-account-nav";
import { accountPath, rememberBookingSlug } from "@/lib/customer/booking-routes";
import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import {
  SlotDayPicker,
  todayIso,
} from "@/components/booking-slot-date-picker";
import { formatAddress } from "@/lib/inspection/types";

type Props = {
  business: BookingBusiness;
  services: BookingService[];
};

export type ServiceAddress = {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
};

function formatServiceAddress(address: ServiceAddress): string {
  return formatAddress(address);
}

function isServiceAddressComplete(address: ServiceAddress): boolean {
  return (
    address.street.trim().length >= 3 &&
    address.suburb.trim().length >= 2 &&
    address.state.trim().length >= 2 &&
    address.postcode.trim().length >= 4
  );
}

export function BookingEngine({ business, services }: Props) {
  const reducedMotion = useReducedMotion();

  const location = useMemo(() => {
    if (business.state && business.postcode) {
      return `${business.state}, ${business.postcode}`;
    }
    return business.state ?? "";
  }, [business.state, business.postcode]);

  const phoneHref = business.businessPhone
    ? `tel:+61${business.businessPhone.replace(/\s+/g, "")}`
    : null;
  const emailHref = business.businessEmail
    ? `mailto:${business.businessEmail}`
    : null;

  useEffect(() => {
    rememberBookingSlug(business.slug);
  }, [business.slug]);

  return (
    <CustomerBookingShell
      backdrop={<AnimatedBackdrop reducedMotion={!!reducedMotion} />}
    >
      <TopBar
        businessName={business.businessName}
        bookingSlug={business.slug}
        logoUrl={business.logoUrl}
      />

      {/* Hero split — same card footprint as account panel */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative mt-4 flex min-h-[min(72vh,640px)] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:mt-5 sm:rounded-[24px] sm:p-6"
      >
          <div className="relative grid gap-5 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-10">
            <HeroContent
              business={business}
              location={location}
              reducedMotion={!!reducedMotion}
            />
            <div className="hidden lg:block">
              <RadarVisualization
                business={business}
                reducedMotion={!!reducedMotion}
              />
            </div>
          </div>

          <div className="relative mt-6 border-t border-stone-200/70 pt-6 sm:mt-10 sm:border-t-0 sm:pt-0">
            <ServiceBookingFlow
              slug={business.slug}
              businessName={business.businessName}
              services={services}
              reducedMotion={!!reducedMotion}
              phoneHref={phoneHref}
              emailHref={emailHref}
            />
          </div>
        </motion.section>

      <BookingFooter
        business={business}
        phoneHref={phoneHref}
        emailHref={emailHref}
      />
    </CustomerBookingShell>
  );
}

/* ==========================================================================
 * Top bar
 * ========================================================================== */

function TopBar({
  businessName,
  bookingSlug,
  logoUrl,
}: {
  businessName: string;
  bookingSlug: string;
  logoUrl?: string | null;
}) {
  const { status } = useCustomerAuth();

  if (status === "loading") {
    return <CustomerNavSpacer />;
  }

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className={CUSTOMER_FIXED_NAV_BAR_CLASS}
      >
        <div className={CUSTOMER_FIXED_NAV_INNER_CLASS}>
          {status === "authenticated" ? (
            <CustomerAccountNav />
          ) : (
            <CustomerGuestNav
              businessName={businessName}
              bookingSlug={bookingSlug}
              logoUrl={logoUrl}
            />
          )}
        </div>
      </motion.header>
      <CustomerNavSpacer />
    </>
  );
}

/* ==========================================================================
 * Hero content (left side)
 * ========================================================================== */

function HeroContent({
  business,
  location,
  reducedMotion,
}: {
  business: BookingBusiness;
  location: string;
  reducedMotion: boolean;
}) {
  const containerVariants = {
    hidden: {},
    show: {
      transition: { staggerChildren: 0.07, delayChildren: 0.1 },
    },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 14 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
    },
  };

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show">
      {business.logoUrl ? (
        <motion.div variants={itemVariants} className="mb-3 sm:mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={business.logoUrl}
            alt={business.businessName}
            className="h-14 w-14 rounded-2xl border border-stone-200 bg-white object-cover shadow-sm sm:h-16 sm:w-16"
          />
        </motion.div>
      ) : null}

      <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-stone-700 shadow-sm">
          <span className="material-symbols-outlined material-symbols-filled text-[14px] text-amber-700">
            {iconForBusinessType(business.businessType)}
          </span>
          {business.businessType}
        </span>
        <AvailableBadge active={business.isActive} reducedMotion={reducedMotion} />
      </motion.div>

      <motion.h1
        variants={itemVariants}
        className="mt-3 font-display text-[26px] font-bold leading-[1.08] tracking-tight text-on-surface sm:mt-4 sm:text-[48px]"
      >
        Book{" "}
        <span className="relative inline-block">
          <span className="relative z-10 text-on-surface">
            {business.businessName}
          </span>
          {!reducedMotion && (
            <motion.span
              aria-hidden
              initial={{ scaleX: 0, originX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.6, duration: 0.6, ease: "easeOut" }}
              className="absolute -bottom-1 left-0 h-[6px] w-full rounded-full bg-primary/25"
            />
          )}
        </span>
      </motion.h1>

      <motion.p
        variants={itemVariants}
        className="mt-2 hidden font-body text-body-lg text-on-surface-variant sm:block"
      >
        Local trade pros, online booking, no callbacks. Pick a time and
        we&apos;ll confirm in minutes.
      </motion.p>

      {(location || business.businessAddress) && (
        <motion.div
          variants={itemVariants}
          className="mt-5 inline-flex items-start gap-2.5 rounded-2xl border border-outline-variant/60 bg-white/70 px-4 py-3 backdrop-blur"
        >
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-primary">
            location_on
          </span>
          <div className="font-body text-body-md leading-tight">
            {business.businessAddress ? (
              <p className="font-semibold text-on-surface">
                {business.businessAddress}
              </p>
            ) : null}
            {location ? (
              <p className="text-on-surface-variant">{location}</p>
            ) : null}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function AvailableBadge({
  active,
  reducedMotion,
}: {
  active: boolean;
  reducedMotion: boolean;
}) {
  if (!active) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-1 font-body text-[11px] font-semibold text-on-surface-variant">
        <span className="h-1.5 w-1.5 rounded-full bg-on-surface-variant/60" />
        Unavailable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-body text-[11px] font-semibold text-emerald-700">
      <span className="relative flex h-1.5 w-1.5">
        {!reducedMotion && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: 0, scale: 2.4 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            className="absolute inset-0 rounded-full bg-emerald-500"
          />
        )}
        <span className="relative h-full w-full rounded-full bg-emerald-500" />
      </span>
      Booking now
    </span>
  );
}

/* ==========================================================================
 * Radar visualization (right side of hero)
 * ========================================================================== */

function RadarVisualization({
  business,
  reducedMotion,
}: {
  business: BookingBusiness;
  reducedMotion: boolean;
}) {
  const areas = business.serviceAreas.slice(0, 6);
  const [activeArea, setActiveArea] = useState(0);

  // Cycle through suburbs
  useEffect(() => {
    if (reducedMotion || areas.length === 0) return;
    const id = window.setInterval(() => {
      setActiveArea((i) => (i + 1) % areas.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [reducedMotion, areas.length]);

  const placements = useMemo(() => {
    return areas.map((area, idx) => {
      const angle = (idx / Math.max(areas.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = 0.35 + ((idx % 2) * 0.05);
      return {
        area,
        x: 50 + Math.cos(angle) * radius * 100,
        y: 50 + Math.sin(angle) * radius * 100,
      };
    });
  }, [areas]);

  return (
    <div className="relative mx-auto flex aspect-square w-full max-w-[400px] items-center justify-center">
      {/* Concentric grid rings — brand blue */}
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <radialGradient id="radarGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(67,123,255,0.14)" />
            <stop offset="100%" stopColor="rgba(67,123,255,0)" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="95" fill="url(#radarGrad)" />
        {[30, 55, 80, 95].map((r) => (
          <circle
            key={r}
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke="rgba(67,123,255,0.28)"
            strokeWidth="1"
            strokeDasharray={r === 95 ? "0" : "3 3"}
          />
        ))}
        <line
          x1="5"
          y1="100"
          x2="195"
          y2="100"
          stroke="rgba(67,123,255,0.2)"
          strokeWidth="0.6"
        />
        <line
          x1="100"
          y1="5"
          x2="100"
          y2="195"
          stroke="rgba(67,123,255,0.2)"
          strokeWidth="0.6"
        />
      </svg>

      {/* Rotating sweep — brand blue */}
      {!reducedMotion && (
        <motion.div
          aria-hidden
          initial={{ rotate: 0 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 [mask:radial-gradient(circle,black,transparent_70%)]"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(67,123,255,0.22) 30deg, transparent 60deg, transparent 360deg)",
            borderRadius: "9999px",
          }}
        />
      )}

      {/* Center pulse */}
      <div className="relative z-10 flex h-20 w-20 items-center justify-center">
        {!reducedMotion && (
          <>
            <motion.span
              aria-hidden
              initial={{ opacity: 0.4, scale: 0.7 }}
              animate={{ opacity: 0, scale: 1.7 }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut" }}
              className="absolute inset-0 rounded-full bg-primary/35"
            />
            <motion.span
              aria-hidden
              initial={{ opacity: 0.35, scale: 0.7 }}
              animate={{ opacity: 0, scale: 1.4 }}
              transition={{
                duration: 2.6,
                repeat: Infinity,
                ease: "easeOut",
                delay: 0.7,
              }}
              className="absolute inset-0 rounded-full bg-primary/35"
            />
          </>
        )}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/85 text-on-primary shadow-[0_10px_30px_-10px_rgba(67,123,255,0.55)]">
          <span className="material-symbols-outlined material-symbols-filled text-[28px]">
            {iconForBusinessType(business.businessType)}
          </span>
        </div>
      </div>

      {/* Pins */}
      {placements.map((pin, idx) => (
        <motion.button
          key={pin.area}
          type="button"
          onClick={() => setActiveArea(idx)}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            delay: 0.4 + idx * 0.08,
            duration: 0.4,
            ease: "easeOut",
          }}
          whileHover={reducedMotion ? undefined : { scale: 1.15 }}
          className="group absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
        >
          <span
            className={`relative flex items-center gap-1 rounded-full border px-2.5 py-1 font-body text-[11px] font-bold transition-all ${
              activeArea === idx
                ? "border-primary bg-primary text-on-primary shadow-md"
                : "border-stone-200 bg-white text-stone-700"
            }`}
          >
            {!reducedMotion && activeArea === idx && (
              <motion.span
                aria-hidden
                initial={{ opacity: 0.55, scale: 1 }}
                animate={{ opacity: 0, scale: 2 }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
                className="absolute inset-0 rounded-full bg-primary/45"
              />
            )}
            <span
              className={`material-symbols-outlined material-symbols-filled text-[12px] ${
                activeArea === idx ? "text-on-primary" : "text-stone-500"
              }`}
            >
              place
            </span>
            {pin.area}
          </span>
        </motion.button>
      ))}

      {areas.length === 0 ? (
        <p className="absolute bottom-4 left-1/2 -translate-x-1/2 font-body text-[11px] text-on-surface-variant">
          Service area coming soon
        </p>
      ) : (
        <p className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-stone-200 bg-white/95 px-3 py-1 font-body text-[11px] font-semibold text-stone-700 backdrop-blur">
          Covering {areas.length} {areas.length === 1 ? "area" : "areas"}
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * Service booking flow — address first, then service
 * ========================================================================== */

const EMPTY_ADDRESS: ServiceAddress = {
  street: "",
  suburb: "",
  state: "",
  postcode: "",
};

const BOOKING_INPUT_CLASS =
  "mt-1 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-3 font-body text-[16px] text-on-surface shadow-sm placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 sm:py-2.5 sm:text-[14px]";

/** One-off visit address — avoid browser "Save address?" prompts. */
const BOOKING_AUTOCOMPLETE = "off";

const BOOKING_STEP_PANEL_CLASS =
  "w-full min-w-0 rounded-xl border border-stone-200 bg-[#faf8f5] p-3 sm:rounded-2xl sm:p-5";

const BOOKING_LABEL_CLASS =
  "font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant";

function normalizeBudgetInput(value: string): string {
  let cleaned = value.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot !== -1) {
    cleaned =
      cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
  }
  const [whole, frac = ""] = cleaned.split(".");
  return frac ? `${whole}.${frac.slice(0, 2)}` : whole;
}

function BookingRequestExtras({
  notes,
  budget,
  onNotesChange,
  onBudgetChange,
}: {
  notes: string;
  budget: string;
  onNotesChange: (value: string) => void;
  onBudgetChange: (value: string) => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-stone-200/90 bg-white p-3 shadow-sm sm:p-4">
      <p className={BOOKING_LABEL_CLASS}>Additional details</p>
      <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
        Optional — helps the team prepare for your visit or quote.
      </p>

      <div className="mt-3 grid gap-3">
        <label className="block">
          <span className={BOOKING_LABEL_CLASS}>Notes</span>
          <textarea
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            rows={3}
            placeholder="Access instructions, urgency, materials, anything else we should know…"
            autoComplete={BOOKING_AUTOCOMPLETE}
            className={`${BOOKING_INPUT_CLASS} resize-y`}
            maxLength={2000}
          />
        </label>

        <label className="block">
          <span className={BOOKING_LABEL_CLASS}>Your budget</span>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 font-body text-[14px] font-semibold text-on-surface">
              Aus $
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={budget}
              onChange={(event) =>
                onBudgetChange(normalizeBudgetInput(event.target.value))
              }
              placeholder="e.g. 2500"
              autoComplete={BOOKING_AUTOCOMPLETE}
              className={`${BOOKING_INPUT_CLASS} mt-0 pl-[3.65rem] pr-3`}
              maxLength={12}
            />
          </div>
          <span className="mt-1 block font-body text-[11px] text-on-surface-variant">
            Rough amount you have in mind (optional).
          </span>
        </label>
      </div>
    </div>
  );
}

type RequestType = "existing_service" | "custom_quote";
type SlotTimeRange = "morning" | "afternoon";

type PreferredSlot = { date: string; timeRange: SlotTimeRange };

const TIME_RANGE_OPTIONS: {
  id: SlotTimeRange;
  label: string;
  hint: string;
  icon: string;
}[] = [
  { id: "morning", label: "Morning", hint: "8am – 12pm", icon: "wb_twilight" },
  { id: "afternoon", label: "Afternoon", hint: "12pm – 5pm", icon: "wb_sunny" },
];

function formatPrettyDate(iso: string): string {
  if (!iso) return "";
  const parsed = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PreferredSlotPicker({
  slot,
  slotIndex,
  minDate,
  allSlots,
  dayPage,
  onDayPageChange,
  onDateChange,
  onTimeChange,
}: {
  slot: PreferredSlot;
  slotIndex: number;
  minDate: string;
  allSlots: PreferredSlot[];
  dayPage: number;
  onDayPageChange: (page: number) => void;
  onDateChange: (iso: string) => void;
  onTimeChange: (timeRange: SlotTimeRange) => void;
}) {
  const takenCombos = useMemo(() => {
    const combos = new Set<string>();
    allSlots.forEach((entry, index) => {
      if (index !== slotIndex && entry.date) {
        combos.add(`${entry.date}-${entry.timeRange}`);
      }
    });
    return combos;
  }, [allSlots, slotIndex]);

  const morningTaken =
    slot.date.length > 0 && takenCombos.has(`${slot.date}-morning`);
  const afternoonTaken =
    slot.date.length > 0 && takenCombos.has(`${slot.date}-afternoon`);

  const selectedTimeLabel =
    TIME_RANGE_OPTIONS.find((option) => option.id === slot.timeRange)?.label ??
    "";

  return (
    <div className="mt-3 flex flex-col gap-4">
      <SlotDayPicker
        selectedIso={slot.date}
        minDate={minDate}
        dayPage={dayPage}
        onDayPageChange={onDayPageChange}
        onSelect={onDateChange}
        dayStripLayout="fit"
      />

      <div>
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Pick a time window
        </span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {TIME_RANGE_OPTIONS.map((option) => {
            const checked = slot.timeRange === option.id;
            const disabled =
              !slot.date ||
              takenCombos.has(`${slot.date}-${option.id}`);
            return (
              <button
                type="button"
                key={option.id}
                disabled={disabled}
                onClick={() => onTimeChange(option.id)}
                className={`relative flex min-h-[5rem] flex-col justify-between overflow-hidden rounded-2xl border px-3 py-3 text-left transition-all ${
                  disabled
                    ? "cursor-not-allowed border-stone-100 bg-stone-50 opacity-45"
                    : checked
                      ? "border-primary bg-gradient-to-br from-primary/15 via-white to-amber-50/80 ring-2 ring-primary/20"
                      : "border-stone-200 bg-white hover:border-stone-300 hover:shadow-sm"
                }`}
              >
                <span
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                    checked
                      ? "bg-primary text-on-primary shadow-sm"
                      : "bg-stone-100 text-stone-600"
                  }`}
                >
                  <span className="material-symbols-outlined material-symbols-filled text-[20px]">
                    {option.icon}
                  </span>
                </span>
                <span>
                  <span
                    className={`block font-body text-[14px] font-bold ${
                      checked ? "text-primary" : "text-on-surface"
                    }`}
                  >
                    {option.label}
                  </span>
                  <span className="font-body text-[11px] text-on-surface-variant">
                    {option.hint}
                  </span>
                </span>
                {checked ? (
                  <span className="absolute right-2 top-[9px] material-symbols-outlined material-symbols-filled text-[18px] leading-none text-primary">
                    check_circle
                  </span>
                ) : null}
                {disabled && slot.date ? (
                  <span className="absolute bottom-2 right-2 font-body text-[9px] font-bold uppercase tracking-wide text-outline">
                    Used
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {slot.date ? (
        <div
          className={`rounded-xl border px-3 py-2.5 ${
            morningTaken && afternoonTaken
              ? "border-amber-200 bg-amber-50/80"
              : "border-primary/25 bg-primary/5"
          }`}
        >
          <p className="inline-flex items-center gap-1.5 font-body text-[12px] font-semibold text-on-surface">
            <span className="material-symbols-outlined text-[16px] text-primary">
              event_available
            </span>
            {formatPrettyDate(slot.date)}
            {selectedTimeLabel ? (
              <>
                <span className="text-on-surface-variant">·</span>
                <span className="text-primary">{selectedTimeLabel}</span>
              </>
            ) : null}
          </p>
          {morningTaken && afternoonTaken ? (
            <p className="mt-1 font-body text-[11px] text-amber-800">
              Both time windows are already used in another option — pick a
              different day.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-stone-200 bg-white/60 px-3 py-2 font-body text-[12px] text-on-surface-variant">
          Choose a day above, then pick morning or afternoon.
        </p>
      )}
    </div>
  );
}

function ServiceBookingFlow({
  slug,
  businessName,
  services,
  phoneHref,
  emailHref,
  reducedMotion,
}: {
  slug: string;
  businessName: string;
  services: BookingService[];
  phoneHref: string | null;
  emailHref: string | null;
  reducedMotion: boolean;
}) {
  const [requestType, setRequestType] = useState<RequestType>(
    services.length > 0 ? "existing_service" : "custom_quote",
  );
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const [customTitle, setCustomTitle] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [budgetAud, setBudgetAud] = useState("");
  const [address, setAddress] = useState<ServiceAddress>(EMPTY_ADDRESS);
  const [preferredSlots, setPreferredSlots] = useState<PreferredSlot[]>([
    { date: "", timeRange: "morning" },
  ]);
  const [customer, setCustomer] = useState({
    fullName: "",
    email: "",
    phone: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedRequestId, setSubmittedRequestId] = useState<string | null>(
    null,
  );
  const [workingDayPage, setWorkingDayPage] = useState(0);

  const customerAuth = useCustomerAuth();
  const isAuthenticated = customerAuth.status === "authenticated";
  const profile = customerAuth.profile;
  const customerEmailFromAuth =
    profile?.email ?? customerAuth.user?.email ?? "";

  useEffect(() => {
    if (!isAuthenticated) return;
    setCustomer((prev) => ({
      fullName: profile?.fullName?.trim() || prev.fullName,
      email: customerEmailFromAuth || prev.email,
      phone: profile?.phone?.trim() || prev.phone,
    }));
  }, [
    isAuthenticated,
    profile?.fullName,
    profile?.phone,
    customerEmailFromAuth,
  ]);

  const profileLocked = isAuthenticated;

  const minDate = useMemo(() => todayIso(), []);
  const selectedService =
    services.find((service) => service.id === selectedServiceId) ?? null;

  const addressComplete = isServiceAddressComplete(address);

  const requestStepValid =
    requestType === "existing_service"
      ? selectedService !== null
      : customTitle.trim().length >= 3 &&
        customDescription.trim().length >= 10;

  const slotsValid =
    preferredSlots.length > 0 &&
    preferredSlots.every((slot) => slot.date.trim().length > 0) &&
    new Set(preferredSlots.map((slot) => `${slot.date}-${slot.timeRange}`))
      .size === preferredSlots.length;

  const customerValid =
    customer.fullName.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim()) &&
    customer.phone.replace(/\D/g, "").length > 0;

  const canSubmit =
    requestStepValid &&
    addressComplete &&
    slotsValid &&
    customerValid &&
    !submitting &&
    !submittedRequestId;

  function updateAddress<K extends keyof ServiceAddress>(key: K, value: string) {
    setAddress((prev) => ({ ...prev, [key]: value }));
    setSubmitError(null);
  }

  function updateCustomer(
    field: "fullName" | "email" | "phone",
    value: string,
  ) {
    const next = field === "phone" ? value.replace(/\D/g, "") : value;
    setCustomer((prev) => ({ ...prev, [field]: next }));
    setSubmitError(null);
  }

  function updateSlot<K extends keyof PreferredSlot>(
    index: number,
    key: K,
    value: PreferredSlot[K],
  ) {
    setPreferredSlots((prev) =>
      prev.map((slot, idx) => (idx === index ? { ...slot, [key]: value } : slot)),
    );
    setSubmitError(null);
  }

  function addSlot() {
    setPreferredSlots((prev) => {
      if (prev.length >= 3) return prev;
      return [...prev, { date: "", timeRange: "morning" }];
    });
  }

  function removeSlot(index: number) {
    setPreferredSlots((prev) =>
      prev.length === 1 ? prev : prev.filter((_, idx) => idx !== index),
    );
  }

  function handleSlotDateChange(index: number, iso: string) {
    setPreferredSlots((prev) => {
      const taken = new Set(
        prev
          .filter((_, idx) => idx !== index && _.date)
          .map((entry) => `${entry.date}-${entry.timeRange}`),
      );
      return prev.map((slot, idx) => {
        if (idx !== index) return slot;
        let timeRange = slot.timeRange;
        if (iso && taken.has(`${iso}-${timeRange}`)) {
          const alt: SlotTimeRange =
            timeRange === "morning" ? "afternoon" : "morning";
          if (!taken.has(`${iso}-${alt}`)) timeRange = alt;
        }
        return { date: iso, timeRange };
      });
    });
    setSubmitError(null);
  }

  async function submitInspectionRequest() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const idToken = await customerAuth.getIdToken();
      if (idToken) {
        headers.authorization = `Bearer ${idToken}`;
      }

      const response = await fetch("/api/booking/inspection-request", {
        method: "POST",
        headers,
        body: JSON.stringify({
          slug,
          requestType,
          serviceId:
            requestType === "existing_service" ? selectedServiceId : null,
          customRequest:
            requestType === "custom_quote"
              ? {
                  title: customTitle.trim(),
                  description: customDescription.trim(),
                }
              : null,
          customer: {
            fullName: customer.fullName.trim(),
            email: customer.email.trim().toLowerCase(),
            phone: customer.phone,
          },
          address,
          preferredSlots,
          customerNotes: customerNotes.trim() || null,
          budgetAud: budgetAud.trim() || null,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        requestId?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.error ?? "Could not submit your request. Please try again.",
        );
      }

      setSubmittedRequestId(payload.requestId ?? "ok");
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Could not submit your request. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    if (!isAuthenticated) {
      const snapshot = {
        fullName: customer.fullName.trim(),
        phone: customer.phone.replace(/\D/g, ""),
      };
      customerAuth.openAuth({
        mode: "signup",
        businessName,
        bookingSlug: slug,
        defaults: {
          fullName: snapshot.fullName,
          phone: snapshot.phone,
          email: customer.email,
        },
        onAuthenticated: async () => {
          try {
            await customerAuth.saveProfile(snapshot);
          } catch {
            /* non-fatal */
          }
          void submitInspectionRequest();
        },
      });
      return;
    }
    await submitInspectionRequest();
  }

  if (submittedRequestId) {
    return (
      <SubmittedConfirmation
        businessName={businessName}
        requestType={requestType}
        selectedServiceName={selectedService?.name ?? customTitle}
        address={address}
        preferredSlots={preferredSlots}
        phoneHref={phoneHref}
        emailHref={emailHref}
        reducedMotion={reducedMotion}
      />
    );
  }

  const existingServiceAvailable = services.length > 0;

  return (
    <div className="relative w-full min-w-0 sm:overflow-hidden sm:rounded-[24px] sm:border sm:border-stone-200/90 sm:bg-white/95 sm:p-8 sm:shadow-[0_12px_40px_-18px_rgba(31,29,26,0.14)]">
      <div className="relative space-y-4 text-on-surface sm:space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-[#faf8f5] px-3 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-stone-600">
            <span className="material-symbols-outlined material-symbols-filled text-[14px] text-primary">
              event_available
            </span>
            Inspection visit request
          </div>
          <h3 className="mt-2 font-display text-[20px] font-semibold leading-snug text-on-surface sm:mt-3 sm:text-headline-md">
            Request a visit with {businessName}
          </h3>
          <p className="mt-1 font-body text-[14px] leading-snug text-on-surface-variant sm:text-body-md">
            Tell us what you need and pick up to 3 dates that suit you. The
            team will confirm a visit time and an inspector.
          </p>
        </div>

        {/* Step 1 — Request type */}
        <div className={BOOKING_STEP_PANEL_CLASS}>
          <BookingStepHeader step={1} title="What do you need?" active />
          <p className="mt-2 font-body text-[13px] text-on-surface-variant">
            Choose an existing service or describe a custom job for a quote.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:mt-4 sm:grid-cols-2 sm:gap-3">
            <RequestTypeOption
              icon="format_list_bulleted"
              label="Request an existing service"
              description="Pick from the services this business offers."
              selected={requestType === "existing_service"}
              disabled={!existingServiceAvailable}
              onSelect={() => {
                setRequestType("existing_service");
                setSubmitError(null);
              }}
            />
            <RequestTypeOption
              icon="request_quote"
              label="Custom quotation request"
              description="Describe the work and we'll inspect and quote."
              selected={requestType === "custom_quote"}
              onSelect={() => {
                setRequestType("custom_quote");
                setSubmitError(null);
              }}
            />
          </div>

          {requestType === "existing_service" ? (
            existingServiceAvailable ? (
              <ul className="mt-4 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
                {services.map((service, index) => (
                  <li
                    key={service.id}
                    className={index > 0 ? "border-t border-stone-200" : ""}
                  >
                    <BookingServiceListItem
                      service={service}
                      selected={selectedServiceId === service.id}
                      onSelect={() => {
                        setSelectedServiceId((current) =>
                          current === service.id ? null : service.id,
                        );
                        setSubmitError(null);
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 font-body text-body-md text-on-surface-variant">
                No published services yet — switch to a custom request below.
              </p>
            )
          ) : (
            <div className="mt-4 grid gap-3">
              <label className="block">
                <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                  Job title
                </span>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(event) => {
                    setCustomTitle(event.target.value);
                    setSubmitError(null);
                  }}
                  placeholder="e.g. Replace kitchen tap and check leak"
                  className={BOOKING_INPUT_CLASS}
                  maxLength={120}
                />
              </label>
              <label className="block">
                <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                  What needs doing?
                </span>
                <textarea
                  value={customDescription}
                  onChange={(event) => {
                    setCustomDescription(event.target.value);
                    setSubmitError(null);
                  }}
                  rows={4}
                  placeholder="Tell us the scope, materials involved, urgency, etc."
                  className={`${BOOKING_INPUT_CLASS} resize-y`}
                  maxLength={1500}
                />
                <span className="mt-1 block font-body text-[11px] text-on-surface-variant">
                  At least 10 characters so the team can size up the visit.
                </span>
              </label>
            </div>
          )}

          <BookingRequestExtras
            notes={customerNotes}
            budget={budgetAud}
            onNotesChange={(value) => {
              setCustomerNotes(value);
              setSubmitError(null);
            }}
            onBudgetChange={(value) => {
              setBudgetAud(value);
              setSubmitError(null);
            }}
          />
        </div>

        {/* Step 2 — Address */}
        <div className={BOOKING_STEP_PANEL_CLASS}>
          <BookingStepHeader
            step={2}
            title="Service address"
            hint="Required"
            active
          />
          <p className="mt-2 font-body text-[13px] text-on-surface-variant">
            Where should the inspector visit?
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Street address
              </span>
              <input
                type="text"
                value={address.street}
                onChange={(e) => updateAddress("street", e.target.value)}
                placeholder="e.g. 12 Main Street"
                autoComplete={BOOKING_AUTOCOMPLETE}
                className={BOOKING_INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Suburb
              </span>
              <input
                type="text"
                value={address.suburb}
                onChange={(e) => updateAddress("suburb", e.target.value)}
                placeholder="e.g. Surry Hills"
                autoComplete={BOOKING_AUTOCOMPLETE}
                className={BOOKING_INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                State
              </span>
              <input
                type="text"
                value={address.state}
                onChange={(e) => updateAddress("state", e.target.value)}
                placeholder="e.g. NSW"
                autoComplete={BOOKING_AUTOCOMPLETE}
                className={BOOKING_INPUT_CLASS}
              />
            </label>
            <label className="block sm:col-span-2 sm:max-w-[12rem] max-sm:w-full">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Postcode
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={address.postcode}
                onChange={(e) => updateAddress("postcode", e.target.value)}
                placeholder="e.g. 2000"
                autoComplete={BOOKING_AUTOCOMPLETE}
                className={BOOKING_INPUT_CLASS}
              />
            </label>
          </div>
        </div>

        {/* Step 3 — Preferred dates */}
        <div className={BOOKING_STEP_PANEL_CLASS}>
          <BookingStepHeader
            step={3}
            title="Preferred dates & times"
            hint={`${preferredSlots.length} of 3`}
            active
          />
          <p className="mt-2 font-body text-[13px] text-on-surface-variant">
            Tap a day and morning or afternoon window — up to 3 options. The
            owner will confirm one (or propose alternatives).
          </p>

          <ul className="mt-4 space-y-3">
            {preferredSlots.map((slot, index) => (
              <li
                key={index}
                className="rounded-xl border border-stone-200 bg-white p-3 sm:p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-body text-[12px] font-bold uppercase tracking-wider text-on-surface">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <span className="material-symbols-outlined text-[14px]">
                        event
                      </span>
                    </span>
                    Option {index + 1}
                  </span>
                  {preferredSlots.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeSlot(index)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-body text-[11px] font-semibold text-on-surface-variant hover:bg-stone-100"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        close
                      </span>
                      Remove
                    </button>
                  ) : null}
                </div>

                <PreferredSlotPicker
                  slot={slot}
                  slotIndex={index}
                  minDate={minDate}
                  allSlots={preferredSlots}
                  dayPage={workingDayPage}
                  onDayPageChange={setWorkingDayPage}
                  onDateChange={(iso) => handleSlotDateChange(index, iso)}
                  onTimeChange={(timeRange) =>
                    updateSlot(index, "timeRange", timeRange)
                  }
                />
              </li>
            ))}
          </ul>

          {preferredSlots.length < 3 ? (
            <button
              type="button"
              onClick={addSlot}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2 font-body text-[12px] font-semibold text-on-surface transition-colors hover:border-primary hover:text-primary"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Add another date
            </button>
          ) : null}
        </div>

        {/* Step 4 — Contact details */}
        <div className={BOOKING_STEP_PANEL_CLASS}>
          <BookingStepHeader
            step={4}
            title="Your contact details"
            hint="Required"
            active
          />
          <p className="mt-2 font-body text-[13px] text-on-surface-variant">
            We&apos;ll use this to confirm the visit time and reach you on the
            day.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Full name
              </span>
              <input
                type="text"
                value={customer.fullName}
                onChange={(e) => updateCustomer("fullName", e.target.value)}
                placeholder="e.g. Alex Thompson"
                autoComplete={BOOKING_AUTOCOMPLETE}
                readOnly={profileLocked}
                className={`${BOOKING_INPUT_CLASS} ${
                  profileLocked
                    ? "cursor-not-allowed bg-stone-50 text-on-surface-variant"
                    : ""
                }`}
              />
            </label>
            <label className="block">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Mobile number
              </span>
              <input
                type="tel"
                inputMode="numeric"
                value={customer.phone}
                onChange={(e) => updateCustomer("phone", e.target.value)}
                placeholder="0400000000"
                autoComplete={BOOKING_AUTOCOMPLETE}
                readOnly={profileLocked}
                className={`${BOOKING_INPUT_CLASS} ${
                  profileLocked
                    ? "cursor-not-allowed bg-stone-50 text-on-surface-variant"
                    : ""
                }`}
              />
            </label>
            <label className="block">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Email
              </span>
              <input
                type="email"
                value={customer.email}
                onChange={(e) => updateCustomer("email", e.target.value)}
                placeholder="you@example.com"
                autoComplete={BOOKING_AUTOCOMPLETE}
                readOnly={profileLocked}
                className={`${BOOKING_INPUT_CLASS} ${
                  profileLocked
                    ? "cursor-not-allowed bg-stone-50 text-on-surface-variant"
                    : ""
                }`}
              />
            </label>
          </div>
          {profileLocked ? (
            <p className="mt-2 inline-flex items-center gap-1 font-body text-[11px] text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary">
                verified_user
              </span>
              From your account.{" "}
              <a
                href={accountPath(slug, "profile")}
                className="font-semibold text-primary hover:underline"
              >
                Edit profile
              </a>
            </p>
          ) : null}
        </div>

        {submitError ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
          >
            {submitError}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-stone-200 pt-4 sm:flex-row sm:items-center sm:justify-between sm:pt-5">
          <div className="flex w-full flex-col gap-1.5 sm:w-auto">
            <motion.button
              type="button"
              whileHover={
                reducedMotion || !canSubmit ? undefined : { scale: 1.02 }
              }
              whileTap={canSubmit ? { scale: 0.98 } : undefined}
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 font-body text-[15px] font-semibold text-on-primary shadow-md transition-opacity disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:text-label-bold"
            >
              <span className="material-symbols-outlined material-symbols-filled text-[18px]">
                {submitting
                  ? "progress_activity"
                  : isAuthenticated
                    ? "send"
                    : "lock_open"}
              </span>
              {submitting
                ? "Sending request…"
                : isAuthenticated
                  ? "Submit inspection request"
                  : "Sign in & submit request"}
            </motion.button>
            {!isAuthenticated && canSubmit ? (
              <span className="inline-flex items-center justify-center gap-1 font-body text-[11px] text-on-surface-variant sm:justify-start">
                <span className="material-symbols-outlined text-[14px] text-primary">
                  info
                </span>
                We&apos;ll ask you to sign in or create an account to confirm
                this booking.
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
            {phoneHref ? (
              <motion.a
                href={phoneHref}
                whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 font-body text-[14px] font-semibold text-on-surface shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 sm:flex-none sm:px-4 sm:text-label-bold"
              >
                <span className="material-symbols-outlined material-symbols-filled text-[18px] text-stone-600">
                  call
                </span>
                Call
              </motion.a>
            ) : null}
            {emailHref ? (
              <motion.a
                href={emailHref}
                whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 font-body text-[14px] font-semibold text-on-surface shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 sm:flex-none sm:px-4 sm:text-label-bold"
              >
                <span className="material-symbols-outlined text-[18px] text-stone-600">
                  mail
                </span>
                Email
              </motion.a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function RequestTypeOption({
  icon,
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  icon: string;
  label: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      className={`flex w-full min-w-0 items-start gap-2.5 rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 sm:gap-3 sm:p-4 ${
        selected
          ? "border-primary bg-white shadow-[0_8px_20px_-12px_rgba(67,123,255,0.4)] ring-1 ring-primary/20"
          : "border-stone-200 bg-white hover:border-stone-300"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9 ${
          selected
            ? "bg-primary text-on-primary"
            : "bg-primary/10 text-primary"
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-body text-[13px] font-semibold leading-snug text-on-surface sm:text-[14px]">
          {label}
        </span>
        <span className="mt-0.5 block font-body text-[11px] leading-snug text-on-surface-variant sm:text-[12px]">
          {description}
        </span>
      </span>
      <span
        aria-hidden
        className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          selected
            ? "border-primary bg-primary text-on-primary"
            : "border-stone-300 bg-white text-transparent"
        }`}
      >
        {selected ? (
          <span className="material-symbols-outlined text-[14px]">check</span>
        ) : null}
      </span>
    </button>
  );
}

function SubmittedConfirmation({
  businessName,
  requestType,
  selectedServiceName,
  address,
  preferredSlots,
  phoneHref,
  emailHref,
  reducedMotion,
}: {
  businessName: string;
  requestType: RequestType;
  selectedServiceName: string;
  address: ServiceAddress;
  preferredSlots: PreferredSlot[];
  phoneHref: string | null;
  emailHref: string | null;
  reducedMotion: boolean;
}) {
  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="w-full min-w-0 overflow-hidden rounded-2xl border border-emerald-200 bg-white p-4 shadow-[0_12px_40px_-18px_rgba(16,185,129,0.25)] sm:rounded-[24px] sm:p-8"
    >
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <span className="material-symbols-outlined material-symbols-filled text-[24px]">
            check_circle
          </span>
        </span>
        <div className="flex-1">
          <h3 className="font-display text-headline-sm font-semibold text-on-surface">
            Request sent to {businessName}
          </h3>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Thanks — the team will review your{" "}
            {requestType === "existing_service"
              ? "service request"
              : "custom quote request"}
            {selectedServiceName ? ` for ${selectedServiceName}` : ""} and
            confirm an inspection time at {formatServiceAddress(address)}.
          </p>

          <div className="mt-4 rounded-xl border border-stone-200 bg-[#faf8f5] p-4">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Your preferred windows
            </p>
            <ul className="mt-2 space-y-1.5 font-body text-[13px] text-on-surface">
              {preferredSlots.map((slot, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-primary">
                    event_available
                  </span>
                  {formatPrettyDate(slot.date)} · {slot.timeRange}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {phoneHref ? (
              <a
                href={phoneHref}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 font-body text-label-bold text-on-surface shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50"
              >
                <span className="material-symbols-outlined text-[18px] text-stone-600">
                  call
                </span>
                Call now
              </a>
            ) : null}
            {emailHref ? (
              <a
                href={emailHref}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 font-body text-label-bold text-on-surface shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50"
              >
                <span className="material-symbols-outlined text-[18px] text-stone-600">
                  mail
                </span>
                Email
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function BookingStepHeader({
  step,
  title,
  hint,
  active,
}: {
  step: number;
  title: string;
  hint?: string;
  active: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full font-body text-[12px] font-bold ${
          active
            ? "bg-stone-800 text-white"
            : "bg-stone-200 text-stone-500"
        }`}
      >
        {step}
      </span>
      <h4 className="font-display text-[15px] font-semibold text-on-surface">
        {title}
      </h4>
      {hint ? (
        <span className="font-body text-[11px] text-on-surface-variant">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function BookingServiceListItem({
  service,
  selected,
  onSelect,
}: {
  service: BookingService;
  selected: boolean;
  onSelect: () => void;
}) {
  const [tasksOpen, setTasksOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const hasTasks = service.tasks.length > 0;
  const tasksTransition = reducedMotion
    ? { duration: 0.15 }
    : { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <div
      className={`transition-colors ${
        selected ? "bg-primary-fixed/25" : "bg-white hover:bg-stone-50/80"
      }`}
    >
      <div className="flex items-stretch gap-2.5 p-2.5 sm:gap-4 sm:p-4">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-stone-100 sm:h-20 sm:w-20">
          {service.imageUrl ? (
            <img
              src={service.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200">
              <span className="material-symbols-outlined material-symbols-filled text-[28px] text-stone-400 sm:text-[32px]">
                {service.skillIcon}
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-col items-start gap-1.5 text-left"
        >
          <p className="line-clamp-2 font-display text-[15px] font-semibold leading-snug text-on-surface sm:text-[16px]">
            {service.name}
          </p>

          {service.businessType ? (
            <span className="inline-flex items-center gap-1 font-body text-[11px] font-semibold text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary">
                {service.skillIcon}
              </span>
              {service.businessType}
            </span>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 font-body text-[11px] font-semibold text-on-surface-variant">
            <span className="inline-flex items-center gap-0.5 text-on-surface">
              <span className="material-symbols-outlined text-[14px] text-primary">
                schedule
              </span>
              {service.durationLabel}
            </span>
            <span aria-hidden className="text-stone-300">
              ·
            </span>
            <span className="inline-flex items-center gap-0.5 text-on-surface">
              <span className="material-symbols-outlined text-[14px] text-primary">
                checklist
              </span>
              {service.taskCount} {service.taskCount === 1 ? "task" : "tasks"}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={onSelect}
          aria-label={selected ? "Selected service" : `Select ${service.name}`}
          className="flex shrink-0 items-center self-center"
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
              selected
                ? "border-primary bg-primary text-on-primary"
                : "border-stone-300 bg-white text-transparent group-hover:border-stone-400"
            }`}
          >
            {selected ? (
              <span className="material-symbols-outlined material-symbols-filled text-[16px]">
                check
              </span>
            ) : null}
          </span>
        </button>
      </div>

      {hasTasks ? (
        <>
          <button
            type="button"
            onClick={() => setTasksOpen((open) => !open)}
            aria-expanded={tasksOpen}
            className="flex w-full items-center justify-between gap-2 border-t border-stone-100 px-3 py-2.5 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-stone-50 sm:px-4"
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-primary">
                checklist
              </span>
              {`${tasksOpen ? "Hide" : "View"} what's included (${service.taskCount})`}
            </span>
            <motion.span
              animate={{ rotate: tasksOpen ? 180 : 0 }}
              transition={tasksTransition}
              className="material-symbols-outlined text-[20px] text-stone-500"
            >
              expand_more
            </motion.span>
          </button>

          <AnimatePresence initial={false}>
            {tasksOpen ? (
              <motion.div
                key="tasks-panel"
                initial={
                  reducedMotion
                    ? { opacity: 0 }
                    : { height: 0, opacity: 0 }
                }
                animate={
                  reducedMotion
                    ? { opacity: 1 }
                    : { height: "auto", opacity: 1 }
                }
                exit={
                  reducedMotion
                    ? { opacity: 0 }
                    : { height: 0, opacity: 0 }
                }
                transition={tasksTransition}
                className="overflow-hidden"
              >
                <ul className="space-y-2.5 border-t border-stone-100 bg-[#faf8f5] px-3 py-3 sm:px-4 sm:py-3.5">
                  {service.tasks.map((task, index) => (
                    <motion.li
                      key={task.id}
                      initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        ...tasksTransition,
                        delay: reducedMotion ? 0 : 0.04 + index * 0.03,
                      }}
                      className="flex gap-2.5"
                    >
                      <span className="material-symbols-outlined material-symbols-filled mt-0.5 shrink-0 text-[15px] text-primary">
                        check_circle
                      </span>
                      <div className="min-w-0">
                        <p className="font-body text-[12px] font-semibold text-on-surface">
                          {task.title}
                        </p>
                        {task.description ? (
                          <p className="mt-0.5 font-body text-[11px] leading-snug text-on-surface-variant">
                            {task.description}
                          </p>
                        ) : null}
                      </div>
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      ) : null}
    </div>
  );
}

/* ==========================================================================
 * Footer
 * ========================================================================== */

function BookingFooter({
  business,
  phoneHref,
  emailHref,
}: {
  business: BookingBusiness;
  phoneHref: string | null;
  emailHref: string | null;
}) {
  const year = new Date().getFullYear();
  const phoneDisplay = business.businessPhone
    ? `+61 ${business.businessPhone}`
    : null;
  const locationParts = [
    business.businessAddress,
    [business.state, business.postcode].filter(Boolean).join(" "),
  ].filter((p): p is string => Boolean(p && p.trim()));

  return (
    <motion.footer
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="relative mt-8 w-full min-w-0 overflow-hidden rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-[0_10px_30px_-20px_rgba(31,29,26,0.15)] backdrop-blur-xl sm:mt-14 sm:rounded-[28px] sm:p-10"
    >
      <div className="grid gap-8 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/85 text-on-primary shadow-md">
              <span className="material-symbols-outlined material-symbols-filled text-[22px]">
                {iconForBusinessType(business.businessType)}
              </span>
            </div>
            <div className="min-w-0">
              <p className="font-display text-[15px] font-bold text-on-surface">
                {business.businessName}
              </p>
              <p className="font-body text-[12px] text-on-surface-variant">
                {business.businessType}
              </p>
            </div>
          </div>
          <p className="mt-4 font-body text-body-md text-on-surface-variant">
            Trusted local trade pros — book online, get the job done.
          </p>
        </div>

        <div>
          <h4 className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Get in touch
          </h4>
          <ul className="mt-3 space-y-2.5 font-body text-body-md text-on-surface">
            {phoneHref && phoneDisplay ? (
              <li>
                <a
                  href={phoneHref}
                  className="inline-flex items-center gap-2 transition-colors hover:text-amber-700"
                >
                  <span className="material-symbols-outlined text-[16px] text-amber-700">
                    call
                  </span>
                  {phoneDisplay}
                </a>
              </li>
            ) : null}
            {emailHref && business.businessEmail ? (
              <li>
                <a
                  href={emailHref}
                  className="inline-flex items-center gap-2 break-all transition-colors hover:text-amber-700"
                >
                  <span className="material-symbols-outlined text-[16px] text-amber-700">
                    mail
                  </span>
                  {business.businessEmail}
                </a>
              </li>
            ) : null}
            {locationParts.length > 0 ? (
              <li className="flex items-start gap-2">
                <span className="material-symbols-outlined mt-0.5 text-[16px] text-amber-700">
                  location_on
                </span>
                <span>
                  {locationParts.map((part) => (
                    <span key={part} className="block">
                      {part}
                    </span>
                  ))}
                </span>
              </li>
            ) : null}
          </ul>
        </div>

        <div>
          <h4 className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Service promise
          </h4>
          <ul className="mt-3 space-y-2 font-body text-body-md text-on-surface">
            <li className="flex items-start gap-2">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[16px] text-emerald-700">
                verified
              </span>
              Verified, insured trade pros
            </li>
            <li className="flex items-start gap-2">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[16px] text-amber-700">
                schedule
              </span>
              Quick response, transparent pricing
            </li>
            <li className="flex items-start gap-2">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[16px] text-rose-700">
                shield_lock
              </span>
              Secure online bookings
            </li>
          </ul>
        </div>
      </div>

      <div className="my-8 h-px bg-gradient-to-r from-transparent via-stone-300 to-transparent" />

      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="font-body text-[12px] text-on-surface-variant">
          © {year} {business.businessName}. All rights reserved.
        </p>
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary-fixed px-3 py-1.5">
          <span className="material-symbols-outlined material-symbols-filled text-[14px] text-primary">
            bolt
          </span>
          <span className="font-body text-[11px] font-semibold text-primary">
            Powered by{" "}
            <span className="font-bold tracking-wide">BMS Pro Trade</span>
          </span>
        </div>
      </div>
    </motion.footer>
  );
}

/* ==========================================================================
 * Animated backdrop — mesh gradient + dot grid + drifting orbs
 * ========================================================================== */

function AnimatedBackdrop({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Soft cream-to-warm wash with a hint of brand blue */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(at 8% 12%, rgba(67,123,255,0.09) 0px, transparent 45%)," +
            "radial-gradient(at 92% 18%, rgba(255,210,180,0.38) 0px, transparent 50%)," +
            "radial-gradient(at 50% 95%, rgba(220,235,225,0.30) 0px, transparent 55%)",
        }}
      />

      {/* === Editorial / poster-style SVG composition === */}
      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1200 900"
        fill="none"
      >
        <defs>
          <linearGradient id="bgBlobBlue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(67,123,255,0.18)" />
            <stop offset="100%" stopColor="rgba(67,123,255,0)" />
          </linearGradient>
          <linearGradient id="bgBlobPeach" x1="20%" y1="20%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,178,128,0.22)" />
            <stop offset="100%" stopColor="rgba(255,178,128,0)" />
          </linearGradient>
          <linearGradient id="bgBlobSage" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(160,200,170,0.22)" />
            <stop offset="100%" stopColor="rgba(160,200,170,0)" />
          </linearGradient>
        </defs>

        {/* Asymmetric organic shape — top-left (blue) */}
        <motion.path
          initial={{ opacity: 0.85 }}
          animate={reducedMotion ? undefined : { opacity: [0.7, 0.95, 0.7] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          d="M -120 -40 C 60 -110, 280 -60, 360 90 C 420 220, 280 320, 140 320 C 0 320, -160 240, -200 140 C -220 60, -200 -10, -120 -40 Z"
          fill="url(#bgBlobBlue)"
        />

        {/* Asymmetric organic shape — bottom-right (peach) */}
        <motion.path
          initial={{ opacity: 0.85 }}
          animate={reducedMotion ? undefined : { opacity: [0.75, 1, 0.75] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
          d="M 1320 580 C 1180 480, 1000 540, 920 660 C 840 780, 920 920, 1080 940 C 1240 960, 1380 860, 1380 740 C 1380 660, 1380 620, 1320 580 Z"
          fill="url(#bgBlobPeach)"
        />

        {/* Small accent shape — middle-right (sage) */}
        <motion.path
          initial={{ opacity: 0.7 }}
          animate={reducedMotion ? undefined : { opacity: [0.55, 0.85, 0.55] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          d="M 1080 380 C 1140 360, 1180 420, 1160 470 C 1140 520, 1080 530, 1040 500 C 1000 470, 1020 400, 1080 380 Z"
          fill="url(#bgBlobSage)"
        />

        {/* === Topographic contour lines — flowing across upper-middle === */}
        <g
          stroke="rgba(67,123,255,0.22)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
        >
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 2, ease: "easeOut", delay: 0.1 }}
            d="M -50 200 C 200 160, 400 240, 600 200 C 800 160, 1000 220, 1260 180"
          />
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.85 }}
            transition={{ duration: 2.2, ease: "easeOut", delay: 0.25 }}
            d="M -50 240 C 200 200, 400 280, 600 240 C 800 200, 1000 260, 1260 220"
          />
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.6 }}
            transition={{ duration: 2.4, ease: "easeOut", delay: 0.4 }}
            d="M -50 280 C 200 240, 400 320, 600 280 C 800 240, 1000 300, 1260 260"
          />
        </g>

        {/* === Topographic contour lines — bottom (warm taupe) === */}
        <g
          stroke="rgba(180,140,90,0.28)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
        >
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 2.2, ease: "easeOut", delay: 0.5 }}
            d="M -50 700 C 200 740, 400 660, 600 700 C 800 740, 1000 680, 1260 720"
          />
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.7 }}
            transition={{ duration: 2.4, ease: "easeOut", delay: 0.65 }}
            d="M -50 740 C 200 780, 400 700, 600 740 C 800 780, 1000 720, 1260 760"
          />
        </g>

        {/* === Sketchy zig-zag accent (top-right) === */}
        <motion.polyline
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.55 }}
          transition={{ duration: 1.6, ease: "easeOut", delay: 0.6 }}
          points="1000,80 1020,100 1040,80 1060,100 1080,80 1100,100 1120,80"
          stroke="rgba(67,123,255,0.55)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* === Triangle accent — middle-left === */}
        <motion.path
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 0.5, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.7 }}
          d="M 80 480 L 120 520 L 60 540 Z"
          fill="none"
          stroke="rgba(67,123,255,0.45)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />

        {/* === Outlined square — rotated, top-right area === */}
        <motion.rect
          initial={{ opacity: 0, rotate: -10 }}
          animate={{ opacity: 0.45, rotate: 18 }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.7 }}
          x="950"
          y="500"
          width="36"
          height="36"
          fill="none"
          stroke="rgba(180,140,90,0.55)"
          strokeWidth="1.2"
          style={{ transformOrigin: "968px 518px" }}
        />

        {/* === Long diagonal brush stroke (bottom-left) === */}
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.4 }}
          transition={{ duration: 2.2, ease: "easeOut", delay: 0.4 }}
          d="M -20 880 C 60 820, 140 800, 240 760"
          stroke="rgba(67,123,255,0.5)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        {/* === Short dashed accent (top, near hero) === */}
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.55 }}
          transition={{ duration: 1.4, ease: "easeOut", delay: 0.9 }}
          d="M 540 60 L 620 60"
          stroke="rgba(67,123,255,0.55)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="4 6"
          fill="none"
        />

        {/* === Floating decorative marks: + signs === */}
        <g
          stroke="rgba(67,123,255,0.4)"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          <PlusSign x={1080} y={380} size={6} />
          <PlusSign x={180} y={420} size={5} />
          <PlusSign x={420} y={140} size={4} />
          <PlusSign x={760} y={140} size={5} />
        </g>

        {/* === Tiny floating dots (warm) === */}
        <g fill="rgba(180,140,90,0.45)">
          <circle cx="780" cy="80" r="2.5" />
          <circle cx="1140" cy="280" r="2" />
          <circle cx="60" cy="380" r="2.5" />
          <circle cx="380" cy="640" r="2.5" />
        </g>

        {/* === Tiny floating dots (blue) === */}
        <g fill="rgba(67,123,255,0.45)">
          <circle cx="940" cy="220" r="2.5" />
          <circle cx="280" cy="80" r="2" />
          <circle cx="660" cy="780" r="2.5" />
        </g>

        {/* === Short tick marks like measuring lines (left edge) === */}
        <g
          stroke="rgba(67,123,255,0.3)"
          strokeWidth="1"
          strokeLinecap="round"
        >
          <line x1="40" y1="120" x2="56" y2="120" />
          <line x1="40" y1="160" x2="56" y2="160" />
          <line x1="40" y1="200" x2="56" y2="200" />
          <line x1="40" y1="240" x2="50" y2="240" />
        </g>
      </svg>

      {/* Soft watercolor drifts — subtle and slow */}
      {!reducedMotion && (
        <>
          <motion.div
            initial={{ x: -30, y: -20 }}
            animate={{ x: 40, y: 40 }}
            transition={{
              duration: 22,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut",
            }}
            className="absolute -top-20 left-[6%] h-72 w-[26rem] rounded-full bg-primary/10 blur-[110px]"
          />
          <motion.div
            initial={{ x: 30, y: 20 }}
            animate={{ x: -30, y: -20 }}
            transition={{
              duration: 26,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut",
            }}
            className="absolute -bottom-24 right-[5%] h-80 w-[30rem] rounded-full bg-[#ffd0a8]/50 blur-[120px]"
          />
        </>
      )}

      {/* Bottom fade for footer */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#fbf8f3] to-transparent" />
    </div>
  );
}

function PlusSign({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <g>
      <line x1={x - size} y1={y} x2={x + size} y2={y} />
      <line x1={x} y1={y - size} x2={x} y2={y + size} />
    </g>
  );
}
