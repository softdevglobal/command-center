import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type UIEvent,
} from 'react';
import {
  ArrowLeft,
  Building2,
  Clock3,
  Loader2,
  MessageSquare,
  Search,
  Send,
  User,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  BLUE_SUPPORT_CHAT_ENABLED,
  defaultSupportChatProduct,
  type SupportChatAccess,
} from '@/lib/queueKind';
import type { Permissions, UserSession } from '@/services/types';
import {
  fetchConversations,
  fetchConversationMessages,
  fetchCallCenterChatMessages,
  fetchCallCenterChats,
  postConversationMessage,
  postCallCenterChatMessage,
  postConversationRead,
  postConversationClaim,
  postChatClose,
  postCallCenterChatClose,
  fetchWorkshopName,
  fetchWorkshopNames,
  fetchCallCenterWorkshopOwners,
  startCallCenterChatWithOwner,
  type CallCenterWorkshopOwner,
  type Conversation,
  type ChatMessage,
  type SupportChatProduct,
} from '@/services/chatApi';
import {
  isChatSoundMuted,
  playNewChatChime,
  playNewMessageChime,
  setChatSoundMuted,
} from '@/lib/chatNotificationSounds';
import {
  logSystemActivity,
  AUDIT_ACTION_CHAT_VIEWED,
  AUDIT_ACTION_CHAT_REPLY,
  AUDIT_RESOURCE_BMS_CHAT,
} from '@/services/auditLogApi';
import { InternalChatTab } from '@/tabs/InternalChatTab';
import { useDashboard } from '@/context/DashboardDataContext';

interface ChatTabProps {
  session: UserSession;
  permissions: Permissions;
  listTenantId?: string | null;
  workshopOwnerUid?: string | null;
  onInboxStatsChange?: (stats: { unreadCount: number }) => void;
  internalUnreadCount?: number;
  /** When omitted, both products are allowed (legacy / privileged). */
  canViewBlackChat?: boolean;
  canViewBlueChat?: boolean;
}

type ChatView = SupportChatProduct | 'internal';

/** Sent automatically when opening a workshop thread from the picker (POST start-with-owner `text`). */
const WORKSHOP_AUTO_OPEN_MESSAGE =
  "Hello — we're contacting you from the call center. Please let us know how we can help.";

const AGENT_SENDER_ROLES = new Set([
  'agent',
  'call_center_agent',
  'call_center_admin',
  'super_admin',
]);

const CUSTOMER_SENDER_ROLES = new Set([
  'customer',
  'workshop_owner',
  'workshop',
  'branch_admin',
  'staff',
  'tenant',
]);

function formatDateTime(iso: string): string {
  if (!iso) return 'N/A';
  const parsed = parseBackendDateTime(iso);
  if (!parsed) return 'N/A';
  return parsed.toLocaleString();
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const parsed = parseBackendDateTime(iso);
  if (!parsed) return '';
  return parsed.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseBackendDateTime(value: string): Date | null {
  const msParsed = Date.parse(value);
  if (!Number.isNaN(msParsed)) {
    const d = new Date(msParsed);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    const adjusted = value.length <= 10 ? n * 1000 : n;
    const d = new Date(adjusted);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function isLastMessageFromCustomer(
  conv: Conversation,
  sessionUserId: string,
): boolean {
  const ls = conv.lastSender?.trim().toLowerCase();
  if (ls === 'customer') return true;
  if (ls === 'agent') return false;
  const aid = conv.agentId?.trim();
  if (aid && conv.lastMessage && sessionUserId.trim() !== aid) {
    return true;
  }
  return true;
}

export function ChatTab({
  session,
  permissions,
  listTenantId = null,
  workshopOwnerUid = null,
  onInboxStatsChange,
  internalUnreadCount = 0,
  canViewBlackChat = true,
  canViewBlueChat = true,
}: ChatTabProps) {
  const { pendingInternalChatAgentId } = useDashboard();

  const chatAccess = useMemo<SupportChatAccess>(
    () => ({
      canViewBlack: canViewBlackChat,
      canViewBlue: canViewBlueChat,
    }),
    [canViewBlackChat, canViewBlueChat],
  );

  const [chatView, setChatView] = useState<ChatView>(() => {
    return (
      defaultSupportChatProduct({
        canViewBlack: canViewBlackChat,
        canViewBlue: canViewBlueChat,
      }) ?? 'black'
    );
  });

  const supportProduct: SupportChatProduct =
    chatView === 'blue' ? 'blue' : 'black';
  const isInternalChat = chatView === 'internal';

  useEffect(() => {
    if (isInternalChat) return;
    const next = defaultSupportChatProduct(chatAccess);
    if (!next) return;
    setChatView((prev) => {
      if (prev === 'black' && chatAccess.canViewBlack) return prev;
      if (prev === 'blue' && chatAccess.canViewBlue && BLUE_SUPPORT_CHAT_ENABLED) return prev;
      if (prev === 'internal') return prev;
      return next;
    });
  }, [chatAccess, isInternalChat]);

  const [queue, setQueue] = useState<Conversation[]>([]);
  const [mine, setMine] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [startChatOpen, setStartChatOpen] = useState(false);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [owners, setOwners] = useState<CallCenterWorkshopOwner[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string>('');
  const [selectedOwnerUid, setSelectedOwnerUid] = useState<string>('');
  const [startingChat, setStartingChat] = useState(false);
  const [activeWorkshopOwner, setActiveWorkshopOwner] = useState<CallCenterWorkshopOwner | null>(
    null,
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [workshopName, setWorkshopName] = useState<string | null>(null);
  const [workshopNameMap, setWorkshopNameMap] = useState<Record<string, string>>({});

  const threadScrollRef = useRef<HTMLDivElement>(null);
  const messagesBottomRef = useRef<HTMLDivElement>(null);
  const workshopSelectTriggerRef = useRef<HTMLButtonElement>(null);
  const lastChatViewAuditRef = useRef<{ chatId: string; at: number } | null>(null);
  const shouldAutoScrollThreadRef = useRef(true);
  const lastAutoScrolledConversationRef = useRef<string | null>(null);
  const allRef = useRef<Conversation[]>([]);
  /** Until the new thread appears in `fetchConversations`, match workshop header from picker. */
  const pendingWorkshopOwnerUidRef = useRef<string | null>(null);
  /** Thread ids created via call-center `start-with-owner` — use call-center APIs, not support-chat. */
  const callCenterThreadIdsRef = useRef<Set<string>>(new Set());

  const [soundsMuted, setSoundsMuted] = useState(() => isChatSoundMuted());
  const skipInboxChimesRef = useRef(true);
  const prevInboxSnapshotRef = useRef<Map<string, string>>(new Map());
  const threadMessageSigRef = useRef<string>('');
  const skipThreadChimeRef = useRef(true);

  useEffect(() => {
    if (pendingInternalChatAgentId) {
      setChatView('internal');
    }
  }, [pendingInternalChatAgentId]);

  const chatListScope = useMemo(
    () => ({
      tenantId: listTenantId?.trim() || null,
      ownerUid: workshopOwnerUid?.trim() || null,
    }),
    [listTenantId, workshopOwnerUid],
  );

  const allConversations = useMemo(() => [...mine, ...queue], [mine, queue]);
  allRef.current = allConversations;

  const selectedConversation = useMemo(
    () => allConversations.find((c) => c.conversationId === selectedId) ?? null,
    [allConversations, selectedId],
  );

  const isMine = useMemo(
    () => mine.some((c) => c.conversationId === selectedId),
    [mine, selectedId],
  );

  const totalUnread = useMemo(
    () => allConversations.reduce((sum, c) => sum + c.unreadForAgent, 0),
    [allConversations],
  );

  const unreadByOwnerUid = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of allConversations) {
      const uid = c.ownerUid?.trim();
      if (!uid) continue;
      const n = Number(c.unreadForAgent) || 0;
      if (n <= 0) continue;
      map[uid] = (map[uid] ?? 0) + n;
    }
    return map;
  }, [allConversations]);

  useEffect(() => {
    onInboxStatsChange?.({ unreadCount: totalUnread });
  }, [totalUnread, onInboxStatsChange]);

  useEffect(() => {
    skipInboxChimesRef.current = true;
    prevInboxSnapshotRef.current = new Map();
  }, [chatListScope.tenantId, chatListScope.ownerUid, supportProduct]);

  const loadConversations = useCallback(async () => {
    if (
      (supportProduct === 'black' && !chatAccess.canViewBlack) ||
      (supportProduct === 'blue' &&
        (!chatAccess.canViewBlue || !BLUE_SUPPORT_CHAT_ENABLED))
    ) {
      setQueue([]);
      setMine([]);
      return;
    }

    const [data, ccChats] = await Promise.all([
      fetchConversations({
        tenantId: chatListScope.tenantId,
        ownerUid: chatListScope.ownerUid,
        product: supportProduct,
      }),
      fetchCallCenterChats(50, supportProduct).catch((err) => {
        console.warn('[ChatTab] fetchCallCenterChats failed', err);
        return [] as Conversation[];
      }),
    ]);

    for (const c of ccChats) {
      if (c.conversationId) callCenterThreadIdsRef.current.add(c.conversationId);
    }

    const supportIds = new Set([
      ...data.queue.map((c) => c.conversationId),
      ...data.mine.map((c) => c.conversationId),
    ]);
    const extraMine = ccChats.filter((c) => !supportIds.has(c.conversationId));
    const mergedMine = [...data.mine, ...extraMine].sort((a, b) => {
      const at = a.lastMessageAt || a.updatedAt || a.createdAt || '';
      const bt = b.lastMessageAt || b.updatedAt || b.createdAt || '';
      return bt.localeCompare(at);
    });

    setQueue(data.queue);
    setMine(mergedMine);

    const ownerUids = [...data.queue, ...mergedMine]
      .map((c) => c.ownerUid)
      .filter((uid): uid is string => !!uid);
    void fetchWorkshopNames(ownerUids).then(setWorkshopNameMap);
  }, [chatListScope, supportProduct, chatAccess.canViewBlack, chatAccess.canViewBlue]);

  const refreshThreadMessages = useCallback(
    async (conversationId: string) => {
      try {
        const rows = callCenterThreadIdsRef.current.has(conversationId)
          ? await fetchCallCenterChatMessages(conversationId, supportProduct)
          : await fetchConversationMessages(conversationId, supportProduct);
        setMessages(rows);
      } catch {
        /* keep existing */
      }
    },
    [supportProduct],
  );

  const switchQueueChat = useCallback(
    (next: SupportChatProduct) => {
      if (next === 'black' && !chatAccess.canViewBlack) return;
      if (next === 'blue' && (!chatAccess.canViewBlue || !BLUE_SUPPORT_CHAT_ENABLED)) return;
      setChatView((prev) => {
        if (prev === next) return prev;
        return next;
      });
    },
    [chatAccess.canViewBlack, chatAccess.canViewBlue],
  );

  useEffect(() => {
    if (isInternalChat) return;

    setSelectedId(null);
    setMessages([]);
    setQueue([]);
    setMine([]);
    setLoading(true);
    setError(null);
    setThreadError(null);
    setStartChatOpen(false);
    setOwners([]);
    setOwnersError(null);
    setSelectedOwnerUid('');
    setOwnerFilter('');
    callCenterThreadIdsRef.current = new Set();
    skipInboxChimesRef.current = true;
    prevInboxSnapshotRef.current = new Map();
  }, [supportProduct, isInternalChat]);

  useEffect(() => {
    if (isInternalChat) return;

    let cancelled = false;

    const run = async () => {
      try {
        setError(null);
        await loadConversations();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load conversations.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    const interval = setInterval(() => {
      void run();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadConversations, isInternalChat]);

  useEffect(() => {
    if (loading) return;

    const nextMap = new Map<string, string>();
    for (const c of allConversations) {
      nextMap.set(c.conversationId, c.lastMessageAt);
    }

    if (skipInboxChimesRef.current) {
      prevInboxSnapshotRef.current = nextMap;
      skipInboxChimesRef.current = false;
      return;
    }

    const prev = prevInboxSnapshotRef.current;
    let played = false;

    for (const c of allConversations) {
      if (played) break;
      const oldLast = prev.get(c.conversationId);
      if (oldLast === undefined) {
        void playNewChatChime();
        played = true;
        break;
      }
      if (oldLast !== c.lastMessageAt) {
        if (isLastMessageFromCustomer(c, session.userId)) {
          void playNewMessageChime();
          played = true;
        }
      }
    }

    prevInboxSnapshotRef.current = nextMap;
  }, [allConversations, loading, session.userId]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setThreadError(null);
      return;
    }

    let cancelled = false;

    const loadThread = async () => {
      setThreadLoading(true);
      setThreadError(null);
      try {
        if (callCenterThreadIdsRef.current.has(selectedId)) {
          const rows = await fetchCallCenterChatMessages(selectedId, supportProduct);
          if (cancelled) return;
          setMessages(rows);

          if (cancelled) return;

          const now = Date.now();
          const prevAudit = lastChatViewAuditRef.current;
          const skipDuplicate =
            prevAudit && prevAudit.chatId === selectedId && now - prevAudit.at < 2500;
          if (!skipDuplicate) {
            lastChatViewAuditRef.current = { chatId: selectedId, at: now };
            const meta = allRef.current.find((c) => c.conversationId === selectedId);
            void logSystemActivity(
              session,
              AUDIT_ACTION_CHAT_VIEWED,
              AUDIT_RESOURCE_BMS_CHAT,
              selectedId,
              {
                tenantName: meta?.userName ?? null,
                workshopDisplayName: null,
                readReceiptPosted: false,
                product: supportProduct,
              },
            ).catch(() => {});
          }

          if (!cancelled) void loadConversations();
          return;
        }

        const rows = await fetchConversationMessages(selectedId, supportProduct);
        if (cancelled) return;
        setMessages(rows);

        let readReceiptPosted = false;
        try {
          await postConversationRead(selectedId, supportProduct);
          readReceiptPosted = true;
        } catch {
          /* best-effort */
        }

        if (cancelled) return;

        const now = Date.now();
        const prevAudit = lastChatViewAuditRef.current;
        const skipDuplicate =
          prevAudit && prevAudit.chatId === selectedId && now - prevAudit.at < 2500;
        if (!skipDuplicate) {
          lastChatViewAuditRef.current = { chatId: selectedId, at: now };
          const meta = allRef.current.find((c) => c.conversationId === selectedId);
          void logSystemActivity(
            session,
            AUDIT_ACTION_CHAT_VIEWED,
            AUDIT_RESOURCE_BMS_CHAT,
            selectedId,
            {
              tenantName: meta?.userName ?? null,
              workshopDisplayName: null,
              readReceiptPosted,
              product: supportProduct,
            },
          ).catch(() => {});
        }

        if (!cancelled) void loadConversations();
      } catch (e) {
        if (!cancelled) {
          setThreadError(e instanceof Error ? e.message : 'Failed to load messages.');
          setMessages([]);
        }
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    };

    void loadThread();
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadConversations, session, supportProduct]);

  useEffect(() => {
    if (!selectedId) {
      pendingWorkshopOwnerUidRef.current = null;
      setWorkshopName(null);
      setActiveWorkshopOwner(null);
      return;
    }
    const conv = allConversations.find((c) => c.conversationId === selectedId);
    void fetchWorkshopName(conv?.ownerUid ?? null).then(setWorkshopName);
    const ouFromConv = conv?.ownerUid?.trim() || '';
    const ou = ouFromConv || pendingWorkshopOwnerUidRef.current || '';
    if (ou) {
      const owner = owners.find((o) => o.ownerUid === ou) ?? null;
      setActiveWorkshopOwner(owner);
      if (ouFromConv) pendingWorkshopOwnerUidRef.current = null;
    } else {
      setActiveWorkshopOwner(null);
    }
  }, [selectedId, allConversations, owners]);

  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    const interval = setInterval(() => {
      void refreshThreadMessages(id);
    }, 5_000);
    return () => clearInterval(interval);
  }, [selectedId, refreshThreadMessages]);

  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshThreadMessages(id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedId, refreshThreadMessages]);

  const sortedMessages = useMemo(
    () =>
      [...messages].sort((a, b) => {
        const ta = parseBackendDateTime(a.createdAt)?.getTime() ?? 0;
        const tb = parseBackendDateTime(b.createdAt)?.getTime() ?? 0;
        return ta !== tb ? ta - tb : (a.messageId || '').localeCompare(b.messageId || '');
      }),
    [messages],
  );

  const messageListSignature = useMemo(() => {
    const last = sortedMessages[sortedMessages.length - 1];
    return [
      selectedId ?? '',
      sortedMessages.length,
      last?.messageId?.trim() ?? '',
      last?.createdAt ?? '',
      last?.text ?? '',
    ].join('|');
  }, [selectedId, sortedMessages]);

  const handleThreadScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    shouldAutoScrollThreadRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= 96;
  }, []);

  useEffect(() => {
    shouldAutoScrollThreadRef.current = true;
    lastAutoScrolledConversationRef.current = null;
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;

    const isNewConversation = lastAutoScrolledConversationRef.current !== selectedId;
    if (isNewConversation) {
      shouldAutoScrollThreadRef.current = true;
      lastAutoScrolledConversationRef.current = selectedId;
    }

    if (!shouldAutoScrollThreadRef.current) return;

    messagesBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messageListSignature, selectedId]);

  const isAgentMessage = useCallback(
    (m: ChatMessage) => {
      const role = m.senderRole?.trim().toLowerCase() ?? '';
      if (role) {
        if (AGENT_SENDER_ROLES.has(role)) return true;
        if (CUSTOMER_SENDER_ROLES.has(role)) return false;
      }

      if (m.senderId === session.userId) return true;
      const aid = selectedConversation?.agentId?.trim();
      if (!!aid && m.senderId === aid) return true;

      const tenantUid =
        selectedConversation?.userId?.trim() ||
        selectedConversation?.ownerUid?.trim() ||
        activeWorkshopOwner?.ownerUid?.trim() ||
        pendingWorkshopOwnerUidRef.current?.trim() ||
        '';
      if (tenantUid && m.senderId === tenantUid) return false;

      if (
        selectedId &&
        callCenterThreadIdsRef.current.has(selectedId) &&
        tenantUid &&
        m.senderId &&
        m.senderId !== tenantUid
      ) {
        return true;
      }

      return false;
    },
    [
      session.userId,
      selectedConversation?.agentId,
      selectedConversation?.userId,
      selectedConversation?.ownerUid,
      activeWorkshopOwner?.ownerUid,
      selectedId,
    ],
  );

  useEffect(() => {
    skipThreadChimeRef.current = true;
    threadMessageSigRef.current = '';
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || threadLoading) return;

    const last = sortedMessages[sortedMessages.length - 1];
    const lastKey = last
      ? `${last.messageId?.trim() || ''}|${last.createdAt}|${last.text.slice(0, 32)}`
      : '';

    if (skipThreadChimeRef.current) {
      threadMessageSigRef.current = lastKey;
      skipThreadChimeRef.current = false;
      return;
    }

    if (!lastKey || lastKey === threadMessageSigRef.current) return;

    if (last && !isAgentMessage(last) && !soundsMuted) {
      void playNewMessageChime();
    }
    threadMessageSigRef.current = lastKey;
  }, [sortedMessages, selectedId, threadLoading, isAgentMessage, soundsMuted]);

  const handleSelectConversation = useCallback(
    async (conversationId: string) => {
      setSelectedId(conversationId);
      if (callCenterThreadIdsRef.current.has(conversationId)) {
        return;
      }
      const isInQueue = queue.some((c) => c.conversationId === conversationId);
      if (isInQueue) {
        setClaiming(true);
        try {
          await postConversationClaim(conversationId, supportProduct);
          await loadConversations();
        } catch {
          // console.warn('[ChatTab] claim failed', e);
        } finally {
          setClaiming(false);
        }
      }
    },
    [queue, loadConversations, supportProduct],
  );

  const openStartChat = useCallback(async () => {
    setStartChatOpen(true);
    setOwnersError(null);
    if (ownersLoading) return;

    setOwnersLoading(true);
    try {
      const rows = await fetchCallCenterWorkshopOwners(supportProduct);
      setOwners(rows);
    } catch (e) {
      setOwners([]);
      setOwnersError(e instanceof Error ? e.message : 'Failed to load workshop owners.');
    } finally {
      setOwnersLoading(false);
    }
  }, [ownersLoading, supportProduct]);

  const closeStartChat = useCallback(() => {
    setStartChatOpen(false);
    setOwnersError(null);
    setSelectedOwnerUid('');
    setOwnerFilter('');
  }, []);

  const filteredOwners = useMemo(() => {
    const q = ownerFilter.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((o) =>
      [o.name, o.slug, o.contactPhone, o.email, o.state]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [owners, ownerFilter]);

  const handleStartChat = useCallback(
    async (ownerUidOverride?: string) => {
      const ownerUid = (ownerUidOverride ?? selectedOwnerUid).trim();
      if (!ownerUid || startingChat) return;

      setStartingChat(true);
      setOwnersError(null);
      pendingWorkshopOwnerUidRef.current = ownerUid;
      try {
        const owner = owners.find((o) => o.ownerUid === ownerUid) ?? null;
        const started = await startCallCenterChatWithOwner(ownerUid, undefined, {
          product: supportProduct,
        });
        setActiveWorkshopOwner(owner);
        closeStartChat();

        if (started.chatId) {
          callCenterThreadIdsRef.current.add(started.chatId);

          /** Send welcome only when the thread has no real messages yet — covers both brand-new docs and ones created earlier without a first message. Re-opening an already-used chat must NOT spam the workshop. */
          let sendWelcome = started.created;
          if (!sendWelcome) {
            try {
              const existing = await fetchCallCenterChatMessages(started.chatId, supportProduct);
              sendWelcome = existing.length === 0;
            } catch {
              /* If we can't read messages, be safe and skip the welcome. */
              sendWelcome = false;
            }
          }

          if (sendWelcome) {
            try {
              await postCallCenterChatMessage(
                started.chatId,
                WORKSHOP_AUTO_OPEN_MESSAGE,
                supportProduct,
              );
            } catch (sendErr) {
              console.warn('[ChatTab] welcome message failed', sendErr);
            }
          }

          await loadConversations();
          await handleSelectConversation(started.chatId);
        } else {
          pendingWorkshopOwnerUidRef.current = null;
          await loadConversations();
        }
      } catch (e) {
        pendingWorkshopOwnerUidRef.current = null;
        setOwnersError(e instanceof Error ? e.message : 'Failed to open chat.');
      } finally {
        setStartingChat(false);
      }
    },
    [
      selectedOwnerUid,
      startingChat,
      closeStartChat,
      loadConversations,
      handleSelectConversation,
      owners,
      supportProduct,
    ],
  );

  const handleClose = async () => {
    if (!selectedId || closing) return;
    const isCallCenterThread = callCenterThreadIdsRef.current.has(selectedId);
    setClosing(true);
    try {
      if (isCallCenterThread) {
        await postCallCenterChatClose(selectedId, supportProduct);
        callCenterThreadIdsRef.current.delete(selectedId);
      } else {
        await postChatClose(selectedId, { product: supportProduct });
      }
      setSelectedId(null);
      await loadConversations();
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to close conversation.');
    } finally {
      setClosing(false);
    }
  };

  const handleSend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !selectedId || sending) return;

    setSending(true);
    setThreadError(null);
    try {
      const isCallCenterThread = callCenterThreadIdsRef.current.has(selectedId);
      const created = isCallCenterThread
        ? await postCallCenterChatMessage(selectedId, text, supportProduct)
        : await postConversationMessage(selectedId, text, supportProduct);
      shouldAutoScrollThreadRef.current = true;
      setDraft('');

      if (created) {
        const msg = {
          ...created,
          senderId: created.senderId?.trim() || session.userId,
          senderRole: created.senderRole?.trim() || 'agent',
        };

        setMessages((prev) => {
          const id = msg.messageId?.trim();
          if (id && prev.some((p) => p.messageId === id)) return prev;
          return [...prev, msg];
        });
      } else {
        const rows = isCallCenterThread
          ? await fetchCallCenterChatMessages(selectedId, supportProduct)
          : await fetchConversationMessages(selectedId, supportProduct);
        setMessages(rows);
      }

      void loadConversations();
      void refreshThreadMessages(selectedId);

      const replyId = created?.messageId?.trim() || null;
      void logSystemActivity(session, AUDIT_ACTION_CHAT_REPLY, AUDIT_RESOURCE_BMS_CHAT, selectedId, {
        messageId: replyId,
        textPreview: text.slice(0, 400),
        tenantName: selectedConversation?.userName ?? null,
        product: supportProduct,
      }).catch(() => {});
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  if (!permissions.canViewChatTab && session.role !== 'super-admin') {
    return (
      <Card className="border-border/80 bg-white shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          You do not have permission to view chats.
        </CardContent>
      </Card>
    );
  }

  const hasAnyQueueChat =
    chatAccess.canViewBlack || (chatAccess.canViewBlue && BLUE_SUPPORT_CHAT_ENABLED);
  const productLabel = supportProduct === 'blue' ? 'Blue' : 'Black';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-1 self-start rounded-2xl bg-slate-100 p-1">
        {chatAccess.canViewBlack && (
          <Button
            type="button"
            variant={chatView === 'black' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => switchQueueChat('black')}
            className={cn(
              'h-9 px-4 rounded-xl font-bold transition-all',
              chatView === 'black'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-900',
            )}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Black Chat
          </Button>
        )}
        {chatAccess.canViewBlue && (
          <span
            title={
              BLUE_SUPPORT_CHAT_ENABLED
                ? undefined
                : 'Blue Chat is disabled until the API is ready.'
            }
          >
            <Button
              type="button"
              variant={chatView === 'blue' ? 'secondary' : 'ghost'}
              size="sm"
              disabled={!BLUE_SUPPORT_CHAT_ENABLED}
              onClick={() => switchQueueChat('blue')}
              className={cn(
                'h-9 px-4 rounded-xl font-bold transition-all',
                chatView === 'blue'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900',
                !BLUE_SUPPORT_CHAT_ENABLED && 'pointer-events-none opacity-50',
              )}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Blue Chat
            </Button>
          </span>
        )}
        <Button
          type="button"
          variant={isInternalChat ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setChatView('internal')}
          className={cn(
            'h-9 px-4 rounded-xl font-bold transition-all',
            isInternalChat
              ? 'bg-white text-emerald-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-900',
          )}
        >
          <Users className="mr-2 h-4 w-4" />
          Internal Chat
          {internalUnreadCount > 0 && (
            <Badge className="ml-2 bg-emerald-500 text-white border-none h-5 min-w-[20px] px-1 flex items-center justify-center text-[10px] animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.4)]">
              {internalUnreadCount}
            </Badge>
          )}
        </Button>
      </div>

      {isInternalChat ? (
        <InternalChatTab session={session} permissions={permissions} />
      ) : !hasAnyQueueChat ? (
        <Card className="border-border/80 bg-white shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {chatAccess.canViewBlue && !BLUE_SUPPORT_CHAT_ENABLED
              ? 'Blue Chat is disabled until the API is ready.'
              : 'No chat queue is assigned to your agent profile. Ask a super admin to assign a Black or Blue queue in the Agents tab.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,360px)_1fr] lg:items-stretch">
          <Card
            className={cn(
              'flex min-h-0 flex-col overflow-hidden border-border/80 bg-white shadow-sm',
              selectedId && 'max-lg:hidden',
            )}
          >
            <CardHeader className="shrink-0 pb-3">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <MessageSquare
                    className={cn(
                      'h-4 w-4',
                      supportProduct === 'blue' ? 'text-blue-700' : 'text-sky-600',
                    )}
                  />
                  {productLabel} Chat Inbox
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 border-sky-200 bg-sky-50 px-2.5 text-xs text-sky-700 hover:bg-sky-100"
                    onClick={() => void openStartChat()}
                  >
                    Chat with owner
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-slate-900"
                    aria-label={soundsMuted ? 'Unmute new message sounds' : 'Mute new message sounds'}
                    title={soundsMuted ? 'Sounds off' : 'Sounds on'}
                    onClick={() => {
                      const next = !soundsMuted;
                      setChatSoundMuted(next);
                      setSoundsMuted(next);
                    }}
                  >
                    {soundsMuted ? (
                      <VolumeX className="h-4 w-4" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                  </Button>
                  <Badge
                    variant="outline"
                    className={cn(
                      'tabular-nums',
                      totalUnread > 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-sky-200 bg-sky-50 text-sky-700',
                    )}
                  >
                    {totalUnread} unread
                  </Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
              {startChatOpen && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-700">Open workshop chat</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-500 hover:text-slate-900"
                      onClick={closeStartChat}
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {ownersError && (
                    <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
                      {ownersError}
                    </div>
                  )}

                  <div className="grid gap-2">
                    <div className="flex gap-2">
                      <Input
                        value={ownerFilter}
                        onChange={(ev) => setOwnerFilter(ev.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            workshopSelectTriggerRef.current?.click();
                          }
                        }}
                        placeholder="Filter workshops…"
                        className="h-9 min-w-0 flex-1 bg-white text-sm"
                        disabled={ownersLoading || startingChat}
                        autoComplete="off"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 bg-white"
                        disabled={ownersLoading || startingChat}
                        aria-label="Search workshops"
                        onClick={() => workshopSelectTriggerRef.current?.click()}
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    </div>

                    <Select
                      value={selectedOwnerUid}
                      onValueChange={(uid) => {
                        setSelectedOwnerUid(uid);
                        void handleStartChat(uid);
                      }}
                      disabled={ownersLoading || startingChat}
                    >
                      <SelectTrigger
                        ref={workshopSelectTriggerRef}
                        className="h-9 bg-white text-sm"
                      >
                        <SelectValue
                          placeholder={
                            ownersLoading
                              ? 'Loading workshops…'
                              : startingChat
                                ? 'Opening…'
                                : 'Select workshop'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredOwners.map((o) => {
                          const unread = unreadByOwnerUid[o.ownerUid] ?? 0;
                          return (
                            <SelectItem key={o.ownerUid} value={o.ownerUid}>
                              <div className="flex items-center gap-2">
                                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                                  {o.logoUrl?.trim() ? (
                                    <img
                                      src={o.logoUrl}
                                      alt={`${o.name} logo`}
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                      referrerPolicy="no-referrer"
                                      onError={(ev) => {
                                        const img = ev.currentTarget;
                                        img.style.display = 'none';
                                      }}
                                    />
                                  ) : null}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span
                                      className={cn(
                                        'truncate text-sm leading-5 text-slate-900',
                                        unread > 0 ? 'font-bold' : 'font-semibold',
                                      )}
                                    >
                                      {o.name}
                                    </span>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      {unread > 0 ? (
                                        <Badge className="h-4 min-w-[1rem] justify-center bg-amber-500 px-1 text-[10px] leading-4 text-white">
                                          {unread > 99 ? '99+' : unread}
                                        </Badge>
                                      ) : null}
                                      {o.state ? (
                                        <span className="text-[10px] font-semibold text-slate-500">
                                          {o.state}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>

                    <div className="flex items-center justify-end gap-2">
                      <Button type="button" variant="ghost" className="h-8" onClick={closeStartChat}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading conversations…
                </div>
              ) : error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              ) : allConversations.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No conversations found.
                </div>
              ) : (
                <>
                  {queue.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Queue
                      </p>
                      {queue.map((c) => (
                        <ConversationRow
                          key={c.conversationId}
                          conversation={c}
                          workshopName={c.ownerUid ? (workshopNameMap[c.ownerUid] ?? null) : null}
                          selected={selectedId === c.conversationId}
                          onSelect={() => void handleSelectConversation(c.conversationId)}
                        />
                      ))}
                    </div>
                  )}
                  {mine.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Mine
                      </p>
                      {mine.map((c) => (
                        <ConversationRow
                          key={c.conversationId}
                          conversation={c}
                          workshopName={c.ownerUid ? (workshopNameMap[c.ownerUid] ?? null) : null}
                          selected={selectedId === c.conversationId}
                          onSelect={() => void handleSelectConversation(c.conversationId)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card
            className={cn(
              'flex min-h-0 flex-1 flex-col overflow-hidden border-border/80 bg-white shadow-sm',
              !selectedId && 'max-lg:hidden',
            )}
          >
            {!selectedId ? (
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center py-16 text-center text-sm text-muted-foreground">
                <MessageSquare className="mb-2 h-10 w-10 text-slate-300" />
                Select a conversation to view messages and reply.
              </CardContent>
            ) : (
              <>
                <CardHeader className="shrink-0 space-y-0 border-b border-slate-100 pb-3">
                  <div className="flex items-start gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-0.5 shrink-0 lg:hidden"
                      onClick={() => setSelectedId(null)}
                      aria-label="Back to inbox"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    {activeWorkshopOwner?.logoUrl?.trim() ? (
                      <div className="mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                        <img
                          src={activeWorkshopOwner.logoUrl}
                          alt={`${activeWorkshopOwner.name} logo`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(ev) => {
                            const img = ev.currentTarget;
                            img.style.display = 'none';
                          }}
                        />
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate text-base">
                        {activeWorkshopOwner?.name || selectedConversation?.userName || 'Chat'}
                      </CardTitle>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {activeWorkshopOwner ? (
                          <>
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {activeWorkshopOwner.slug}
                            </span>
                            {activeWorkshopOwner.email && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {activeWorkshopOwner.email}
                              </span>
                            )}
                            {activeWorkshopOwner.contactPhone && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {activeWorkshopOwner.contactPhone}
                              </span>
                            )}
                            {(activeWorkshopOwner.state || activeWorkshopOwner.timezone) && (
                              <span className="flex items-center gap-1">
                                <Clock3 className="h-3 w-3" />
                                {[activeWorkshopOwner.state, activeWorkshopOwner.timezone]
                                  .filter(Boolean)
                                  .join(' • ')}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {selectedConversation?.userName || '—'}
                          </span>
                        )}
                        {workshopName && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {workshopName}
                          </span>
                        )}

                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            selectedConversation?.status === 'waiting'
                              ? 'border-amber-200 bg-amber-50 text-amber-700'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                          )}
                        >
                          {activeWorkshopOwner?.accountStatus || selectedConversation?.status || '—'}
                        </Badge>
                        {!isMine && (
                          <Badge variant="outline" className="border-slate-200 text-[10px] text-slate-500">
                            Queue
                          </Badge>
                        )}
                        {claiming && (
                          <Badge className="flex items-center gap-1 border-sky-200 bg-sky-100 text-[10px] text-sky-700">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Claiming conversation…
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-0 px-4 pb-4 pt-3">
                  {threadError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {threadError}
                    </div>
                  )}

                  <div
                    ref={threadScrollRef}
                    onScroll={handleThreadScroll}
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-lg border border-slate-100 bg-slate-50/50 p-3"
                  >
                    {threadLoading ? (
                      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading messages…
                      </div>
                    ) : sortedMessages.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
                        No messages yet.
                      </div>
                    ) : (
                      <ul className="space-y-3">
                        {sortedMessages.map((m, idx) => {
                          const mineMsg = isAgentMessage(m);
                          return (
                            <li
                              key={m.messageId?.trim() || `msg-${idx}-${m.createdAt}`}
                              className={cn('flex', mineMsg ? 'justify-end' : 'justify-start')}
                            >
                              <div
                                className={cn(
                                  'max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                                  mineMsg
                                    ? 'rounded-br-md bg-sky-600 text-white'
                                    : 'rounded-bl-md border border-slate-200 bg-white text-slate-800',
                                )}
                              >
                                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                                <div
                                  className={cn(
                                    'mt-1 flex items-center gap-1 text-[10px]',
                                    mineMsg ? 'text-sky-100' : 'text-slate-400',
                                  )}
                                >
                                  <Clock3 className="h-3 w-3" />
                                  {formatTime(m.createdAt) || 'Just now'}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div ref={messagesBottomRef} />
                  </div>

                  <form
                    onSubmit={(e) => void handleSend(e)}
                    className="flex shrink-0 gap-2 border-t border-slate-100 pt-2"
                  >
                    <Input
                      value={draft}
                      onChange={(ev) => setDraft(ev.target.value)}
                      placeholder="Type a message…"
                      disabled={sending || threadLoading || claiming}
                      className="flex-1"
                      autoComplete="off"
                    />
                    <Button
                      type="submit"
                      disabled={sending || threadLoading || claiming || !draft.trim()}
                      className="shrink-0 gap-1.5 bg-sky-600 hover:bg-sky-700"
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline">Send</span>
                    </Button>
                    <Button
                      type="button"
                      disabled={closing || sending || claiming}
                      onClick={() => void handleClose()}
                      className="shrink-0 gap-1.5 bg-rose-600 text-white hover:bg-rose-700"
                    >
                      {closing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline">Close</span>
                    </Button>
                  </form>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

interface ConversationRowProps {
  conversation: Conversation;
  workshopName: string | null;
  selected: boolean;
  onSelect: () => void;
}

function ConversationRow({ conversation: c, workshopName, selected, onSelect }: ConversationRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border p-3 text-left shadow-sm transition-colors',
        selected
          ? 'border-sky-400 bg-sky-50/80 ring-1 ring-sky-200/60'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80',
        c.unreadForAgent > 0 && !selected && 'border-l-4 border-l-emerald-500 pl-2.5',
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {c.unreadForAgent > 0 && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.85)]"
              aria-hidden
            />
          )}
          <span className="truncate text-sm font-semibold text-slate-900">
            {c.userName || c.userEmail || 'Unknown user'}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {c.role && (
            <Badge variant="outline" className="border-slate-200 text-[10px] text-slate-500">
              {c.role}
            </Badge>
          )}
          {c.claimedAt && c.status !== 'closed' && (
            <Badge className="border border-sky-200 bg-sky-100 text-[10px] text-sky-700">
              Claimed
            </Badge>
          )}
          {(c.status === 'closed' || c.closedAt) && (
            <Badge className="bg-rose-600 text-[10px] text-white">Closed</Badge>
          )}
          {c.unreadForAgent > 0 && (
            <Badge className="bg-amber-500 text-white">{c.unreadForAgent}</Badge>
          )}
        </div>
      </div>
      {workshopName && (
        <p className="mb-0.5 flex items-center gap-1 text-[11px] text-slate-500">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{workshopName}</span>
        </p>
      )}
      <p className="line-clamp-2 text-xs text-slate-600">{c.lastMessage || 'No messages yet.'}</p>
      <span className="mt-1 block text-[10px] text-slate-400">{formatDateTime(c.lastMessageAt)}</span>
    </button>
  );
}
