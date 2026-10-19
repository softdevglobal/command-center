import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Bot, ChevronDown, Download, FileClock, PhoneCall, RefreshCw, Wrench } from 'lucide-react';
import { fetchAiAgentActivity, type AiAgentActivityEvent, type AiAgentActivityType } from '@/services/aiAgentActivityApi';

const PAGE_SIZE = 100;
const eventLabels: Record<AiAgentActivityType, string> = {
  call_started: 'Call started',
  call_answered: 'Call answered',
  call_ended: 'Call ended',
  mcp_tool: 'MCP tool',
  usage_updated: 'Model usage',
};

function dateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function duration(ms?: number | null) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function bytes(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function tokenCount(usage?: Record<string, unknown>) {
  if (!usage) return null;
  const read = (key: string): number | null => typeof usage[key] === 'number' ? usage[key] as number : null;
  const input = read('input_tokens');
  const output = read('output_tokens');
  if (input !== null || output !== null) return (input ?? 0) + (output ?? 0);
  const total = read('total_tokens');
  if (total !== null) return total;
  let sum = 0;
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4) return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'input_tokens' || key === 'output_tokens' || key === 'total_tokens') continue;
      if (/token/i.test(key) && typeof item === 'number') sum += item;
      else visit(item, depth + 1);
    }
  };
  visit(usage);
  return sum || null;
}

function tokenText(usage?: Record<string, unknown>) {
  const count = tokenCount(usage);
  return count === null ? 'Not reported' : new Intl.NumberFormat().format(count);
}

function brandLabel(brand: AiAgentActivityEvent['brand']) {
  return brand === 'trade' ? 'Trade' : brand === 'black' ? 'Black' : 'Onboarding';
}

function eventTitle(event: AiAgentActivityEvent) {
  return event.event_type === 'mcp_tool' ? event.tool_name || 'MCP tool' : eventLabels[event.event_type];
}

interface Transaction {
  callId: string;
  events: AiAgentActivityEvent[];
  started?: AiAgentActivityEvent;
  answered?: AiAgentActivityEvent;
  ended?: AiAgentActivityEvent;
  usage?: AiAgentActivityEvent;
  tools: AiAgentActivityEvent[];
}

function buildTransactions(events: AiAgentActivityEvent[]): Transaction[] {
  const grouped = new Map<string, Transaction>();
  for (const event of events) {
    let row = grouped.get(event.call_id);
    if (!row) { row = { callId: event.call_id, events: [], tools: [] }; grouped.set(event.call_id, row); }
    row.events.push(event);
    if (event.event_type === 'call_started') row.started = event;
    if (event.event_type === 'call_answered') row.answered = event;
    if (event.event_type === 'call_ended') row.ended = event;
    if (event.event_type === 'usage_updated' && (!row.usage || event.occurred_at > row.usage.occurred_at)) row.usage = event;
    if (event.event_type === 'mcp_tool') row.tools.push(event);
  }
  return [...grouped.values()].sort((a, b) => (b.started?.occurred_at || b.events[0]?.occurred_at || '').localeCompare(a.started?.occurred_at || a.events[0]?.occurred_at || ''));
}

function downloadCsv(events: AiAgentActivityEvent[]) {
  const headers = ['time', 'call_id', 'event', 'brand', 'mode', 'did', 'business', 'branch', 'model', 'tool', 'status', 'duration_ms', 'input_bytes', 'output_bytes', 'usage'];
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(','), ...events.map(event => [event.occurred_at, event.call_id, event.event_type, event.brand, event.mode, event.did, event.business_name, event.branch_name, event.model, event.tool_name, event.status, event.duration_ms, event.input_bytes, event.output_bytes, JSON.stringify(event.usage ?? {})].map(quote).join(','))];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ai-agent-activity.csv'; anchor.click(); URL.revokeObjectURL(url);
}

export function AiAgentActivityTab() {
  const [events, setEvents] = useState<AiAgentActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<'transactions' | 'audit'>('transactions');
  const [brand, setBrand] = useState('');
  const [mode, setMode] = useState('');
  const [did, setDid] = useState('');
  const [didFilter, setDidFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDid(didFilter), 350);
    return () => window.clearTimeout(timer);
  }, [didFilter]);

  const fetchPage = useCallback(async (nextOffset: number, append: boolean) => {
    setLoading(true); setError('');
    try {
      const result = await fetchAiAgentActivity({ limit: PAGE_SIZE, offset: nextOffset, brand, mode, did: did.trim(), from: from ? `${from}T00:00:00.000Z` : '', to: to ? `${to}T23:59:59.999Z` : '' });
      setEvents(current => append ? [...current, ...result.data] : result.data);
      setTotal(result.total); setOffset(nextOffset + result.data.length);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load AI agent activity.'); }
    finally { setLoading(false); }
  }, [brand, mode, did, from, to]);

  useEffect(() => { setEvents([]); setOffset(0); void fetchPage(0, false); }, [fetchPage]);

  const visibleEvents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return events.filter(event => !needle || [event.call_id, event.event_type, event.mode, event.brand, event.did, event.business_name, event.branch_name, event.model, event.tool_name, event.status].some(value => String(value ?? '').toLowerCase().includes(needle)));
  }, [events, search]);
  const transactions = useMemo(() => buildTransactions(visibleEvents), [visibleEvents]);
  const answeredCalls = transactions.filter(row => row.answered).length;
  const toolCalls = visibleEvents.filter(event => event.event_type === 'mcp_tool').length;
  const totalTokens = transactions.reduce((sum, row) => sum + (tokenCount(row.usage?.usage) ?? 0), 0);

  return <div className="animate-in fade-in space-y-5 duration-300">
    <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">AI operations</p><h2 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900"><Bot className="h-6 w-6" />Agent transactions &amp; audit</h2><p className="mt-1 max-w-3xl text-sm text-slate-500">Review AI call sessions, reported model usage, and the tools the assistant invoked. Caller audio, transcripts, tool arguments, and raw results are not stored here.</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => downloadCsv(visibleEvents)} disabled={!visibleEvents.length} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"><Download className="h-4 w-4" />Export loaded rows</button>
        <button type="button" onClick={() => void fetchPage(0, false)} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>
    </header>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<PhoneCall className="h-4 w-4" />} label="Calls in loaded rows" value={transactions.length} />
      <Metric icon={<Activity className="h-4 w-4" />} label="Answered calls" value={answeredCalls} />
      <Metric icon={<Wrench className="h-4 w-4" />} label="Tool transactions" value={toolCalls} />
      <Metric icon={<FileClock className="h-4 w-4" />} label="Reported model tokens" value={new Intl.NumberFormat().format(totalTokens)} />
    </div>

    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="inline-flex w-fit rounded-xl bg-slate-100 p-1">
          <button type="button" onClick={() => setView('transactions')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === 'transactions' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Usage transactions</button>
          <button type="button" onClick={() => setView('audit')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === 'audit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>AI audit log</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <select aria-label="Filter product" value={brand} onChange={event => setBrand(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All products</option><option value="black">Black</option><option value="trade">Trade</option><option value="onboarding">Onboarding</option></select>
          <select aria-label="Filter agent route" value={mode} onChange={event => setMode(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All routes</option><option value="receptionist">Black reception</option><option value="trade">Trade</option><option value="onboarding">Onboarding</option></select>
          <input aria-label="Filter DID" inputMode="numeric" placeholder="DID number" value={didFilter} onChange={event => setDidFilter(event.target.value.replace(/\D/g, '').slice(0, 15))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <input aria-label="From date" type="date" value={from} onChange={event => setFrom(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <input aria-label="To date" type="date" value={to} onChange={event => setTo(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <input aria-label="Search loaded activity" placeholder="Search loaded rows" value={search} onChange={event => setSearch(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Showing {visibleEvents.length.toLocaleString()} loaded events of {total.toLocaleString()} matching events. Token counts are included when the voice provider reports them; this page does not estimate provider or phone charges.</p>
    </div>

    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

    {view === 'transactions' ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto"><table className="w-full min-w-[1020px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Started', 'Agent / business', 'Product', 'DID', 'Duration', 'Model tokens', 'Tools', 'Audio in / out', 'Status'].map(label => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}<th className="w-10 px-3 py-3" /></tr></thead>
        <tbody className="divide-y divide-slate-100">{loading && !events.length ? <tr><td colSpan={10} className="py-12 text-center text-slate-500">Loading agent transactions…</td></tr> : transactions.length === 0 ? <tr><td colSpan={10} className="py-12 text-center text-slate-500">No AI agent activity found. Calls appear here after bridge telemetry is deployed and the database table is installed.</td></tr> : transactions.map(row => {
          const info = row.started || row.events[0]; const open = expandedCall === row.callId;
          return <FragmentRow key={row.callId} row={row} info={row.answered || info} open={open} onToggle={() => setExpandedCall(open ? null : row.callId)} />;
        })}</tbody>
      </table></div>
    </div> : <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm">
      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Time', 'Event', 'Agent / business', 'Product / route', 'DID', 'Tool', 'Result', 'Duration', 'Call reference'].map(label => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{loading && !events.length ? <tr><td colSpan={9} className="py-12 text-center text-slate-500">Loading AI audit records…</td></tr> : visibleEvents.length === 0 ? <tr><td colSpan={9} className="py-12 text-center text-slate-500">No AI audit events found.</td></tr> : visibleEvents.map(event => <tr key={event.id} className="hover:bg-slate-50"><td className="whitespace-nowrap px-4 py-3 text-slate-500">{dateTime(event.occurred_at)}</td><td className="px-4 py-3 font-semibold text-slate-800">{eventTitle(event)}</td><td className="px-4 py-3">{event.business_name || 'AI voice agent'}{event.branch_name ? <span className="block text-xs text-slate-500">{event.branch_name}</span> : null}</td><td className="px-4 py-3">{brandLabel(event.brand)}<span className="block text-xs text-slate-500">{event.mode}</span></td><td className="px-4 py-3 font-mono">{event.did}</td><td className="px-4 py-3">{event.tool_name || '—'}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{event.status || 'recorded'}</span></td><td className="px-4 py-3">{duration(event.duration_ms)}</td><td className="max-w-36 truncate px-4 py-3 font-mono text-xs text-slate-500" title={event.call_id}>{event.call_id.slice(0, 8)}</td></tr>)}</tbody>
    </table></div></div>}

    {events.length < total && <div className="flex justify-center"><button type="button" onClick={() => void fetchPage(offset, true)} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">{loading ? 'Loading…' : 'Load more activity'}<ChevronDown className="h-4 w-4" /></button></div>}
    <p className="text-xs text-slate-400">Usage records include call duration, audio byte counts, model token counts when supplied, and tool execution status. Exact OpenAI and telecom charges should be reconciled with provider billing.</p>
  </div>;
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{icon}{label}</div><div className="mt-3 text-2xl font-bold text-slate-900">{value}</div></div>;
}

function FragmentRow({ row, info, open, onToggle }: { row: Transaction; info: AiAgentActivityEvent; open: boolean; onToggle: () => void }) {
  const event = row.ended;
  return <>
    <tr className="cursor-pointer hover:bg-slate-50" onClick={onToggle}>
      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{dateTime(row.started?.occurred_at || info.occurred_at)}</td>
      <td className="px-4 py-3"><span className="font-medium text-slate-800">{info.business_name || 'AI voice agent'}</span>{info.branch_name ? <span className="block text-xs text-slate-500">{info.branch_name}</span> : null}<span className="block font-mono text-[10px] text-slate-400">{row.callId.slice(0, 8)}</span></td>
      <td className="px-4 py-3">{brandLabel(info.brand)}<span className="block text-xs text-slate-500">{info.mode}</span></td>
      <td className="px-4 py-3 font-mono">{info.did}</td>
      <td className="px-4 py-3">{duration(event?.duration_ms)}</td>
      <td className="px-4 py-3">{tokenText(row.usage?.usage)}</td>
      <td className="px-4 py-3">{row.tools.length}</td>
      <td className="px-4 py-3 text-xs">{bytes(event?.input_bytes)} / {bytes(event?.output_bytes)}</td>
      <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${event ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'}`}>{event ? event.status || 'Ended' : 'In progress'}</span></td>
      <td className="px-3 py-3"><ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} /></td>
    </tr>
    {open && <tr><td colSpan={10} className="bg-slate-50 px-5 py-4"><div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI call audit trail</p>{[...row.events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map(item => <div key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><span className="text-slate-500">{dateTime(item.occurred_at)}</span><span className="font-semibold text-slate-800">{eventTitle(item)}</span>{item.status ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{item.status}</span> : null}{item.duration_ms != null ? <span className="text-slate-500">{duration(item.duration_ms)}</span> : null}{item.event_type === 'usage_updated' ? <span className="text-slate-500">{tokenText(item.usage)}</span> : null}</div>)}</div><p className="mt-3 text-xs text-slate-500">Model: {info.model || 'Not reported'}{row.usage ? ` · Latest reported tokens: ${tokenText(row.usage.usage)}` : ' · Token usage not reported'}</p></td></tr>}
  </>;
}
