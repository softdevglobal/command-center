import type { Queue, UserRole } from '@/services/types';

/** BMS product line / call-queue family used by Support Chat and call routing. */
export type QueueKind = 'black' | 'blue';

/**
 * Blue support / call-center chat is wired in the dashboard, but `/api/bms-blue`
 * is not on the backend yet. Keep the UI (disabled) and flip this to `true`
 * when those routes exist.
 */
export const BLUE_SUPPORT_CHAT_ENABLED = false;

export type SupportChatAccess = {
  canViewBlack: boolean;
  canViewBlue: boolean;
};

function hasQueueToken(value: string | null | undefined, token: string): boolean {
  const normalized = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return false;
  return normalized.split(/\s+/).includes(token);
}

/** Blue if id/name/type contains a `blue` token; otherwise Black (matches call-detail routing). */
export function detectQueueKind(input: {
  id?: string | null;
  name?: string | null;
  type?: string | null;
}): QueueKind {
  const values = [input.id, input.name, input.type];
  return values.some((value) => hasQueueToken(value, 'blue')) ? 'blue' : 'black';
}

export function isQueueKind(
  queue: Pick<Queue, 'id' | 'name' | 'type'>,
  kind: QueueKind,
): boolean {
  return detectQueueKind(queue) === kind;
}

/**
 * Super-admin / client-admin / supervisor → both chat products.
 * Agents → product lines for their effective assigned queues
 * (today’s shift-schedule queue when set).
 */
export function resolveSupportChatAccess(opts: {
  role: UserRole;
  queues: Array<Pick<Queue, 'id' | 'name' | 'type'>>;
  assignedQueueIds: string[];
}): SupportChatAccess {
  const { role, queues, assignedQueueIds } = opts;

  if (role === 'super-admin' || role === 'client-admin' || role === 'supervisor') {
    return { canViewBlack: true, canViewBlue: true };
  }

  const assigned = new Set(assignedQueueIds.map(String).filter(Boolean));
  const queueById = new Map(queues.map((q) => [q.id, q]));
  const assignedQueues = [...assigned].map(
    (id) => queueById.get(id) ?? { id, name: id, type: '' },
  );

  if (assignedQueues.length === 0) {
    return { canViewBlack: false, canViewBlue: false };
  }

  return {
    canViewBlack: assignedQueues.some((q) => detectQueueKind(q) === 'black'),
    canViewBlue: assignedQueues.some((q) => detectQueueKind(q) === 'blue'),
  };
}

export function defaultSupportChatProduct(access: SupportChatAccess): QueueKind | null {
  if (access.canViewBlack) return 'black';
  if (BLUE_SUPPORT_CHAT_ENABLED && access.canViewBlue) return 'blue';
  return null;
}
