import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Phone,
  PhoneCall,
  PhoneOff,
  PhoneMissed,
  Mic,
  MicOff,
  Pause,
  Play,
  ChevronDown,
  Delete,
  Loader2,
  AlertCircle,
  CheckCircle2,
  PhoneIncoming,
  Volume2,
  ShieldAlert,
  RefreshCw,
  Users,
  Search,
  Hash,
  ArrowRightLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  useLinkusSDK,
  type ActiveCallInfo,
  type SoftphoneStatus,
  LINKUS_CALL_STATUS_LABELS,
} from '@/hooks/useLinkusSDK';
import type { MicPermission } from '@/hooks/useLinkusSDK';
import {
  clearCachedSdkSign,
  seedSdkSign,
  type PbxExtension,
} from '@/services/linkusSdkService';
import {
  appendLinkusCallLog,
  appendLinkusCallToSupabase,
  buildCallFromLinkusSessionEnd,
  type LinkusCallDispositionPayload,
  type LinkusSessionEndPayload,
  syncLinkusCallDispositionToSupabase,
  type SoftphoneCallLogContext,
} from '@/services/linkusCallLog';
import { useExtensions } from '@/hooks/useExtensions';

// ─── helpers ───────────────────────────────────────────────
export const SOFTPHONE_DIAL_REQUEST_EVENT = 'softphone:dial-request';

type SoftphoneDialRequestDetail = {
  number: string;
};

function formatDuration(startTime: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - startTime) / 1000));
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const STATUS_META: Record<
  SoftphoneStatus,
  { label: string; dot: string; badge: string }
> = {
  idle: {
    label: 'Offline',
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-600',
  },
  initializing: {
    label: 'Connecting…',
    dot: 'bg-amber-400 animate-pulse',
    badge: 'bg-amber-50 text-amber-700',
  },
  registered: {
    label: 'Ready',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700',
  },
  ringing: {
    label: 'Incoming',
    dot: 'bg-sky-500 animate-pulse',
    badge: 'bg-sky-50 text-sky-700',
  },
  'on-call': {
    label: 'On Call',
    dot: 'bg-violet-500',
    badge: 'bg-violet-50 text-violet-700',
  },
  'ip-forbidden': {
    label: 'IP Blocked',
    dot: 'bg-orange-500',
    badge: 'bg-orange-50 text-orange-700',
  },
  error: {
    label: 'Error',
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700',
  },
};

const DIALPAD_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

function presenceDotClass(ext: PbxExtension): string {
  if (!ext.online) return 'bg-slate-300';

  switch (ext.presence) {
    case 'do_not_disturb':
      return 'bg-rose-500';
    case 'away':
    case 'lunch':
    case 'business_trip':
      return 'bg-amber-400';
    case 'off_work':
      return 'bg-slate-400';
    case 'available':
    default:
      return 'bg-emerald-500';
  }
}

// ─── Sub-components ────────────────────────────────────────

function IncomingCallCard({
  call,
  onAnswer,
  onReject,
}: {
  call: ActiveCallInfo;
  onAnswer: () => void;
  onReject: () => void;
}) {
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
        </span>
        <span className="text-xs font-semibold text-sky-700">Incoming Call</span>
      </div>
      <p className="truncate text-sm font-semibold text-slate-900">
        {call.name || call.number}
      </p>
      {call.name && (
        <p className="truncate text-xs text-slate-500">{call.number}</p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          className="flex-1 bg-emerald-500 text-white hover:bg-emerald-600"
          onClick={onAnswer}
        >
          <Phone className="mr-1 h-3 w-3" />
          Answer
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 border-rose-200 text-rose-600 hover:bg-rose-50"
          onClick={onReject}
        >
          <PhoneOff className="mr-1 h-3 w-3" />
          Reject
        </Button>
      </div>
    </div>
  );
}

function ExtensionTransferRow({
  ext,
  onTransfer,
}: {
  ext: PbxExtension;
  onTransfer: (number: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onTransfer(ext.number)}
      className="group flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-violet-200 hover:bg-violet-100/60"
      title={`Blind transfer to ${ext.name} (${ext.number})`}
    >
      <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-semibold text-violet-700">
        {ext.name.slice(0, 2).toUpperCase() || ext.number.slice(0, 2)}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${presenceDotClass(ext)}`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-900">{ext.name}</p>
        <p className="truncate font-mono text-[11px] text-slate-500">{ext.number}</p>
      </div>
      <ArrowRightLeft className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 transition-colors group-hover:text-violet-600" />
    </button>
  );
}

function ActiveCallCard({
  call,
  now,
  onHangup,
  onHold,
  onMute,
  onBlindTransfer,
  remoteAudioBlocked,
  onEnableAudio,
}: {
  call: ActiveCallInfo;
  now: number;
  onHangup: () => void;
  onHold: () => void;
  onMute: () => void;
  /** Returns whether the SDK accepted the blind transfer request. */
  onBlindTransfer: (toNumber: string) => boolean;
  remoteAudioBlocked?: boolean;
  onEnableAudio?: () => void;
}) {
  const isConnected = call.callStatus === 'talking';
  const [xferOpen, setXferOpen] = useState(false);
  const [xferDest, setXferDest] = useState('');
  const [xferError, setXferError] = useState<string | null>(null);
  const [xferQuery, setXferQuery] = useState('');

  // Load directory as soon as the call is connected so the list is ready when
  // the user expands "Transfer call" (same cached fetch as the Directory tab).
  const { status: extStatus, extensions, error: extErr, refresh } = useExtensions({
    enabled: isConnected,
  });

  const filteredXfer = useMemo(() => {
    const q = xferQuery.trim().toLowerCase();
    const list = extensions.filter((e) => {
      if (!q) return true;
      return (
        e.number.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        (e.email?.toLowerCase().includes(q) ?? false)
      );
    });
    return [...list].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.number.localeCompare(b.number, undefined, { numeric: true });
    });
  }, [extensions, xferQuery]);

  const runBlindTransfer = useCallback(
    (raw: string) => {
      const sanitized = raw.replace(/[^0-9+*#]/g, '');
      if (!sanitized) {
        setXferError('Enter a valid extension or number.');
        return;
      }
      const ok = onBlindTransfer(sanitized);
      if (ok) {
        setXferError(null);
        setXferDest('');
      } else {
        setXferError('Transfer was rejected or the call has already ended.');
      }
    },
    [onBlindTransfer]
  );

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={
              call.direction === 'outbound'
                ? 'border-violet-300 bg-violet-100/80 text-[10px] font-semibold text-violet-800'
                : 'border-sky-300 bg-sky-100/80 text-[10px] font-semibold text-sky-800'
            }
          >
            {call.direction === 'outbound' ? 'Outbound' : 'Inbound'}
          </Badge>
          <Badge variant="outline" className="border-slate-200 bg-white text-[10px] font-medium text-slate-600">
            {call.isHeld ? 'On hold' : LINKUS_CALL_STATUS_LABELS[call.callStatus]}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          {isConnected && !call.isMuted && (
            <Volume2 className="h-3 w-3 text-violet-400" title="Audio active" />
          )}
          {isConnected && (
            <span className="font-mono text-xs text-violet-600">
              {formatDuration(call.startTime, now)}
            </span>
          )}
        </div>
      </div>
      <p
        className="mb-2 truncate font-mono text-[10px] text-violet-500/90"
        title="Linkus session id"
      >
        {call.callId}
      </p>

      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-200 text-violet-700">
          <PhoneCall className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {call.name || call.number}
          </p>
          {call.name && (
            <p className="truncate text-xs text-slate-500">{call.number}</p>
          )}
        </div>
      </div>

      {isConnected && remoteAudioBlocked && (
        <button
          type="button"
          onClick={onEnableAudio}
          className="mb-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-left text-xs font-medium text-amber-800 hover:bg-amber-100"
        >
          Click to enable call audio — the browser blocked speaker playback.
        </button>
      )}

      <div className="flex gap-2">
        {/* Hold / unhold */}
        <Button
          size="sm"
          variant="outline"
          className={`flex-1 ${
            call.isHeld
              ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
          onClick={onHold}
          title={call.isHeld ? 'Resume' : 'Hold'}
        >
          {call.isHeld ? (
            <Play className="h-3 w-3" />
          ) : (
            <Pause className="h-3 w-3" />
          )}
        </Button>

        {/* Mute / unmute */}
        <Button
          size="sm"
          variant="outline"
          className={`flex-1 ${
            call.isMuted
              ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
          onClick={onMute}
          title={call.isMuted ? 'Unmute' : 'Mute'}
        >
          {call.isMuted ? (
            <MicOff className="h-3 w-3" />
          ) : (
            <Mic className="h-3 w-3" />
          )}
        </Button>

        {/* Hangup */}
        <Button
          size="sm"
          className="flex-1 bg-rose-500 text-white hover:bg-rose-600"
          onClick={onHangup}
          title="Hang up"
        >
          <PhoneOff className="h-3 w-3" />
        </Button>
      </div>

      {/* Blind transfer — only when media path is up (avoids SDK "not connected" errors) */}
      {isConnected && (
        <div className="mt-2 border-t border-violet-200/80 pt-2">
          <button
            type="button"
            onClick={() => {
              setXferOpen((o) => !o);
              setXferError(null);
            }}
            className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-medium text-violet-800 hover:bg-violet-100/50"
          >
            <span className="flex items-center gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span>
                Transfer call
                {extStatus === 'ready' && extensions.length > 0 && (
                  <span className="ml-1 font-normal text-violet-600/80">
                    ({extensions.length})
                  </span>
                )}
              </span>
            </span>
            <ChevronRight
              className={`h-3.5 w-3.5 text-violet-500 transition-transform ${xferOpen ? 'rotate-90' : ''}`}
            />
          </button>

          {xferOpen && (
            <div className="mt-2 space-y-2 rounded-lg border border-violet-200/60 bg-white/80 p-2">
              <p className="text-[10px] leading-snug text-slate-500">
                Tap an extension to blind transfer, or dial another number below.
              </p>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-800">
                    Extensions
                  </span>
                  {extStatus === 'ready' && extensions.length > 0 && (
                    <span className="text-[10px] text-slate-500">
                      {xferQuery.trim() ? `${filteredXfer.length} match` : `${extensions.length} total`}
                    </span>
                  )}
                </div>

                <div className="mb-1.5 flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                  <Search className="h-3 w-3 flex-shrink-0 text-slate-400" />
                  <input
                    type="text"
                    value={xferQuery}
                    onChange={(e) => setXferQuery(e.target.value)}
                    placeholder="Filter by name or extension…"
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-800 outline-none placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={refresh}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                    title="Refresh extensions"
                    aria-label="Refresh extensions"
                    disabled={extStatus === 'loading'}
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${extStatus === 'loading' ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>

                {extStatus === 'loading' && extensions.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-200 py-6 text-[11px] text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading extensions…</span>
                  </div>
                )}

                {extStatus === 'error' && (
                  <div className="flex items-start gap-1.5 rounded bg-rose-50 px-1.5 py-1.5 text-[10px] text-rose-700">
                    <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    <span className="min-w-0 break-words">{extErr}</span>
                  </div>
                )}

                {extStatus === 'ready' && extensions.length === 0 && (
                  <p className="rounded-md border border-dashed border-slate-200 py-3 text-center text-[10px] text-slate-500">
                    No extensions returned. Check PBX API permissions or refresh.
                  </p>
                )}

                {filteredXfer.length > 0 && (
                  <div className="max-h-52 space-y-0.5 overflow-y-auto overscroll-contain rounded-md border border-slate-100 bg-slate-50/50 pr-0.5">
                    {filteredXfer.map((ext) => (
                      <ExtensionTransferRow
                        key={ext.id}
                        ext={ext}
                        onTransfer={(n) => runBlindTransfer(n)}
                      />
                    ))}
                  </div>
                )}

                {extStatus === 'ready' && extensions.length > 0 && filteredXfer.length === 0 && (
                  <p className="py-2 text-center text-[10px] text-slate-500">
                    No extensions match your filter.
                  </p>
                )}
              </div>

              <div className="border-t border-slate-200/80 pt-2">
                <p className="mb-1 text-[10px] font-medium text-slate-600">Other number</p>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={xferDest}
                    onChange={(e) => {
                      setXferDest(e.target.value);
                      setXferError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') runBlindTransfer(xferDest);
                    }}
                    placeholder="Extension or external number"
                    className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 outline-none focus:border-violet-400"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-violet-300 text-violet-800 hover:bg-violet-50"
                    disabled={!xferDest.trim()}
                    onClick={() => runBlindTransfer(xferDest)}
                  >
                    Transfer
                  </Button>
                </div>
              </div>

              {xferError && (
                <p className="text-[10px] text-rose-600">{xferError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Directory (extension list) ────────────────────────────

function ExtensionRow({
  ext,
  onCall,
  disabled,
}: {
  ext: PbxExtension;
  onCall: (number: string) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onCall(ext.number)}
      disabled={disabled}
      className="group flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-slate-200 hover:bg-slate-50 disabled:opacity-50"
      title={`Call ${ext.name} (${ext.number})`}
    >
      <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
        {ext.name.slice(0, 2).toUpperCase() || ext.number.slice(0, 2)}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${presenceDotClass(ext)}`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-900">
          {ext.name}
        </p>
        <p className="truncate font-mono text-[11px] text-slate-500">
          {ext.number}
        </p>
      </div>
      <Phone className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 transition-colors group-hover:text-emerald-500" />
    </button>
  );
}

function DirectoryView({
  enabled,
  onCall,
  callDisabled,
}: {
  enabled: boolean;
  onCall: (number: string) => void;
  callDisabled: boolean;
}) {
  const { status, extensions, error, refresh } = useExtensions({ enabled });
  const [query, setQuery] = useState('');

  const filtered = extensions.filter((e) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      e.number.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      (e.email?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center gap-1 rounded-lg border border-border bg-slate-50 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or extension…"
          className="min-w-0 flex-1 bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400"
        />
        <button
          onClick={refresh}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          title="Refresh list"
          aria-label="Refresh directory"
          disabled={status === 'loading'}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${status === 'loading' ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {status === 'loading' && extensions.length === 0 && (
        <div className="flex items-center justify-center gap-2 rounded-lg bg-slate-50 py-6 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading extensions…
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-2 py-2 text-[11px] text-rose-700">
          <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
        </div>
      )}

      {status === 'ready' && filtered.length === 0 && (
        <div className="rounded-lg bg-slate-50 py-6 text-center text-xs text-slate-500">
          {query ? 'No matches.' : 'No extensions found.'}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="max-h-64 space-y-0.5 overflow-y-auto pr-0.5">
          {filtered.map((ext) => (
            <ExtensionRow
              key={ext.id}
              ext={ext}
              onCall={onCall}
              disabled={callDisabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main widget ───────────────────────────────────────────

interface SoftphoneWidgetProps {
  /** The agent's Yeastar-registered email address. */
  agentEmail: string | null | undefined;
  /** When set, finished Linkus sessions are stored for the Calls tab (stable ref in widget avoids SDK reconnect loop). */
  callLogContext?: SoftphoneCallLogContext | null;
}

async function requestMicPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

type WidgetTab = 'dialpad' | 'directory';

export function SoftphoneWidget({
  agentEmail,
  callLogContext,
}: SoftphoneWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dialInput, setDialInput] = useState('');
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<WidgetTab>('dialpad');
  /** Workaround for super-admin "no cached sign + PBX blocking" — paste a sign generated elsewhere. */
  const [pasteSignOpen, setPasteSignOpen] = useState(false);
  const [pasteSignValue, setPasteSignValue] = useState('');
  const [pasteSignError, setPasteSignError] = useState<string | null>(null);

  const callLogContextRef = useRef(callLogContext);
  callLogContextRef.current = callLogContext;

  const onCallSessionEndStable = useCallback((info: LinkusSessionEndPayload) => {
    const ctx = callLogContextRef.current;
    if (!ctx?.tenantId) return;
    const call = buildCallFromLinkusSessionEnd(ctx, info);
    appendLinkusCallLog(call);
    void appendLinkusCallToSupabase(call);
  }, []);

  const onCallDispositionStable = useCallback((info: LinkusCallDispositionPayload) => {
    const ctx = callLogContextRef.current;
    if (!ctx?.tenantId) return;
    void syncLinkusCallDispositionToSupabase(ctx, info);
  }, []);

  const sdk = useLinkusSDK({
    agentEmail,
    onCallSessionEnd: onCallSessionEndStable,
    onCallDisposition: onCallDispositionStable,
  });
  const meta = STATUS_META[sdk.status];

  // Tick every second for live call timers
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-open when a call arrives
  useEffect(() => {
    if (sdk.incomingCalls.length > 0 || sdk.primaryActiveCall) {
      setIsOpen(true);
    }
  }, [sdk.incomingCalls.length, sdk.primaryActiveCall]);

  const handleDialKey = useCallback(
    (key: string) => setDialInput((prev) => prev + key),
    []
  );

  const handleBackspace = useCallback(
    () => setDialInput((prev) => prev.slice(0, -1)),
    []
  );

  const handleCall = useCallback(() => {
    if (!dialInput) return;
    // Strip everything the PBX can't dial — spaces, dashes, parentheses, dots.
    // Keep digits and valid SIP dialing characters (+, *, #).
    const sanitized = dialInput.replace(/[^0-9+*#]/g, '');
    if (!sanitized) {
      // console.warn('[SoftphoneWidget] Dial input had no valid digits:', dialInput);
      return;
    }
    sdk.makeCall(sanitized).catch((_err) => {
      // console.error('[SoftphoneWidget] Call failed:', _err);
    });
    setDialInput('');
  }, [dialInput, sdk]);

  const handleDirectoryCall = useCallback(
    (number: string) => {
      if (!number) return;
      const sanitized = number.replace(/[^0-9+*#]/g, '');
      if (!sanitized) return;
      sdk.makeCall(sanitized).catch((_err) => {
        // console.error('[SoftphoneWidget] Directory call failed:', _err);
      });
      // Jump back to the dialpad so the active-call card is visible.
      setTab('dialpad');
    },
    [sdk]
  );

  useEffect(() => {
    const onDialRequest = (evt: Event) => {
      const customEvt = evt as CustomEvent<SoftphoneDialRequestDetail>;
      const rawNumber = String(customEvt.detail?.number ?? '');
      const sanitized = rawNumber.replace(/[^0-9+*#]/g, '');
      if (!sanitized) return;
      setIsOpen(true);
      setTab('dialpad');
      sdk.makeCall(sanitized).catch((_err) => {
        // console.error('[SoftphoneWidget] External dial failed:', _err);
      });
    };
    window.addEventListener(
      SOFTPHONE_DIAL_REQUEST_EVENT,
      onDialRequest as EventListener
    );
    return () =>
      window.removeEventListener(
        SOFTPHONE_DIAL_REQUEST_EVENT,
        onDialRequest as EventListener
      );
  }, [sdk]);

  // Don't render at all if no email → not an agent with PBX access
  if (!agentEmail) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-[120] flex flex-col items-end gap-2"
      aria-label="Softphone"
    >
      {/* Expanded panel */}
      {isOpen && (
        <div className="w-72 overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-slate-200 ring-1 ring-slate-100">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${meta.dot}`}
              />
              <span className="text-sm font-semibold text-slate-800">
                Softphone
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={`text-xs ${meta.badge}`}>{meta.label}</Badge>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-md p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                aria-label="Minimise"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-3 p-3">
            {/* Initialising */}
            {sdk.status === 'initializing' && (
              <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting to PBX…
              </div>
            )}

            {/* IP FORBIDDEN — needs one-time whitelisted-IP login */}
            {sdk.status === 'ip-forbidden' && (
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 flex-shrink-0 text-orange-600" />
                  <span className="text-xs font-semibold text-orange-700">
                    IP Address Blocked (error 70087)
                  </span>
                </div>
                <p className="mb-2 text-xs text-orange-700">
                  The Yeastar PBX is rejecting this request from your current
                  network. You need to connect <strong>once</strong> from a
                  whitelisted IP to generate your sign.
                </p>
                <p className="mb-3 text-xs font-medium text-orange-800">
                  Fix options:
                </p>
                <ol className="mb-3 list-inside list-decimal space-y-1 text-xs text-orange-700">
                  <li>
                    Log into the Yeastar admin portal →{' '}
                    <strong>Integrations → Linkus SDK</strong> → remove the
                    IP restriction
                  </li>
                  <li>
                    Or connect from the <strong>office network / VPN</strong>{' '}
                    once — the sign is cached locally and all future logins
                    will work from any IP
                  </li>
                  <li>
                    Or paste a sign generated on a working machine (use
                    <em> Paste sign manually </em> below)
                  </li>
                </ol>
                <Button
                  size="sm"
                  variant="outline"
                  className="mb-2 w-full border-orange-300 text-orange-700 hover:bg-orange-100"
                  onClick={() => {
                    if (agentEmail) clearCachedSdkSign(agentEmail);
                    window.location.reload();
                  }}
                >
                  <RefreshCw className="mr-1 h-3 w-3" />
                  Retry
                </Button>

                {sdk.error && (
                  <details className="mb-2 text-[11px] text-orange-700">
                    <summary className="cursor-pointer select-none font-medium">
                      Technical details
                    </summary>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border border-orange-200 bg-white/60 p-2 font-mono text-[10px] leading-snug text-orange-800">
                      {sdk.error}
                    </pre>
                  </details>
                )}

                <details
                  open={pasteSignOpen}
                  onToggle={(e) => setPasteSignOpen(e.currentTarget.open)}
                  className="text-[11px] text-orange-700"
                >
                  <summary className="cursor-pointer select-none font-medium">
                    Paste sign manually
                  </summary>
                  <div className="mt-2 space-y-2">
                    <p className="text-[10px] leading-snug text-orange-700">
                      On a machine that <em>can</em> connect (or in the Yeastar
                      admin portal), generate a Linkus SDK sign for{' '}
                      <code className="font-mono">{agentEmail}</code> and paste it here.
                    </p>
                    <textarea
                      className="w-full resize-y rounded-md border border-orange-300 bg-white p-1.5 font-mono text-[10px] text-slate-800 focus:border-orange-500 focus:outline-none"
                      rows={3}
                      value={pasteSignValue}
                      onChange={(e) => {
                        setPasteSignValue(e.target.value);
                        if (pasteSignError) setPasteSignError(null);
                      }}
                      placeholder="Paste sign token…"
                    />
                    {pasteSignError && (
                      <p className="text-[10px] font-medium text-rose-600">
                        {pasteSignError}
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full border-orange-300 text-orange-700 hover:bg-orange-100"
                      onClick={() => {
                        if (!agentEmail) {
                          setPasteSignError('No agent email — log in first.');
                          return;
                        }
                        const ok = seedSdkSign(agentEmail, pasteSignValue);
                        if (!ok) {
                          setPasteSignError(
                            'That does not look like a valid Linkus sign (too short or empty).',
                          );
                          return;
                        }
                        window.location.reload();
                      }}
                    >
                      Save sign &amp; reload
                    </Button>
                  </div>
                </details>
              </div>
            )}

            {/* Microphone denied */}
            {sdk.micPermission === 'denied' && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                <div className="mb-2 flex items-start gap-2 text-xs text-rose-700">
                  <MicOff className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>
                    Microphone access is blocked. Click the 🔒 icon in your
                    browser's address bar, allow <em>Microphone</em>, then
                    refresh the page.
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-rose-200 text-rose-700 hover:bg-rose-100"
                  onClick={async () => {
                    const ok = await requestMicPermission();
                    if (ok) window.location.reload();
                  }}
                >
                  <Mic className="mr-1 h-3 w-3" />
                  Allow Microphone
                </Button>
              </div>
            )}

            {/* Error (non-mic) */}
            {sdk.status === 'error' && sdk.micPermission !== 'denied' && (
              <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>{sdk.error ?? 'Connection failed'}</span>
              </div>
            )}

            {/* Ready banner */}
            {sdk.status === 'registered' && sdk.incomingCalls.length === 0 && !sdk.primaryActiveCall && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Registered &amp; ready
              </div>
            )}

            {/* Incoming calls */}
            {sdk.incomingCalls.map((call) => (
              <IncomingCallCard
                key={call.callId}
                call={call}
                onAnswer={() => sdk.answer(call.callId)}
                onReject={() => sdk.reject(call.callId)}
              />
            ))}

            {/* Active calls (non-incoming) */}
            {sdk.activeCalls
              .filter((c) => !sdk.incomingCalls.some((i) => i.callId === c.callId))
              .map((call) => (
                <ActiveCallCard
                  key={call.callId}
                  call={call}
                  now={now}
                  onHangup={() => sdk.hangup(call.callId)}
                  onHold={() =>
                    call.isHeld
                      ? sdk.unhold(call.callId)
                      : sdk.hold(call.callId)
                  }
                  onMute={() =>
                    call.isMuted
                      ? sdk.unmute(call.callId)
                      : sdk.mute(call.callId)
                  }
                  onBlindTransfer={(to) => sdk.blindTransfer(call.callId, to)}
                  remoteAudioBlocked={sdk.remoteAudioBlocked}
                  onEnableAudio={sdk.enableCallAudio}
                />
              ))}

            {/* Dialpad / Directory tabs — only when registered or on call */}
            {(sdk.status === 'registered' || sdk.status === 'on-call') && (
              <div>
                {/* Tab bar */}
                <div className="mb-2 flex rounded-lg bg-slate-100 p-0.5">
                  <button
                    type="button"
                    onClick={() => setTab('dialpad')}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-xs font-medium transition-colors ${
                      tab === 'dialpad'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Hash className="h-3 w-3" />
                    Dialpad
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('directory')}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-xs font-medium transition-colors ${
                      tab === 'directory'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Users className="h-3 w-3" />
                    Directory
                  </button>
                </div>

                {tab === 'dialpad' && (
                  <div>
                    {/* Number input */}
                    <div className="mb-2 flex items-center gap-1 rounded-lg border border-border bg-slate-50 px-3 py-2">
                      <input
                        type="text"
                        value={dialInput}
                        onChange={(e) => setDialInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCall();
                        }}
                        placeholder="Enter number…"
                        className="min-w-0 flex-1 bg-transparent font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      />
                      {dialInput && (
                        <button
                          onClick={handleBackspace}
                          className="text-slate-400 hover:text-slate-600"
                          aria-label="Backspace"
                        >
                          <Delete className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {/* Keypad */}
                    <div className="grid grid-cols-3 gap-1">
                      {DIALPAD_KEYS.flat().map((key) => (
                        <button
                          key={key}
                          onClick={() => handleDialKey(key)}
                          className="rounded-lg border border-border bg-slate-50 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 active:bg-slate-200"
                        >
                          {key}
                        </button>
                      ))}
                    </div>

                    {/* Call button */}
                    <Button
                      className="mt-2 w-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
                      disabled={!dialInput}
                      onClick={handleCall}
                    >
                      <Phone className="mr-2 h-4 w-4" />
                      Call
                    </Button>
                  </div>
                )}

                {tab === 'directory' && (
                  <DirectoryView
                    enabled={sdk.status === 'registered' || sdk.status === 'on-call'}
                    onCall={handleDirectoryCall}
                    callDisabled={sdk.status !== 'registered' && sdk.status !== 'on-call'}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapsed toggle button */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className={`relative flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 ${
          sdk.status === 'ringing'
            ? 'animate-bounce bg-sky-500 text-white'
            : sdk.status === 'on-call'
            ? 'bg-violet-600 text-white'
            : sdk.status === 'ip-forbidden'
            ? 'bg-orange-500 text-white'
            : sdk.status === 'error'
            ? 'bg-rose-500 text-white'
            : sdk.status === 'registered'
            ? 'bg-emerald-500 text-white'
            : 'bg-slate-700 text-white'
        }`}
        aria-label={isOpen ? 'Minimise softphone' : 'Open softphone'}
      >
        {sdk.status === 'initializing' ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : sdk.status === 'ringing' ? (
          <PhoneIncoming className="h-5 w-5" />
        ) : sdk.status === 'on-call' ? (
          <PhoneCall className="h-5 w-5" />
        ) : sdk.status === 'ip-forbidden' ? (
          <ShieldAlert className="h-5 w-5" />
        ) : sdk.micPermission === 'denied' ? (
          <MicOff className="h-5 w-5" />
        ) : sdk.status === 'error' ? (
          <PhoneMissed className="h-5 w-5" />
        ) : isOpen ? (
          <ChevronDown className="h-5 w-5" />
        ) : (
          <Phone className="h-5 w-5" />
        )}

        {/* Status dot */}
        <span
          className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white ${meta.dot}`}
        />

        {/* Incoming call badge count */}
        {sdk.incomingCalls.length > 0 && (
          <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
            {sdk.incomingCalls.length}
          </span>
        )}
      </button>
    </div>
  );
}
