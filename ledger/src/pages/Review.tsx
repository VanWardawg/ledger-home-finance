import { useState } from 'react';
import { api, cents, money, useData } from '../lib';

// The money review (server/analysis.js): what stands out, worked out by Ledger from the household's own
// history. The findings are arithmetic and are always shown. Where the household has a model of its own or
// Home Assistant's AI switched on, a button has that model write the findings up in plain words.

const KIND: Record<string, string> = {
  double: 'Check', price: 'Price change', over: 'Over usual', high: 'Running high', unusual: 'Unusual', budget: 'Budget',
  cushion: 'Cushion', quarter: 'Trend', low: 'Running low', 'new-category': 'New', 'new-merchant': 'New',
};
const TONE: Record<string, string> = { double: 'bad', price: 'bad', over: 'bad', budget: 'bad', cushion: 'bad', high: 'warn', unusual: 'warn' };

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="review-figure"><span className="sub">{label}</span><b className="num">{value}</b>{note && <small className="sub">{note}</small>}</div>;
}

export function MoneyReview() {
  const { data: r, error } = useData<any>('/api/review');
  const [written, setWritten] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (error || !r) return null;
  const write = async (again = false) => {
    setBusy(true); setErr('');
    try { setWritten(await api('/api/review/written', { method: 'POST', body: { again } })); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const o = r.outlook;
  const young = r.history_months < 3;
  return (
    <section className="card money-review">
      <div className="card-head"><h2>Money review</h2><span className="sub">worked out from your own history</span></div>
      <div className="review-figures">
        <Figure label="This month so far" value={money(o.spent)} note={`day ${o.day} of ${o.days_in_month}`} />
        <Figure label="On pace for" value={money(o.projected)} note={o.usual > 0 ? `${money(Math.abs(o.projected - o.usual))} ${o.projected > o.usual ? 'above' : 'below'} your usual` : undefined} />
        {r.cash.days_covered != null && <Figure label="Cash covers" value={`${r.cash.days_covered} days`} note={`of your usual ${cents(r.cash.usual_spending_a_day)} a day`} />}
        {r.cash.age_of_money_days != null && <Figure label="Age of money" value={`${r.cash.age_of_money_days} days`} note="how long a dollar waits before it is spent" />}
        {r.saving && <Figure label="Kept, last 3 months" value={`${r.saving.kept_percent}%`} note={`${money(r.saving.kept)} of ${money(r.saving.income)} that came in`} />}
      </div>

      {young && <p className="sub">With less than three months of history there is little to compare against yet. The review sharpens as more months come in.</p>}

      {r.highlights.length > 0 ? (
        <ul className="review-list">
          {r.highlights.slice(0, 8).map((h: any, i: number) => (
            <li key={i}><span className={`review-tag ${TONE[h.kind] || ''}`}>{KIND[h.kind] || 'Note'}</span><span>{h.text}</span></li>
          ))}
        </ul>
      ) : !young && <p className="sub">Nothing stands out this month: spending is close to your usual in every category.</p>}

      {written && (
        <div className="review-written">
          {String(written.text).split(/\n\s*\n/).map((p: string, i: number) => <p key={i}>{p}</p>)}
          <small className="sub">Written by {written.where}, from the figures above. It was given nothing else and nothing left your {/own model/.test(written.where) ? 'network' : 'Home Assistant'}.</small>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      {r.canWrite ? (
        <p className="review-actions">
          <button type="button" disabled={busy} onClick={() => write(!!written)}>{busy ? 'Writing…' : written ? 'Write it again' : `Have ${r.aiName === 'Claude' ? 'Claude' : 'your AI'} write this up`}</button>
          <small className="sub">Uses {r.where}.</small>
        </p>
      ) : (
        <p className="sub">These findings need no AI. To have them written up in plain words, switch on a model of your own under <a href="#connections">Settings</a>, "AI recap and logos".</p>
      )}
    </section>
  );
}
