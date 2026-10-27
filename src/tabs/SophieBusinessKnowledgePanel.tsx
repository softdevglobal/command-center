import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Save } from 'lucide-react';
import {
  fetchSophieBusinessKnowledge, saveSophieBusinessKnowledge,
  type SophieBusinessKnowledge, type SophieBusinessKnowledgeInput,
} from '@/services/sophieMailApi';

const emptyEntry = (): SophieBusinessKnowledgeInput => ({ scope: 'bms_pros', product: 'all', businessName: '', title: '', content: '', published: false });
const fieldClass = 'w-full rounded-lg border bg-background px-3 py-2 text-sm';

export function SophieBusinessKnowledgePanel() {
  const [entries, setEntries] = useState<SophieBusinessKnowledge[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SophieBusinessKnowledgeInput>(emptyEntry);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    fetchSophieBusinessKnowledge().then((rows) => { if (active) setEntries(rows); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Could not load business information.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const edit = (row: SophieBusinessKnowledge) => {
    setEditingId(row.id);
    setForm({ scope: row.scope, product: row.product, businessName: row.business_name, title: row.title, content: row.content, published: row.published });
    setError(''); setNotice('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      const row = await saveSophieBusinessKnowledge(editingId, form);
      setEntries((previous) => [row, ...previous.filter((entry) => entry.id !== row.id)]);
      setEditingId(row.id);
      setNotice(row.published ? 'Saved and published. Sophie can use this information in new email replies.' : 'Saved as a draft. Sophie will not use this entry.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save business information.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Add approved BMS Pros product details, plans, features and policies, or public answers for a named business. Sophie also reads current profiles and services for businesses configured in DID Mappings.</p>
      {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
      <div className="grid overflow-hidden rounded-xl border bg-card md:grid-cols-[280px_1fr]">
        <aside className="border-b md:border-b-0 md:border-r">
          <div className="border-b p-3"><button type="button" disabled={saving} onClick={() => { setEditingId(null); setForm(emptyEntry()); setError(''); setNotice(''); }} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Plus className="h-4 w-4" /> Add information</button></div>
          <div className="max-h-[650px] overflow-y-auto">
            {loading && <p className="p-4 text-sm text-muted-foreground">Loading information…</p>}
            {!loading && !entries.length && <p className="p-4 text-sm text-muted-foreground">No published answers yet. Add your actual approved business information.</p>}
            {entries.map((row) => <button type="button" key={row.id} disabled={saving} onClick={() => edit(row)} className={`block w-full border-b p-4 text-left hover:bg-muted ${editingId === row.id ? 'bg-muted' : ''}`}>
              <p className="break-words text-sm font-semibold">{row.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{row.scope === 'bms_pros' ? 'BMS Pros' : row.business_name} · {row.product === 'all' ? 'All products' : row.product === 'black' ? 'Black' : 'Trade'}</p>
              <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs ${row.published ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-600'}`}>{row.published ? 'Published' : 'Draft'}</span>
            </button>)}
          </div>
        </aside>
        <form onSubmit={(event) => void save(event)} className="space-y-4 p-5">
          <h2 className="text-lg font-semibold">{editingId ? 'Edit business information' : 'New business information'}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">About<select className={fieldClass} value={form.scope} disabled={saving} onChange={(event) => setForm({ ...form, scope: event.target.value as SophieBusinessKnowledgeInput['scope'], businessName: '' })}><option value="bms_pros">BMS Pros company / products</option><option value="business">An individual business</option></select></label>
            <label className="space-y-1 text-sm font-medium">Product<select className={fieldClass} value={form.product} disabled={saving} onChange={(event) => setForm({ ...form, product: event.target.value as SophieBusinessKnowledgeInput['product'] })}><option value="all">All products</option><option value="black">Black</option><option value="trade">Trade</option></select></label>
          </div>
          {form.scope === 'business' && <label className="block space-y-1 text-sm font-medium">Full business name<input className={fieldClass} required minLength={3} maxLength={180} value={form.businessName} disabled={saving} onChange={(event) => setForm({ ...form, businessName: event.target.value })} /></label>}
          <label className="block space-y-1 text-sm font-medium">Title<input className={fieldClass} required minLength={3} maxLength={200} value={form.title} disabled={saving} placeholder="For example: Black subscription plans" onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="block space-y-1 text-sm font-medium">Approved information<textarea className={fieldClass} required minLength={3} maxLength={12000} rows={12} value={form.content} disabled={saving} placeholder="Enter the accurate details Sophie may share with customers. Include relevant conditions, currency and billing periods for prices." onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={form.published} disabled={saving} onChange={(event) => setForm({ ...form, published: event.target.checked })} /><span>Publish for customer replies<p className="mt-1 text-xs text-muted-foreground">Published text can be shared with customers. Clear this box to keep the entry as a draft or withdraw it.</p></span></label>
          <button type="submit" disabled={saving || loading} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save information'}</button>
        </form>
      </div>
    </div>
  );
}
