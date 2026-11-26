import { useState } from 'react';
import { api, cents, forgetLoaded, useData } from '../lib';
import { at } from '../base';

// Three Settings panels added for a household moving in from another budgeting app and wanting to keep
// everything at home: a model of your own for the AI features (server/localai.js), bringing a YNAB budget
// across (server/ynab.js), and copies of the database (server/backup.js).

/** A model the household runs itself (Ollama, LM Studio and the like), for the AI features that don't need Claude. */
export function LocalAi({ onChange }: { onChange: () => void }) {
  const { data: s, reload } = useData<any>('/api/ai/local?models=1');
  const [url, setUrl] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  if (!s) return null;
  const address = url ?? s.url ?? '';
  const list = models ?? s.models ?? [];
  const chosen = model ?? (list.includes(s.model) ? s.model : list[0] ?? '');
  const done = () => { forgetLoaded(); reload(); onChange(); dispatchEvent(new Event('ledger-refresh')); };
  const look = async () => {
    setBusy('look'); setErr('');
    try { const r = await api('/api/ai/local/models', { method: 'POST', body: { url: address } }); setUrl(r.url); setModels(r.models); setModel(null); if (!r.models.length) setErr('That server answered but has no models yet. Add one there (for Ollama: ollama pull qwen3:8b), then look again.'); } catch (e: any) { setErr(e.message); setModels([]); }
    setBusy('');
  };
  const put = async (body: object, what: string) => {
    setBusy(what); setErr('');
    try { await api('/api/ai/local', { method: 'PUT', body }); setUrl(null); setModel(null); setModels(null); done(); } catch (e: any) { setErr(e.message); }
    setBusy('');
  };
  const same = s.on && address === s.url && chosen === s.model;
  return (
    <div className="ai-route local-ai" data-go="ai-local">
      <h3>A model of your own {s.on && <span className="good">On: {s.model}</span>}</h3>
      <p className="sub">
        If you run a model at home (Ollama, LM Studio, or anything else that answers OpenAI-style requests), Ledger can use it in place of a key.
        Your figures go from this server to that one and no further, and nothing is charged.
      </p>
      <p className="sub">
        It does the dashboard recap, category suggestions, the money review on the Reports page, and a CFO that looks things up in your data step by step.
        Reading receipts, statements and pay stubs, finding logos and searching official tax sites still need an Anthropic key; one saved below is still used for those.
      </p>
      <div className="local-ai-form">
        <label>Server address
          <input type="text" inputMode="url" autoComplete="off" spellCheck={false} placeholder="http://192.168.1.20:11434" value={address} disabled={!!busy}
            onChange={(e) => { setUrl(e.target.value); setModels(null); }} />
        </label>
        <button type="button" disabled={!!busy || !address.trim()} onClick={look}>{busy === 'look' ? 'Looking…' : 'See its models'}</button>
      </div>
      {list.length > 0 && (
        <div className="local-ai-form">
          <label>Model
            <select value={chosen} disabled={!!busy} onChange={(e) => setModel(e.target.value)}>
              {list.map((m: string) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          {same ? <button type="button" disabled={!!busy} onClick={() => put({ on: false }, 'off')}>Stop using it</button>
            : <button type="button" className="primary" disabled={!!busy || !chosen} onClick={() => put({ url: address, model: chosen }, 'on')}>{busy === 'on' ? 'Checking it answers…' : 'Use this model'}</button>}
        </div>
      )}
      {s.error && !err && <p className="error">{s.error}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <p className="sub">
        A model that supports tool calls (qwen3, llama3.1 and newer, mistral-nemo) lets the CFO look things up; one that doesn't still answers from the month's figures.
        Bigger models read the figures more carefully. If Ledger runs in Docker on another machine, the model server has to accept connections from it (for Ollama, set OLLAMA_HOST=0.0.0.0).
      </p>
    </div>
  );
}

const readText = (file: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result || '')); r.onerror = () => bad(new Error("That file couldn't be read.")); r.readAsText(file); });

/** Bringing a YNAB budget across: its register (every transaction) and, optionally, its plan (what each category was given). */
export function YnabImport({ onDone }: { onDone: () => void }) {
  const [register, setRegister] = useState('');
  const [plan, setPlan] = useState('');
  const [p, setP] = useState<any>(null);
  const [choices, setChoices] = useState<Record<string, any>>({});
  const [rules, setRules] = useState(true);
  const [budgets, setBudgets] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<any>(null);

  const look = async (reg: string, pl: string) => {
    setErr(''); setResult(null);
    if (!reg) { setP(null); return; }
    setBusy(true);
    try {
      const v = await api('/api/ynab/preview', { method: 'POST', body: { register: reg, plan: pl } });
      setP(v);
      setChoices(Object.fromEntries(v.accounts.map((a: any) => [a.name, a.match != null ? { to: a.match } : { type: a.type }])));
    } catch (e: any) { setErr(e.message); setP(null); }
    setBusy(false);
  };
  const pick = async (which: 'register' | 'plan', file?: File) => {
    if (!file) return;
    if (file.size > 7_000_000) { setErr('That file is too large to bring in at once (7 MB at most). Export a shorter stretch from YNAB, or ask for help splitting it.'); return; }
    try {
      const text = await readText(file);
      if (which === 'register') { setRegister(text); await look(text, plan); } else { setPlan(text); await look(register, text); }
    } catch (e: any) { setErr(e.message); }
  };
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api('/api/ynab/import', { method: 'POST', body: { register, plan, choices: { accounts: choices, rules, budgets } } });
      setResult(r); setP(null); setRegister(''); setPlan('');
      forgetLoaded(); dispatchEvent(new Event('ledger-refresh')); onDone();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const set = (name: string, value: string) => setChoices({ ...choices, [name]: value === 'skip' ? { skip: true } : value.startsWith('to:') ? { to: Number(value.slice(3)) } : { type: value } });
  const valueOf = (c: any) => (c?.skip ? 'skip' : c?.to != null ? `to:${c.to}` : c?.type ?? 'checking');
  const coming = p ? p.accounts.filter((a: any) => !choices[a.name]?.skip).reduce((n: number, a: any) => n + a.rows, 0) : 0;

  return (
    <section className="card ynab-import">
      <div className="card-head"><h2>Moving in from YNAB</h2></div>
      <p className="sub first">
        Brings your YNAB history across with what YNAB already knows: which account each transaction belongs to, the category you chose for it, its memo, and which rows are transfers.
        It also learns where you file each shop, so Ledger files them the same way from now on. The files are read on this server and sent nowhere.
      </p>
      <ol className="sub ynab-steps">
        <li>In YNAB on the web, click your budget's name at the top left and choose <b>Export budget</b> (called Export plan in newer versions).</li>
        <li>Unzip the file it downloads. Inside are two files: one with <b>Register</b> in its name and one with <b>Plan</b> (or Budget).</li>
        <li>Choose them here. Nothing is changed until you press the button at the bottom.</li>
      </ol>
      <div className="ynab-files">
        <label>Register file (every transaction)<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => pick('register', e.target.files?.[0])} /></label>
        <label>Plan file (optional: your monthly amounts)<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => pick('plan', e.target.files?.[0])} /></label>
      </div>
      {err && <p className="error" role="alert">{err}</p>}

      {p && (
        <>
          <p><b>{p.rows.toLocaleString()} transactions</b> from {p.from} to {p.to}, in {p.accounts.length} account{p.accounts.length === 1 ? '' : 's'}.{p.unread ? ` ${p.unread} row${p.unread === 1 ? '' : 's'} had no date or account and will be left out.` : ''}</p>
          {p.sample && <p className="sub">This copy still has its sample household. Bringing your budget in clears the sample accounts and their transactions away first.</p>}
          <table className="ynab-accounts">
            <thead><tr><th>YNAB account</th><th className="r">Rows</th><th className="r">Balance</th><th>In Ledger</th></tr></thead>
            <tbody>
              {p.accounts.map((a: any) => (
                <tr key={a.name}>
                  <td>{a.name}</td>
                  <td className="r num">{a.rows.toLocaleString()}</td>
                  <td className={`r num ${a.balance < 0 ? 'bad' : ''}`}>{cents(a.balance)}</td>
                  <td>
                    <select value={valueOf(choices[a.name])} disabled={busy} onChange={(e) => set(a.name, e.target.value)} aria-label={`What to do with ${a.name}`}>
                      <optgroup label="Make a new account">
                        {p.types.map((t: string) => <option key={t} value={t}>New: {t === 'auto' ? 'car loan' : t === 'hsa' ? 'health savings' : t}</option>)}
                      </optgroup>
                      {p.existing.length > 0 && <optgroup label="Add to an account already here">{p.existing.map((x: any) => <option key={x.id} value={`to:${x.id}`}>{x.name}</option>)}</optgroup>}
                      <option value="skip">Leave this account out</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sub">
            {p.categories.total} categor{p.categories.total === 1 ? 'y' : 'ies'} in use; {p.categories.fresh.length ? `${p.categories.fresh.length} will be made new (${p.categories.fresh.slice(0, 6).join(', ')}${p.categories.fresh.length > 6 ? ', and more' : ''})` : 'all are already in Ledger'}.
            {' '}{p.transfers.toLocaleString()} transfers and card payments, {p.income.toLocaleString()} rows of income{p.categories.uncategorized ? `, and ${p.categories.uncategorized} with no category (filed under Other)` : ''}.
            {' '}When you add to an account that is already here, rows that match one of its transactions by date and amount are skipped.
          </p>
          <label className="row check"><span className="grow">Learn where you file each shop ({p.rules} shop{p.rules === 1 ? '' : 's'} always filed the same way)</span><input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} /></label>
          {p.plan && <label className="row check"><span className="grow">Use {p.plan.month}'s amounts as each category's monthly budget ({p.plan.categories} categories, {cents(p.plan.total)} in all; only where no budget is set yet)</span><input type="checkbox" checked={budgets} onChange={(e) => setBudgets(e.target.checked)} /></label>}
          {p.planError && <p className="error">{p.planError}</p>}
          <p className="sub">What does not come across: category groups, flags, cleared marks, scheduled transactions and targets. Two YNAB categories with the same name in different groups become one. Bills are found again from your history on the Recurring page.</p>
          <p><button type="button" className="primary" disabled={busy || coming === 0} onClick={go}>{busy ? 'Bringing it in…' : `Bring in ${coming.toLocaleString()} transactions`}</button></p>
        </>
      )}

      {result && (
        <p className="good" role="status">
          Done: {result.added.toLocaleString()} transactions brought in{result.skipped ? `, ${result.skipped.toLocaleString()} already here and skipped` : ''}
          {result.accountsMade ? `, ${result.accountsMade} account${result.accountsMade === 1 ? '' : 's'} made` : ''}
          {result.categoriesMade ? `, ${result.categoriesMade} categor${result.categoriesMade === 1 ? 'y' : 'ies'} made` : ''}
          {result.rulesLearned ? `, ${result.rulesLearned} filing rule${result.rulesLearned === 1 ? '' : 's'} learned` : ''}
          {result.budgetsSet ? `, ${result.budgetsSet} budget${result.budgetsSet === 1 ? '' : 's'} set from ${result.budgetMonth}` : ''}.
          {' '}Bringing the same files in again adds nothing twice.
        </p>
      )}
    </section>
  );
}

const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Copies of the database: the nightly ones Ledger keeps, and one to download. */
export function Backups() {
  const { data: b, reload } = useData<any>('/api/backup');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!b) return null;
  const act = async (fn: () => Promise<any>) => { setBusy(true); setErr(''); try { await fn(); reload(); } catch (e: any) { setErr(e.message); } setBusy(false); };
  return (
    <section className="card backups">
      <div className="card-head"><h2>Backups</h2>{b.keep > 0 && <span className="good">Nightly</span>}</div>
      <p className="sub first">
        Everything you have put into Ledger is one file. Ledger makes a whole copy of it each night and keeps the last few, in a folder beside the database:
        <br /><code>{b.folder}</code>
      </p>
      <p className="sub">
        Those copies are on the same disk, so they guard against a mistake or a bad update, not against losing the disk. Have whatever backs up the rest of this machine include that folder, or download a copy now and then and keep it somewhere else.
        A copy holds everything, including your bank connection and any keys saved here: keep it as carefully as you would those.
      </p>
      <label className="row">
        <span className="grow">Nightly copies to keep</span>
        <select value={b.keep} disabled={busy} onChange={(e) => act(() => api('/api/backup', { method: 'PUT', body: { keep: Number(e.target.value) } }))}>
          {[0, 3, 7, 14, 30, 60].map((n) => <option key={n} value={n}>{n === 0 ? 'None (switched off)' : n}</option>)}
        </select>
      </label>
      <p>
        <button type="button" disabled={busy} onClick={() => act(() => api('/api/backup/now', { method: 'POST', body: {} }))}>{busy ? 'Copying…' : 'Make a copy now'}</button>{' '}
        <a className="button-link" href={at('/api/backup/download')} download>Download a copy</a>
      </p>
      {err && <p className="error" role="alert">{err}</p>}
      {b.copies.length > 0 ? (
        <ul className="backup-list">{b.copies.slice(0, 8).map((c: any) => <li key={c.name}><span>{when(c.at)}</span><span className="sub">{c.name}</span><span className="sub num">{size(c.size)}</span></li>)}</ul>
      ) : <p className="sub">No copies yet. The first is made within a minute or so of Ledger starting.</p>}
      <p className="sub">To go back to a copy: stop Ledger, put the copy in place of <code>ledger.db</code> (removing any <code>ledger.db-wal</code> and <code>ledger.db-shm</code> beside it), and start Ledger again.</p>
    </section>
  );
}
