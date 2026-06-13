import "@/styles/dashboard.css";
import { useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  FileText,
  Home,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Send,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { createBlueInspectionRequest } from "@/services/blueInspectionRequestsApi";
import { formatPhone } from "@/utils/formatters";
import {
  resolveTradeInspectionContext,
  type TradeInspectionRequestsPageState,
} from "./TradeInspectionRequestsPage";

type RequestMode = "existing_service" | "custom_quote";
type TimeRange = "morning" | "afternoon";

type ServiceAddress = {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
};

type PreferredSlot = {
  date: string;
  timeRange: TimeRange;
};

const SERVICE_OPTIONS = [
  "General inspection",
  "Site inspection",
  "Quote request",
  "Maintenance request",
  "Repair request",
  "Compliance check",
];

const PRIORITIES = ["Normal", "Urgent", "High", "Low"];

const TIME_RANGE_OPTIONS: {
  id: TimeRange;
  label: string;
  hint: string;
}[] = [
  { id: "morning", label: "Morning", hint: "8am - 12pm" },
  { id: "afternoon", label: "Afternoon", hint: "12pm - 5pm" },
];

const EMPTY_ADDRESS: ServiceAddress = {
  street: "",
  suburb: "",
  state: "",
  postcode: "",
};

const INPUT_CLASS =
  "mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-[15px] text-slate-950 shadow-sm placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 sm:py-2.5 sm:text-sm";

const LABEL_CLASS =
  "text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500";

const PANEL_CLASS =
  "rounded-2xl border border-slate-200 bg-[#fbfaf8] p-4 shadow-sm sm:p-5";

function todayInputValue(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatAddress(address: ServiceAddress): string {
  return [
    address.street.trim(),
    address.suburb.trim(),
    address.state.trim(),
    address.postcode.trim(),
  ]
    .filter(Boolean)
    .join(", ");
}

function isAddressComplete(address: ServiceAddress): boolean {
  return (
    address.street.trim().length >= 3 &&
    address.suburb.trim().length >= 2 &&
    address.state.trim().length >= 2 &&
    address.postcode.trim().length >= 4
  );
}

function formatPrettyDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTimeRange(value: TimeRange): string {
  const option = TIME_RANGE_OPTIONS.find((item) => item.id === value);
  return option ? `${option.label} (${option.hint})` : value;
}

function formatSlot(slot: PreferredSlot): string {
  return [formatPrettyDate(slot.date), formatTimeRange(slot.timeRange)]
    .filter(Boolean)
    .join(" - ");
}

function normalizeBudgetInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  const whole = cleaned.slice(0, dot);
  const fraction = cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  return fraction ? `${whole}.${fraction}` : `${whole}.`;
}

function StepHeader({
  step,
  title,
  hint,
}: {
  step: number;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white shadow-sm">
          {step}
        </span>
        <div className="font-semibold text-slate-950">{title}</div>
      </div>
      {hint ? (
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function RequestModeOption({
  icon,
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  icon: "list" | "quote";
  label: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const Icon = icon === "list" ? ClipboardList : FileText;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`relative rounded-2xl border p-4 text-left transition-all ${
        disabled
          ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-50"
          : selected
            ? "border-blue-300 bg-gradient-to-br from-blue-50 via-white to-amber-50 ring-2 ring-blue-100"
            : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${
          selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
        }`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="mt-3 block text-sm font-bold text-slate-950">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      {selected ? (
        <CheckCircle2 className="absolute right-3 top-3 h-5 w-5 text-blue-600" />
      ) : null}
    </button>
  );
}

function ServiceOption({
  service,
  selected,
  onSelect,
}: {
  service: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
        selected ? "bg-blue-50 text-blue-700" : "bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      <span className="text-sm font-semibold">{service}</span>
      {selected ? <CheckCircle2 className="h-4 w-4 text-blue-600" /> : null}
    </button>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  disabled,
  className = "",
  autoComplete = "off",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "decimal" | "numeric" | "tel";
  disabled?: boolean;
  className?: string;
  autoComplete?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={LABEL_CLASS}>{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        className={INPUT_CLASS}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  disabled,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  help?: string;
}) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={`${INPUT_CLASS} resize-y`}
      />
      {help ? <span className="mt-1 block text-[11px] text-slate-500">{help}</span> : null}
    </label>
  );
}

function ContextField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function PreferredSlotEditor({
  slot,
  index,
  canRemove,
  submitting,
  onDateChange,
  onTimeChange,
  onRemove,
}: {
  slot: PreferredSlot;
  index: number;
  canRemove: boolean;
  submitting: boolean;
  onDateChange: (value: string) => void;
  onTimeChange: (value: TimeRange) => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-700">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <CalendarDays className="h-4 w-4" />
          </span>
          Option {index + 1}
        </span>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={submitting}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Remove
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_260px]">
        <TextField
          label="Preferred date"
          type="date"
          value={slot.date}
          onChange={onDateChange}
          disabled={submitting}
        />
        <div>
          <span className={LABEL_CLASS}>Time window</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {TIME_RANGE_OPTIONS.map((option) => {
              const selected = slot.timeRange === option.id;
              return (
                <button
                  type="button"
                  key={option.id}
                  disabled={submitting}
                  onClick={() => onTimeChange(option.id)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? "border-blue-300 bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <span className="block text-sm font-bold">{option.label}</span>
                  <span className="block text-[11px] text-slate-500">{option.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {slot.date ? (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs font-semibold text-slate-700">
          {formatSlot(slot)}
        </div>
      ) : null}
    </li>
  );
}

export default function TradeInspectionRequestCreatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const { toast } = useToast();
  const state = location.state as TradeInspectionRequestsPageState | null;
  const context = useMemo(() => resolveTradeInspectionContext(state), [state]);

  const [requestMode, setRequestMode] = useState<RequestMode>("existing_service");
  const [service, setService] = useState(SERVICE_OPTIONS[0]);
  const [customTitle, setCustomTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(PRIORITIES[0]);
  const [budgetAud, setBudgetAud] = useState("");
  const [siteAddress, setSiteAddress] = useState<ServiceAddress>(EMPTY_ADDRESS);
  const [preferredSlots, setPreferredSlots] = useState<PreferredSlot[]>([
    { date: todayInputValue(), timeRange: "morning" },
  ]);
  const [name, setName] = useState(context.customerName);
  const [phone, setPhone] = useState(context.callerNumber);
  const [email, setEmail] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedService = requestMode === "custom_quote" ? customTitle.trim() : service;
  const requestTitle =
    requestMode === "custom_quote"
      ? customTitle.trim() || "Custom quotation request"
      : selectedService;
  const fullAddress = formatAddress(siteAddress);
  const firstSlot = preferredSlots[0];
  const requestDescription = description.trim() || selectedService;
  const addressComplete = isAddressComplete(siteAddress);
  const slotsValid =
    preferredSlots.length > 0 &&
    preferredSlots.every((slot) => slot.date.trim()) &&
    new Set(preferredSlots.map((slot) => `${slot.date}-${slot.timeRange}`)).size ===
      preferredSlots.length;
  const requestStepValid =
    selectedService.length >= 3 && (requestMode === "existing_service" || description.trim().length >= 10);
  const contactValid = name.trim().length >= 2 && phone.replace(/\D/g, "").length > 0;

  const combinedNotes = [
    requestDescription,
    customerNotes.trim() ? `Customer notes: ${customerNotes.trim()}` : "",
    budgetAud.trim() ? `Budget: AUD ${budgetAud.trim()}` : "",
    preferredSlots.length
      ? `Preferred options:\n${preferredSlots
          .map((slot, index) => `${index + 1}. ${formatSlot(slot)}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const canSubmit =
    context.businessId.length > 0 &&
    requestStepValid &&
    addressComplete &&
    slotsValid &&
    contactValid &&
    !submitting;

  function updateAddress<K extends keyof ServiceAddress>(
    key: K,
    value: ServiceAddress[K],
  ) {
    setSiteAddress((current) => ({ ...current, [key]: value }));
  }

  function updateSlot<K extends keyof PreferredSlot>(
    index: number,
    key: K,
    value: PreferredSlot[K],
  ) {
    setPreferredSlots((current) =>
      current.map((slot, slotIndex) =>
        slotIndex === index ? { ...slot, [key]: value } : slot,
      ),
    );
  }

  function addSlot() {
    setPreferredSlots((current) => {
      if (current.length >= 3) return current;
      return [...current, { date: "", timeRange: "morning" }];
    });
  }

  function removeSlot(index: number) {
    setPreferredSlots((current) =>
      current.length === 1 ? current : current.filter((_, slotIndex) => slotIndex !== index),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context.businessId) {
      toast({
        title: "Missing Blue business",
        description: "This call DID is not mapped to a Blue business id.",
        variant: "destructive",
      });
      return;
    }
    if (!canSubmit) {
      toast({
        title: "Required details missing",
        description:
          "Complete the request, address, preferred time, name, and phone before submitting.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      await createBlueInspectionRequest({
        businessId: context.businessId,
        requestTitle,
        requestType: selectedService,
        priority,
        preferredDate: firstSlot?.date ?? "",
        preferredTime: firstSlot ? formatTimeRange(firstSlot.timeRange) : "",
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: fullAddress,
        service: selectedService,
        description: requestDescription,
        did: context.did,
        didLabel: context.didLabel,
        callId: context.callId,
        queueId: context.queueId,
        queueName: context.queueName,
        tenantId: context.tenantId,
        agentUserId: context.agentUserId ?? session?.userId ?? null,
        agentName: context.agentName ?? session?.displayName ?? null,
        notes: combinedNotes,
        internalNotes: internalNotes.trim(),
      });

      toast({
        title: "Inspection request submitted",
        description: context.businessName,
      });
      navigate("/trade", {
        replace: true,
        state: {
          ...state,
          businessId: context.businessId,
          ownerId: context.businessId,
          customerName: name.trim(),
          callerNumber: phone.trim(),
          businessName: context.businessName,
          did: context.did,
          didLabel: context.didLabel,
          callId: context.callId,
          queueId: context.queueId,
          queueName: context.queueName,
          tenantId: context.tenantId,
          agentUserId: context.agentUserId ?? session?.userId ?? null,
          agentName: context.agentName ?? session?.displayName ?? null,
        } satisfies TradeInspectionRequestsPageState,
      });
    } catch (err) {
      toast({
        title: "Submission failed",
        description: err instanceof Error ? err.message : "Could not submit inspection request.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cc-fade-in min-h-screen bg-[#f5f2ed]">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 shadow-sm">
              <Wrench className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight text-slate-950">
                Create Inspection Request
              </div>
              <div className="text-xs text-slate-500">{context.businessName}</div>
            </div>
          </div>
          <Badge className="bg-blue-600 text-white hover:bg-blue-600">Blue</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {!context.businessId ? (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            No Blue business id is mapped to this DID. Update the DID mapping before
            creating inspection requests.
          </div>
        ) : null}

        <section className="mb-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-5 sm:p-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-[#fbfaf8] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600">
                <ClipboardList className="h-3.5 w-3.5 text-blue-600" />
                Inspection visit request
              </div>
              <h1 className="mt-4 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-5xl">
                Request a site visit with {context.businessName}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                Capture the job, address, preferred visit windows, and caller details in
                the same flow customers use when booking an inspection request.
              </p>
              <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className={LABEL_CLASS}>Caller</div>
                  <div className="mt-1 font-semibold text-slate-950">
                    {context.callerNumber ? formatPhone(context.callerNumber) : "Not captured"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className={LABEL_CLASS}>DID</div>
                  <div className="mt-1 truncate font-semibold text-slate-950">
                    {context.didLabel || context.did || "Unknown"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className={LABEL_CLASS}>Queue</div>
                  <div className="mt-1 truncate font-semibold text-slate-950">
                    {context.queueName || "No queue"}
                  </div>
                </div>
              </div>
            </div>
            <div className="relative hidden min-h-[360px] items-center justify-center overflow-hidden border-l border-slate-200 bg-gradient-to-br from-blue-50 via-white to-amber-50 lg:flex">
              <div className="absolute h-72 w-72 rounded-full border border-blue-200/70" />
              <div className="absolute h-52 w-52 rounded-full border border-dashed border-blue-200/80" />
              <div className="absolute h-32 w-32 rounded-full border border-blue-200/80 bg-white/50" />
              {["Address", "Service", "Dates", "Contact"].map((label, index) => (
                <div
                  key={label}
                  className="absolute rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-sm"
                  style={{
                    transform: `rotate(${index * 90}deg) translateY(-132px) rotate(-${index * 90}deg)`,
                  }}
                >
                  {label}
                </div>
              ))}
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_18px_45px_-18px_rgba(37,99,235,0.9)]">
                <MapPin className="h-9 w-9" />
              </div>
            </div>
          </div>
        </section>

        <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]" onSubmit={handleSubmit}>
          <div className="space-y-5">
            <section className={PANEL_CLASS}>
              <StepHeader step={1} title="What does the customer need?" hint="Required" />
              <p className="mt-2 text-sm text-slate-600">
                Choose a common inspection service or describe a custom quote request.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <RequestModeOption
                  icon="list"
                  label="Request an existing service"
                  description="Pick from the standard services this team handles."
                  selected={requestMode === "existing_service"}
                  onSelect={() => setRequestMode("existing_service")}
                />
                <RequestModeOption
                  icon="quote"
                  label="Custom quotation request"
                  description="Write the job title and scope for an inspection quote."
                  selected={requestMode === "custom_quote"}
                  onSelect={() => setRequestMode("custom_quote")}
                />
              </div>

              {requestMode === "existing_service" ? (
                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  {SERVICE_OPTIONS.map((option, index) => (
                    <div key={option} className={index > 0 ? "border-t border-slate-200" : ""}>
                      <ServiceOption
                        service={option}
                        selected={service === option}
                        onSelect={() => setService(option)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 grid gap-3">
                  <TextField
                    label="Job title"
                    value={customTitle}
                    onChange={setCustomTitle}
                    placeholder="e.g. Inspect water damage and quote repair"
                    disabled={submitting}
                  />
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
                <TextAreaField
                  label="What needs doing?"
                  value={description}
                  onChange={setDescription}
                  placeholder="Tell the team what should be inspected, quoted, or repaired."
                  rows={4}
                  disabled={submitting}
                  help={
                    requestMode === "custom_quote"
                      ? "At least 10 characters for custom quote requests."
                      : "Optional but helpful for the inspector."
                  }
                />
                <div>
                  <label className="block">
                    <span className={LABEL_CLASS}>Priority</span>
                    <select
                      value={priority}
                      onChange={(event) => setPriority(event.target.value)}
                      disabled={submitting}
                      className={INPUT_CLASS}
                    >
                      {PRIORITIES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TextField
                    label="Budget"
                    value={budgetAud}
                    onChange={(value) => setBudgetAud(normalizeBudgetInput(value))}
                    placeholder="e.g. 2500"
                    inputMode="decimal"
                    disabled={submitting}
                    className="mt-3"
                  />
                </div>
              </div>
            </section>

            <section className={PANEL_CLASS}>
              <StepHeader step={2} title="Service address" hint="Required" />
              <p className="mt-2 text-sm text-slate-600">Where should the inspector visit?</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Street address"
                  value={siteAddress.street}
                  onChange={(value) => updateAddress("street", value)}
                  placeholder="e.g. 12 Main Street"
                  disabled={submitting}
                  className="sm:col-span-2"
                />
                <TextField
                  label="Suburb"
                  value={siteAddress.suburb}
                  onChange={(value) => updateAddress("suburb", value)}
                  placeholder="e.g. Surry Hills"
                  disabled={submitting}
                />
                <TextField
                  label="State"
                  value={siteAddress.state}
                  onChange={(value) => updateAddress("state", value)}
                  placeholder="e.g. NSW"
                  disabled={submitting}
                />
                <TextField
                  label="Postcode"
                  value={siteAddress.postcode}
                  onChange={(value) => updateAddress("postcode", value)}
                  placeholder="e.g. 2000"
                  inputMode="numeric"
                  disabled={submitting}
                  className="sm:max-w-[14rem]"
                />
              </div>
            </section>

            <section className={PANEL_CLASS}>
              <StepHeader
                step={3}
                title="Preferred dates and times"
                hint={`${preferredSlots.length} of 3`}
              />
              <p className="mt-2 text-sm text-slate-600">
                Add up to 3 visit options. The first option is sent as the primary
                preferred date.
              </p>
              <ul className="mt-4 space-y-3">
                {preferredSlots.map((slot, index) => (
                  <PreferredSlotEditor
                    key={index}
                    slot={slot}
                    index={index}
                    canRemove={preferredSlots.length > 1}
                    submitting={submitting}
                    onDateChange={(value) => updateSlot(index, "date", value)}
                    onTimeChange={(value) => updateSlot(index, "timeRange", value)}
                    onRemove={() => removeSlot(index)}
                  />
                ))}
              </ul>
              {preferredSlots.length < 3 ? (
                <button
                  type="button"
                  onClick={addSlot}
                  disabled={submitting}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Add another date
                </button>
              ) : null}
            </section>

            <section className={PANEL_CLASS}>
              <StepHeader step={4} title="Contact details" hint="Required" />
              <p className="mt-2 text-sm text-slate-600">
                Use the caller details from the call or update them before submitting.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Full name"
                  value={name}
                  onChange={setName}
                  placeholder="Caller or site contact"
                  disabled={submitting}
                  className="sm:col-span-2"
                />
                <TextField
                  label="Mobile number"
                  value={phone}
                  onChange={(value) => setPhone(value.replace(/[^\d+ ]/g, ""))}
                  placeholder="0400000000"
                  type="tel"
                  inputMode="tel"
                  disabled={submitting}
                />
                <TextField
                  label="Email"
                  value={email}
                  onChange={setEmail}
                  placeholder="Optional"
                  type="email"
                  disabled={submitting}
                />
              </div>
            </section>

            <section className={PANEL_CLASS}>
              <StepHeader step={5} title="Additional notes" />
              <div className="mt-4 grid gap-3">
                <TextAreaField
                  label="Customer notes"
                  value={customerNotes}
                  onChange={setCustomerNotes}
                  placeholder="Access instructions, urgency, materials, parking, onsite contact..."
                  rows={3}
                  disabled={submitting}
                />
                <TextAreaField
                  label="Internal notes"
                  value={internalNotes}
                  onChange={setInternalNotes}
                  placeholder="Optional notes for Blue admin..."
                  rows={3}
                  disabled={submitting}
                />
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <div className="sticky top-24 overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-xl">
              <div className="border-b border-white/10 p-5">
                <div className="text-base font-semibold">Review and submit</div>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Complete the required steps, then send the request to Blue.
                </p>
              </div>

              <div className="space-y-4 p-5">
                <div className="rounded-2xl bg-slate-900 px-4 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    <Home className="h-3.5 w-3.5" />
                    Business
                  </div>
                  <div className="mt-2 font-semibold">{context.businessName}</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-500">
                    {context.businessId || "No business id"}
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm">
                  <div className="flex items-start gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
                    <div>
                      <div className="font-semibold text-blue-200">
                        {requestTitle || "Inspection request"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {requestMode === "custom_quote" ? "Custom quote" : selectedService} -
                        {" "}
                        {priority}
                      </div>
                    </div>
                  </div>
                  {budgetAud ? (
                    <div className="flex items-center gap-2 text-slate-300">
                      <DollarSign className="h-4 w-4 text-slate-500" />
                      AUD {budgetAud}
                    </div>
                  ) : null}
                  {firstSlot?.date ? (
                    <div className="flex items-center gap-2 text-slate-300">
                      <Clock className="h-4 w-4 text-slate-500" />
                      {formatSlot(firstSlot)}
                    </div>
                  ) : null}
                  {fullAddress ? (
                    <div className="rounded-xl bg-slate-800 px-3 py-2 text-xs leading-5 text-slate-300">
                      {fullAddress}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    <UserRound className="h-3.5 w-3.5" />
                    Contact
                  </div>
                  {name ? <div className="text-slate-300">{name}</div> : null}
                  {phone ? (
                    <div className="flex items-center gap-2 text-slate-300">
                      <Phone className="h-4 w-4 text-slate-500" />
                      {formatPhone(phone)}
                    </div>
                  ) : null}
                  {email ? <div className="break-all text-slate-300">{email}</div> : null}
                </div>

                <div className="rounded-2xl bg-slate-900 px-4 py-3">
                  <div className="grid gap-3">
                    <ContextField label="DID" value={context.didLabel || context.did} />
                    <ContextField label="Queue" value={context.queueName} />
                    <ContextField label="Agent" value={context.agentName ?? session?.displayName} />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="h-12 w-full rounded-xl bg-blue-500 font-semibold text-white hover:bg-blue-600"
                  disabled={!canSubmit}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {submitting ? "Submitting..." : "Submit inspection request"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full rounded-xl border-slate-700 bg-transparent text-slate-200 hover:bg-slate-900 hover:text-white"
                  disabled={submitting}
                  onClick={() => navigate(-1)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </aside>
        </form>
      </main>
    </div>
  );
}
