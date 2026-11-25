// Allowances (server/allowance.js): a notebook of what the household holds for each child. The card sits on
// the Accounts page once the feature is switched on in Settings; the switch is at the foot of this file.
import { GO, jump } from '../go';
import { useState } from 'react';
import { api, cents, forgetLoaded, money, useData } from '../lib';
import { Modal, MoneyInput } from '../ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const JARS: [string, string, string][] = [['spend', 'Spend', '🛍️'], ['save', 'Save', '🐷'], ['give', 'Give', '💝']];
const jarName = (j: string) => JARS.find((x) => x[0] === j)?.[1] ?? 'Spend';
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const num = (v: string) => Number(String(v).replace(/,/g, ''));

type KidForm = { id?: number; name: string; weekly: string; pay_day: string; split: boolean; pct_save: string; pct_give: string; goal_name: string; goal_amount: string; start: string };
type EntryForm = { kid: any; kind: 'add' | 'spend'; amount: string; jar: string; note: string };

/** Add or change a child: name, weekly amount and day, the three-jar split if wanted, and what they're saving for. */
function KidDialog({ start, onClose, onDone, onRemove }: { start: KidForm; onClose: () => void; onDone: (d: any) => void; onRemove?: () => void }) {
  const [f, setF] = useState<KidForm>(start);
  const [err, setErr] = useState('');
  const set = (k: keyof KidForm) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      name: f.name, weekly: f.weekly === '' ? 0 : num(f.weekly), pay_day: Number(f.pay_day),
      pct_save: f.split ? Number(f.pct_save) || 0 : 0, pct_give: f.split ? Number(f.pct_give) || 0 : 0,
      goal_name: f.goal_name, goal_amount: f.goal_amount === '' ? '' : num(f.goal_amount), start: f.start === '' ? 0 : num(f.start),
    };
    try { onDone(await api(f.id ? `/api/allowance/kids/${f.id}` : '/api/allowance/kids', { method: f.id ? 'PATCH' : 'POST', body })); } catch (e: any) { setErr(e.message); }
  };
  const spendPct = 100 - (Number(f.pct_save) || 0) - (Number(f.pct_give) || 0);
  return (
    <Modal title={f.id ? `Change ${start.name}'s allowance` : 'Add a child'} onClose={onClose}>
      <form onSubmit={save} noValidate className="add-grid kid-form">
        <label className="field"><span>First name</span><input type="text" value={f.name} maxLength={30} autoFocus={!f.id} onChange={set('name')} /></label>
        <label className="field"><span>Allowance each week</span><MoneyInput value={f.weekly} placeholder="None" onChange={(v) => { setF({ ...f, weekly: v }); setErr(''); }} label="Allowance each week" /><small>Leave empty if you only add money now and then.</small></label>
        <label className="field"><span>Paid on</span><select value={f.pay_day} onChange={set('pay_day')}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select><small>Ledger adds it by itself on that day.</small></label>
        {!f.id && <label className="field"><span>What they have already</span><MoneyInput value={f.start} placeholder="0" onChange={(v) => { setF({ ...f, start: v }); setErr(''); }} label="What they have already" /></label>}
        <label className="hint-every kid-wide"><input type="checkbox" checked={f.split} onChange={(e) => setF({ ...f, split: e.target.checked, pct_save: e.target.checked && !Number(f.pct_save) && !Number(f.pct_give) ? '40' : f.pct_save, pct_give: e.target.checked && !Number(f.pct_save) && !Number(f.pct_give) ? '10' : f.pct_give })} /> Share each allowance between spend, save and give</label>
        {f.split && <>
          <label className="field"><span>Save (%)</span><input type="number" inputMode="numeric" min={0} max={100} value={f.pct_save} onChange={set('pct_save')} /></label>
          <label className="field"><span>Give (%)</span><input type="number" inputMode="numeric" min={0} max={100} value={f.pct_give} onChange={set('pct_give')} /><small>{spendPct >= 0 ? `The other ${spendPct}% is theirs to spend.` : 'Together these can be 100 at most.'}</small></label>
        </>}
        <label className="field"><span>Saving for (optional)</span><input type="text" value={f.goal_name} maxLength={40} placeholder="A bike" onChange={set('goal_name')} /></label>
        <label className="field"><span>What it costs</span><MoneyInput value={f.goal_amount} placeholder="120" onChange={(v) => { setF({ ...f, goal_amount: v }); setErr(''); }} label="What it costs" /></label>
        {err && <p className="error kid-wide" role="alert">{err}</p>}
        <div className="add-actions kid-wide">
          <button type="submit" className="primary">{f.id ? 'Save' : 'Add'}</button>
          <button type="button" onClick={onClose}>Cancel</button>
          {onRemove && <button type="button" className="link" onClick={onRemove}>Remove {start.name}</button>}
        </div>
      </form>
    </Modal>
  );
}

/** Money added or spent for one child. */
function EntryDialog({ start, onClose, onDone }: { start: EntryForm; onClose: () => void; onDone: (d: any) => void }) {
  const [f, setF] = useState<EntryForm>(start);
  const [err, setErr] = useState('');
  const k = f.kid, spend = f.kind === 'spend';
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { onDone(await api(`/api/allowance/kids/${k.id}/entries`, { method: 'POST', body: { kind: f.kind, amount: num(f.amount), jar: f.jar, note: f.note } })); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title={spend ? `${k.name} spent some` : `Add money for ${k.name}`} onClose={onClose}>
      <form onSubmit={save} noValidate className="add-grid kid-form">
        <label className="field"><span>Amount</span><MoneyInput value={f.amount} placeholder="0" autoFocus onChange={(v) => { setF({ ...f, amount: v }); setErr(''); }} label="Amount" /></label>
        <label className="field"><span>{spend ? 'What on' : 'What for'}</span><input type="text" value={f.note} maxLength={60} placeholder={spend ? 'Book fair' : 'Mowed the lawn'} onChange={(e) => { setF({ ...f, note: e.target.value }); setErr(''); }} /></label>
        {k.split && <label className="field"><span>{spend ? 'Out of' : 'Into'}</span><select value={f.jar} onChange={(e) => { setF({ ...f, jar: e.target.value }); setErr(''); }}>{JARS.map(([id, name]) => <option key={id} value={id}>{name} ({cents(k.jars[id])})</option>)}</select></label>}
        {err && <p className="error kid-wide" role="alert">{err}</p>}
        <div className="add-actions kid-wide">
          <button type="submit" className="primary">{spend ? 'Record it' : 'Add it'}</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function Kid({ k, onEntry, onChange, onData }: { k: any; onEntry: (kind: 'add' | 'spend') => void; onChange: () => void; onData: (d: any) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? k.entries : k.entries.slice(0, 3);
  const undo = async (e: any) => { if (!confirm(`Remove "${e.note}" (${cents(Math.abs(e.amount))})?`)) return; onData(await api(`/api/allowance/entries/${e.id}`, { method: 'DELETE' })); };
  return (
    <div className="kid">
      <div className="kid-head">
        <span className="kid-face" aria-hidden="true">{k.name.slice(0, 1).toUpperCase()}</span>
        <span className="grow">
          <b>{k.name}</b>
          <small>{k.weekly > 0 ? `${money(k.weekly)} a week · next on ${DAYS[k.pay_day]}` : 'No weekly allowance'}</small>
        </span>
        <span className="kid-total"><b className="num">{cents(k.balance)}</b><small>held for {k.name}</small></span>
      </div>
      {k.split && (
        <div className="kid-jars">
          {JARS.map(([id, name, icon]) => <div key={id} className="kid-jar"><small><span className="emoji">{icon}</span> {name}</small><b className="num">{cents(k.jars[id])}</b></div>)}
        </div>
      )}
      {k.goal && (
        <div className="kid-goal">
          <small>{k.goal.done ? `Enough for ${k.goal.name}: ${money(k.goal.saved)} of ${money(k.goal.amount)}.` : `Saving for ${k.goal.name}: ${money(k.goal.saved)} of ${money(k.goal.amount)}`}</small>
          <div className="track" role="img" aria-label={`${k.goal.pct}% of the way to ${k.goal.name}`}><div className={`fill ${k.goal.done ? 'done' : ''}`} style={{ width: `${k.goal.pct}%` }} /></div>
        </div>
      )}
      {shown.length > 0 && (
        <div className="kid-entries">
          {shown.map((e: any) => (
            <div key={e.id} className="kid-entry">
              <span className="grow">{shortDay(e.date)} · {e.note}{k.split && !e.auto ? ` (${jarName(e.jar).toLowerCase()})` : ''}{all && <> <button type="button" className="link" onClick={() => undo(e)}>Remove</button></>}</span>
              <span className={`num ${e.amount > 0 ? 'good' : ''}`}>{e.amount > 0 ? '+' : '-'}{cents(Math.abs(e.amount))}</span>
            </div>
          ))}
          {k.entries.length > 3 && <button type="button" className="link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show more${k.count > k.entries.length ? ' (the last 15)' : ''}`}</button>}
        </div>
      )}
      <div className="add-actions">
        <button onClick={() => onEntry('add')}>Add money</button>
        <button onClick={() => onEntry('spend')} disabled={k.balance <= 0}>Record spending</button>
        <button className="link" onClick={onChange}>Change</button>
      </div>
    </div>
  );
}

/** The card on the Accounts page. Draws nothing until allowances are switched on. */
export function AllowanceCard() {
  const { data: loaded, reload } = useData<any>('/api/allowance');
  const [fresh, setFresh] = useState<any>(null);
  const [kid, setKid] = useState<KidForm | null>(null);
  const [entry, setEntry] = useState<EntryForm | null>(null);
  const data = fresh ?? loaded;
  if (!data?.on) return null;
  const took = (d: any) => { setFresh(d); setKid(null); setEntry(null); forgetLoaded(); reload(); };
  const blank: KidForm = { name: '', weekly: '', pay_day: '6', split: false, pct_save: '', pct_give: '', goal_name: '', goal_amount: '', start: '' };
  const edit = (k: any): KidForm => ({ id: k.id, name: k.name, weekly: k.weekly ? String(k.weekly) : '', pay_day: String(k.pay_day), split: k.pct_save + k.pct_give > 0, pct_save: k.pct_save ? String(k.pct_save) : '', pct_give: k.pct_give ? String(k.pct_give) : '', goal_name: k.goal_name, goal_amount: k.goal_amount ? String(k.goal_amount) : '', start: '' });
  const remove = async (k: any) => { if (!confirm(`Remove ${k.name} and everything recorded for them? This can't be undone.`)) return; took(await api(`/api/allowance/kids/${k.id}`, { method: 'DELETE' })); };
  return (
    <section className="card allowance" data-news="allowance">
      <div className="card-head"><h2>Allowances</h2>{data.kids.length > 1 && <span className="sub">{cents(data.total)} held in all</span>}</div>
      {data.kids.length === 0 && <p className="sub first">A notebook of what you hold for each child. Add a child and, if you like, a weekly allowance: Ledger adds it on its day, and you record what they earn and spend. It is only a record; no account or total elsewhere in Ledger is touched.</p>}
      {data.kids.map((k: any) => <Kid key={k.id} k={k} onData={took} onEntry={(kind) => setEntry({ kid: k, kind, amount: '', jar: 'spend', note: '' })} onChange={() => setKid(edit(k))} />)}
      <div className="add-actions" style={{ marginTop: 12 }}><button className={data.kids.length ? '' : 'primary'} onClick={() => setKid(blank)}>Add a child</button></div>
      {kid && <KidDialog start={kid} onClose={() => setKid(null)} onDone={took} onRemove={kid.id ? () => { const k = data.kids.find((x: any) => x.id === kid.id); if (k) remove(k); } : undefined} />}
      {entry && <EntryDialog start={entry} onClose={() => setEntry(null)} onDone={took} />}
    </section>
  );
}

/** The switch, in Settings. */
export function AllowanceSwitch() {
  const { data, reload } = useData<any>('/api/allowance');
  if (!data) return null;
  const put = async (on: boolean) => { await api('/api/allowance', { method: 'PUT', body: { on } }); forgetLoaded(); reload(); window.dispatchEvent(new Event('ledger-refresh')); };
  return (
    <section className="card">
      <div className="card-head"><h2>Allowances</h2>{data.on && <span className="good">On</span>}</div>
      <p className="sub first">Keep track of what you hold for each child: a weekly allowance that adds itself, money for chores or gifts, and what they spend, shared between spend, save and give if you like. It is a notebook only. The money stays wherever you keep it, and nothing else in Ledger counts it.</p>
      <label className="row check" data-go="allowance-switch"><span className="grow">Keep allowances</span><input type="checkbox" checked={!!data.on} onChange={(e) => put(e.target.checked)} /></label>
      {data.on && <p className="sub">It is on the <a href="#accounts" onClick={jump(GO.allowance)}>Accounts page</a>, under savings goals. Switching this off hides it and stops the weekly amounts; what was recorded is kept.</p>}
    </section>
  );
}
