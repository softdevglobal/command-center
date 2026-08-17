import '@/styles/dashboard.css';

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  lazy,
  Suspense,
  memo,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { TenantOnboarding, NewClientForm, UserSession, Permissions } from '@/services/types';
import { useDashboard } from '@/context/DashboardDataContext';
import { useLiveClock } from '@/hooks/useLiveClock';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { AgentNavAttendanceActions } from '@/components/dashboard/AgentNavAttendanceActions';
import { AgentAttendanceTodayProvider } from '@/context/AgentAttendanceTodayContext';
import DashboardSidebar from '@/tabs/DashboardSidebar';
import { LoadingSkeleton } from '@/components/dashboard/LoadingSkeleton';
import { OverviewTab as RawOverviewTab } from '@/tabs/OverviewTab';

const OverviewTab = memo(RawOverviewTab);

const AgentsTab = lazy(() =>
  import('@/tabs/AgentsTab').then((m) => ({ default: m.AgentsTab })),
);
const AgentPerformanceTab = lazy(() =>
  import('@/tabs/AgentPerformanceTab').then((m) => ({ default: m.AgentPerformanceTab })),
);
const CallsTab = lazy(() => import('@/tabs/CallsTab').then((m) => ({ default: m.CallsTab })));
const SipLinesTab = lazy(() =>
  import('@/tabs/SipLinesTab').then((m) => ({ default: m.SipLinesTab })),
);
const ClientsTab = lazy(() =>
  import('@/tabs/ClientsTab').then((m) => ({ default: m.ClientsTab })),
);
const AgentOnboardingTab = lazy(() =>
  import('@/tabs/AgentOnboardingTab').then((m) => ({ default: m.AgentOnboardingTab })),
);
const AttendanceTab = lazy(() =>
  import('@/tabs/AttendanceTab').then((m) => ({ default: m.AttendanceTab })),
);
const AuditLogsTab = lazy(() =>
  import('@/tabs/AuditLogsTab').then((m) => ({ default: m.AuditLogsTab })),
);
const ChatTab = lazy(() => import('@/tabs/ChatTab').then((m) => ({ default: m.ChatTab })));
const SmsTab = lazy(() => import('@/tabs/SmsTab').then((m) => ({ default: m.SmsTab })));
const DIDMappingsTab = lazy(() =>
  import('@/tabs/DIDMappingsTab').then((m) => ({ default: m.DIDMappingsTab })),
);
const SalesAgentSuburbAssignmentTab = lazy(() =>
  import('@/tabs/sales-workspace/SalesWorkspaceAdminTabs').then((m) => ({
    default: m.SalesAgentSuburbAssignmentTab,
  })),
);
const SalesCallProgressTab = lazy(() =>
  import('@/tabs/sales-workspace/SalesWorkspaceAdminTabs').then((m) => ({
    default: m.SalesCallProgressTab,
  })),
);
const SalesSuburbWorkshopsTab = lazy(() =>
  import('@/tabs/sales-workspace/SalesWorkspaceAdminTabs').then((m) => ({
    default: m.SalesSuburbWorkshopsTab,
  })),
);
const AgentFollowUpsTab = lazy(() =>
  import('@/tabs/sales-workspace/SalesWorkspaceAgentTabs').then((m) => ({
    default: m.AgentFollowUpsTab,
  })),
);
const AgentMyCallListTab = lazy(() =>
  import('@/tabs/sales-workspace/SalesWorkspaceAgentTabs').then((m) => ({
    default: m.AgentMyCallListTab,
  })),
);
const AgentSalesHomeTab = lazy(() =>
  import('@/tabs/sales-workspace/SalesWorkspaceAgentTabs').then((m) => ({
    default: m.AgentSalesHomeTab,
  })),
);
const AgentCompletedTab = lazy(() =>
  import('@/tabs/sales-workspace/SalesWorkspaceAgentTabs').then((m) => ({
    default: m.AgentCompletedTab,
  })),
);

import { fetchClients, createClient, advanceClientStage } from '@/services/dashboardApi';
import { fetchCallCenterChats, fetchConversations } from '@/services/chatApi';
import {
  BLUE_SUPPORT_CHAT_ENABLED,
  resolveSupportChatAccess,
  type QueueKind,
} from '@/lib/queueKind';
import {
  fetchMyShiftSchedule,
  getTodayShiftQueueId,
} from '@/services/attendanceApi';
import { fetchSmsUnreadCount, subscribeToSmsUpdates } from '@/services/smsApi';
import {
  fetchAllLeaveRequests,
  subscribeToAllLeaveRequestChanges,
  fetchMyLeaveRequests,
  subscribeToMyLeaveRequests,
} from '@/services/leaveRequestsApi';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SoftphoneCallLogContext } from '@/services/linkusCallLog';
import { cacheAgentSession } from '@/services/linkusCallLog';
import { prefetchDashboardNavTab } from '@/lib/dashboardPrefetch';

interface DashboardPageProps {
  session: UserSession;
  permissions: Permissions;
  onSignOut: () => Promise<void>;
}

function AgentAttendanceShell({
  enabled,
  now,
  children,
}: {
  enabled: boolean;
  now: number;
  children: ReactNode;
}) {
  if (enabled) {
    return <AgentAttendanceTodayProvider now={now}>{children}</AgentAttendanceTodayProvider>;
  }
  return <>{children}</>;
}

function TabSuspenseFallback() {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-border/60 bg-white text-sm text-muted-foreground">
      Loading tab…
    </div>
  );
}

export default function DashboardPage({ session, permissions, onSignOut }: DashboardPageProps) {
  const d = useDashboard();
  const queryClient = useQueryClient();
  const setDashboardTab = d.setSelectedTab;
  const { formattedDate: clockDate, formattedTime: clockTime } = useLiveClock();
  const [clients, setClients] = useState<TenantOnboarding[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!permissions.canViewClientsTab) return;
    if (d.selectedTab !== 'clients') return;
    if (!d.selectedTenant) return;
    fetchClients(d.selectedTenant).then(setClients).catch(() => {});
  }, [d.selectedTenant, d.selectedTab, permissions.canViewClientsTab]);

  const handlePrefetchTab = useCallback(
    (tabKey: string) => {
      const tenantId = (session.tenantId || d.selectedTenant || d.tenants[0]?.id) ?? null;
      prefetchDashboardNavTab(queryClient, {
        tenantId,
        callDate: d.callDate,
        tabKey,
        isAgent: session.role === 'agent',
      });
    },
    [queryClient, session.tenantId, session.role, d.selectedTenant, d.tenants, d.callDate],
  );

  useEffect(() => {
    if (session?.role === 'agent') {
      sessionStorage.removeItem('agent_booking_expiry');
    }
  }, [session?.role]);

  // If the current tab becomes unavailable due to role changes, fall back safely.
  useEffect(() => {
    const isAllowed = (key: string) => {
      if (key === 'overview') return permissions.canViewOverviewTab;
      if (key === 'calls') return permissions.canViewCallsTab;
      if (key === 'bookings') return permissions.canViewBookingsTab;
      if (key === 'agents' || key === 'agent-performance') return permissions.canViewAgentsTab;
      if (key === 'chat') return permissions.canViewChatTab;
      if (key === 'sms') return permissions.canViewSmsTab;
      if (key === 'agent-onboarding') return permissions.canViewAgentOnboardingTab;
      if (key === 'sip') return permissions.canViewSipTab;
      if (key === 'clients') return permissions.canViewClientsTab;
      if (key === 'did-mappings') return permissions.canManageDIDMappings;
      if (key === 'audit-logs') return permissions.canViewAuditLogs;
      if (key === 'attendance' || key === 'leave-requests' || key === 'shift-schedule') return permissions.canViewAttendanceTab;
      if (
        key === 'sales-suburbs' ||
        key === 'sales-workshops' ||
        key === 'sales-progress'
      ) {
        return permissions.canViewSalesAdminSuite;
      }
      if (
        key === 'agent-sales-home' ||
        key === 'agent-my-calls' ||
        key === 'agent-followups' ||
        key === 'agent-completed'
      ) {
        return permissions.canViewSalesAgentSuite;
      }
      return false;
    };

    if (!isAllowed(d.selectedTab)) {
      setDashboardTab('overview');
    }
  }, [d.selectedTab, setDashboardTab, permissions]);

  const handleSelectTab = useCallback((tab: string) => {
    if (tab === 'bookings') {
      navigate('/bookings/dashboard');
      return;
    }
    setDashboardTab(tab);
  }, [setDashboardTab, navigate]);

  const handleCreateClient = useCallback(async (data: NewClientForm) => {
    if (!session) return;
    await createClient(data, session);
    const updated = await fetchClients(d.selectedTenant);
    setClients(updated);
  }, [session, d.selectedTenant]);

  const handleAdvanceStage = useCallback(async (clientId: string) => {
    if (!session) return;
    await advanceClientStage(clientId, session);
    const updated = await fetchClients(d.selectedTenant);
    setClients(updated);
  }, [session, d.selectedTenant]);


  /** BMS chat list needs a tenant scope; super-admins often have no row in the switcher — fall back like softphone context. */
  const effectiveChatTenantId = useMemo(
    () =>
      session.role === 'agent'
        ? (session.tenantId ?? d.selectedTenant ?? null)
        : (d.selectedTenant ?? session.tenantId ?? d.tenants[0]?.id ?? null),
    [d.selectedTenant, session.role, session.tenantId, d.tenants],
  );

  const chatWorkshopOwnerUid = useMemo(() => {
    const tid = effectiveChatTenantId;
    if (!tid) return null;
    const ou = d.tenants.find((t) => t.id === tid)?.bmsOwnerUid?.trim();
    return ou || null;
  }, [effectiveChatTenantId, d.tenants]);

  /**
   * Match `useDashboardData` tenant (`session.tenantId || selectedTenant`) so CRM
   * pickers align with agents already fetched. Fallback: first tenant (super-admin).
   */
  const effectiveSalesTenantId =
    session.tenantId || d.selectedTenant || d.tenants[0]?.id || null;
  const selectedSalesTenantId = session.tenantId || d.selectedTenant || null;

  const currentAgentDbId = useMemo(
    () => {
      const byUserId = d.agents.find((a) => a.userId === session.userId);
      if (byUserId?.id) return byUserId.id;

      const email = session.authEmail?.trim().toLowerCase();
      if (email) {
        const byEmail = d.agents.find((a) => a.email?.trim().toLowerCase() === email);
        if (byEmail?.id) return byEmail.id;
      }

      const displayName = session.displayName?.trim().toLowerCase();
      if (displayName) {
        const byName = d.agents.find((a) => a.name?.trim().toLowerCase() === displayName);
        if (byName?.id) return byName.id;
      }

      return null;
    },
    [d.agents, session.userId, session.authEmail, session.displayName],
  );

  const currentAgent = useMemo(
    () => (currentAgentDbId ? d.agents.find((a) => a.id === currentAgentDbId) ?? null : null),
    [currentAgentDbId, d.agents],
  );

  /** Today's shift-board queue for agents (same source as Overview). */
  const [todayShiftQueueId, setTodayShiftQueueId] = useState<string | null>(null);

  useEffect(() => {
    if (session.role !== 'agent') {
      setTodayShiftQueueId(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const matchingAgentIds = d.agents
          .filter((agent) => agent.userId === session.userId)
          .map((agent) => agent.id);
        if (currentAgentDbId && !matchingAgentIds.includes(currentAgentDbId)) {
          matchingAgentIds.push(currentAgentDbId);
        }

        const schedule = await fetchMyShiftSchedule({
          userId: session.userId,
          candidateIds: matchingAgentIds,
        });
        if (cancelled) return;
        setTodayShiftQueueId(getTodayShiftQueueId(schedule));
      } catch (err) {
        console.warn('[DashboardPage] failed to load today shift queue for chat', err);
        if (!cancelled) setTodayShiftQueueId(null);
      }
    };

    void load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session.role, session.userId, currentAgentDbId, d.agents]);

  const agentChatQueueIds = useMemo(() => {
    if (session.role !== 'agent') {
      return currentAgent?.queueIds?.length
        ? currentAgent.queueIds
        : session.allowedQueueIds;
    }
    // Match Overview / shift board: today's assigned queue drives access.
    if (todayShiftQueueId) return [todayShiftQueueId];
    return [];
  }, [
    session.role,
    session.allowedQueueIds,
    currentAgent?.queueIds,
    todayShiftQueueId,
  ]);

  const supportChatAccess = useMemo(
    () =>
      resolveSupportChatAccess({
        role: session.role,
        queues: d.queues,
        assignedQueueIds: agentChatQueueIds,
      }),
    [session.role, d.queues, agentChatQueueIds],
  );

  const [chatNavUnreadCount, setChatNavUnreadCount] = useState(0);
  const [smsNavUnreadCount, setSmsNavUnreadCount] = useState(0);
  const [internalChatUnreadCount, setInternalChatUnreadCount] = useState(0);
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);

  useEffect(() => {
    if (!permissions.canViewChatTab) return;
    if (d.selectedTab === 'chat') return;

    const products: QueueKind[] = [];
    if (supportChatAccess.canViewBlack) products.push('black');
    if (supportChatAccess.canViewBlue && BLUE_SUPPORT_CHAT_ENABLED) products.push('blue');
    if (products.length === 0) {
      setChatNavUnreadCount(0);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const results = await Promise.all(
          products.map(async (product) => {
            const [supportChats, callCenterChats] = await Promise.all([
              effectiveChatTenantId
                ? fetchConversations({
                    tenantId: effectiveChatTenantId,
                    ownerUid: chatWorkshopOwnerUid,
                    product,
                  }).catch(() => ({ queue: [], mine: [] }))
                : Promise.resolve({ queue: [], mine: [] }),
              fetchCallCenterChats(50, product).catch(() => []),
            ]);
            const supportRows = [...supportChats.queue, ...supportChats.mine];
            const supportIds = new Set(supportRows.map((c) => c.conversationId));
            return [
              ...supportRows,
              ...callCenterChats.filter((c) => !supportIds.has(c.conversationId)),
            ];
          }),
        );
        if (!cancelled) {
          const unreadCount = results
            .flat()
            .reduce((sum, c) => sum + (Number(c.unreadForAgent) || 0), 0);
          setChatNavUnreadCount(unreadCount);
        }
      } catch {
        /* ignore */
      }
    };

    void run();
    const id = setInterval(run, 120_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    permissions.canViewChatTab,
    d.selectedTab,
    effectiveChatTenantId,
    chatWorkshopOwnerUid,
    supportChatAccess.canViewBlack,
    supportChatAccess.canViewBlue,
  ]);

  useEffect(() => {
    if (!permissions.canViewSmsTab) return;

    let cancelled = false;
    const run = async () => {
      try {
        const count = await fetchSmsUnreadCount();
        if (!cancelled) setSmsNavUnreadCount(count);
      } catch {
        /* ignore */
      }
    };

    void run();
    const interval = setInterval(run, d.selectedTab === 'sms' ? 30_000 : 120_000);
    const unsubscribe = subscribeToSmsUpdates(() => {
      void run();
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [permissions.canViewSmsTab, d.selectedTab]);

  // Handle Internal Chat unread count (keep polling + listener while Chat tab is open so
  // sidebar badge clears after reading; InternalChatTab dispatches `internal-chat-read`.)
  useEffect(() => {
    if (!permissions.canViewInternalChat) return;

    let cancelled = false;
    const fetchUnread = async () => {
      try {
        const { fetchInternalUnreadCount, fetchGlobalInternalUnreadCount } = await import('@/services/chatApi');
        
        let count = 0;
        if (session.role === 'super-admin' && !currentAgentDbId) {
          count = await fetchGlobalInternalUnreadCount();
        } else if (currentAgentDbId) {
          count = await fetchInternalUnreadCount(currentAgentDbId);
        } else if (session.role === 'agent') {
          count = await fetchInternalUnreadCount(session.userId);
        }
        
        if (!cancelled) setInternalChatUnreadCount(count);
      } catch { /* ignore */ }
    };

    fetchUnread();
    const pollMs = d.selectedTab === 'chat' ? 30_000 : 90_000;
    const id = setInterval(fetchUnread, pollMs);

    const handleReadEvent = () => fetchUnread();
    window.addEventListener('internal-chat-read', handleReadEvent);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('internal-chat-read', handleReadEvent);
    };
  }, [permissions.canViewInternalChat, currentAgentDbId, session.role, session.userId, d.selectedTab]);

  useEffect(() => {
    if (session.role !== 'super-admin') return;

    let cancelled = false;
    const loadLeaves = async () => {
      try {
        const rows = await fetchAllLeaveRequests();
        if (cancelled) return;

        const ccUserIds = new Set(
          d.agents
            .filter((a) => !String(a.bmsOwnerUid ?? '').trim() && a.userId && a.userId.length >= 36)
            .map((a) => a.userId)
        );

        const pending = rows.filter((r) => r.status === 'pending' && ccUserIds.has(r.user_id)).length;
        setPendingLeaveCount(pending);
      } catch {
        /* ignore */
      }
    };

    void loadLeaves();

    const debounceMs = 4000;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (reloadTimer) return;
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void loadLeaves();
      }, debounceMs);
    };

    const unsub = subscribeToAllLeaveRequestChanges(() => {
      scheduleReload();
    });

    return () => {
      cancelled = true;
      if (reloadTimer) clearTimeout(reloadTimer);
      unsub();
    };
  }, [session.role, d.agents]);

  // For agents: Show a notification badge if a leave request was reviewed (approved/rejected)
  // since the last time they viewed the leave-requests tab.
  useEffect(() => {
    if (session.role !== 'agent' || !session.userId) return;

    let cancelled = false;
    const LOCAL_STORAGE_KEY = 'last_seen_leave_reviews_at';

    const loadAgentLeaves = async () => {
      try {
        const rows = await fetchMyLeaveRequests(session.userId);
        if (cancelled) return;

        if (d.selectedTab === 'leave-requests') {
          localStorage.setItem(LOCAL_STORAGE_KEY, Date.now().toString());
          setPendingLeaveCount(0);
          return;
        }

        const lastSeenStr = localStorage.getItem(LOCAL_STORAGE_KEY);
        const lastSeenMs = lastSeenStr ? parseInt(lastSeenStr, 10) : 0;

        const unseenCount = rows.filter((r) => {
          if (r.status === 'pending') return false;
          if (!r.reviewed_at) return false;
          return new Date(r.reviewed_at).getTime() > lastSeenMs;
        }).length;

        setPendingLeaveCount(unseenCount);
      } catch {
        /* ignore */
      }
    };

    void loadAgentLeaves();

    const unsub = subscribeToMyLeaveRequests(session.userId, () => {
      void loadAgentLeaves();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [session.role, session.userId, d.selectedTab]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-950">

      {/* Sidebar */}
      <DashboardSidebar
        selectedTab={d.selectedTab}
        onSelect={handleSelectTab}
        onPrefetchTab={handlePrefetchTab}
        permissions={permissions}
        displayName={session.displayName}
        currentRole={session.role}
        onSignOut={onSignOut}
        chatNavUnreadCount={chatNavUnreadCount + internalChatUnreadCount}
        smsNavUnreadCount={smsNavUnreadCount}
        pendingLeaveCount={pendingLeaveCount}
      />

      {/* Main content */}
      <AgentAttendanceShell enabled={session.role === 'agent' && permissions.canViewShiftPanel} now={d.now}>
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Top header */}
          <DashboardHeader
            connectionStatus={d.connectionStatus}
            clockDate={clockDate}
            clockTime={clockTime}
            attendanceSlot={
              permissions.canViewShiftPanel && session.role === 'agent' ? (
                <AgentNavAttendanceActions session={session} />
              ) : undefined
            }
          />

        {/* Tab content: chat fills height and scrolls internally; other tabs scroll the main area */}
        <main
          className={
            d.selectedTab === 'chat' || d.selectedTab === 'internal-chat' || d.selectedTab === 'sms'
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-6 sm:px-6 lg:px-8'
              : 'min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8'
          }
        >
          {d.error && (
            <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {d.error}
              </span>
              <Button variant="outline" size="sm" onClick={d.refresh} className="border-rose-200 bg-white text-rose-700 hover:bg-rose-100">
                Retry
              </Button>
            </div>
          )}

          {d.loading ? (
            <LoadingSkeleton />
          ) : (
            <>
              {d.selectedTab === 'overview' && (
                <OverviewTab
                  summary={d.summary}
                  queues={d.queues}
                  agents={d.agents}
                  calls={d.calls}
                  tenants={d.tenants}
                  permissions={permissions}
                  now={d.now}
                  session={session}
                  agentGroups={d.agentGroups}
                  incomingCalls={d.incomingCalls}
                  incomingCallsForQueueCards={d.incomingCallsWithQueueLinger}
                  queueIncomingLingerEndedAt={d.queueIncomingLingerEndedAt}
                  callDate={d.callDate}
                />
              )}
              <Suspense fallback={<TabSuspenseFallback />}>
              {(d.selectedTab === 'attendance' || d.selectedTab === 'leave-requests' || d.selectedTab === 'shift-schedule') && (
                <AttendanceTab
                  session={session}
                  permissions={permissions}
                  agents={d.agents}
                  queues={d.queues}
                  tenants={d.tenants}
                  now={d.now}
                  section={
                    d.selectedTab === 'leave-requests' 
                      ? 'leave' 
                      : d.selectedTab === 'shift-schedule'
                      ? 'shift-schedule'
                      : 'shifts'
                  }
                />
              )}
              {d.selectedTab === 'agents' && (
                <AgentsTab
                  agents={d.agents}
                  queues={d.queues}
                  tenants={d.tenants}
                  permissions={permissions}
                  now={d.now}
                  onRefresh={d.refresh}
                />
              )}
              {d.selectedTab === 'agent-performance' && (
                <AgentPerformanceTab
                  agents={d.agents}
                  calls={d.calls}
                  queues={d.queues}
                  tenants={d.tenants}
                  tenantId={effectiveSalesTenantId}
                />
              )}
              {d.selectedTab === 'agent-onboarding' && (
                <AgentOnboardingTab
                  agentOnboarding={d.agentOnboarding}
                  tenants={d.tenants}
                  permissions={permissions}
                  onRefresh={d.refresh}
                />
              )}
              {d.selectedTab === 'chat' && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <ChatTab
                    session={session}
                    permissions={permissions}
                    listTenantId={effectiveChatTenantId}
                    workshopOwnerUid={chatWorkshopOwnerUid}
                    onInboxStatsChange={({ unreadCount }) =>
                      setChatNavUnreadCount(unreadCount)
                    }
                    internalUnreadCount={internalChatUnreadCount}
                    canViewBlackChat={supportChatAccess.canViewBlack}
                    canViewBlueChat={supportChatAccess.canViewBlue}
                  />
                </div>
              )}
              {d.selectedTab === 'sms' && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <SmsTab
                    session={session}
                    currentAgentDbId={currentAgentDbId}
                    onInboxStatsChange={({ unreadCount }) => setSmsNavUnreadCount(unreadCount)}
                  />
                </div>
              )}
              {d.selectedTab === 'calls' && (
                <CallsTab
                  calls={d.calls}
                  queues={d.queues}
                  tenants={d.tenants}
                  agents={d.agents}
                  session={session}
                  permissions={permissions}
                  callDate={d.callDate}
                  onDateChange={d.setCallDate}
                />
              )}
              {/* {d.selectedTab === 'bookings' && (
                <BookingsTab
                  tenantId={d.selectedTenant}
                  permissions={permissions}
                />
              )} */}
              {d.selectedTab === 'sip' && (
                <SipLinesTab
                  sipLines={d.sipLines}
                  tenants={d.tenants}
                  permissions={permissions}
                  now={d.now}
                />
              )}
              {d.selectedTab === 'clients' && (
                <ClientsTab
                  clients={clients}
                  permissions={permissions}
                  onCreateClient={handleCreateClient}
                  onAdvanceStage={handleAdvanceStage}
                />
              )}
              {d.selectedTab === 'did-mappings' && (
                <DIDMappingsTab permissions={permissions} />
              )}
              {d.selectedTab === 'audit-logs' && (
                <AuditLogsTab />
              )}
              {d.selectedTab === 'sales-suburbs' && (
                <SalesAgentSuburbAssignmentTab
                  tenantId={effectiveSalesTenantId}
                  tenants={d.tenants}
                  agents={d.agents}
                  queues={d.queues}
                  permissions={permissions}
                  session={session}
                  onRefreshDashboard={d.refresh}
                />
              )}
              {d.selectedTab === 'sales-workshops' && (
                <SalesSuburbWorkshopsTab
                  tenantId={selectedSalesTenantId}
                  tenants={d.tenants}
                  agents={d.agents}
                  queues={d.queues}
                  permissions={permissions}
                  session={session}
                  onRefreshDashboard={d.refresh}
                />
              )}
              {d.selectedTab === 'sales-progress' && (
                <SalesCallProgressTab
                  tenantId={effectiveSalesTenantId}
                  tenants={d.tenants}
                  agents={d.agents}
                  queues={d.queues}
                  permissions={permissions}
                  session={session}
                  onRefreshDashboard={d.refresh}
                />
              )}
              {d.selectedTab === 'agent-sales-home' && (
                <AgentSalesHomeTab
                  tenants={d.tenants}
                  agents={d.agents}
                  permissions={permissions}
                  session={session}
                  currentAgentDbId={currentAgentDbId}
                  onRefreshDashboard={d.refresh}
                />
              )}
              {d.selectedTab === 'agent-my-calls' && (
                <AgentMyCallListTab
                  tenants={d.tenants}
                  agents={d.agents}
                  permissions={permissions}
                  session={session}
                  currentAgentDbId={currentAgentDbId}
                  onRefreshDashboard={d.refresh}
                />
              )}
              {d.selectedTab === 'agent-followups' && (
                <AgentFollowUpsTab
                  tenants={d.tenants}
                  agents={d.agents}
                  permissions={permissions}
                  session={session}
                  currentAgentDbId={currentAgentDbId}
                  onRefreshDashboard={d.refresh}
                />
              )}
              {d.selectedTab === 'agent-completed' && (
                <AgentCompletedTab
                  tenants={d.tenants}
                  agents={d.agents}
                  permissions={permissions}
                  session={session}
                  currentAgentDbId={currentAgentDbId}
                  onRefreshDashboard={d.refresh}
                />
              )}
              </Suspense>
            </>
          )}
        </main>
        </div>
      </AgentAttendanceShell>
    </div>
  );
}
