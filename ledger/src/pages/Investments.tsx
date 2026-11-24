import { useState } from 'react';
import { api, dayShort, forgetLoaded, money, useData } from '../lib';
import { Logo, MoneyInput } from '../ui';

/**
 * Accounts page, "Investments": what each investment account holds and how its value has moved.
 * Holdings come from the bank where it lists them, or are typed in here. Ledger looks up no prices:
 * a bank-fed value is as fresh as the bank's last update, and a typed one is as fresh as you keep it.
 */
const signed = (n: number) => `${n >= 0 ? '+' : '-'}${money(Math.abs(n))}`;
const tone = (n: number) => (n > 0.004 ? 'good' : n < -0.004 ? 'bad' : 'sub');

function HoldingForm({ account, holding, onDone }: { account: number; holding?: any; onDone: () => void }) {
  const [f, setF] = useState({ name: holding?.name || '', symbol: holding?.symbol || '', shares: holding?.shares != null ? String(holding.shares) : '', value: holding ? String(holding.value) : '', cost: holding?.cost != null ? String(holding.cost) : '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setErr(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(holding ? `/api/holdings/${holding.id}` : `/api/investments/${account}/holdings`, { method: holding ? 'PATCH' : 'POST', body: f });
      forgetLoaded(); onDone();
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <form onSubmit={submit} noValidate className="holding-form">
      <div className="add-grid">
        <label>What it is<input type="text" value={f.name} autoFocus maxLength={80} placeholder="Total market index fund" onChange={(e) => set('name')(e.target.value)} /></label>
        <label>Symbol, if it has one<input type="text" value={f.symbol} maxLength={12} placeholder="VTSAX" autoCapitalize="characters" onChange={(e) => set('symbol')(e.target.value)} /></label>
        <label>Shares<input type="number" min="0" step="any" inputMode="decimal" value={f.shares} placeholder="Optional" onChange={(e) => set('shares')(e.target.value)} /></label>
        <label>Worth today<MoneyInput value={f.value} onChange={set('value')} placeholder="0.00" /></label>
        <label>What you paid in all<MoneyInput value={f.cost} onChange={set('cost')} placeholder="Optional" /></label>
      </div>
      <div className="add-actions">
        <button type="submit" className="primary">{holding ? 'Save' : 'Add holding'}</button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

function Account({ a, reload }: { a: any; reload: () => void }) {
  const [form, setForm] = useState<null | 'new' | number>(null);
  const [more, setMore] = useState(false);
  const done = () => { setForm(null); reload(); dispatchEvent(new CustomEvent('ledger-refresh')); };
  const remove = async (h: any) => {
    if (!confirm(`Remove ${h.name} from ${a.name}?`)) return;
    await api(`/api/holdings/${h.id}`, { method: 'DELETE' }); forgetLoaded(); done();
  };
  const shown = more ? a.holdings : a.holdings.slice(0, 6);
  const typed = a.holdings.some((h: any) => h.manual);
  const gap = a.holdings.length > 0 ? a.balance - a.held : 0;
  return (
    <div className="invest">
      <div className="row">
        <Logo name={a.institution} as={`account ${a.id}`} also={[a.name]} edit />
        <span className="grow wrap">{a.name}<small>{a.institution}{a.byHand ? ' · kept by hand' : ''}</small></span>
        <span className="num"><b>{money(a.balance)}</b></span>
      </div>
      {a.spans.length > 0 ? (
        <div className="invest-spans">
          {a.spans.map((s: any) => (
            <div key={s.label} className="invest-span" title={`From ${dayShort(s.from)}, when it was ${money(s.was)}`}>
              <span className="label">{s.label}</span>
              <b className={tone(s.change)}>{signed(s.change)}</b>
              {s.pct !== null && <small className={tone(s.change)}>{s.pct >= 0 ? '+' : ''}{s.pct}%</small>}
              {Math.abs(s.added) >= 0.005 && <small className="sub">{s.added > 0 ? `${money(s.added)} of it paid in` : `${money(-s.added)} taken out`}</small>}
            </div>
          ))}
        </div>
      ) : <p className="sub invest-none">Ledger has only just met this account, so there is no change to show yet. It notes the value each day from here on.</p>}
      {a.gain !== null && <p className="sub invest-gain">Against what was paid for {a.holdings.every((h: any) => h.cost !== null) ? 'these holdings' : 'the holdings with a cost'}: <b className={tone(a.gain)}>{signed(a.gain)}</b> on {money(a.cost)}.</p>}
      {shown.map((h: any) => form === h.id ? <HoldingForm key={h.id} account={a.id} holding={h} onDone={done} /> : (
        <div key={h.id} className="row holding">
          <span className="grow wrap">{h.name}<small>{[h.symbol, h.price ? `$${Number(h.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a share` : '', h.shares != null ? `${Number(h.shares).toLocaleString('en-US', { maximumFractionDigits: 4 })} shares` : '', a.balance > 0 ? `${Math.round((h.value / a.balance) * 100)}% of the account` : ''].filter(Boolean).join(' · ')}</small></span>
          <span className="num">{money(h.value)}{h.gain !== null && <small className={tone(h.gain)}>{signed(h.gain)}{h.gainPct !== null ? ` (${h.gainPct >= 0 ? '+' : ''}${h.gainPct}%)` : ''}</small>}</span>
          {h.manual && <span className="holding-acts"><button className="link" onClick={() => setForm(h.id)}>Change</button><button className="link" onClick={() => remove(h)}>Remove</button></span>}
        </div>
      ))}
      {a.holdings.length > 6 && <button className="link" onClick={() => setMore(!more)}>{more ? 'Show fewer' : `Show all ${a.holdings.length} holdings`}</button>}
      {!a.byHand && Math.abs(gap) >= 1 && <small className="sub">The holdings listed add up to {money(a.held)}; the rest of the account ({money(gap)}) is cash or something the bank doesn't itemise.</small>}
      {form === 'new' ? <HoldingForm account={a.id} onDone={done} /> : (a.byHand || a.holdings.length === 0 || typed) && (
        <p className="sub invest-add">
          {a.holdings.length === 0 && (a.byHand ? 'Nothing is listed in this account yet. ' : "Your bank doesn't list what's inside this account. You can list it yourself. ")}
          <button className="link" onClick={() => setForm('new')}>Add a holding</button>
          {a.byHand && a.holdings.length > 0 && <> · the account's value follows what you list here</>}
        </p>
      )}
    </div>
  );
}

/** Price look-ups (server/prices.js): off until switched on, since it sends ticker symbols to an outside service. */
function Prices({ onChanged }: { onChanged: () => void }) {
  const { data: p, reload } = useData<any>('/api/prices');
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  const put = async (path: string, method: string, body?: object) => { setBusy(true); try { await api(path, { method, body }); reload(); onChanged(); } finally { setBusy(false); } };
  return (
    <div className="invest-prices">
      <label className="row check"><span className="grow">Look up prices for holdings that have a ticker symbol</span><input type="checkbox" checked={p.on} disabled={busy} onChange={(e) => put('/api/prices', 'PUT', { on: e.target.checked })} /></label>
      <p className="sub">{p.on
        ? <>Prices are checked a few times a day. A holding you typed in with a share count is valued at shares times the latest price; a holding your bank reports keeps the bank's own value. {p.last ? `Last checked ${new Date(p.last.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: ${p.last.found} of ${p.last.asked} symbols had a price. ` : ''}<button className="link" disabled={busy} onClick={() => put('/api/prices/refresh', 'POST')}>{busy ? 'Checking…' : 'Check now'}</button></>
        : <>Off. Switching it on sends the ticker symbols of what you hold, and nothing else, to Yahoo Finance to ask the price. Without it, figures are your bank's latest or the ones you typed.</>}</p>
    </div>
  );
}

export function InvestmentsCard() {
  const { data, reload } = useData('/api/investments');
  if (!data || data.accounts.length === 0) return null;
  return (
    <section className="card">
      <div className="card-head"><h2>Investments</h2><span className="num">{money(data.total)}</span></div>
      <p className="sub first">What each account holds and how its value has moved. A change in value includes money you paid in, which is shown beside it where Ledger can see it. Figures are your bank's latest, or the ones you typed, unless price look-ups are switched on below.</p>
      {data.accounts.map((a: any) => <Account key={a.id} a={a} reload={reload} />)}
      <Prices onChanged={reload} />
    </section>
  );
}
