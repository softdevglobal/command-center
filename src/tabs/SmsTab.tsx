import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from 'react';
import {
  ArrowLeft,
  Building2,
  Clock3,
  Inbox,
  Loader2,
  MessageSquareText,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  fetchCallCenterWorkshopOwners,
  type CallCenterWorkshopOwner,
} from '@/services/chatApi';
import type { UserSession } from '@/services/types';
import {
  claimSmsThread,
  createSmsContact,
  deleteSmsContact,
  deleteSmsThread,
  fetchSmsContacts,
  fetchSmsInbox,
  fetchSmsMessages,
  enrichSmsThreadsWithContacts,
  findSmsContactByPhone,
  normalizeSmsPhone,
  normalizeSmsPhoneDigits,
  resolveCustomerNameForPhone,
  resolveSmsThread,
  sendSmsMessage,
  startSmsThread,
  subscribeToSmsUpdates,
  type SmsContact,
  type SmsMessage,
  type SmsQueue,
  type SmsThread,
} from '@/services/smsApi';

type SmsSection = 'owners' | 'customers';

interface SmsTabProps {
  session: UserSession;
  currentAgentDbId?: string | null;
  onInboxStatsChange?: (stats: { unreadCount: number }) => void;
}

function formatTime(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDateTime(value: string): string {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString();
}

function initials(label: string): string {
  const clean = label.replace(/\s+/g, '');
  if (clean.length >= 2) return clean.slice(0, 2).toUpperCase();
  const digits = label.replace(/\D/g, '');
  return digits.slice(-2) || 'SM';
}

function isInbound(message: SmsMessage): boolean {
  return message.direction === 'INBOUND';
}

function normalizeAgentKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-all text-sm font-medium text-slate-900">{value.trim() || '—'}</p>
    </div>
  );
}

type ThreadDisplay = {
  title: string;
  subtitle: string;
};

function SmsThreadRow({
  thread,
  display,
  selected,
  onSelect,
  onDelete,
  deleting,
}: {
  thread: SmsThread;
  display: ThreadDisplay;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div
      className={cn(
        'flex w-full items-start gap-1 rounded-xl border p-3 transition',
        selected
          ? 'border-sky-300 bg-sky-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
          {initials(display.title)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">{display.title}</p>
            {thread.unreadForAgent > 0 ? (
              <Badge className="bg-emerald-500 text-[10px] text-white">
                {thread.unreadForAgent > 99 ? '99+' : thread.unreadForAgent}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-slate-600">{display.subtitle}</p>
          <p className="mt-1 line-clamp-2 text-xs text-slate-500">
            {thread.lastMessageBody || 'No messages yet.'}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>{thread.queueName}</span>
            <span>{formatTime(thread.lastMessageAt)}</span>
          </div>
        </div>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-slate-400 hover:text-rose-600"
        aria-label="Delete conversation"
        disabled={deleting}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function SmsContactList({
  title,
  contacts,
  loading,
  emptyLabel,
  onUse,
  onDelete,
  deletingId,
}: {
  title: string;
  contacts: SmsContact[];
  loading: boolean;
  emptyLabel: string;
  onUse: (contact: SmsContact) => void;
  onDelete: (contact: SmsContact) => void;
  deletingId: string | null;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading contacts…
        </div>
      ) : contacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="max-h-36 space-y-1.5 overflow-y-auto">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex items-center gap-1 rounded-lg border border-slate-100 px-2 py-1.5"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onUse(contact)}
              >
                <p className="truncate text-xs font-semibold text-slate-900">{contact.displayName}</p>
                <p className="truncate text-[11px] text-slate-500">{contact.phone}</p>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-slate-400 hover:text-rose-600"
                aria-label={`Delete ${contact.displayName}`}
                disabled={deletingId === contact.id}
                onClick={() => onDelete(contact)}
              >
                {deletingId === contact.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SmsTab({ session, currentAgentDbId = null, onInboxStatsChange }: SmsTabProps) {
  const [section, setSection] = useState<SmsSection>('customers');
  const [queues, setQueues] = useState<SmsQueue[]>([]);
  const [threads, setThreads] = useState<SmsThread[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState<string>('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerMessage, setCustomerMessage] = useState('');
  const [customerContacts, setCustomerContacts] = useState<SmsContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [owners, setOwners] = useState<CallCenterWorkshopOwner[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [selectedOwnerUid, setSelectedOwnerUid] = useState('');
  const [ownerPhoneOverride, setOwnerPhoneOverride] = useState('');
  const [ownerMessage, setOwnerMessage] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollThreadRef = useRef(true);
  const lastAutoScrolledThreadRef = useRef<string | null>(null);

  const myAgentIds = useMemo(
    () =>
      new Set(
        [session.userId, currentAgentDbId, session.authEmail]
          .map(normalizeAgentKey)
          .filter(Boolean),
      ),
    [session.userId, currentAgentDbId, session.authEmail],
  );
  const myAgentNames = useMemo(
    () =>
      new Set(
        [session.displayName, session.authEmail]
          .map(normalizeAgentKey)
          .filter(Boolean),
      ),
    [session.displayName, session.authEmail],
  );
  const isSuperAdmin = session.role === 'super-admin';

  const isAssignedToCurrentAgent = useCallback(
    (thread: SmsThread) => {
      const assignedId = normalizeAgentKey(thread.assignedAgentId);
      const assignedName = normalizeAgentKey(thread.assignedAgentName);
      return (
        (!!assignedId && myAgentIds.has(assignedId)) ||
        (!!assignedName && myAgentNames.has(assignedName))
      );
    },
    [myAgentIds, myAgentNames],
  );

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );

  const selectedOwner = useMemo(
    () => owners.find((owner) => owner.ownerUid === selectedOwnerUid) ?? null,
    [owners, selectedOwnerUid],
  );

  const ownerForThread = useMemo(() => {
    if (!selectedThread) return null;
    const threadDigits = normalizeSmsPhoneDigits(selectedThread.customerPhone);
    if (!threadDigits) return null;
    return (
      owners.find((owner) => normalizeSmsPhoneDigits(owner.contactPhone) === threadDigits) ??
      null
    );
  }, [selectedThread, owners]);

  const ownerContactPhone =
    selectedOwner?.contactPhone?.trim() || ownerPhoneOverride.trim() || '';

  const ownerPhoneDigitsSet = useMemo(() => {
    const set = new Set<string>();
    for (const owner of owners) {
      const digits = normalizeSmsPhoneDigits(owner.contactPhone);
      if (digits) set.add(digits);
    }
    return set;
  }, [owners]);

  const isOwnerThread = useCallback(
    (thread: SmsThread) => {
      const digits = normalizeSmsPhoneDigits(thread.customerPhone);
      if (!digits) return false;
      if (ownerPhoneDigitsSet.has(digits)) return true;
      const owner = owners.find(
        (o) => normalizeSmsPhoneDigits(o.contactPhone) === digits,
      );
      return Boolean(owner);
    },
    [ownerPhoneDigitsSet, owners],
  );

  const threadDisplayFor = useCallback(
    (thread: SmsThread, forOwners: boolean): ThreadDisplay => {
      const digits = normalizeSmsPhoneDigits(thread.customerPhone);
      const phone = thread.customerPhone || '—';

      if (forOwners) {
        const apiOwner = owners.find(
          (o) => normalizeSmsPhoneDigits(o.contactPhone) === digits,
        );
        const workshopName =
          apiOwner?.name?.trim() || thread.customerName?.trim();
        const title = workshopName || phone;
        return { title, subtitle: phone };
      }

      const title =
        resolveCustomerNameForPhone(thread.customerPhone, customerContacts, thread.customerName) ||
        phone;
      return { title, subtitle: phone };
    },
    [owners, customerContacts],
  );

  const filteredOwners = useMemo(() => {
    const q = ownerFilter.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((o) =>
      [o.name, o.slug, o.contactPhone, o.email, o.state]
        .filter(Boolean)
        .some((part) => part.toLowerCase().includes(q)),
    );
  }, [owners, ownerFilter]);

  const mineThreads = useMemo(
    () =>
      threads.filter((thread) => {
        if (isSuperAdmin) return thread.status !== 'QUEUED';
        return isAssignedToCurrentAgent(thread);
      }),
    [threads, isSuperAdmin, isAssignedToCurrentAgent],
  );

  const queueThreads = useMemo(
    () =>
      threads.filter(
        (thread) => thread.status === 'QUEUED' && (!selectedQueueId || thread.queueId === selectedQueueId),
      ),
    [threads, selectedQueueId],
  );

  const canReply = Boolean(
    selectedThread &&
      selectedThread.status !== 'QUEUED' &&
      (isSuperAdmin || isAssignedToCurrentAgent(selectedThread)),
  );

  const sectionQueueThreads = useMemo(
    () =>
      queueThreads.filter((thread) =>
        section === 'owners' ? isOwnerThread(thread) : !isOwnerThread(thread),
      ),
    [queueThreads, section, isOwnerThread],
  );

  const sectionMineThreads = useMemo(
    () =>
      mineThreads.filter((thread) =>
        section === 'owners' ? isOwnerThread(thread) : !isOwnerThread(thread),
      ),
    [mineThreads, section, isOwnerThread],
  );

  const hiddenInOtherSectionCount = useMemo(() => {
    const inSection = (thread: SmsThread) =>
      section === 'owners' ? isOwnerThread(thread) : !isOwnerThread(thread);
    return threads.filter((thread) => !inSection(thread)).length;
  }, [threads, section, isOwnerThread]);

  const selectedThreadDisplay = useMemo(
    () => (selectedThread ? threadDisplayFor(selectedThread, section === 'owners') : null),
    [selectedThread, threadDisplayFor, section],
  );

  const messageListSignature = useMemo(() => {
    const first = messages[0];
    const last = messages[messages.length - 1];
    return [
      selectedThreadId ?? '',
      messages.length,
      first?.id ?? '',
      first?.createdAt ?? '',
      last?.id ?? '',
      last?.createdAt ?? '',
      last?.messageBody ?? '',
    ].join('|');
  }, [messages, selectedThreadId]);

  const loadOwners = useCallback(async () => {
    setOwnersLoading(true);
    setOwnersError(null);
    try {
      setOwners(await fetchCallCenterWorkshopOwners());
    } catch (err) {
      setOwnersError(err instanceof Error ? err.message : 'Failed to load workshop owners.');
    } finally {
      setOwnersLoading(false);
    }
  }, []);

  const loadCustomerContacts = useCallback(async () => {
    setContactsLoading(true);
    try {
      const { contacts: rows } = await fetchSmsContacts({ contactType: 'customer', limit: 200 });
      setCustomerContacts(rows);
      setThreads((prev) => enrichSmsThreadsWithContacts(prev, rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contact list.');
    } finally {
      setContactsLoading(false);
    }
  }, []);

  const loadInbox = useCallback(async () => {
    const [inbox, contactResult] = await Promise.all([
      fetchSmsInbox(),
      fetchSmsContacts({ contactType: 'customer', limit: 200 }).catch(() => ({
        contacts: [] as SmsContact[],
        total: 0,
        limit: 200,
        offset: 0,
      })),
    ]);
    setCustomerContacts(contactResult.contacts);
    setQueues(inbox.queues);
    setThreads(enrichSmsThreadsWithContacts(inbox.threads, contactResult.contacts));
    onInboxStatsChange?.({ unreadCount: inbox.unreadCount });
    setSelectedQueueId((prev) => prev || inbox.queues[0]?.id || '');
  }, [onInboxStatsChange]);

  const loadSelectedMessages = useCallback(async (threadId: string) => {
    setThreadLoading(true);
    setThreadError(null);
    try {
      setMessages(await fetchSmsMessages(threadId));
    } catch (err) {
      setMessages([]);
      setThreadError(err instanceof Error ? err.message : 'Failed to load SMS messages.');
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setError(null);
        await loadInbox();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load SMS inbox.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    const interval = setInterval(() => {
      void run();
    }, 30_000);
    const unsubscribe = subscribeToSmsUpdates(() => {
      void run();
      if (selectedThreadId) void loadSelectedMessages(selectedThreadId);
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [loadInbox, loadSelectedMessages, selectedThreadId]);

  useEffect(() => {
    if (section === 'owners') void loadOwners();
  }, [section, loadOwners]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      setThreadError(null);
      return;
    }
    void loadSelectedMessages(selectedThreadId);
  }, [selectedThreadId, loadSelectedMessages]);

  const handleThreadScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    shouldAutoScrollThreadRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= 96;
  }, []);

  useEffect(() => {
    shouldAutoScrollThreadRef.current = true;
    lastAutoScrolledThreadRef.current = null;
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) return;

    const isNewThread = lastAutoScrolledThreadRef.current !== selectedThreadId;
    if (isNewThread) {
      shouldAutoScrollThreadRef.current = true;
      lastAutoScrolledThreadRef.current = selectedThreadId;
    }

    if (!shouldAutoScrollThreadRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messageListSignature, selectedThreadId]);

  const openThread = useCallback(
    async (thread: SmsThread, initialMessages?: SmsMessage[]) => {
      setSelectedThreadId(thread.id);
      setThreads((prev) => {
        const others = prev.filter((row) => row.id !== thread.id);
        const resolved =
          enrichSmsThreadsWithContacts([thread], customerContacts)[0] ?? thread;
        return [resolved, ...others];
      });
      if (initialMessages) {
        setMessages(initialMessages);
      } else {
        await loadSelectedMessages(thread.id);
      }
      await loadInbox();
    },
    [loadInbox, loadSelectedMessages, customerContacts],
  );

  const handleSelectThread = useCallback(
    async (thread: SmsThread) => {
      setSelectedThreadId(thread.id);
      if (thread.status !== 'QUEUED') return;

      setClaiming(true);
      setThreadError(null);
      try {
        const updated = await claimSmsThread(thread.id);
        const enriched = enrichSmsThreadsWithContacts([updated], customerContacts)[0] ?? updated;
        setThreads((prev) =>
          prev.map((row) => (row.id === enriched.id ? enriched : row)),
        );
        await loadInbox();
      } catch {
        /* Chat tab silently keeps the selected thread if auto-claim fails. */
      } finally {
        setClaiming(false);
      }
    },
    [customerContacts, loadInbox],
  );

  const handleResolve = async () => {
    if (!selectedThreadId) return;
    setResolving(true);
    setThreadError(null);
    try {
      await resolveSmsThread(selectedThreadId);
      setSelectedThreadId(null);
      setMessages([]);
      await loadInbox();
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to resolve conversation.');
    } finally {
      setResolving(false);
    }
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedThreadId || !draft.trim() || !canReply) return;
    const body = draft.trim();
    setSending(true);
    setThreadError(null);
    try {
      const { thread, message } = await sendSmsMessage(selectedThreadId, body);
      setDraft('');
      setThreads((prev) => prev.map((row) => (row.id === thread.id ? thread : row)));
      setMessages((prev) => [...prev, message]);
      await loadInbox();
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to send SMS.');
    } finally {
      setSending(false);
    }
  };

  const handleCreateContact = async (event: FormEvent) => {
    event.preventDefault();
    if (!newContactName.trim() || !newContactPhone.trim()) return;

    setSavingContact(true);
    setError(null);
    try {
      const contact = await createSmsContact({
        contactType: 'customer',
        displayName: newContactName.trim(),
        phone: normalizeSmsPhone(newContactPhone.trim()),
      });
      const nextContacts = [...customerContacts.filter((row) => row.id !== contact.id), contact].sort(
        (a, b) => a.displayName.localeCompare(b.displayName),
      );
      setCustomerContacts(nextContacts);
      setThreads((prev) => enrichSmsThreadsWithContacts(prev, nextContacts));
      setNewContactName('');
      setNewContactPhone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save contact.');
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteContact = async (contact: SmsContact) => {
    setDeletingContactId(contact.id);
    setError(null);
    try {
      await deleteSmsContact(contact.id);
      setCustomerContacts((prev) => prev.filter((row) => row.id !== contact.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete contact.');
    } finally {
      setDeletingContactId(null);
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    if (!window.confirm('Delete this SMS conversation and all its messages?')) return;

    setDeletingThreadId(threadId);
    setThreadError(null);
    try {
      await deleteSmsThread(threadId);
      if (selectedThreadId === threadId) {
        setSelectedThreadId(null);
        setMessages([]);
      }
      setThreads((prev) => prev.filter((row) => row.id !== threadId));
      await loadInbox();
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to delete conversation.');
    } finally {
      setDeletingThreadId(null);
    }
  };

  const handleStartCustomerConversation = async (event: FormEvent) => {
    event.preventDefault();
    if (!customerPhone.trim() || !customerMessage.trim()) return;

    setStarting(true);
    setError(null);
    try {
      const phone = normalizeSmsPhone(customerPhone.trim());
      const name =
        customerName.trim() ||
        findSmsContactByPhone(customerContacts, phone)?.displayName?.trim() ||
        null;
      const { thread, message } = await startSmsThread({
        customerPhone: phone,
        customerName: name,
        messageBody: customerMessage.trim(),
        queueId: selectedQueueId || queues[0]?.id || null,
      });
      setCustomerPhone('');
      setCustomerName('');
      setCustomerMessage('');
      const enrichedThread =
        enrichSmsThreadsWithContacts([thread], customerContacts)[0] ?? thread;
      await openThread(enrichedThread, [message]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start SMS conversation.');
    } finally {
      setStarting(false);
    }
  };

  const handleStartOwnerConversation = async (event: FormEvent) => {
    event.preventDefault();
    if (!ownerContactPhone || !ownerMessage.trim()) return;

    setStarting(true);
    setError(null);
    try {
      const ownerLabel = selectedOwner?.name?.trim() || null;
      const { thread, message } = await startSmsThread({
        customerPhone: ownerContactPhone,
        customerName: ownerLabel,
        messageBody: ownerMessage.trim(),
        queueId: selectedQueueId || queues[0]?.id || null,
      });
      setOwnerMessage('');
      await openThread(thread, [message]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start SMS with workshop owner.');
    } finally {
      setStarting(false);
    }
  };

  const newConversationForm =
    section === 'owners' ? (
      <form
        onSubmit={handleStartOwnerConversation}
        className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/60 p-3"
      >
        <div>
          <p className="text-sm font-semibold text-slate-900">New SMS to owner</p>
          <p className="text-xs text-muted-foreground">
            Pick a workshop owner — SMS goes to their contact phone.
          </p>
        </div>

        {ownersError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
            {ownersError}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Input
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
            placeholder="Filter workshops…"
            className="h-9 min-w-0 flex-1 bg-white text-sm"
            disabled={ownersLoading || starting}
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 bg-white"
            disabled={ownersLoading || starting}
            aria-label="Refresh workshop list"
            onClick={() => void loadOwners()}
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>

        <Select
          value={selectedOwnerUid}
          onValueChange={(uid) => {
            setSelectedOwnerUid(uid);
            setOwnerPhoneOverride('');
          }}
          disabled={ownersLoading || starting}
        >
          <SelectTrigger className="h-9 bg-white text-sm">
            <SelectValue
              placeholder={
                ownersLoading ? 'Loading workshops…' : 'Select workshop owner'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {filteredOwners.map((owner) => (
              <SelectItem key={owner.ownerUid} value={owner.ownerUid}>
                <span className="font-medium">{owner.name || owner.slug || owner.ownerUid}</span>
                {owner.contactPhone ? (
                  <span className="ml-2 text-muted-foreground">· {owner.contactPhone}</span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!ownersLoading && filteredOwners.length === 0 ? (
          <p className="text-xs text-muted-foreground">No workshops match your filter.</p>
        ) : null}

        <Input
          value={ownerContactPhone}
          readOnly
          placeholder={selectedOwnerUid ? 'No contact phone on file' : 'Owner phone'}
          inputMode="tel"
          className="bg-white"
          disabled
        />

        {selectedOwnerUid && !ownerContactPhone ? (
          <p className="text-xs text-amber-700">
            This workshop has no contact phone in BMS. Choose another owner or update their profile.
          </p>
        ) : null}

        <Textarea
          value={ownerMessage}
          onChange={(event) => setOwnerMessage(event.target.value)}
          placeholder="First SMS message…"
          className="min-h-[74px] resize-none bg-white"
          disabled={starting || !ownerContactPhone}
        />
        <Button
          type="submit"
          size="sm"
          className="w-full"
          disabled={starting || !ownerContactPhone || !ownerMessage.trim()}
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Start chat with owner
        </Button>
      </form>
    ) : (
      <div className="space-y-2">
      <form
        onSubmit={handleStartCustomerConversation}
        className="space-y-2 rounded-xl border border-sky-100 bg-sky-50/60 p-3"
      >
        <div>
          <p className="text-sm font-semibold text-slate-900">New SMS to customer</p>
          <p className="text-xs text-muted-foreground">Start an outbound customer conversation.</p>
        </div>
        <Input
          value={customerName}
          onChange={(event) => setCustomerName(event.target.value)}
          placeholder="Customer name (optional)"
          disabled={starting}
        />
        <Input
          value={customerPhone}
          onChange={(event) => setCustomerPhone(event.target.value)}
          placeholder="Customer phone number"
          inputMode="tel"
          disabled={starting}
        />
        <Textarea
          value={customerMessage}
          onChange={(event) => setCustomerMessage(event.target.value)}
          placeholder="First SMS message…"
          className="min-h-[74px] resize-none bg-white"
          disabled={starting}
        />
        <Button
          type="submit"
          size="sm"
          className="w-full"
          disabled={starting || !customerPhone.trim() || !customerMessage.trim()}
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Start chat with customer
        </Button>
      </form>

      <div className="space-y-2 rounded-xl border border-sky-100 bg-sky-50/40 p-3">
        <SmsContactList
          title="Customer contact list"
          contacts={customerContacts}
          loading={contactsLoading}
          emptyLabel="No saved customer contacts yet."
          deletingId={deletingContactId}
          onUse={(contact) => {
            setCustomerName(contact.displayName);
            setCustomerPhone(contact.phone);
          }}
          onDelete={(contact) => void handleDeleteContact(contact)}
        />

        <form onSubmit={handleCreateContact} className="space-y-2 border-t border-sky-100 pt-2">
          <p className="text-xs font-semibold text-slate-700">Add customer contact</p>
          <Input
            value={newContactName}
            onChange={(event) => setNewContactName(event.target.value)}
            placeholder="Customer name"
            disabled={savingContact}
            className="bg-white"
          />
          <Input
            value={newContactPhone}
            onChange={(event) => setNewContactPhone(event.target.value)}
            placeholder="Phone number"
            inputMode="tel"
            disabled={savingContact}
            className="bg-white"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="w-full bg-white"
            disabled={savingContact || !newContactName.trim() || !newContactPhone.trim()}
          >
            {savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add to contact list
          </Button>
        </form>
      </div>
      </div>
    );

  const activeOwnerDetails: CallCenterWorkshopOwner | null = ownerForThread ?? selectedOwner;

  const detailsPanel =
    section === 'owners' ? (
      activeOwnerDetails ? (
        <>
          <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Workshop</p>
            <p className="mt-1 break-words font-semibold text-slate-900">{activeOwnerDetails.name}</p>
            <div className="mt-2">
              <DetailField label="Phone" value={activeOwnerDetails.contactPhone} />
            </div>
            {activeOwnerDetails.slug ? (
              <p className="mt-2 break-words text-xs text-muted-foreground">{activeOwnerDetails.slug}</p>
            ) : null}
            {activeOwnerDetails.email ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <DetailField label="Email" value={activeOwnerDetails.email} />
              </div>
            ) : null}
          </div>
          {selectedThread ? (
            <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Conversation</p>
              <div className="mt-2 space-y-3">
                <DetailField label="Queue" value={selectedThread.queueName} />
                <DetailField label="Last SMS" value={formatDateTime(selectedThread.lastMessageAt)} />
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-muted-foreground">
          Select a workshop owner or open an owner SMS thread to see details.
        </p>
      )
    ) : selectedThread ? (
      <>
        <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Customer</p>
          <p className="mt-1 break-words font-semibold text-slate-900">
            {selectedThreadDisplay?.title ?? selectedThread.customerName ?? '—'}
          </p>
          <DetailField label="Phone" value={selectedThread.customerPhone} />
        </div>
        <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">CRM History</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Holder card for future customer lookup, notes, bookings, and prior activity.
          </p>
        </div>
        <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Conversation</p>
          <div className="mt-2 space-y-3">
            <DetailField label="Queue" value={selectedThread.queueName} />
            <DetailField label="Agent" value={selectedThread.assignedAgentName || 'Unassigned'} />
            <DetailField label="Last SMS" value={formatDateTime(selectedThread.lastMessageAt)} />
          </div>
        </div>
      </>
    ) : (
      <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-muted-foreground">
        Select a conversation to see customer context.
      </p>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">SMS Center</h2>
          <p className="text-sm text-muted-foreground">
            TextBee SMS — chat with workshop owners or customers.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void loadInbox();
            if (section === 'owners') void loadOwners();
            if (section === 'customers') void loadCustomerContacts();
          }}
          disabled={loading}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <Tabs
        value={section}
        onValueChange={(value) => setSection(value as SmsSection)}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
      >
        <TabsList className="w-full max-w-md shrink-0 grid grid-cols-2">
          <TabsTrigger value="owners" className="gap-2">
            <Building2 className="h-4 w-4" />
            Chat with owners
          </TabsTrigger>
          <TabsTrigger value="customers" className="gap-2">
            <User className="h-4 w-4" />
            Chat with customers
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value={section}
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          {error ? (
            <div className="mb-4 shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {hiddenInOtherSectionCount > 0 ? (
            <div className="mb-4 shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {hiddenInOtherSectionCount} conversation
              {hiddenInOtherSectionCount === 1 ? '' : 's'} in the other tab (
              {section === 'owners' ? 'Chat with customers' : 'Chat with owners'}). Switch tabs to
              see them.
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,260px)]">
            <Card
              className={cn(
                'flex min-h-0 flex-col overflow-hidden border-border/80 bg-white shadow-sm',
                selectedThreadId && 'max-lg:hidden',
              )}
            >
              <CardHeader className="shrink-0 border-b border-slate-100 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Inbox className="h-4 w-4" />
                  {section === 'owners' ? 'Owner SMS' : 'Customer SMS'}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
                {newConversationForm}

                <div className="grid shrink-0 grid-cols-2 gap-2">
                  {queues.map((queue) => {
                    const count = threads.filter(
                      (thread) => thread.status === 'QUEUED' && thread.queueId === queue.id,
                    ).length;
                    return (
                      <button
                        key={queue.id}
                        type="button"
                        onClick={() => setSelectedQueueId(queue.id)}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left text-xs font-semibold transition',
                          selectedQueueId === queue.id
                            ? 'border-sky-300 bg-sky-50 text-sky-800'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                        )}
                      >
                        <span>{queue.queueName}</span>
                        <span className="ml-2 text-slate-400">{count}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-4">
                  <section className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Unassigned Pool
                      </p>
                      <Badge variant="outline" className="text-[10px]">
                        {sectionQueueThreads.length}
                      </Badge>
                    </div>
                    {loading ? (
                      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading SMS…
                      </div>
                    ) : sectionQueueThreads.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-muted-foreground">
                        No unassigned SMS in this queue.
                      </p>
                    ) : (
                      sectionQueueThreads.map((thread) => (
                        <SmsThreadRow
                          key={thread.id}
                          thread={thread}
                          display={threadDisplayFor(thread, section === 'owners')}
                          selected={selectedThreadId === thread.id}
                          onSelect={() => void handleSelectThread(thread)}
                          onDelete={() => void handleDeleteThread(thread.id)}
                          deleting={deletingThreadId === thread.id}
                        />
                      ))
                    )}
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {isSuperAdmin ? 'All active' : 'Mine'}
                      </p>
                      <Badge variant="outline" className="text-[10px]">
                        {sectionMineThreads.length}
                      </Badge>
                    </div>
                    {sectionMineThreads.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-muted-foreground">
                        {isSuperAdmin
                          ? 'Active conversations appear here.'
                          : 'Claimed conversations appear here.'}
                      </p>
                    ) : (
                      sectionMineThreads.map((thread) => (
                        <SmsThreadRow
                          key={thread.id}
                          thread={thread}
                          display={threadDisplayFor(thread, section === 'owners')}
                          selected={selectedThreadId === thread.id}
                          onSelect={() => void handleSelectThread(thread)}
                          onDelete={() => void handleDeleteThread(thread.id)}
                          deleting={deletingThreadId === thread.id}
                        />
                      ))
                    )}
                  </section>
                </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={cn(
                'flex min-h-0 flex-col overflow-hidden border-border/80 bg-white shadow-sm',
                !selectedThread && 'max-lg:hidden',
              )}
            >
              {!selectedThread ? (
                <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center text-center text-sm text-muted-foreground">
                  <MessageSquareText className="mb-3 h-10 w-10 text-slate-300" />
                  Select an SMS conversation to view the message history.
                </CardContent>
              ) : (
                <>
                  <CardHeader className="shrink-0 border-b border-slate-100 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-0.5 shrink-0 lg:hidden"
                        onClick={() => setSelectedThreadId(null)}
                        aria-label="Back to inbox"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="break-words text-base leading-snug">
                          {selectedThreadDisplay?.title ?? selectedThread.customerPhone}
                        </CardTitle>
                        <p className="mt-1 flex items-start gap-1.5 break-all text-sm text-muted-foreground">
                          <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{selectedThreadDisplay?.subtitle ?? selectedThread.customerPhone}</span>
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="outline">{selectedThread.queueName}</Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              selectedThread.status === 'QUEUED'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                            )}
                          >
                            {selectedThread.status}
                          </Badge>
                          {selectedThread.assignedAgentName ? (
                            <Badge variant="outline">
                              Assigned to {selectedThread.assignedAgentName}
                            </Badge>
                          ) : null}
                          {selectedThread.status === 'QUEUED' ? (
                            <Badge variant="outline" className="border-slate-200 text-[10px] text-slate-500">
                              Queue
                            </Badge>
                          ) : null}
                          {claiming ? (
                            <Badge className="flex items-center gap-1 border-sky-200 bg-sky-100 text-[10px] text-sky-700">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Claiming conversation…
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-rose-600 hover:text-rose-700"
                          disabled={deletingThreadId === selectedThread.id}
                          onClick={() => void handleDeleteThread(selectedThread.id)}
                        >
                          {deletingThreadId === selectedThread.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-0 px-4 pb-4 pt-3">
                    {threadError ? (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        {threadError}
                      </div>
                    ) : null}

                    <div
                      ref={threadScrollRef}
                      onScroll={handleThreadScroll}
                      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-lg border border-slate-100 bg-slate-50/50 p-3"
                    >
                      {threadLoading ? (
                        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading messages…
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          No SMS messages yet.
                        </div>
                      ) : (
                        <ul className="space-y-3">
                          {messages.map((message) => {
                            const inbound = isInbound(message);
                            return (
                              <li
                                key={message.id}
                                className={cn('flex', inbound ? 'justify-start' : 'justify-end')}
                              >
                                <div
                                  className={cn(
                                    'max-w-[78%] rounded-2xl px-4 py-2 text-sm shadow-sm',
                                    inbound
                                      ? 'rounded-bl-sm bg-white text-slate-800'
                                      : 'rounded-br-sm bg-slate-900 text-white',
                                  )}
                                >
                                  <p className="whitespace-pre-wrap break-words">
                                    {message.messageBody}
                                  </p>
                                  <div
                                    className={cn(
                                      'mt-1 flex items-center justify-end gap-1 text-[10px]',
                                      inbound ? 'text-slate-400' : 'text-slate-300',
                                    )}
                                  >
                                    <Clock3 className="h-3 w-3" />
                                    {formatTime(message.createdAt)}
                                    {!inbound && message.textbeeStatus
                                      ? ` • ${message.textbeeStatus}`
                                      : ''}
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <div ref={bottomRef} />
                    </div>

                    <form onSubmit={handleSend} className="flex shrink-0 gap-2 border-t border-slate-100 pt-2">
                      {!canReply ? (
                        <div className="hidden rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                          Claim this conversation before replying.
                        </div>
                      ) : null}
                        <Textarea
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          placeholder="Type SMS reply…"
                          className="min-h-10 flex-1 resize-none"
                          disabled={!canReply || sending || threadLoading || claiming || resolving}
                        />
                        <Button
                          type="submit"
                          className="h-auto shrink-0 gap-1.5 bg-sky-600 px-4 hover:bg-sky-700"
                          disabled={!canReply || sending || threadLoading || claiming || !draft.trim()}
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
                          disabled={resolving || sending || claiming}
                          onClick={() => void handleResolve()}
                          className="h-auto shrink-0 gap-1.5 bg-rose-600 px-4 text-white hover:bg-rose-700"
                        >
                          {resolving ? (
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

            <Card className="hidden min-h-0 flex-col overflow-hidden border-border/80 bg-white shadow-sm lg:flex">
              <CardHeader className="shrink-0 border-b border-slate-100 pb-3">
                <CardTitle className="text-base">
                  {section === 'owners' ? 'Owner Details' : 'Customer Details'}
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                <div className="min-w-0 space-y-4">{detailsPanel}</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
