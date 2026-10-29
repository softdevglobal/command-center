import { useCallback, useEffect, useState } from 'react';
import { Bot, CircleCheck, CirclePlus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AiAgentAccountsModal } from '@/components/dashboard/AiAgentAccountsModal';
import { fetchAiAgentOptions, type AiAgentOption } from '@/services/aiAgentAdminApi';

type Brand = 'black' | 'trade' | 'pink';

export function AiReceptionistAccountsTab() {
  const [brand, setBrand] = useState<Brand>('trade');
  const [options, setOptions] = useState<AiAgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async (cancelled: () => boolean) => {
    setLoading(true);
    setError('');
    try {
      const rows = await fetchAiAgentOptions(brand);
      if (!cancelled()) setOptions(rows);
    } catch (cause) {
      if (!cancelled()) {
        setOptions([]);
        setError(cause instanceof Error ? cause.message : 'Could not load AI receptionist accounts.');
      }
    } finally {
      if (!cancelled()) setLoading(false);
    }
  }, [brand]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load, refresh]);

  const brandName = brand === 'trade' ? 'BMS Trade' : brand === 'pink' ? 'BMS Pink' : 'BMS Black';

  return (
    <div className="cc-fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Agents &amp; Performance</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">AI Receptionists</h1>
          <p className="mt-1 text-sm text-muted-foreground">View mapped business numbers and manage their Black, Trade or Pink receptionist accounts.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
          </Button>
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <CirclePlus className="mr-2 h-4 w-4" />Add AI Receptionist
          </Button>
        </div>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="AI receptionist product">
        {(['trade', 'black', 'pink'] as const).map((item) => (
          <Button key={item} type="button" size="sm" variant={brand === item ? 'default' : 'outline'}
            role="tab" aria-selected={brand === item} onClick={() => setBrand(item)}>
            {item === 'trade' ? 'BMS Trade' : item === 'pink' ? 'BMS Pink' : 'BMS Black'}
          </Button>
        ))}
      </div>

      <Card className="border-border/80 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Bot className="h-5 w-5" />{brandName} phone numbers</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
          {loading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading mapped phone numbers…</p>
            : options.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">
              {error ? 'Check the backend connection and retry.' : `No ${brandName} phone numbers are mapped yet.`}
            </div> : <div className="divide-y divide-slate-100">
              {options.map((item) => (
                <div key={item.did} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-1 last:pb-1">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{item.workshopName}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{[item.branchName, item.did].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.account ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      <CircleCheck className="h-3.5 w-3.5" />Account created
                    </span> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">No account yet</span>}
                    {item.account && <span className="hidden text-sm text-slate-700 sm:inline">{item.account.name}</span>}
                  </div>
                </div>
              ))}
            </div>}
        </CardContent>
      </Card>

      <AiAgentAccountsModal open={createOpen} initialBrand={brand} onClose={() => {
        setCreateOpen(false);
        setRefresh((value) => value + 1);
      }} />
    </div>
  );
}
