import { useEffect, useState } from 'react';
import { api, cents, dayShort } from '../lib';
import { MoneyInput } from '../ui';

/**
 * Accounts page, "Check a statement": the statement's first and last day and the balance at each end,
 * compared with the transactions Ledger has for those days. Nothing is changed by a check; when the two
 * disagree it lists what could explain the difference, and the fixing is done on the Transactions page.
 */
const WHY: Record<string, string> = {
  twice: 'Entered twice? These look alike, and one of them is exactly the difference.',
  extra: 'In Ledger, and exactly the difference. Is it on the statement?',
  outside: 'Dated just outside these days in Ledger. If the statement lists it, that is the difference, and nothing is wrong.',
  waiting: 'Still waiting for the bank in Ledger, so it was not counted. If the statement lists it, that is the difference.',
  flipped: 'Typed the wrong way round? Money in entered as money out, or the reverse, leaves a difference of twice the amount.',
  swapped: 'The difference divides evenly by 9, which is what two swapped digits leave (54.00 typed for 45.00). These are the amounts you typed yourself:',
};

function Lines({ rows }: { rows: any[] }) {
  return <>{rows.map((r) => (
    <div key={r.id} className="row check-line">
      <span className="sub">{dayShort(r.date)}</span>
      <span className="grow wrap">{r.merchant}{r.typed && <small>typed in</small>}</span>
      <span className={`num ${r.amount > 0 ? 'good' : ''}`}>{r.amount > 0 ? '+' : ''}{cents(r.amount)}</span>
    </div>
  ))}</>;
}

export function StatementCheck({ a, onClose }: { a: any; onClose: () => void }) {
  const owed = a.type === 'credit';
  const [f, setF] = useState({ start: '', end: '', opening: '', closing: '' });
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  // Carry on from the last statement checked: the day after it ended, at the balance it ended on.
  useEffect(() => {
    api(`/api/accounts/${a.id}/statement`).then((d: any) => {
      if (d?.next) setF((x) => (x.start || x.opening ? x : { ...x, start: d.next.start, opening: Math.abs(d.next.opening).toFixed(2) }));
    }).catch(() => {});
  }, [a.id]);
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setErr(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { setOut(await api(`/api/accounts/${a.id}/statement`, { method: 'POST', body: f })); setAll(false); }
    catch (x: any) { setErr(x.message || 'Could not check that.'); setOut(null); }
    setBusy(false);
  };
  const inWord = owed ? 'payment or credit' : 'deposit';
  const outWord = owed ? 'charge' : 'withdrawal or purchase';
  return (
    <div className="statement-check">
      <p className="sub">From the statement for <b>{a.name}</b>: its first and last day, and the balance at each end. Ledger adds up what it has for those days and says whether it comes to the same.</p>
      <form onSubmit={submit} noValidate>
        <div className="add-grid">
          <label>First day<input type="date" value={f.start} onChange={(e) => set('start')(e.target.value)} /></label>
          <label>Last day<input type="date" value={f.end} onChange={(e) => set('end')(e.target.value)} /></label>
          <label>{owed ? 'Previous balance (owed)' : 'Balance at the start'}<MoneyInput value={f.opening} onChange={set('opening')} placeholder="0.00" /></label>
          <label>{owed ? 'New balance (owed)' : 'Balance at the end'}<MoneyInput value={f.closing} onChange={set('closing')} placeholder="0.00" /></label>
        </div>
        <div className="add-actions">
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Checking…' : 'Check'}</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
      </form>
      {out && (
        <div className="check-result" role="status">
          {out.matches ? (
            <p className="good"><b>✓ It matches.</b> Ledger has {out.count} transaction{out.count === 1 ? '' : 's'} from {dayShort(out.start)} to {dayShort(out.end)}, and they add up to exactly what the statement's balance moved by.</p>
          ) : (
            <p><b className="bad">Out by {cents(Math.abs(out.gap))}.</b> Going by the statement's two balances, the transactions should add up to {cents(out.expected)}. The {out.count} Ledger has for those days add up to {cents(out.got)}.</p>
          )}
          <p className="sub">Ledger's totals for those days, to hold against the statement's own: <b>{cents(out.moneyIn)}</b> in ({owed ? 'payments and credits' : 'deposits'}) and <b>{cents(out.moneyOut)}</b> out ({owed ? 'purchases, fees and interest' : 'withdrawals and purchases'}). Whichever one differs is the side to look through.{out.left > 0 && ` ${out.left} entr${out.left === 1 ? 'y' : 'ies'} still pending or waiting for the bank ${out.left === 1 ? 'was' : 'were'} left out.`}</p>
          {out.ideas.map((i: any) => i.kind === 'missing' ? (
            <p key="missing" className="check-idea">{out.ideas.length > 1 ? 'Otherwise, look' : 'Look'} on the statement for a <b>{i.amount > 0 ? inWord : outWord} of {cents(Math.abs(i.amount))}</b> that Ledger doesn't have, or several that add up to it. Add what's missing on the Transactions page and check again.</p>
          ) : (
            <div key={i.kind} className="check-idea"><p>{WHY[i.kind]}</p><Lines rows={i.rows} /></div>
          ))}
          {out.count > 0 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Hide the list' : `Show the ${out.count} transaction${out.count === 1 ? '' : 's'} Ledger counted`}</button>}
          {all && <Lines rows={out.rows} />}
        </div>
      )}
    </div>
  );
}
