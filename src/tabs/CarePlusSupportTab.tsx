import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  HeartHandshake,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  CarePlusSupportApiError,
  fetchCarePlusMessages,
  fetchCarePlusThreads,
  postCarePlusReply,
  type CarePlusSupportMessage,
  type CarePlusSupportThread,
} from '@/services/carePlusSupportApi';
import type { UserSession } from '@/services/types';

const THREADS_POLL_MS = 8_000;
const MESSAGES_POLL_MS = 5_000;

type StatusFilter = 'open' | 'closed' | 'all';

interface CarePlusSupportTabProps {
  session: UserSession;
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatRelative(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return '';
  }
}

export function CarePlusSupportTab({ session }: CarePlusSupportTabProps) {
  const canAccess =
    session.role === 'super-admin' ||
    session.role === 'supervisor' ||
    session.role === 'agent';

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [listSearch, setListSearch] = useState('');
  const [threads, setThreads] = useState<CarePlusSupportThread[]>([]);
  const [configured, setConfigured] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<CarePlusSupportThread | null>(null);
  const [messages, setMessages] = useState<CarePlusSupportMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sinceRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadThreads = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setListLoading(true);
    try {
      const res = await fetchCarePlusThreads({ status: statusFilter, limit: 100 });
      setConfigured(res.configured);
      setThreads(res.threads);
      setListError(null);

      if (!res.configured) {
        setListError('Care Plus support is not configured on the server.');
      }

      setSelectedId((prev) => {
        if (!prev) return prev;
        if (res.threads.some((t) => t.id === prev)) return prev;
        return null;
      });
    } catch (err) {
      const status = err instanceof CarePlusSupportApiError ? err.status : 0;
      if (status === 403) {
        setListError('Forbidden — you do not have access to the Care Plus inbox.');
      } else if (status === 503) {
        setConfigured(false);
        setListError('Care Plus support is not configured (503).');
      } else {
        setListError(err instanceof Error ? err.message : 'Failed to load Care Plus threads.');
      }
      if (!opts?.silent) setThreads([]);
    } finally {
      if (!opts?.silent) setListLoading(false);
    }
  }, [statusFilter]);

  const loadMessages = useCallback(
    async (threadId: string, opts?: { since?: string | null; silent?: boolean }) => {
      if (!opts?.silent) setThreadLoading(true);
      try {
        const res = await fetchCarePlusMessages(threadId, { since: opts?.since ?? null });
        setConfigured(res.configured);
        if (res.thread) setSelectedThread(res.thread);

        if (opts?.since) {
          setMessages((prev) => {
            const byId = new Map(prev.map((m) => [m.id, m]));
            for (const m of res.messages) byId.set(m.id, m);
            return [...byId.values()].sort((a, b) =>
              a.createdAt.localeCompare(b.createdAt),
            );
          });
        } else {
          setMessages(res.messages);
        }

        const latest = res.messages.at(-1)?.createdAt
          ?? (opts?.since ? sinceRef.current : null);
        if (latest) sinceRef.current = latest;

        setThreadError(null);
      } catch (err) {
        const status = err instanceof CarePlusSupportApiError ? err.status : 0;
        if (status === 403) {
          setThreadError('Forbidden — you do not have access to this thread.');
        } else if (status === 404) {
          setThreadError('Thread not found.');
        } else if (status === 503) {
          setConfigured(false);
          setThreadError('Care Plus support is not configured.');
        } else {
          setThreadError(err instanceof Error ? err.message : 'Failed to load messages.');
        }
      } finally {
        if (!opts?.silent) setThreadLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!canAccess) return;
    void loadThreads();
  }, [canAccess, loadThreads]);

  useEffect(() => {
    if (!canAccess) return;
    const id = window.setInterval(() => {
      void loadThreads({ silent: true });
    }, THREADS_POLL_MS);
    return () => window.clearInterval(id);
  }, [canAccess, loadThreads]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setSelectedThread(null);
      sinceRef.current = null;
      return;
    }
    sinceRef.current = null;
    const fromList = threads.find((t) => t.id === selectedId) ?? null;
    setSelectedThread(fromList);
    void loadMessages(selectedId);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps -- reload on selection only

  useEffect(() => {
    if (!selectedId || !canAccess) return;
    const id = window.setInterval(() => {
      const tid = selectedIdRef.current;
      if (!tid) return;
      void loadMessages(tid, { since: sinceRef.current, silent: true });
    }, MESSAGES_POLL_MS);
    return () => window.clearInterval(id);
  }, [selectedId, canAccess, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const filteredThreads = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => {
      const hay = [
        t.providerName,
        t.requesterName,
        t.requesterEmail,
        t.providerId,
        t.status,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [threads, listSearch]);

  const canReply = selectedThread?.status === 'open' && configured && canAccess;

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedId || !canReply || sending) return;
    const text = draft.trim();
    if (!text) return;

    setSending(true);
    setThreadError(null);
    try {
      const { thread, message } = await postCarePlusReply(selectedId, text);
      setDraft('');
      if (thread) setSelectedThread(thread);
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      if (message.createdAt) sinceRef.current = message.createdAt;
      void loadThreads({ silent: true });
    } catch (err) {
      const status = err instanceof CarePlusSupportApiError ? err.status : 0;
      if (status === 409) {
        setThreadError('Thread is closed — replies are disabled.');
        setSelectedThread((prev) => (prev ? { ...prev, status: 'closed' } : prev));
      } else {
        setThreadError(err instanceof Error ? err.message : 'Failed to send reply.');
      }
    } finally {
      setSending(false);
    }
  };

  if (!canAccess) {
    return (
      <Card className="border-border/80 bg-white shadow-sm">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <ShieldAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium text-slate-800">Access restricted</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Care Plus provider support is available to Command Center agents, supervisors,
            and super-admins.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,360px)_1fr] lg:items-stretch">
      <Card
        className={cn(
          'flex min-h-0 flex-col overflow-hidden border-border/80 bg-white shadow-sm',
          selectedId && 'max-lg:hidden',
        )}
      >
        <CardHeader className="shrink-0 space-y-3 pb-3">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <HeartHandshake className="h-4 w-4 text-rose-600" />
              Care Plus inbox
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              aria-label="Refresh threads"
              onClick={() => void loadThreads()}
            >
              <RefreshCw className={cn('h-4 w-4', listLoading && 'animate-spin')} />
            </Button>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger className="h-9 w-[120px] rounded-xl text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="Search provider / requester"
                className="h-9 rounded-xl pl-8 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {listError && (
            <div className="mx-4 mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {listError}
            </div>
          )}
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-0.5 px-2 pb-3">
              {listLoading && threads.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading threads…
                </div>
              ) : filteredThreads.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {configured
                    ? 'No Care Plus support threads yet.'
                    : 'Support tables missing — run scripts/command-center-supabase.sql in Supabase.'}
                </div>
              ) : (
                filteredThreads.map((thread) => {
                  const active = thread.id === selectedId;
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => setSelectedId(thread.id)}
                      className={cn(
                        'flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-colors',
                        active
                          ? 'bg-rose-50 ring-1 ring-rose-200'
                          : 'hover:bg-slate-50',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {thread.providerName || 'Provider'}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'shrink-0 text-[10px] capitalize',
                            thread.status === 'open'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-slate-50 text-slate-500',
                          )}
                        >
                          {thread.status}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-slate-600">
                        {thread.requesterName || 'Requester'}
                        {thread.requesterEmail ? ` · ${thread.requesterEmail}` : ''}
                      </p>
                      <p className="text-[10px] text-slate-400 tabular-nums">
                        {formatRelative(thread.updatedAt) || formatTime(thread.updatedAt)}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card
        className={cn(
          'flex min-h-0 flex-col overflow-hidden border-border/80 bg-white shadow-sm',
          !selectedId && 'max-lg:hidden',
        )}
      >
        {selectedId && selectedThread ? (
          <>
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setSelectedId(null)}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-bold text-slate-900">
                  {selectedThread.providerName}
                </h3>
                <p className="truncate text-xs text-slate-500">
                  {selectedThread.requesterName}
                  {selectedThread.requesterEmail
                    ? ` · ${selectedThread.requesterEmail}`
                    : ''}
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'capitalize',
                  selectedThread.status === 'open'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 text-slate-500',
                )}
              >
                {selectedThread.status}
              </Badge>
            </div>

            <ScrollArea className="min-h-0 flex-1 bg-slate-50/40 p-4">
              {threadLoading && messages.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading messages…
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg) => {
                    const isAgent = msg.senderRole === 'agent';
                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          'flex flex-col',
                          isAgent ? 'items-end' : 'items-start',
                        )}
                      >
                        <span className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {msg.senderName || (isAgent ? 'Agent' : 'Provider')}
                        </span>
                        <div
                          className={cn(
                            'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
                            isAgent
                              ? 'rounded-tr-none bg-rose-600 text-white'
                              : 'rounded-tl-none border border-slate-100 bg-white text-slate-700',
                          )}
                        >
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                          <p
                            className={cn(
                              'mt-1 text-right text-[9px] tabular-nums opacity-70',
                              isAgent ? 'text-rose-50' : 'text-slate-400',
                            )}
                          >
                            {formatTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {threadError && (
              <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                {threadError}
              </div>
            )}

            <div className="border-t border-slate-100 p-3">
              {canReply ? (
                <form onSubmit={(e) => void handleSend(e)} className="flex items-center gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Reply to provider…"
                    maxLength={8000}
                    disabled={sending}
                    className="h-11 flex-1 rounded-2xl border-transparent bg-slate-50 focus:bg-white"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={sending || !draft.trim()}
                    className="h-11 w-11 shrink-0 rounded-xl bg-rose-600 hover:bg-rose-700"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    ) : (
                      <Send className="h-4 w-4 text-white" />
                    )}
                  </Button>
                </form>
              ) : (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  {selectedThread.status !== 'open'
                    ? 'This thread is closed. Replies are disabled (no close API from CC yet).'
                    : 'Replies unavailable — support tables not ready.'}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[2.5rem] bg-rose-50 shadow-inner">
              <MessageSquare className="h-10 w-10 text-rose-500" />
            </div>
            <h3 className="mb-2 text-xl font-bold text-slate-900">Care Plus provider support</h3>
            <p className="max-w-sm text-sm text-slate-500">
              Select a thread from the inbox to chat with NDIS provider admins who reached out
              from Care Plus Help → Command Center.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
