import { Hint } from '../GoLinks';
import { useRef, useState } from 'react';
import { api, cents, useData } from '../lib';
import { Modal, shrinkPicture } from '../ui';

// Reading statements (server/statements.js): choose several PDF statements, or photos of them, at once.
// Each is read by Claude in turn and laid out for checking: which account it belongs to, its closing balance,
// what was paid, interest, the minimum and the rate. Nothing is saved until "Save what's ticked".
const asDataUrl = (file: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error("That file couldn't be opened.")); r.readAsDataURL(file); });
const DEBTS = ['credit', 'auto', 'mortgage', 'loan'];
const day = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'no date');

export function StatementReader({ onClose, onSaved, forAccount, forImport }: { onClose: () => void; onSaved: () => void; forAccount?: number; forImport?: boolean }) {
  const { data: info } = useData<any>('/api/statements/accounts');
  const box = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState<any>(null);
  // Opened from Settings, Import a file: the transactions are the point, so that box starts ticked.
  const [keep, setKeep] = useState({ history: true, rate: true, transactions: !!forImport });
  const accounts: any[] = info?.accounts || [];

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])].slice(0, 24);
    e.target.value = '';
    if (!files.length) return;
    setErr(''); setDone(null);
    const read: any[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setBusy(`Reading ${i + 1} of ${files.length}: ${f.name}`);
      try {
        const data = f.type === 'application/pdf' ? await asDataUrl(f) : await shrinkPicture(f).catch(() => { throw new Error("That picture couldn't be opened."); });
        const r = await api('/api/statements/read', { method: 'POST', body: { file: data } });
        read.push({ ...r, account_id: r.account_id || forAccount || null, file: f.name, key: `${f.name}-${i}-${Date.now()}` });
      } catch (x: any) {
        read.push({ file: f.name, key: `${f.name}-${i}-${Date.now()}`, failed: x.message || "That file couldn't be read." });
      }
      setRows((old) => [...old.filter((o) => !read.some((n) => n.key === o.key)), ...read].sort((a, b) => String(a.period_end || '').localeCompare(String(b.period_end || ''))));
    }
    setBusy('');
  };
  const set = (key: string, change: any) => setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const good = rows.filter((r) => !r.failed);
  const ready = good.filter((r) => r.account_id);
  const txCount = ready.reduce((n, r) => n + (r.transactions?.length || 0), 0);
  const typeOf = (id: number) => accounts.find((a) => a.id === Number(id))?.type;
  const save = async () => {
    setErr(''); setBusy('Saving…');
    try {
      const r = await api('/api/statements/apply', { method: 'POST', body: { items: ready.map((x) => ({ account_id: Number(x.account_id), period_end: x.period_end, new_balance: x.new_balance, payments: x.payments, interest: x.interest, principal: x.principal, minimum: x.minimum, apr: x.apr, transactions: x.transactions, keep })) } });
      setDone(r); setRows([]); onSaved(); dispatchEvent(new CustomEvent('ledger-refresh'));
    } catch (x: any) { setErr(x.message); }
    setBusy('');
  };

  return (
    <Modal title={forImport ? 'Read a statement' : 'Upload debt statements'} onClose={onClose}>
      <div className="statement-reader">
        {forImport && <p className="sub first">For an account the bank connection can't reach, when all you have is the statement: a PDF, or a photo of a paper one. Claude lists its transactions, you choose the account, and any already in Ledger are skipped. A CSV export is more exact when your bank offers one.</p>}
        {!forImport && <p className="sub first">Choose one statement or several at once: PDFs from your bank, card or lender, or photos of paper ones. Ledger reads the balance, payment, interest and rate from each, for debts already on this page. Each is sent to Claude to be read and isn't kept. You see what was read, and nothing is saved until you say so.</p>}
        {info && !info.canRead ? <p className="error"><Hint text={info.why} /></p> : (
          <div className="add-actions">
            <button type="button" className="primary" disabled={!!busy} onClick={() => box.current?.click()}>{rows.length ? 'Add more statements' : 'Choose statements'}</button>
            <input ref={box} type="file" accept="application/pdf,image/*" multiple onChange={pick} hidden />
          </div>
        )}
        {busy && <p className="sub" role="status">{busy}</p>}
        {done && <p className="good" role="status">Saved. {done.history > 0 && `${done.history} ${done.history === 1 ? 'statement' : 'statements'} added to the graphs. `}{done.rates > 0 && `Rate and payment updated on ${done.rates} ${done.rates === 1 ? 'account' : 'accounts'}. `}{done.added + done.skipped > 0 && `${done.added} ${done.added === 1 ? 'transaction' : 'transactions'} added, ${done.skipped} already here. `}{done.problems?.length > 0 && done.problems.join(' ')}</p>}

        {rows.map((r) => r.failed ? (
          <div className="stmt" key={r.key}><b>{r.file}</b><small className="bad">{r.failed}</small><button type="button" className="link" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>Remove</button></div>
        ) : (
          <div className="stmt" key={r.key}>
            <div className="stmt-head">
              <b>{[r.institution, r.account_name].filter(Boolean).join(' ') || r.file}{r.last4 ? ` ··${r.last4}` : ''}</b>
              <span className="when">{r.period_start ? `${day(r.period_start)} to ` : ''}{day(r.period_end)}</span>
              <button type="button" className="link" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>Remove</button>
            </div>
            <div className="stmt-figs">
              <span><i>Balance</i>{r.new_balance != null ? cents(r.new_balance) : 'not shown'}</span>
              <span><i>Paid</i>{r.payments != null ? cents(r.payments) : 'not shown'}</span>
              <span><i>Interest</i>{r.interest != null ? cents(r.interest) : 'not shown'}</span>
              {r.fees > 0 && <span><i>Fees</i>{cents(r.fees)}</span>}
              <span><i>Minimum</i>{r.minimum != null ? cents(r.minimum) : 'not shown'}</span>
              <span><i>Rate</i>{r.apr != null ? `${r.apr}%` : 'not shown'}</span>
              {r.transactions?.length > 0 && <span><i>Transactions</i>{r.transactions.length}</span>}
            </div>
            {r.promo_apr != null && <small className="stmt-promo">A promotional rate of {r.promo_apr}% applies now{r.promo_expires ? ` and ends ${day(r.promo_expires)}` : ''}. After that the rate is {r.apr != null ? `${r.apr}%` : 'the standard one'}.</small>}
            {r.unsure && <small>Claude's note: {r.unsure}</small>}
            <label className="field"><span>This statement is for</span>
              <select value={r.account_id || ''} onChange={(e) => set(r.key, { account_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Choose an account…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {r.account_id && !DEBTS.includes(typeOf(r.account_id)) && <small>Not a debt, so only its transactions can be saved.</small>}
            </label>
          </div>
        ))}

        {good.length > 0 && (
          <div className="stmt-save">
            <label className="hint-every"><input type="checkbox" checked={keep.history} onChange={(e) => setKeep({ ...keep, history: e.target.checked })} /> Add each statement's balance, payment and interest to that debt's graph</label>
            <label className="hint-every"><input type="checkbox" checked={keep.rate} onChange={(e) => setKeep({ ...keep, rate: e.target.checked })} /> Set each debt's rate and monthly payment from its newest statement</label>
            {txCount > 0 && <label className="hint-every"><input type="checkbox" checked={keep.transactions} onChange={(e) => setKeep({ ...keep, transactions: e.target.checked })} /> Also add the {txCount} listed {txCount === 1 ? 'transaction' : 'transactions'} (any already in Ledger are skipped)</label>}
            {txCount > 0 && keep.transactions && <small>Worth a look afterwards: a transaction read from a statement can be misread. They are added to the account each statement is for.</small>}
            {ready.length < good.length && <small className="bad">{good.length - ready.length} {good.length - ready.length === 1 ? 'statement has' : 'statements have'} no account chosen and will be left out.</small>}
            <div className="add-actions">
              <button type="button" className="primary" disabled={!!busy || !ready.length || !(keep.history || keep.rate || keep.transactions)} onClick={save}>Save what's ticked</button>
              <button type="button" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
        {err && <p className="error" role="alert"><Hint text={err} /></p>}
      </div>
    </Modal>
  );
}
