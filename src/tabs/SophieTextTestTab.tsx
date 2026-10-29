import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, Loader2, MessageSquareText, Play, RefreshCw, Send, Square, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { endTextTest, fetchTextTestOptions, sendTextTestMessage, startTextTest, type TextTestBrand, type TextTestMode, type TextTestOptions, type TextTestSession, type TextToolTrace } from '@/services/sophieTextTestApi';

type Message = { id: string; role: 'user' | 'assistant'; text: string; tools?: TextToolTrace[] };
const productName = (brand: TextTestBrand) => brand === 'trade' ? 'BMS Trade' : brand === 'pink' ? 'BMS Pink' : 'BMS Black';

export function SophieTextTestTab() {
  const [options, setOptions] = useState<TextTestOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [mode, setMode] = useState<TextTestMode>('receptionist');
  const [brand, setBrand] = useState<TextTestBrand>('pink');
  const [did, setDid] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [session, setSession] = useState<TextTestSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState({ requests: 0, inputTokens: 0, outputTokens: 0 });
  const sessionRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const scrollEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void fetchTextTestOptions().then(result => { if (!cancelled) setOptions(result); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load test options.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  const choices = mode === 'onboarding'
    ? (options?.onboarding ?? []).map(number => ({ did: number, label: `Business onboarding · ${number}` }))
    : (options?.receptionist ?? []).filter(row => row.brand === brand).map(row => ({ did: row.did, label: [row.name, row.branch, row.did].filter(Boolean).join(' · ') }));
  const choiceKey = choices.map(choice => choice.did).join(',');
  useEffect(() => {
    if (!sessionRef.current) setDid(current => choices.some(choice => choice.did === current) ? current : choices[0]?.did ?? '');
    // Only the selected mode, product and returned number list determine the default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, brand, choiceKey]);
  useEffect(() => { scrollEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, busy]);
  useEffect(() => () => {
    generation.current++; requestRef.current?.abort();
    const id = sessionRef.current; sessionRef.current = null;
    if (id) void endTextTest(id).catch(() => undefined);
  }, []);

  async function start() {
    if (!did || !acknowledge || starting || session) return;
    const current = ++generation.current, controller = new AbortController(); requestRef.current = controller;
    setStarting(true); setError(''); setMessages([]); setEnded(false); setUsage({ requests: 0, inputTokens: 0, outputTokens: 0 });
    try {
      const result = await startTextTest({ mode, did, ...(mode === 'receptionist' ? { brand } : {}), acknowledgeRealActions: true }, controller.signal);
      if (generation.current !== current) { void endTextTest(result.id).catch(() => undefined); return; }
      sessionRef.current = result.id; setSession(result); setUsage(result.usage);
      setMessages([{ id: crypto.randomUUID(), role: 'assistant', text: result.text, tools: result.tools }]);
    } catch (cause) {
      if (generation.current === current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not start Sophie.');
    } finally { if (generation.current === current) setStarting(false); }
  }

  async function end() {
    generation.current++; requestRef.current?.abort();
    const id = sessionRef.current; sessionRef.current = null;
    setEnding(true); setBusy(false); setStarting(false); setError('');
    try { if (id) await endTextTest(id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not confirm session cleanup.'); }
    finally { setSession(null); setEnding(false); setEnded(true); setAcknowledge(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim(), id = sessionRef.current;
    if (!text || !id || busy || ending) return;
    const messageId = crypto.randomUUID(), current = generation.current, controller = new AbortController(); requestRef.current = controller;
    setMessages(previous => [...previous, { id: messageId, role: 'user', text }]); setInput(''); setBusy(true); setError('');
    try {
      const result = await sendTextTestMessage(id, text, messageId, controller.signal);
      if (generation.current !== current) return;
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'assistant', text: result.text, tools: result.tools }]); setUsage(result.usage);
    } catch (cause) {
      if (generation.current === current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Sophie could not reply.');
    } finally { if (generation.current === current) setBusy(false); }
  }

  const locked = Boolean(session) || starting || ending;
  const fieldClass = 'mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-400';
  return (
    <div className="cc-fade-in space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-sky-700">Sophie testing</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Text Test</h1>
          <p className="mt-1 text-sm text-slate-500">Talk to Sophie using the real business and onboarding tools. No microphone or phone call.</p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">Real integrations · text only</span>
      </div>
      <div className="grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)]">
        <section aria-label="Text test settings" className="self-start rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Start a conversation</h2>
          <label className="mt-5 block text-sm font-medium text-slate-700">Test flow
            <select className={fieldClass} value={mode} disabled={locked} onChange={event => setMode(event.target.value as TextTestMode)}>
              <option value="receptionist">Business knowledge &amp; bookings</option><option value="onboarding">Business onboarding</option>
            </select>
          </label>
          {mode === 'receptionist' ? <label className="mt-4 block text-sm font-medium text-slate-700">Product
            <select className={fieldClass} value={brand} disabled={locked} onChange={event => setBrand(event.target.value as TextTestBrand)}>
              {(['black', 'pink', 'trade'] as const).map(product => <option key={product} value={product}>{productName(product)}</option>)}
            </select>
          </label> : <p className="mt-4 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">Sophie will ask whether you want Black, Pink or Trade, then guide you through that signup.</p>}
          <label className="mt-4 block text-sm font-medium text-slate-700">{mode === 'onboarding' ? 'Onboarding number' : 'Mapped business number'}
            <select className={fieldClass} value={did} disabled={locked || loading} onChange={event => setDid(event.target.value)}>
              {!choices.length && <option value="">{loading ? 'Loading numbers…' : 'No enabled numbers found'}</option>}
              {choices.map(choice => <option key={choice.did} value={choice.did}>{choice.label}</option>)}
            </select>
          </label>
          <Button variant="ghost" size="sm" className="mt-2 px-0 text-slate-500" disabled={locked || loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw className="mr-2 h-3.5 w-3.5" />Reload numbers</Button>
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">This uses real data</p><p className="mt-1">Confirmed bookings and signups create real records and can send customer emails or SMS.</p>
            <label className="mt-3 flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={acknowledge} disabled={locked} onChange={event => setAcknowledge(event.target.checked)} /><span>I understand and want to use real integrations.</span></label>
          </div>
          <Button className="mt-4 w-full" disabled={locked || loading || !did || !acknowledge} onClick={() => void start()}>
            {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />} {starting ? 'Connecting to Sophie…' : 'Start test'}
          </Button>
          <Button className="mt-2 w-full" variant="outline" disabled={(!session && !starting) || ending} onClick={() => void end()}>
            <Square className="mr-2 h-4 w-4" />{ending ? 'Ending…' : 'End test'}
          </Button>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">End test closes this text session. Records already submitted stay in the real system. Idle text sessions expire after 15 minutes.</p>
        </section>
        <section className="flex min-h-[580px] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Chat with Sophie">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4"><div className="rounded-xl bg-sky-50 p-2 text-sky-700"><Bot className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-slate-900">{session?.label || 'Sophie'}</h2><p className="text-xs text-slate-500">{session ? `${session.did} · ${session.model}` : ended ? 'Test ended' : 'Ready when you are'}</p></div>
            {session && <span className="h-2 w-2 rounded-full bg-emerald-500" aria-label="Session active" />}
          </div>
          {error && <div role="alert" className="mx-5 mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>}
          <div className="flex-1 space-y-5 overflow-y-auto p-5" style={{ maxHeight: '62vh' }} role="log" aria-live="polite">
            {!messages.length && <div className="flex min-h-[300px] flex-col items-center justify-center px-4 text-center text-slate-500"><MessageSquareText className="mb-4 h-10 w-10 text-slate-300" /><p className="font-medium text-slate-700">A real conversation, without the call</p><p className="mt-2 max-w-sm text-sm">Choose a flow and press Start test. Ask business questions, check availability, book an appointment, or set up a business account.</p></div>}
            {messages.map(message => <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className="max-w-[90%] sm:max-w-[85%]">
              <p className={`mb-1 text-xs font-medium ${message.role === 'user' ? 'text-right text-slate-500' : 'text-sky-700'}`}>{message.role === 'user' ? 'You' : 'Sophie'}</p>
              <div className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === 'user' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-800'}`}>{message.text}</div>
              {Boolean(message.tools?.length) && <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600"><summary className="cursor-pointer px-3 py-2"><Wrench className="mr-1.5 inline h-3 w-3" />Live tool activity ({message.tools!.length})</summary><div className="space-y-3 p-3 pt-0">{message.tools!.map((tool, index) => <div key={`${tool.name}-${index}`}><p className="font-mono font-semibold">{tool.name} · {tool.status}</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2">{JSON.stringify(tool.result, null, 2)}</pre></div>)}</div></details>}
            </div></div>)}
            {busy && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Sophie is working…</p>}
            <div ref={scrollEnd} />
          </div>
          <form className="border-t border-slate-100 p-4" onSubmit={event => void send(event)}>
            <div className="flex items-end gap-2"><label className="sr-only" htmlFor="sophie-text-message">Message Sophie</label><textarea id="sophie-text-message" rows={2} maxLength={4000} value={input} disabled={!session || busy || ending} placeholder={session ? 'Type your message to Sophie…' : 'Start a test to chat with Sophie'} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(event); } }} className="min-h-[70px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50" /><Button type="submit" disabled={!session || busy || ending || !input.trim()} aria-label="Send message"><Send className="h-4 w-4" /></Button></div>
            <p className="mt-2 text-xs text-slate-400">{usage.requests ? `${usage.requests} text requests · ${usage.inputTokens.toLocaleString()} input / ${usage.outputTokens.toLocaleString()} output tokens` : 'Only submitted messages use the text model.'}</p>
          </form>
        </section>
      </div>
    </div>
  );
}
