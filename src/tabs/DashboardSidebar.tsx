import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlarmClock,
  Building2,
  BookOpen,
  CalendarClock,
  CalendarOff,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderKanban,
  Home,
  LayoutDashboard,
  ListTodo,
  LogOut,
  MapPin,
  MessageSquare,
  Phone,
  PhoneForwarded,
  Radio,
  Target,
  Users,
  UserPlus,
  History,
  CalendarDays,
} from 'lucide-react';
import type { Permissions, UserRole } from '@/services/types';

interface DashboardSidebarProps {
  selectedTab: string;
  onSelect: (tab: string) => void;
  /** Best-effort React Query prefetch when hovering a nav destination (desktop). */
  onPrefetchTab?: (tab: string) => void;
  permissions: Permissions;
  displayName: string;
  currentRole: UserRole;
  onSignOut: () => Promise<void>;
  /** Unread BMS chat threads (agent inbox) — shows a green indicator on the Chat nav item. */
  chatNavUnreadCount?: number;
  /** Pending leave requests count for super admins — shows an indicator on the Leave requests nav item. */
  pendingLeaveCount?: number;
}

type Perm = keyof Permissions;

type SidebarLeaf = { kind: 'item'; key: string; label: string; icon: LucideIcon; perm: Perm };

type SidebarGroup = {
  kind: 'group';
  label: string;
  icon: LucideIcon;
  perm: Perm;
  items: { key: string; label: string; icon: LucideIcon }[];
};

type SidebarEntry = SidebarLeaf | SidebarGroup;

const NAV_ITEMS: SidebarEntry[] = [
  { kind: 'item', key: 'overview', label: 'Overview', icon: LayoutDashboard, perm: 'canViewOverviewTab' },
  {
    kind: 'group',
    label: 'Attendance',
    icon: Clock,
    perm: 'canViewAttendanceTab',
    items: [
      { key: 'attendance', label: 'Time tracking', icon: CalendarClock },
      { key: 'leave-requests', label: 'Leave requests', icon: CalendarOff },
      { key: 'shift-schedule', label: 'Shift schedule', icon: CalendarDays },
    ],
  },
  {
    kind: 'group',
    label: 'Agents & Performance',
    icon: Users,
    perm: 'canViewAgentsTab',
    items: [
      { key: 'agents', label: 'Directory', icon: Users },
      { key: 'agent-performance', label: 'Performance', icon: Activity },
    ],
  },
  { kind: 'item', key: 'agent-onboarding', label: 'Agent Onboarding', icon: UserPlus, perm: 'canViewAgentOnboardingTab' },
  { kind: 'item', key: 'chat', label: 'Chat', icon: MessageSquare, perm: 'canViewChatTab' },
  { kind: 'item', key: 'calls', label: 'Calls', icon: Phone, perm: 'canViewCallsTab' },
  { kind: 'item', key: 'sip', label: 'SIP Lines', icon: Radio, perm: 'canViewSipTab' },
  { kind: 'item', key: 'clients', label: 'Clients', icon: BookOpen, perm: 'canViewClientsTab' },
  {
    kind: 'group',
    label: 'Sales (admin)',
    icon: Target,
    perm: 'canViewSalesAdminSuite',
    items: [
      { key: 'sales-suburbs', label: 'Agent suburb assignment', icon: MapPin },
      { key: 'sales-workshops', label: 'Suburb workshops', icon: Building2 },
      { key: 'sales-progress', label: 'Call progress tracker', icon: Activity },
    ],
  },
  {
    kind: 'group',
    label: 'My sales workspace',
    icon: FolderKanban,
    perm: 'canViewSalesAgentSuite',
    items: [
      { key: 'agent-sales-home', label: 'Agent home', icon: Home },
      { key: 'agent-my-calls', label: 'My call list', icon: ListTodo },
      { key: 'agent-followups', label: 'My follow-ups', icon: AlarmClock },
      { key: 'agent-completed', label: 'Completed', icon: CheckCheck },
    ],
  },
  { kind: 'item', key: 'did-mappings', label: 'DID Mappings', icon: PhoneForwarded, perm: 'canManageDIDMappings' },
  { kind: 'item', key: 'audit-logs', label: 'Audit Logs', icon: History, perm: 'canViewAuditLogs' },
];

export default function DashboardSidebar({
  selectedTab,
  onSelect,
  onPrefetchTab,
  permissions,
  displayName,
  currentRole,
  onSignOut,
  chatNavUnreadCount = 0,
  pendingLeaveCount = 0,
}: DashboardSidebarProps) {
  const [open, setOpen] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set<string>());

  useEffect(() => {
    for (const entry of NAV_ITEMS) {
      if (entry.kind === 'group' && entry.items.some((i) => i.key === selectedTab)) {
        setExpandedGroups((prev) => {
          if (prev.has(entry.label)) return prev;
          const next = new Set(prev);
          next.add(entry.label);
          return next;
        });
        break;
      }
    }
  }, [selectedTab]);

  const visibleNav = NAV_ITEMS.filter((entry) => permissions[entry.perm]);

  return (
    <nav className="hidden md:flex md:w-64 md:h-full bg-neutral-900 flex-col flex-shrink-0">
      <div className="p-6 border-b border-neutral-800">
        <h1 className="font-bold text-base text-white">Command Center</h1>
      </div>

      <div className="flex-1 p-4 space-y-1 overflow-y-auto">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => { if (e.key === 'Enter') setOpen((v) => !v); }}
          className="flex items-center space-x-3 px-4 py-3 rounded-xl text-sm transition cursor-pointer select-none text-neutral-400 hover:bg-neutral-800 hover:text-white"
        >
          <Activity className="h-5 w-5" />
          <span>Dashboard</span>
          <span className="ml-auto opacity-70">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        </div>

        {open && (
          <div className="space-y-0.5">
            {visibleNav.map((entry) => {
              if (entry.kind === 'item') {
                const { key, label, icon: Icon } = entry;
                const active = selectedTab === key;
                const chatUnread = key === 'chat' && chatNavUnreadCount > 0;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSelect(key)}
                    onMouseEnter={() => onPrefetchTab?.(key)}
                    className={`ml-3 w-[calc(100%-0.75rem)] flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                      active
                        ? 'bg-neutral-800 text-white'
                        : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                    }`}
                  >
                    <span className="relative shrink-0">
                      <Icon className="h-4 w-4" />
                      {chatUnread && (
                        <span
                          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.95)] ring-2 ring-neutral-900"
                          title={`${chatNavUnreadCount} unread`}
                          aria-hidden
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                    {chatUnread && (
                      <span
                        className="shrink-0 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-bold leading-none text-neutral-950"
                        aria-label={`${chatNavUnreadCount} unread chats`}
                      >
                        {chatNavUnreadCount > 99 ? '99+' : chatNavUnreadCount}
                      </span>
                    )}
                  </button>
                );
              }

              const groupActive = entry.items.some((i) => i.key === selectedTab);
              const GroupIcon = entry.icon;
              return (
                <div key={entry.label} className="ml-3 w-[calc(100%-0.75rem)] space-y-0.5">
                  <button
                    type="button"
                    aria-expanded={expandedGroups.has(entry.label)}
                    onClick={() =>
                      setExpandedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(entry.label)) next.delete(entry.label);
                        else next.add(entry.label);
                        return next;
                      })
                    }
                    className={`flex w-full items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      groupActive
                        ? 'bg-neutral-800/90 text-white'
                        : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                    }`}
                  >
                    <GroupIcon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
                    <span className="shrink-0 opacity-70">
                      {expandedGroups.has(entry.label) ? (
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      )}
                    </span>
                  </button>
                  {expandedGroups.has(entry.label) && (
                    <div className="ml-1 space-y-0.5 border-l border-neutral-700 pl-2">
                      {entry.items.map((item) => {
                        const SubIcon = item.icon;
                        const active = selectedTab === item.key;
                        const isLeaveItem = item.key === 'leave-requests';
                        const showLeaveBadge = isLeaveItem && pendingLeaveCount > 0;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => onSelect(item.key)}
                            onMouseEnter={() => onPrefetchTab?.(item.key)}
                            className={`flex w-full items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                              active
                                ? 'bg-neutral-800 text-white'
                                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                            }`}
                          >
                            <span className="relative shrink-0">
                              <SubIcon className="h-4 w-4 shrink-0" />
                              {showLeaveBadge && (
                                <span
                                  className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.95)] ring-2 ring-neutral-900"
                                  title={`${pendingLeaveCount} pending`}
                                  aria-hidden
                                />
                              )}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                            {showLeaveBadge && (
                              <span
                                className="shrink-0 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold leading-none text-neutral-950"
                                aria-label={`${pendingLeaveCount} pending leaves`}
                              >
                                {pendingLeaveCount > 99 ? '99+' : pendingLeaveCount}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-neutral-800 space-y-2">
        <div className="flex items-center space-x-3 px-4 py-2">
          <div className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-white font-semibold text-xs shrink-0">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{displayName}</p>
            <p className="text-xs text-neutral-400 capitalize">{currentRole.replace('-', ' ')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-sm font-semibold transition border border-neutral-700"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </nav>
  );
}
