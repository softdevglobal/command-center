import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Clock3,
  Inbox,
  Loader2,
  MessageSquareText,
  Phone,
  RefreshCw,
  Send,
  UserCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { UserSession } from '@/services/types';
import {
  claimSmsThread,
  fetchSmsInbox,
  fetchSmsMessages,
  resolveSmsThread,
  sendSmsMessage,
  startSmsThread,
  subscribeToSmsUpdates,
  type SmsMessage,
  type SmsQueue,
  type SmsThread,
} from '@/services/smsApi';

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

function initials(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  return clean.slice(-2) || 'SM';
}

function isInbound(message: SmsMessage): boolean {
  return message.direction === 'INBOUND';
}

function SmsThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: SmsThread;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border p-3 text-left transition',
        selected
          ? 'border-sky-300 bg-sky-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
          {initials(thread.customerPhone)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">{thread.customerPhone}</p>
            {thread.unreadForAgent > 0 ? (
              <Badge className="bg-emerald-500 text-[10px] text-white">
                {thread.unreadForAgent > 99 ? '99+' : thread.unreadForAgent}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{thread.lastMessageBody || 'No messages yet.'}</p>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>{thread.queueName}</span>
            <span>{formatTime(thread.lastMessageAt)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

export function SmsTab({ session, currentAgentDbId = null, onInboxStatsChange }: SmsTabProps) {
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
  const [newPhone, setNewPhone] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const myAgentIds = useMemo(
    () => new Set([session.userId, currentAgentDbId].filter((id): id is string => Boolean(id))),
    [session.userId, currentAgentDbId],
  );

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );

  const mineThreads = useMemo(
    () =>
      threads.filter(
        (thread) => thread.assignedAgentId && myAgentIds.has(thread.assignedAgentId),
      ),
    [threads, myAgentIds],
  );

  const queueThreads = useMemo(
    () =>
      threads.filter(
        (thread) => thread.status === 'QUEUED' && (!selectedQueueId || thread.queueId === selectedQueueId),
      ),
    [threads, selectedQueueId],
  );

  const canReply = Boolean(
    selectedThread?.assignedAgentId && myAgentIds.has(selectedThread.assignedAgentId),
  );

  const loadInbox = useCallback(async () => {
    const inbox = await fetchSmsInbox();
    setQueues(inbox.queues);
    setThreads(inbox.threads);
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
    if (!selectedThreadId) {
      setMessages([]);
      setThreadError(null);
      return;
    }
    void loadSelectedMessages(selectedThreadId);
  }, [selectedThreadId, loadSelectedMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, selectedThreadId]);

  const handleClaim = async () => {
    if (!selectedThreadId) return;
    setClaiming(true);
    setThreadError(null);
    try {
      const updated = await claimSmsThread(selectedThreadId);
      setThreads((prev) => prev.map((thread) => (thread.id === updated.id ? updated : thread)));
      await loadInbox();
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to claim conversation.');
    } finally {
      setClaiming(false);
    }
  };

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

  const handleStartConversation = async (event: FormEvent) => {
    event.preventDefault();
    if (!newPhone.trim() || !newMessage.trim()) return;

    setStarting(true);
    setError(null);
    try {
      const { thread, message } = await startSmsThread({
        customerPhone: newPhone.trim(),
        messageBody: newMessage.trim(),
        queueId: selectedQueueId || queues[0]?.id || null,
      });
      setNewPhone('');
      setNewMessage('');
      setSelectedThreadId(thread.id);
      setThreads((prev) => {
        const others = prev.filter((row) => row.id !== thread.id);
        return [thread, ...others];
      });
      setMessages([message]);
      await loadInbox();
      await loadSelectedMessages(thread.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start SMS conversation.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">SMS Center</h2>
          <p className="text-sm text-muted-foreground">
            Live TextBee conversations from the Android SMS gateway.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadInbox()}
          disabled={loading}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)_300px]">
        <Card className="flex min-h-[560px] flex-col overflow-hidden border-border/80 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="h-4 w-4" />
              Queue View
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
            <form
              onSubmit={handleStartConversation}
              className="space-y-2 rounded-xl border border-sky-100 bg-sky-50/60 p-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">New SMS</p>
                <p className="text-xs text-muted-foreground">Start an outbound conversation.</p>
              </div>
              <Input
                value={newPhone}
                onChange={(event) => setNewPhone(event.target.value)}
                placeholder="Customer phone number"
                inputMode="tel"
                disabled={starting}
              />
              <Textarea
                value={newMessage}
                onChange={(event) => setNewMessage(event.target.value)}
                placeholder="First SMS message…"
                className="min-h-[74px] resize-none bg-white"
                disabled={starting}
              />
              <Button
                type="submit"
                size="sm"
                className="w-full"
                disabled={starting || !newPhone.trim() || !newMessage.trim()}
              >
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Start Chat
              </Button>
            </form>

            <div className="grid grid-cols-2 gap-2">
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

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Unassigned Pool
                  </p>
                  <Badge variant="outline" className="text-[10px]">
                    {queueThreads.length}
                  </Badge>
                </div>
                {loading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading SMS…
                  </div>
                ) : queueThreads.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-muted-foreground">
                    No unassigned SMS in this queue.
                  </p>
                ) : (
                  queueThreads.map((thread) => (
                    <SmsThreadRow
                      key={thread.id}
                      thread={thread}
                      selected={selectedThreadId === thread.id}
                      onSelect={() => setSelectedThreadId(thread.id)}
                    />
                  ))
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Mine
                  </p>
                  <Badge variant="outline" className="text-[10px]">
                    {mineThreads.length}
                  </Badge>
                </div>
                {mineThreads.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-muted-foreground">
                    Claimed conversations appear here.
                  </p>
                ) : (
                  mineThreads.map((thread) => (
                    <SmsThreadRow
                      key={thread.id}
                      thread={thread}
                      selected={selectedThreadId === thread.id}
                      onSelect={() => setSelectedThreadId(thread.id)}
                    />
                  ))
                )}
              </section>
            </div>
          </CardContent>
        </Card>

        <Card className="flex min-h-[560px] flex-col overflow-hidden border-border/80 bg-white shadow-sm">
          {!selectedThread ? (
            <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <MessageSquareText className="mb-3 h-10 w-10 text-slate-300" />
              Select an SMS conversation to view the message history.
            </CardContent>
          ) : (
            <>
              <CardHeader className="border-b border-slate-100 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Phone className="h-4 w-4" />
                      {selectedThread.customerPhone}
                    </CardTitle>
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
                        <Badge variant="outline">Assigned to {selectedThread.assignedAgentName}</Badge>
                      ) : null}
                    </div>
                  </div>
                  {!canReply ? (
                    <Button type="button" size="sm" onClick={handleClaim} disabled={claiming}>
                      {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                      Claim Conversation
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleResolve}
                      disabled={resolving}
                    >
                      {resolving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Resolve
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                {threadError ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {threadError}
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/70 p-4">
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
                              <p className="whitespace-pre-wrap break-words">{message.messageBody}</p>
                              <div
                                className={cn(
                                  'mt-1 flex items-center justify-end gap-1 text-[10px]',
                                  inbound ? 'text-slate-400' : 'text-slate-300',
                                )}
                              >
                                <Clock3 className="h-3 w-3" />
                                {formatTime(message.createdAt)}
                                {!inbound && message.textbeeStatus ? ` • ${message.textbeeStatus}` : ''}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div ref={bottomRef} />
                </div>

                <form onSubmit={handleSend} className="shrink-0 space-y-2">
                  {!canReply ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      Claim this conversation before replying.
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Type SMS reply…"
                      className="min-h-[52px] resize-none"
                      disabled={!canReply || sending || claiming || resolving}
                    />
                    <Button
                      type="submit"
                      className="h-auto self-stretch px-4"
                      disabled={!canReply || sending || !draft.trim()}
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Send
                    </Button>
                  </div>
                </form>
              </CardContent>
            </>
          )}
        </Card>

        <Card className="min-h-[560px] border-border/80 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle className="text-base">Customer Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {selectedThread ? (
              <>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Phone</p>
                  <p className="mt-1 font-semibold text-slate-900">{selectedThread.customerPhone}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">CRM History</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Holder card for future customer lookup, notes, bookings, and prior activity.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Conversation</p>
                  <dl className="mt-2 space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Queue</dt>
                      <dd className="font-medium text-slate-900">{selectedThread.queueName}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Agent</dt>
                      <dd className="text-right font-medium text-slate-900">
                        {selectedThread.assignedAgentName || 'Unassigned'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Last SMS</dt>
                      <dd className="text-right font-medium text-slate-900">
                        {formatDateTime(selectedThread.lastMessageAt)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-muted-foreground">
                Select a conversation to see customer context.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
