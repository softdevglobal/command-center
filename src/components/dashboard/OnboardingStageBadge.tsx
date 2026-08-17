import type { OnboardingStage } from '@/services/types';
import { StageBadge } from './StageBadge';

const STAGE_CONFIG: Record<OnboardingStage, { label: string; color: string }> = {
  'new':                  { label: 'New',                color: 'var(--cc-color-cyan)' },
  'contacted':            { label: 'Contacted',          color: '#3b82f6' },
  'discovery-complete':   { label: 'Discovery',          color: 'var(--cc-color-purple)' },
  'tenant-created':       { label: 'Tenant Created',     color: 'var(--cc-color-amber)' },
  'queue-setup-complete': { label: 'Queues Ready',       color: 'var(--cc-color-orange)' },
  'script-setup-complete':{ label: 'Scripts Ready',      color: 'var(--cc-color-slate)' },
  'testing':              { label: 'Testing',            color: '#8b5cf6' },
  'awaiting-approval':    { label: 'Awaiting Approval',  color: '#f59e0b' },
  'live':                 { label: 'Live',               color: 'var(--cc-color-green)' },
  'needs-revision':       { label: 'Needs Revision',     color: '#ef4444' },
};

interface Props {
  stage: OnboardingStage;
}

export function OnboardingStageBadge({ stage }: Props) {
  const cfg = STAGE_CONFIG[stage];
  return <StageBadge label={cfg.label} color={cfg.color} live={stage === 'live'} />;
}
