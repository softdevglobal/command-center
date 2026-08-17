import type { AgentOnboardingStage } from '@/services/types';
import { StageBadge } from './StageBadge';

const STAGE_CONFIG: Record<AgentOnboardingStage, { label: string; color: string }> = {
  'invited':          { label: 'Invited',         color: 'var(--cc-color-cyan)' },
  'account-created':  { label: 'Account Created', color: '#3b82f6' },
  'training':         { label: 'Training',        color: 'var(--cc-color-amber)' },
  'shadowing':        { label: 'Shadowing',       color: 'var(--cc-color-purple)' },
  'live':             { label: 'Live',            color: 'var(--cc-color-green)' },
};

interface Props {
  stage: AgentOnboardingStage;
}

export function AgentOnboardingStageBadge({ stage }: Props) {
  const cfg = STAGE_CONFIG[stage];
  return <StageBadge label={cfg.label} color={cfg.color} live={stage === 'live'} />;
}
