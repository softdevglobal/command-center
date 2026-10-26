import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Mail, MailOpen, RefreshCw, Send, UserRound, Bot, Hand, BookOpen } from 'lucide-react';
import { SophieBusinessKnowledgePanel } from '@/tabs/SophieBusinessKnowledgePanel';
import {
  fetchSophieInbox,
  fetchSophieMessage,
  sendSophieReply,
  setSophieThreadControl,
  type SophieMailThread,
} from '@/services/sophieMailApi';

function displayDate(value: string | null) {
  if (!value) return '—';
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric) : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function safePlainText(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script,style,iframe,object,embed').forEach((node) => node.remove());
  return (parsed.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function SophieInboxTab() {
  const [folder, setFolder] = useState<'inbox' | 'sent'>('inbox');
  const [threads, setThreads] = useState<SophieMailThread[]>([]);
  const [selected, setSelected] = useState<SophieMailThread | null>(null);
  const [content, setContent] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showKnowledge, setShowKnowledge] = useState(false);

  const refresh = useCallback(async (keepSelected = true) => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchSophieInbox(folder);
      setThreads(result);
      setSelected((current) => keepSelected && current
        ? result.find((row) => row.messageId === current.messageId) ?? result[0] ?? null
        : result[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Sophie’s inbox.');
    } finally {
      setLoading(false);
    }
  }, [folder]);

  useEffect(() => { void refresh(false); }, [refresh]);

  useEffect(() => {
    let active = true;
    setContent('');
    if (!selected) return () => { active = false; };
    fetchSophieMessage(selected).then((value) => { if (active) setContent(safePlainText(value)); }).catch((err) => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load this email.');
    });
    return () => { active = false; };
  }, [selected?.messageId, selected?.folderId]);

  const selectedIsHuman = folder === 'inbox' && selected?.control.state === 'human';
  const sorted = useMemo(() => threads, [threads]);

  const changeControl = async () => {
    if (!selected || folder !== 'inbox') return;
    setWorking(true); setError(''); setNotice('');
    const state = selectedIsHuman ? 'sophie' : 'human';
    try {
      await setSophieThreadControl(selected.threadId, state);
      setNotice(state === 'human' ? 'You have taken over this thread.' : 'Control released back to Sophie.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change thread control.');
    } finally { setWorking(false); }
  };

  const submitReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    setWorking(true); setError(''); setNotice('');
    try {
      await sendSophieReply(selected.messageId, reply.trim());
      setReply('');
      setNotice('Reply sent from Sophie’s mailbox.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reply.');
    } finally { setWorking(false); }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sophie Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">Read incoming emails and review replies Sophie sent from her Zoho mailbox.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowKnowledge(!showKnowledge)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"><BookOpen className="h-4 w-4" />{showKnowledge ? 'Back to inbox' : 'Business information'}</button>
        {!showKnowledge && <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>}
        </div>
      </header>

      {showKnowledge && <SophieBusinessKnowledgePanel />}
      {!showKnowledge && error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {!showKnowledge && notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
      {!showKnowledge && <div className="grid min-h-[620px] grid-cols-1 overflow-hidden rounded-xl border bg-card md:grid-cols-[minmax(280px,360px)_1fr]">
        <aside className="border-b md:border-b-0 md:border-r">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Mailbox folder">
              {(['inbox', 'sent'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={folder === value}
                onClick={() => setFolder(value)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${folder === value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {value === 'inbox' ? 'Inbox' : 'Sent'}
              </button>)}
            </div>
            <span className="text-xs text-muted-foreground">{threads.length} loaded</span>
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {loading && threads.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Loading mailbox…</p> : null}
            {!loading && sorted.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground"><Mail className="mx-auto mb-2 h-6 w-6" />No email in the {folder === 'inbox' ? 'inbox' : 'sent folder'}.</div> : null}
            {sorted.map((row) => (
              <button key={row.messageId} type="button" onClick={() => { setSelected(row); setNotice(''); }} className={`block w-full border-b p-4 text-left hover:bg-muted/60 ${selected?.messageId === row.messageId ? 'bg-muted' : ''}`}>
                <div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-semibold">{folder === 'sent' ? `To: ${row.toAddress || 'Unknown recipient'}` : row.fromAddress || 'Unknown sender'}</span><span className="shrink-0 text-[11px] text-muted-foreground">{displayDate(row.receivedTime)}</span></div>
                <div className="mt-1 truncate text-sm">{row.subject || '(no subject)'}</div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.summary || 'Open to read this email.'}</p>
                {folder === 'sent' ? <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-900"><Send className="h-3 w-3" />Sent</span> : <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${row.control.state === 'human' ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'}`}>
                  {row.control.state === 'human' ? <Hand className="h-3 w-3" /> : <Bot className="h-3 w-3" />}{row.control.state === 'human' ? (row.control.ownerId ? 'Human takeover' : 'Needs human reply') : 'Sophie control'}
                </span>}
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-h-[620px] flex-col">
          {!selected ? <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground"><MailOpen className="mb-2 h-8 w-8" /><p>Select an email to read it.</p></div> : <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
              <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{selected.subject || '(no subject)'}</h2><p className="mt-1 break-all text-sm text-muted-foreground">From: {selected.fromAddress}</p><p className="break-all text-sm text-muted-foreground">To: {selected.toAddress || 'Sophie'}</p><p className="mt-1 text-xs text-muted-foreground">{displayDate(selected.receivedTime)}</p></div>
              {folder === 'inbox' && <button type="button" onClick={() => void changeControl()} disabled={working} className="inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
                {selectedIsHuman ? <Bot className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}{selectedIsHuman ? 'Return to Sophie' : 'Take over'}
              </button>}
            </div>
            <article className="min-h-[220px] flex-1 whitespace-pre-wrap break-words p-5 text-sm leading-6">{content || 'Loading email content…'}</article>
            {folder === 'sent' ? <p className="border-t p-4 text-sm text-muted-foreground">This is a sent message from Sophie’s mailbox.</p> : <form onSubmit={submitReply} className="border-t p-4">
              {!selectedIsHuman ? <p className="mb-3 text-sm text-muted-foreground">Take over this thread to enable manual replies.</p> : <>
                <label htmlFor="sophie-reply" className="mb-2 block text-sm font-semibold">Reply as Sophie</label>
                <textarea id="sophie-reply" value={reply} onChange={(event) => setReply(event.target.value)} rows={5} maxLength={20000} placeholder="Write your reply…" className="w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
                <div className="mt-3 flex justify-end"><button type="submit" disabled={working || !reply.trim()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" />{working ? 'Sending…' : 'Send reply'}</button></div>
              </>}
              <p className="mt-2 text-xs text-muted-foreground">Automatic email replies run only when enabled in the backend. Taking over a thread stops Sophie from sending replies to it.</p>
            </form>}
          </>}
        </main>
      </div>}
    </section>
  );
}
