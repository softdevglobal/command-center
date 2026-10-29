import { useEffect, useState } from 'react';
import { Bot, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createAiAgent, fetchAiAgentOptions, type AiAgentOption, type AiAgentResult } from '@/services/aiAgentAdminApi';

type Brand = 'black' | 'trade' | 'pink';

export function AiAgentAccountsModal({ open, onClose, initialBrand = 'black' }: { open: boolean; onClose: () => void; initialBrand?: Brand }) {
  const [options, setOptions] = useState<AiAgentOption[]>([]);
  const [brand, setBrand] = useState<Brand>(initialBrand);
  const [did, setDid] = useState('');
  const [name, setName] = useState('AI Receptionist');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<AiAgentResult | null>(null);
  const [reload, setReload] = useState(0);
  const selected = options.find((item) => item.did === did);
  const uid = result?.firebaseBlackUid || result?.firebaseBlueUid || result?.firebasePinkUid || selected?.account?.firebaseBlackUid || selected?.account?.firebaseBlueUid || selected?.account?.firebasePinkUid;

  useEffect(() => {
    if (open) setBrand(initialBrand);
  }, [open, initialBrand]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setOptions([]);
    setDid('');
    setName('AI Receptionist');
    setResult(null);
    setCopied(false);
    fetchAiAgentOptions(brand)
      .then((items) => { if (!cancelled) setOptions(items); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load phone numbers.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, reload, brand]);

  async function handleCreate() {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    try {
      const account = await createAiAgent({ did, name: name.trim(), brand });
      setResult(account);
      setOptions((items) => items.map((item) => item.did === account.did
        ? { ...item, account: { firebaseBlackUid: account.firebaseBlackUid, firebaseBlueUid: account.firebaseBlueUid, firebasePinkUid: account.firebasePinkUid, name: account.name } }
        : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the AI account.');
    } finally { setSaving(false); }
  }

  async function copyUid() {
    if (!uid) return;
    try { await navigator.clipboard.writeText(uid); setCopied(true); }
    catch { setError('Copy failed. Select the account UID below and copy it manually.'); }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto bg-white" onInteractOutside={(event) => { if (saving) event.preventDefault(); }} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />AI Receptionist Accounts</DialogTitle>
          <DialogDescription>Create a Black, Trade or Pink receptionist account for a mapped business phone number.</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          Choose a mapped phone number to assign the account to its business. Black and Pink accounts also use the mapped branch. The account needs no login password.
        </p>
        <div className="space-y-2">
          <Label htmlFor="ai-agent-brand">Product</Label>
          <Select value={brand} disabled={saving} onValueChange={(value: Brand) => { setBrand(value); setDid(''); setResult(null); setOptions([]); }}>
            <SelectTrigger id="ai-agent-brand"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="black">BMS Black</SelectItem><SelectItem value="trade">BMS Trade</SelectItem><SelectItem value="pink">BMS Pink</SelectItem></SelectContent>
          </Select>
        </div>
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {loading ? <p role="status" className="text-sm text-muted-foreground">Loading business phone numbers…</p> : (
          <>
            {options.length === 0 && !error && <p className="text-sm text-muted-foreground">No mapped phone numbers found. Add a {brand === 'trade' ? 'Trade business mapping with a Blue queue' : brand === 'pink' ? 'Pink salon and branch mapping with a Pink queue' : 'Black workshop and branch mapping'} on the DID Mappings page first.</p>}
            {options.length > 0 && <>
              <div className="space-y-2">
                <Label htmlFor="ai-agent-did">Business phone number</Label>
                <Select value={did || undefined} disabled={saving} onValueChange={(value) => {
                  setDid(value); setResult(null); setCopied(false); setError('');
                  setName(options.find((item) => item.did === value)?.account?.name || 'AI Receptionist');
                }}>
                  <SelectTrigger id="ai-agent-did"><SelectValue placeholder="Select business phone number" /></SelectTrigger>
                  <SelectContent>{options.map((item) => <SelectItem key={item.did} value={item.did}>{[item.workshopName, item.branchName, item.did].filter(Boolean).join(' · ')}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {selected && <p className="text-sm text-muted-foreground">Assigned to {[selected.workshopName, selected.branchName].filter(Boolean).join(', ')}. Product: BMS {brand === 'trade' ? 'Trade' : brand === 'pink' ? 'Pink' : 'Black'}.</p>}
              <div className="space-y-2">
                <Label htmlFor="ai-agent-name">Account name</Label>
                <Input id="ai-agent-name" value={name} maxLength={120} disabled={saving || !!selected?.account} onChange={(event) => setName(event.target.value)} />
              </div>
            </>}
          </>
        )}
        {uid && <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p role="status" className="text-sm font-medium text-emerald-800">{result?.created ? 'AI account created' : 'AI account already exists'}</p>
          <Label htmlFor="ai-agent-uid">Account UID</Label>
          <Input id="ai-agent-uid" readOnly value={uid} className="bg-white font-mono text-xs" />
          <Button type="button" variant="outline" size="sm" onClick={() => void copyUid()}><Copy className="mr-2 h-4 w-4" />{copied ? 'Copied' : 'Copy UID'}</Button>
          <p className="text-sm text-emerald-900">The backend uses this account for the selected phone mapping. Calls become active after the backend and Yeastar setup are complete.</p>
        </div>}
        <DialogFooter>
          {!saving && error && !uid && <Button variant="outline" onClick={() => setReload((value) => value + 1)}>Retry loading</Button>}
          <Button variant="outline" disabled={saving} onClick={onClose}>Close</Button>
          {!selected?.account && !result && <Button disabled={loading || saving || !selected || !name.trim()} onClick={() => void handleCreate()}>{saving ? 'Creating…' : 'Create AI Account'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
