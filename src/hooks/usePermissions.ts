import { useMemo } from 'react';
import { derivePermissions } from '@/utils/permissions';
import type { UserSession, Permissions } from '@/services/types';

/** Derives permissions from the current session. Memoised. */
export function usePermissions(session: UserSession | null): Permissions {
  return useMemo(() => {
    if (!session) {
      return {
        canViewAllTenants: false,
        canSwitchTenant: false,
        canViewSipInfrastructure: false,
        canViewTenantNames: false,
        canViewCallsTab: false,
        canViewBookingsTab: false,
        canViewAgentsTab: false,
        canViewChatTab: false,
        canViewSmsTab: false,
        canViewOverviewTab: false,
        canViewSipTab: false,
        canViewClientsTab: false,
        canSignUpClients: false,
        canAdvanceOnboarding: false,
        canEditClientDetails: false,
        canApproveGoLive: false,
        canRegressStage: false,
        canViewShiftPanel: false,
        canViewAttendanceTab: false,
        canOnboardAgents: false,
        canViewAgentOnboarding: false,
        canViewAgentOnboardingTab: false,
        canViewAuditLogs: false,
        canViewCallRecordings: false,
        canManageAgents: false,
        canManageDIDMappings: false,
        allowedTenantId: null,
        allowedQueueIds: [],
      };
    }
    return derivePermissions(session);
  }, [session]);
}
