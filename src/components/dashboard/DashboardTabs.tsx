import type { Permissions, TabDef } from '@/services/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface DashboardTabsProps {
  tabs: TabDef[];
  selectedTab: string;
  onSelect: (key: string) => void;
  permissions: Permissions;
}

/** Filter and render tabs based on role permissions */
export function DashboardTabs({ tabs, selectedTab, onSelect, permissions }: DashboardTabsProps) {
  const visibleTabs = tabs.filter((t) => {
    if (t.key === 'overview') return permissions.canViewOverviewTab;
    if (t.key === 'agents') return permissions.canViewAgentsTab;
    if (t.key === 'chat') return permissions.canViewChatTab;
    if (t.key === 'sms') return permissions.canViewSmsTab;
    if (t.key === 'calls') return permissions.canViewCallsTab;
    if (t.key === 'bookings') return permissions.canViewBookingsTab;
    if (t.key === 'sip') return permissions.canViewSipTab;
    if (t.key === 'clients') return permissions.canViewClientsTab;
    if (t.key === 'attendance' || t.key === 'leave-requests') return permissions.canViewAttendanceTab;
    return false;
  });

  return (
    <div className="border-b border-border/70 bg-slate-50/80">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <Tabs value={selectedTab} onValueChange={onSelect}>
          <TabsList className="h-auto flex-wrap justify-start gap-2 rounded-2xl bg-white p-1 shadow-sm">
            {visibleTabs.map((t) => (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className="rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 data-[state=active]:text-slate-950"
              >
                <span className="mr-2 text-sm">{t.icon}</span>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
