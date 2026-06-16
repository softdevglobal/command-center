/**
 * Shared limits & tab→data mapping for dashboard React Query + hover prefetch.
 */

export const CALLS_LIMIT_OVERVIEW = 280;
export const CALLS_LIMIT_FULL = 500;

const TABS_NEED_QUEUES = new Set([
  'overview',
  'calls',
  'agents',
  'sales-suburbs',
  'sales-workshops',
  'sales-progress',
  'agent-sales-home',
  'agent-my-calls',
  'agent-completed',
]);

const TABS_NEED_CALLS = new Set(['overview', 'calls', 'agent-performance']);

const TABS_NEED_AGENT_GROUPS = new Set(['overview']);

const TABS_NEED_SIP = new Set(['sip']);

const TABS_NEED_AGENT_ONBOARDING = new Set<string>();

export function callsFetchLimitForTab(tab: string): number {
  if (tab === 'calls' || tab === 'agent-performance') return CALLS_LIMIT_FULL;
  if (tab === 'overview') return CALLS_LIMIT_OVERVIEW;
  return CALLS_LIMIT_FULL;
}

export function tabNeedsQueues(tab: string): boolean {
  return TABS_NEED_QUEUES.has(tab);
}

export function tabNeedsCalls(tab: string): boolean {
  return TABS_NEED_CALLS.has(tab);
}

export function tabNeedsAgentGroups(tab: string): boolean {
  return TABS_NEED_AGENT_GROUPS.has(tab);
}

export function tabNeedsSip(tab: string, isAgent: boolean): boolean {
  return TABS_NEED_SIP.has(tab) && !isAgent;
}

export function tabNeedsAgentOnboarding(tab: string, isAgent: boolean): boolean {
  return TABS_NEED_AGENT_ONBOARDING.has(tab) && !isAgent;
}
