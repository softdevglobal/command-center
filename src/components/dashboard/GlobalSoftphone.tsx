import { useMemo, useEffect } from 'react';
import { useDashboard } from '@/context/DashboardDataContext';
import { SoftphoneWidget } from '@/components/dashboard/SoftphoneWidget';
import { UserSession } from '@/services/types';
import { cacheAgentSession, SoftphoneCallLogContext } from '@/services/linkusCallLog';

interface GlobalSoftphoneProps {
  session: UserSession;
}

export function GlobalSoftphone({ session }: GlobalSoftphoneProps) {
  const d = useDashboard();

  const adminExtEmail = (import.meta.env.VITE_YEASTAR_ADMIN_EMAIL as string | undefined)?.trim();

  const softphoneEmail = useMemo(() => {
    if (session.role === 'agent') {
      const currentAgent = d.agents.find((a) => a.userId === session.userId);
      const fromRoster = (currentAgent?.email ?? '').trim();
      const fromSession = (session.authEmail ?? '').trim();
      return fromRoster || fromSession || null;
    } else if (session.role === 'super-admin') {
      return adminExtEmail || session.authEmail || null;
    }
    return null;
  }, [session, d.agents, adminExtEmail]);

  const softphoneCallLogContext = useMemo((): SoftphoneCallLogContext | null => {
    if (!softphoneEmail) return null;
    const tid = session.tenantId ?? d.selectedTenant ?? d.tenants[0]?.id ?? null;
    if (!tid) return null;
    
    const tenant = d.tenants.find((t) => t.id === tid);
    const agent = d.agents.find((a) => a.userId === session.userId);
    const qid = agent?.queueIds?.[0] ?? 'unknown';
    const queue = d.queues.find((q) => q.id === qid);
    
    return {
      tenantId: tid,
      tenantName: tenant?.name ?? tid,
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? session.displayName,
      queueId: qid,
      queueName: queue?.name ?? 'Queue',
    };
  }, [softphoneEmail, session, d.selectedTenant, d.tenants, d.agents]);

  useEffect(() => {
    if (softphoneCallLogContext?.agentId) {
      cacheAgentSession({
        agentId: softphoneCallLogContext.agentId,
        agentName: softphoneCallLogContext.agentName,
        tenantId: softphoneCallLogContext.tenantId,
        tenantName: softphoneCallLogContext.tenantName,
        queueId: softphoneCallLogContext.queueId,
        queueName: softphoneCallLogContext.queueName,
      });
    }
  }, [softphoneCallLogContext]);

  const softphoneIdentityExtension = useMemo(() => {
    const agent = d.agents.find((a) => a.userId === session.userId);
    if (agent?.extension) return agent.extension.trim();
    
    if (!softphoneEmail) return null;
    const byEmail = d.agents.find(
      (a) => (a.email ?? '').trim().toLowerCase() === softphoneEmail.trim().toLowerCase()
    );
    return byEmail?.extension?.trim() || null;
  }, [session.userId, softphoneEmail, d.agents]);

  const softphoneVisibleRange = useMemo(() => {
    if (!softphoneEmail) return null;
    const numeric = (softphoneIdentityExtension ?? '').replace(/\D/g, '');
    const n = Number.parseInt(numeric, 10);
    if (!Number.isFinite(n) || n < 0) return null;
    const min = Math.floor(n / 1000) * 1000;
    return { min, max: min + 999 };
  }, [softphoneEmail, softphoneIdentityExtension]);

  if (!softphoneEmail) return null;

  return (
    <SoftphoneWidget
      agentEmail={softphoneEmail}
      callLogContext={softphoneCallLogContext}
      visibleExtensionRange={softphoneVisibleRange}
    />
  );
}
