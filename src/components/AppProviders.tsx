import { type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { DashboardDataProvider } from '@/context/DashboardDataContext';
import { CallNotificationProvider } from '@/context/CallNotificationContext';
import { GlobalCallMonitor } from '@/components/dashboard/GlobalCallMonitor';

import { GlobalSoftphone } from './dashboard/GlobalSoftphone';

export function AppProviders({ children }: { children?: ReactNode }) {
  const { session } = useAuth();

  if (!session) return null;

  return (
    <DashboardDataProvider session={session}>
      <CallNotificationProvider>
        <GlobalCallMonitor />
        <GlobalSoftphone session={session} />
        {children ?? <Outlet />}
      </CallNotificationProvider>
    </DashboardDataProvider>
  );
}
