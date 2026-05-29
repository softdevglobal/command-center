import type { IncomingCallStatus, Queue, Tenant } from '@/services/types';
import { Card, CardContent } from '@/components/ui/card';
import { PhoneIncoming, Clock, Users, PhoneCall, HeadphonesIcon, ChevronRight } from 'lucide-react';
import { formatPhone } from '@/utils/formatters';
import type { CallDetailSnapshot } from '@/components/dashboard/CallDetailsSheet';

export interface IncomingCallerContext {
  number: string;
  name: string | null;
  waitingSince?: number | null;
  /** When set, this row opens the details sheet for that specific call */
  detail?: CallDetailSnapshot;
  /** Epoch ms when the call left the live incoming list (queue card linger only). */
  endedAt?: number | null;
  status?: IncomingCallStatus | null;
}

interface QueueSummaryCardProps {
  queue: Queue;
  tenant?: Tenant;
  showTenant: boolean;
  now?: number;
  interactive?: boolean;
  isIncoming?: boolean;
  /** True when an agent in this queue is currently on a connected call. */
  isLive?: boolean;
  /** Show caller rows for post-end queue linger without incoming/live chrome. */
  showEndedCallerRecall?: boolean;
  incomingCallers?: IncomingCallerContext[];
  callHint?: string;
  onClick?: () => void;
  onIncomingCallerClick?: (detail: CallDetailSnapshot) => void;
}

export function QueueSummaryCard({ 
  queue, 
  tenant, 
  showTenant, 
  now = Date.now(),
  interactive = false, 
  isIncoming = false, 
  isLive = false,
  showEndedCallerRecall = false,
  incomingCallers, 
  callHint, 
  onClick,
  onIncomingCallerClick,
}: QueueSummaryCardProps) {
  const incomingCount = incomingCallers?.length ?? 0;
  const incomingSeverity =
    queue.avgWaitSeconds >= 45
      ? "critical"
      : queue.avgWaitSeconds >= 20
        ? "warning"
        : "normal";
  const incomingTone =
    incomingSeverity === "critical"
      ? "var(--cc-color-red)"
      : incomingSeverity === "warning"
        ? "var(--cc-color-amber)"
        : "var(--cc-color-cyan)";
  const incomingSurface =
    incomingSeverity === "critical"
      ? "linear-gradient(135deg, rgba(239,68,68,0.13), rgba(254,242,242,0.7))"
      : incomingSeverity === "warning"
        ? "linear-gradient(135deg, rgba(245,158,11,0.16), rgba(255,247,237,0.7))"
        : "linear-gradient(135deg, rgba(6,182,212,0.12), rgba(236,254,255,0.65))";

  // Answered / on-call treatment — distinct from ringing/incoming.
  const liveTone = "var(--cc-color-green)";
  const liveSurface =
    "linear-gradient(135deg, rgba(16,185,129,0.14), rgba(236,253,245,0.7))";

  // Only show the "live" treatment if there isn't also an incoming call
  // (incoming takes visual priority because it demands attention).
  const showLive = isLive && !isIncoming;

  const showCallerRows =
    Boolean(incomingCallers?.length) &&
    (isIncoming || showLive || showEndedCallerRecall);
  const shouldScrollCallerRows = incomingCount > 3;

  const stats = [
    {
      label: 'Active',
      value: queue.activeCalls,
      color:
        queue.activeCalls > 0
          ? 'var(--cc-color-green)'
          : 'var(--cc-color-slate)',
      icon: PhoneCall,
    },
    {
      label: 'Waiting',
      value: queue.waitingCalls,
      color: queue.waitingCalls > 0 ? 'var(--cc-color-amber)' : 'var(--cc-color-slate)',
      icon: Clock,
    },
    {
      label: 'Ready',
      value: queue.availableAgents,
      color: 'var(--cc-color-cyan)',
      icon: HeadphonesIcon,
    },
    {
      label: 'Avg',
      value: `${queue.avgWaitSeconds}s`,
      color: 'var(--cc-color-slate)',
      icon: Users,
    },
  ];

  return (
    <Card
      className={`group relative overflow-hidden bg-white transition-all duration-300 ${
        interactive ? 'cursor-pointer hover:-translate-y-1 hover:shadow-xl' : 'shadow-sm'
      } ${isIncoming || showLive || showEndedCallerRecall ? 'ring-2 ring-offset-2 shadow-lg' : 'border-border/80'}`}
      style={
        isIncoming
          ? { borderColor: `${incomingTone}55`, boxShadow: `0 0 0 1px ${incomingTone}33` }
          : showLive
            ? { borderColor: `${liveTone}55`, boxShadow: `0 0 0 1px ${liveTone}33` }
            : showEndedCallerRecall
              ? { borderColor: 'rgba(100,116,139,0.35)', boxShadow: '0 0 0 1px rgba(100,116,139,0.2)' }
              : undefined
      }
      onClick={interactive ? onClick : undefined}
    >
      {/* Background glow effect for incoming / live calls */}
      {isIncoming && (
        <>
          <div className="pointer-events-none absolute inset-0" style={{ background: incomingSurface }} />
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-1.5 animate-pulse"
            style={{ backgroundColor: incomingTone }}
          />
        </>
      )}
      {showLive && (
        <>
          <div className="pointer-events-none absolute inset-0" style={{ background: liveSurface }} />
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
            style={{ backgroundColor: liveTone }}
          />
        </>
      )}
      {showEndedCallerRecall && !isIncoming && !showLive && (
        <>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-50/90 to-slate-100/50" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-slate-400/70" />
        </>
      )}

      {/* Glossy top highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-white/0 via-white/80 to-white/0" />

      <CardContent className="relative space-y-5 p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div 
              className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-2xl shadow-inner ring-1 ring-slate-200/50"
            >
              {queue.icon}
            </div>
            <div className="min-w-0 pt-0.5">
              <div className="truncate text-[15px] font-semibold tracking-tight text-slate-900 group-hover:text-amber-700 transition-colors" style={{ color: queue.color }}>
                {queue.name}
              </div>
              {showTenant && tenant && (
                <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">
                  {tenant.name}
                </div>
              )}
              {isIncoming && (
                <div className="mt-1.5 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ background: `${incomingTone}1a`, color: incomingTone }}>
                  <PhoneIncoming className="h-3 w-3" />
                  Incoming{incomingCount > 1 ? ` (${incomingCount})` : ""}
                </div>
              )}
              {showLive && (
                <div
                  className="mt-1.5 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em]"
                  style={{ background: `${liveTone}1a`, color: liveTone }}
                >
                  <PhoneCall className="h-3 w-3" />
                  On Call
                </div>
              )}
              {showEndedCallerRecall && !isIncoming && !showLive && (
                <div className="mt-1.5 inline-flex items-center gap-2 rounded-full bg-slate-200/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 ring-1 ring-slate-300/50">
                  <PhoneIncoming className="h-3 w-3 opacity-70" />
                  Recent
                </div>
              )}
            </div>
          </div>
          
          {/* Animated dot indicator */}
          <div className="flex items-center gap-2">
           {isIncoming && (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: incomingTone }}></span>
                <span className="relative inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: incomingTone }}></span>
              </span>
            )}
           {showLive && (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: liveTone }}></span>
                <span className="relative inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: liveTone, boxShadow: `0 0 8px ${liveTone}99` }}></span>
              </span>
            )}
          </div>
        </div>

        {/* Callers List (Incoming or Answered/Live) */}
        {showCallerRows && (
          <div
            className={`flex flex-col gap-2 ${
              shouldScrollCallerRows
                ? 'max-h-[13rem] overflow-y-auto pr-1'
                : ''
            }`}
          >
            {incomingCallers.map((caller, i) => {
              const openDetail = caller.detail && onIncomingCallerClick;

              const isLiveCard = showLive;
              const status = caller.status ?? null;
              const isEndedLinger = !isLiveCard && caller.endedAt != null;
              
              const cardBg = isLiveCard
                ? 'bg-gradient-to-r from-emerald-50 to-emerald-100/50 ring-emerald-200/50'
                : isEndedLinger
                  ? 'bg-gradient-to-r from-slate-50 to-slate-100/50 ring-slate-200/50'
                  : 'bg-gradient-to-r from-amber-50 to-amber-100/50 ring-amber-200/50';
              const hoverStyle = isLiveCard
                ? 'hover:bg-emerald-100/90 hover:ring-emerald-300/80 focus-visible:outline-emerald-500'
                : isEndedLinger
                  ? 'hover:bg-slate-100/90 hover:ring-slate-300/80 focus-visible:outline-slate-500'
                  : 'hover:bg-amber-100/90 hover:ring-amber-300/80 focus-visible:outline-amber-500';
              const nonHoverStyle = isLiveCard
                ? 'hover:bg-emerald-100/70'
                : isEndedLinger
                  ? 'hover:bg-slate-100/70'
                  : 'hover:bg-amber-100/70';
              
              const iconContainerStyle = isLiveCard
                ? 'bg-emerald-100 text-emerald-600 ring-emerald-200'
                : isEndedLinger
                  ? 'bg-slate-100 text-slate-600 ring-slate-200'
                  : 'bg-amber-100 text-amber-600 ring-amber-200';
                
              const textColor = isLiveCard
                ? 'text-emerald-950'
                : isEndedLinger
                  ? 'text-slate-950'
                  : 'text-amber-950';
              const subTextColor = isLiveCard
                ? 'text-emerald-700/80'
                : isEndedLinger
                  ? 'text-slate-600/80'
                  : 'text-amber-700/80';
              const badgeStyle = isLiveCard
                ? 'text-emerald-700 ring-emerald-200/60'
                : isEndedLinger
                  ? 'text-slate-600 ring-slate-200/60'
                  : 'text-amber-700 ring-amber-200/60';

              const chevronColor = isLiveCard
                ? 'text-emerald-700/60'
                : isEndedLinger
                  ? 'text-slate-600/60'
                  : 'text-amber-700/60';

              const Icon = isLiveCard ? PhoneCall : PhoneIncoming;

              return (
                <div
                  key={caller.detail?.id ?? `${caller.number}-${i}`}
                  role={openDetail ? 'button' : undefined}
                  tabIndex={openDetail ? 0 : undefined}
                  onClick={
                    openDetail
                      ? (e) => {
                          e.stopPropagation();
                          onIncomingCallerClick(caller.detail!);
                        }
                      : undefined
                  }
                  onKeyDown={
                    openDetail
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            onIncomingCallerClick(caller.detail!);
                          }
                        }
                      : undefined
                  }
                  className={`relative min-h-[3.75rem] overflow-hidden rounded-xl ${cardBg} p-2.5 ring-1 shadow-sm transition-all ${
                    openDetail
                      ? `cursor-pointer ${hoverStyle} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`
                      : nonHoverStyle
                  }`}
                >
                  <div className="absolute -right-4 -top-4 opacity-10">
                    <Icon size={56} />
                  </div>
                  <div className="relative flex items-center gap-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconContainerStyle} shadow-sm`}>
                      <Icon
                        className={`h-[14px] w-[14px] ${!isLiveCard && !isEndedLinger ? 'animate-pulse' : ''}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-[13px] font-bold ${textColor} leading-tight`}>
                        {caller.name || 'Unknown Caller'}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <div className={`min-w-[8rem] max-w-full truncate font-mono text-[12px] font-semibold ${subTextColor}`}>
                          {formatPhone(caller.number)}
                        </div>
                        <div className={`ml-auto shrink-0 rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[10px] font-bold ${badgeStyle} ring-1`}>
                          {isLiveCard ? (
                            'Answered'
                          ) : status === 'answered' ? (
                            'Answered'
                          ) : status === 'ended' ? (
                            'Ended'
                          ) : status === 'ringing' ? (
                            'Ringing'
                          ) : isEndedLinger ? (
                            'Ended'
                          ) : (
                            <>
                              Waiting{" "}
                              {formatPhoneDurationLabel(
                                caller.waitingSince
                                  ? Math.max(
                                      0,
                                      (now - caller.waitingSince) / 1000,
                                    )
                                  : queue.avgWaitSeconds,
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {openDetail && (
                      <ChevronRight
                        className={`h-4 w-4 shrink-0 ${chevronColor}`}
                        aria-hidden
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-2">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div 
                key={stat.label} 
                className="relative overflow-hidden rounded-xl bg-slate-50 p-3 transition-all hover:bg-slate-100/80 ring-1 ring-slate-900/5"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    {stat.label}
                  </div>
                  <Icon className="h-3.5 w-3.5 opacity-30 text-slate-500" />
                </div>
                <div 
                  className="font-sans text-xl font-bold tracking-tight" 
                  style={{ color: stat.color }}
                >
                  {stat.value}
                </div>
              </div>
            );
          })}
        </div>

        {/* Subtle Hint (live/ringing rows, or multiple incoming — pick a caller) */}
        {callHint &&
          (!isIncoming ||
            (incomingCallers && incomingCallers.length > 1)) && (
          <div className="flex items-center gap-2 rounded-lg bg-slate-50/50 px-3 py-2 text-[12px] font-medium text-slate-500 ring-1 ring-slate-100 transition-colors group-hover:bg-slate-50">
            {isIncoming ? "Select a caller to open full details." : callHint}
            <div className="ml-auto opacity-0 -translate-x-2 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0">
              →
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** `MM:SS` from elapsed seconds (queue avg is seconds; live wait uses ms → s at call site). */
function formatPhoneDurationLabel(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "—";
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
