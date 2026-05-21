import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  fetchTenants,
  fetchQueues,
  fetchCalls,
  fetchSummary,
  fetchSipLines,
  fetchAgentGroups,
  subscribeToAgents,
  subscribeToCalls,
  subscribeToIncomingCalls,
} from "@/services/dashboardApi";
import { fetchAgentsList } from "@/services/agentApis";
import { DASHBOARD_DISMISS_INCOMING_CALLER_EVENT } from "@/services/linkusCallLog";
import { fetchAgentOnboarding } from "@/services/agentOnboardingApi";
import { isValidCallerNumber } from "@/utils/formatters";
import { 
  getAustralianDateKey, 
  attendanceDayRangeAustralianYmd 
} from "@/utils/australianTime";
import type {
  Tenant,
  Agent,
  Queue,
  Call,
  DashboardSummary,
  SipLine,
  AgentGroup,
  AgentOnboarding,
  IncomingCall,
  UserSession,
  ConnectionStatus,
} from "@/services/types";
import {
  callsFetchLimitForTab,
  tabNeedsAgentGroups,
  tabNeedsAgentOnboarding,
  tabNeedsCalls,
  tabNeedsQueues,
  tabNeedsSip,
} from "@/lib/dashboardQueryLimits";

export type { ConnectionStatus } from "@/services/types";

export interface DashboardData {
  selectedTenant: string | null;
  setSelectedTenant: (id: string | null) => void;
  selectedTab: string;
  setSelectedTab: (tab: string) => void;
  connectionStatus: ConnectionStatus;
  tenants: Tenant[];
  summary: DashboardSummary | null;
  queues: Queue[];
  agents: Agent[];
  calls: Call[];
  sipLines: SipLine[];
  agentGroups: AgentGroup[];
  agentOnboarding: AgentOnboarding[];
  incomingCalls: IncomingCall[];
  /** Same as `incomingCalls` plus calls that recently left that list, kept ~40s for queue cards only. */
  incomingCallsWithQueueLinger: IncomingCall[];
  /** Call id → epoch ms when the call dropped out of `incomingCalls` (queue card “ended” badge). */
  queueIncomingLingerEndedAt: ReadonlyMap<string, number>;
  loading: boolean;
  error: string | null;
  now: number;
  callDate: string;
  setCallDate: (ymd: string) => void;
  refresh: () => void;
  pendingInternalChatAgentId: string | null;
  setPendingInternalChatAgentId: (id: string | null) => void;
  startInternalChat: (agentId: string) => void;
}

const POLL_INTERVAL = 8000;
const POLL_INTERVAL_AGENT_MS = 15000;
const INCOMING_CALLS_STORAGE_KEY = "cc_incoming_calls_v1";
const DASHBOARD_REFRESH_REQUEST_EVENT = "cc-dashboard-refresh-request";
/** Keep ended / cleared incoming rows visible on overview queue cards only (not the floating monitor). */
const QUEUE_CARD_INCOMING_LINGER_MS = 40_000;
/** Ignore duplicate dismiss events for the same Linkus leg (reject + deleteSession). */
const LINKUS_DISMISS_DEDUP_MS = 3500;

/**
 * Tab→query gating lives in `@/lib/dashboardQueryLimits` (shared with hover prefetch).
 *
 * - `fetchTenants` + `fetchAgentsList` stay on for the whole session — `DashboardPage`
 *   resolves chat tenant, workshop owner UID, leave badges, and sidebar `isCCAgent`
 *   from these lists even when the heavy tabs are closed.
 * - Queues / calls / SIP / onboarding / derived summary only run when a tab that
 *   actually renders that data is selected (stops polling while you are elsewhere).
 */

interface UseDashboardDataProps {
  session: UserSession | null;
}

export function useDashboardData({
  session,
}: UseDashboardDataProps): DashboardData {
  const queryClient = useQueryClient();
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState("overview");
  const [callDate, setCallDate] = useState<string>(() => getAustralianDateKey(Date.now()));
  const [now, setNow] = useState(Date.now());
  const [pendingInternalChatAgentId, setPendingInternalChatAgentId] = useState<string | null>(null);
  const linkusDismissDedupeRef = useRef<Map<string, number>>(new Map());

  // Set tenant from session
  useEffect(() => {
    if (session?.tenantId) {
      setSelectedTenant(session.tenantId);
    }
  }, [session?.tenantId]);

  // Live timer for relative time displays (isolated to avoid re-fetching data)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const effectiveTenant = session?.tenantId || selectedTenant;
  const isAgent = session?.role === "agent";
  const refreshInterval = isAgent ? POLL_INTERVAL_AGENT_MS : POLL_INTERVAL;

  const needsQueues = tabNeedsQueues(selectedTab);
  const needsCalls = tabNeedsCalls(selectedTab);
  const needsAgentGroups = tabNeedsAgentGroups(selectedTab);
  const needsSip = tabNeedsSip(selectedTab, isAgent);
  const needsAgentOnboarding = tabNeedsAgentOnboarding(selectedTab, isAgent);
  const needsSummary = selectedTab === "overview";
  const callsFetchLimit = callsFetchLimitForTab(selectedTab);

  // --- React Query Definitions ---

  const { data: tenants = [], error: tenantsErr, isPending: isPendingTenants } = useQuery({
    queryKey: ["tenants"],
    queryFn: fetchTenants,
    enabled: !!session,
    staleTime: 60000,
  });

  const { data: agents = [], error: agentsErr, isPending: isPendingAgents } = useQuery({
    queryKey: ["agents", effectiveTenant],
    queryFn: () => fetchAgentsList({ tenantId: effectiveTenant }),
    enabled: !!session,
    staleTime: 10_000,
    refetchInterval: refreshInterval,
  });

  const { data: queues = [], error: queuesErr, isPending: isPendingQueues } = useQuery({
    queryKey: ["queues", effectiveTenant],
    queryFn: () => fetchQueues(effectiveTenant),
    enabled: !!session && needsQueues,
    staleTime: 8_000,
    refetchInterval: refreshInterval,
  });

  const {
    data: calls = [],
    error: callsErr,
    isPending: isPendingCalls,
  } = useQuery({
    queryKey: ["calls", effectiveTenant, callDate, callsFetchLimit],
    queryFn: () => {
      const { startIso, endIso } = attendanceDayRangeAustralianYmd(callDate);
      return fetchCalls(effectiveTenant, callsFetchLimit, startIso, endIso);
    },
    enabled: !!session && needsCalls,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
    refetchInterval: refreshInterval,
  });

  // Summary depends on agents, queues, and calls. 
  // The overview API supplies the call KPIs; live local data fills any fields
  // the API does not return (active calls, waiting calls, available agents).
  const { data: summary = null, error: summaryErr } = useQuery({
    queryKey: ["summary", effectiveTenant, callDate, callsFetchLimit],
    queryFn: () => {
      const { startIso, endIso } = attendanceDayRangeAustralianYmd(callDate);
      return fetchSummary(
        effectiveTenant,
        { agents, queues, calls },
        startIso,
        endIso,
      );
    },
    enabled:
      !!session &&
      needsSummary &&
      !isPendingAgents &&
      !isPendingQueues &&
      !isPendingCalls,
    staleTime: 5_000,
    refetchInterval: refreshInterval,
  });

  const { data: sipLines = [], error: sipLinesErr } = useQuery({
    queryKey: ["sipLines", effectiveTenant],
    queryFn: () => fetchSipLines(effectiveTenant),
    enabled: !!session && needsSip,
    staleTime: 15_000,
    refetchInterval: refreshInterval * 2,
  });

  const { data: agentGroups = [], error: agentGroupsErr } = useQuery({
    queryKey: ["agentGroups", effectiveTenant],
    queryFn: () => fetchAgentGroups(effectiveTenant),
    enabled: !!session && needsAgentGroups,
    staleTime: 45_000,
  });

  const { data: agentOnboarding = [], error: onboardingErr } = useQuery({
    queryKey: ["agentOnboarding", effectiveTenant],
    queryFn: () => fetchAgentOnboarding(effectiveTenant),
    enabled: !!session && needsAgentOnboarding,
    staleTime: 60_000,
  });

  // --- Incoming Calls Logic (Manual State) ---

  const [incomingCalls, setIncomingCalls] = useState<IncomingCall[]>(() => {
    try {
      const saved = sessionStorage.getItem(INCOMING_CALLS_STORAGE_KEY);
      if (saved) return JSON.parse(saved) as IncomingCall[];
    } catch { /* ignore */ }
    return [];
  });

  const [endedIncomingLinger, setEndedIncomingLinger] = useState<
    Map<string, { call: IncomingCall; endedAt: number }>
  >(() => new Map());
  const queueLingerInitRef = useRef(false);
  const prevIncomingByIdRef = useRef<Map<string, IncomingCall>>(new Map());

  const incomingCallsWithQueueLinger = useMemo(() => {
    const activeIds = new Set(incomingCalls.map((c) => c.id));
    const extra: IncomingCall[] = [];
    for (const [id, v] of endedIncomingLinger) {
      if (activeIds.has(id)) continue;
      if (now - v.endedAt >= QUEUE_CARD_INCOMING_LINGER_MS) continue;
      extra.push(v.call);
    }
    return [...incomingCalls, ...extra];
  }, [incomingCalls, endedIncomingLinger, now]);

  const queueIncomingLingerEndedAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, v] of endedIncomingLinger) {
      if (now - v.endedAt < QUEUE_CARD_INCOMING_LINGER_MS) m.set(id, v.endedAt);
    }
    return m;
  }, [endedIncomingLinger, now]);

  useEffect(() => {
    queueLingerInitRef.current = false;
    prevIncomingByIdRef.current = new Map();
    setEndedIncomingLinger(new Map());
  }, [session?.userId, effectiveTenant]);

  useEffect(() => {
    const activeIds = new Set(incomingCalls.map((c) => c.id));
    const idToCall = new Map(incomingCalls.map((c) => [c.id, c] as const));

    if (!queueLingerInitRef.current) {
      queueLingerInitRef.current = true;
      prevIncomingByIdRef.current = idToCall;
      setEndedIncomingLinger((lingerPrev) => {
        const next = new Map(lingerPrev);
        for (const id of [...next.keys()]) {
          if (activeIds.has(id)) next.delete(id);
        }
        return next;
      });
      return;
    }

    const prev = prevIncomingByIdRef.current;

    setEndedIncomingLinger((lingerPrev) => {
      const next = new Map(lingerPrev);
      for (const id of [...next.keys()]) {
        if (activeIds.has(id)) next.delete(id);
      }
      for (const [id, call] of prev) {
        if (!activeIds.has(id)) {
          next.set(id, { call, endedAt: Date.now() });
        }
      }
      return next;
    });

    prevIncomingByIdRef.current = idToCall;
  }, [incomingCalls]);

  useEffect(() => {
    setEndedIncomingLinger((prev) => {
      let dirty = false;
      const next = new Map(prev);
      for (const [id, v] of prev) {
        if (now - v.endedAt >= QUEUE_CARD_INCOMING_LINGER_MS) {
          next.delete(id);
          dirty = true;
        }
      }
      return dirty ? next : prev;
    });
  }, [now]);

  useEffect(() => {
    try {
      if (incomingCalls.length > 0) {
        sessionStorage.setItem(INCOMING_CALLS_STORAGE_KEY, JSON.stringify(incomingCalls));
      } else {
        sessionStorage.removeItem(INCOMING_CALLS_STORAGE_KEY);
      }
    } catch { /* ignore quota errors */ }
  }, [incomingCalls]);

  // Reconcile incoming calls against CDRs
  useEffect(() => {
    if (calls.length === 0 || incomingCalls.length === 0) return;
    
    setIncomingCalls((prev) => {
      const RING_MATCH_WINDOW_MS = 5 * 60_000;
      const CLOCK_SKEW_TOLERANCE_MS = 90_000;

      const fresh = prev.filter((ic) => {
        const callid = ic.id.replace(/^incoming-/, "");
        const normalizedIcCaller = (ic.callerNumber ?? "").replace(/\D/g, "");

        const cdrEndedAfter = (endTimeIso: string | null): boolean => {
          if (!endTimeIso) return false;
          const endMs = new Date(endTimeIso).getTime();
          return Number.isFinite(endMs) && endMs >= ic.waitingSince - CLOCK_SKEW_TOLERANCE_MS;
        };

        const directMatch = calls.find((c) => c.id === `yeastar-${callid}`);
        if (directMatch && cdrEndedAfter(directMatch.endTime)) return false;

        if (normalizedIcCaller) {
          const fuzzyMatch = calls.find((c) => {
            if (c.tenantId !== ic.tenantId || !c.endTime) return false;
            const normalizedCdrCaller = (c.callerNumber ?? "").replace(/\D/g, "");
            const sharesSuffix = normalizedCdrCaller.endsWith(normalizedIcCaller) || normalizedIcCaller.endsWith(normalizedCdrCaller);
            if (!sharesSuffix) return false;
            const startMs = new Date(c.startTime).getTime();
            return Number.isFinite(startMs) && Math.abs(startMs - ic.waitingSince) < RING_MATCH_WINDOW_MS;
          });
          if (fuzzyMatch && cdrEndedAfter(fuzzyMatch.endTime)) return false;
        }
        return true;
      });
      return fresh.length === prev.length ? prev : fresh;
    });
  }, [calls]);

  // Evict stale calls
  const STALE_INCOMING_MS = 45_000;
  useEffect(() => {
    if (incomingCalls.length === 0) return;
    setIncomingCalls((prev) => {
      const fresh = prev.filter((c) => (now - c.waitingSince) < STALE_INCOMING_MS);
      return fresh.length === prev.length ? prev : fresh;
    });
  }, [now]);

  // Optimistic clear when this workstation rejects inbound on Linkus (CallHangup
  // from the server often waits on NewCdr).
  useEffect(() => {
    if (!session) return;

    const normalizeDigits = (p: string) => p.replace(/\D/g, "");
    const phonesMatch = (a: string, b: string): boolean => {
      const ca = normalizeDigits(a);
      const cb = normalizeDigits(b);
      if (!ca || !cb) return false;
      if (ca === cb) return true;
      return ca.endsWith(cb) || cb.endsWith(ca);
    };

    const onDismissCaller: EventListener = (ev) => {
      const ce = ev as CustomEvent<{
        callerNumber?: string;
        tenantId?: string;
        linkusCallId?: string;
      }>;
      const raw = ce.detail?.callerNumber?.trim();
      const linkusRaw = ce.detail?.linkusCallId?.trim();
      const baseFromLinkus = linkusRaw
        ? linkusRaw.split("@")[0]?.trim() || linkusRaw
        : "";
      const tid = ce.detail?.tenantId;
      if (!raw && !baseFromLinkus) return;

      const dispatchedAt = Date.now();
      for (const [k, exp] of linkusDismissDedupeRef.current) {
        if (exp <= dispatchedAt) linkusDismissDedupeRef.current.delete(k);
      }
      if (baseFromLinkus) {
        const until = linkusDismissDedupeRef.current.get(baseFromLinkus);
        if (until !== undefined && until > dispatchedAt) return;
      }

      setIncomingCalls((prev) => {
        // Re-check dedup inside the updater. React batches setState updaters and
        // runs them in order during commit. Multiple dismiss events for the same
        // Linkus leg (reject + deleteSession + session 'ended') can fire before
        // any updater commits, so the outer check above sees no dedup for all of
        // them. The first updater to run sets the dedup, and every following
        // updater bails here — preventing the heuristics from touching a row
        // that belongs to a different call.
        if (baseFromLinkus) {
          const until = linkusDismissDedupeRef.current.get(baseFromLinkus);
          if (until !== undefined && until > Date.now()) return prev;
        }

        const matchesTenant = (c: { tenantId: string }) =>
          !tid || c.tenantId === tid;

        const idsToRemove = new Set<string>();

        // 1) Strict id match (Yeastar `incoming-<callid>` vs Linkus SIP Call-ID base).
        if (baseFromLinkus) {
          for (const c of prev) {
            if (!matchesTenant(c)) continue;
            const rowBase = c.id.replace(/^incoming-/, "");
            if (rowBase === baseFromLinkus) idsToRemove.add(c.id);
          }
        }

        // 2) Phone fallback — only when *exactly one* row matches the caller number
        //    AND the dismissal looks like it refers to a recent ring. We deliberately
        //    do NOT remove anything if multiple rows share that number, and we no
        //    longer fall through to "remove the only remaining row" — that was
        //    evicting live calls when duplicate dismiss events arrived after the
        //    intended row had already been removed.
        if (idsToRemove.size === 0 && raw) {
          const candidates = prev.filter(
            (c) => matchesTenant(c) && phonesMatch(c.callerNumber, raw),
          );
          if (candidates.length === 1) {
            const c = candidates[0];
            const ageMs = dispatchedAt - c.waitingSince;
            if (ageMs >= 0 && ageMs < 30 * 60_000) {
              idsToRemove.add(c.id);
            }
          }
        }

        if (idsToRemove.size === 0) return prev;

        const next = prev.filter((c) => !idsToRemove.has(c.id));
        if (next.length < prev.length && baseFromLinkus) {
          linkusDismissDedupeRef.current.set(
            baseFromLinkus,
            Date.now() + LINKUS_DISMISS_DEDUP_MS,
          );
        }
        return next.length === prev.length ? prev : next;
      });
    };

    window.addEventListener(DASHBOARD_DISMISS_INCOMING_CALLER_EVENT, onDismissCaller);
    return () =>
      window.removeEventListener(DASHBOARD_DISMISS_INCOMING_CALLER_EVENT, onDismissCaller);
  }, [session]);

  // --- Subscriptions ---

  useEffect(() => {
    if (!session) return;

    const unsubCalls = subscribeToIncomingCalls(
      session.role === "super-admin" ? [] : session.allowedQueueIds,
      (call) => {
        if (!isValidCallerNumber(call.callerNumber)) return;
        setIncomingCalls((prev) => {
          const existing = prev.find((c) => c.id === call.id);
          const merged: IncomingCall = existing && !call.callerNumber && existing.callerNumber
            ? { ...call, callerNumber: existing.callerNumber, callerName: call.callerName ?? existing.callerName }
            : call;
          return [merged, ...prev.filter((c) => c.id !== call.id)];
        });
      },
      (callId) => setIncomingCalls((prev) => prev.filter((c) => c.id !== callId)),
    );

    const triggerRefetch = () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["calls"] });
      void queryClient.invalidateQueries({ queryKey: ["queues"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    };

    const unsubAgents = subscribeToAgents(effectiveTenant, triggerRefetch);
    /** Skip `calls` / softphone disposition CDC when neither calls nor queues tab data is loaded. */
    const needsCallsTableCdc = needsCalls || needsQueues;
    const unsubCallLog = needsCallsTableCdc
      ? subscribeToCalls(effectiveTenant, triggerRefetch)
      : () => {};

    return () => {
      unsubCalls();
      unsubAgents();
      unsubCallLog();
    };
  }, [session, effectiveTenant, queryClient, needsCalls, needsQueues]);

  const invalidateDashboardQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["tenants"] });
    void queryClient.invalidateQueries({ queryKey: ["agents"] });
    void queryClient.invalidateQueries({ queryKey: ["queues"] });
    void queryClient.invalidateQueries({ queryKey: ["calls"] });
    void queryClient.invalidateQueries({ queryKey: ["summary"] });
    void queryClient.invalidateQueries({ queryKey: ["sipLines"] });
    void queryClient.invalidateQueries({ queryKey: ["agentGroups"] });
    void queryClient.invalidateQueries({ queryKey: ["agentOnboarding"] });
  }, [queryClient]);

  // Handle manual refresh requests
  useEffect(() => {
    if (!session) return;
    const onRefresh = () => {
      invalidateDashboardQueries();
    };
    window.addEventListener(DASHBOARD_REFRESH_REQUEST_EVENT, onRefresh);
    return () => window.removeEventListener(DASHBOARD_REFRESH_REQUEST_EVENT, onRefresh);
  }, [session, invalidateDashboardQueries]);

  const refresh = useCallback(() => {
    invalidateDashboardQueries();
  }, [invalidateDashboardQueries]);

  const startInternalChat = useCallback((agentId: string) => {
    setPendingInternalChatAgentId(agentId);
    setSelectedTab("chat");
  }, []);

  // Derive loading and error states (wait for shell + whatever the active tab needs).
  const isInitialLoading =
    !session ||
    isPendingTenants ||
    isPendingAgents ||
    (needsQueues && isPendingQueues) ||
    (needsCalls && isPendingCalls);

  const error =
    (
      tenantsErr ||
      agentsErr ||
      queuesErr ||
      callsErr ||
      summaryErr ||
      sipLinesErr ||
      agentGroupsErr ||
      onboardingErr
    )?.toString() || null;
  const connectionStatus: ConnectionStatus = error ? "disconnected" : "connected";

  return {
    selectedTenant: effectiveTenant,
    setSelectedTenant,
    selectedTab,
    setSelectedTab,
    connectionStatus,
    tenants,
    summary,
    queues,
    agents,
    calls,
    sipLines,
    agentGroups,
    agentOnboarding,
    incomingCalls,
    incomingCallsWithQueueLinger,
    queueIncomingLingerEndedAt,
    loading: isInitialLoading,
    error,
    now,
    callDate,
    setCallDate,
    refresh,
    pendingInternalChatAgentId,
    setPendingInternalChatAgentId,
    startInternalChat,
  };
}
