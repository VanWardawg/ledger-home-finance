import { CatIcon, EmojiPick } from '../icons';
import { useState } from 'react';
import { api, forgetLoaded, money, useData } from '../lib';
import { Fold, Meter, More, Skeleton } from '../ui';
import { BudgetSuggest } from './Setup';
import { ZeroGuide } from './ZeroGuide';

function BudgetInput({ cat, onSaved, month }: { cat: any; onSaved: () => void; month?: string }) {
  const typed = cat.base ?? cat.budget;   // the monthly amount as typed; cat.budget also counts what was carried over
  const [value, setValue] = useState(String(typed));
  const [err, setErr] = useState('');
  const save = async () => {
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) return setErr('Enter 0 or more');
    setErr('');
    if (n === typed) return;
    try {
      // In the zero-based mode the box is what this category is given this month, not a standing amount.
      if (cat.zero && month) await api('/api/zero/assign', { method: 'PUT', body: { month, category_id: cat.id, amount: n } });
      else await api(`/api/categories/${cat.id}`, { method: 'PATCH', body: { budget: n } });
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <div>
      <input
        type="number" min="0" step="10" inputMode="decimal" value={value} aria-label={cat.zero ? `Assigned to ${cat.name} this month` : `Monthly budget for ${cat.name}`}
        onChange={(e) => { setValue(e.target.value); setErr(''); }}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {err && <small className="bad">{err}</small>}
    </div>
  );
}

function AddCategory({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: '', icon: '', budget: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Enter a name for the category.');
    try {
      await api('/api/categories', { method: 'POST', body: f });
      setF({ name: '', icon: '', budget: '' });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head"><h2>Add a category</h2></div>
      <div className="add-grid">
        <label>Name<input type="text" value={f.name} onChange={set('name')} placeholder="Haircuts" /></label>
        <EmojiPick value={f.icon} onChange={(v) => { setF({ ...f, icon: v }); setErr(''); }} />
        <label>Monthly budget<input type="number" min="0" step="5" inputMode="decimal" value={f.budget} onChange={set('budget')} placeholder="40" /></label>
        <div style={{ alignSelf: 'end' }}><button type="submit" className="primary">Add category</button></div>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

/**
 * "Give every dollar a job" (server/zero.js): the money that has come in and not yet been handed to a
 * category, with quick ways to fill the month. Shown at the top of Budgets while the mode is on.
 */
function ZeroBar({ z, month, onChanged }: { z: any; month: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [guide, setGuide] = useState(() => { try { return !z.before && !localStorage.getItem('ledger-zero-guide'); } catch { return false; } });
  const closeGuide = () => { try { localStorage.setItem('ledger-zero-guide', '1'); } catch { /* private window */ } setGuide(false); };
  if (z.before) return <section className="card"><p className="sub" style={{ margin: 0 }}>This month is from before you began giving every dollar a job ({z.from}), so it shows the budgets you had then.</p></section>;
  const fill = async (how: string) => { setBusy(true); try { const r = await api('/api/zero/fill', { method: 'POST', body: { month, how } }); setNote(r.filled ? `${r.filled} categor${r.filled === 1 ? 'y' : 'ies'} filled in. Change any amount on the right.` : 'Every category already has an amount this month.'); onChanged(); } catch (e: any) { setNote(e.message); } setBusy(false); };
  const left = z.toAssign;
  return (
    <section className={`card zero-bar ${left < -0.005 ? 'over' : left > 0.005 ? 'some' : 'done'}`}>
      <div className="zero-top">
        <div><div className="label">{left < -0.005 ? 'Assigned more than you have' : 'To be assigned'}</div><div className="value">{money(Math.abs(left))}</div></div>
        <p className="sub">{left > 0.005 ? 'Money that has come in and has no job yet. Hand it out below until this reads zero.' : left < -0.005 ? 'The categories below have been given more than has come in. Lower some until this reads zero.' : 'Every dollar has a job.'} Income this month so far: {money(z.income)}; given out this month: {money(z.assignedMonth)}.</p>
      </div>
      <div className="add-actions">
        <button disabled={busy} onClick={() => fill('usual')}>Fill empty ones with my usual amounts</button>
        <button className="link" onClick={() => setGuide(true)}>How this works</button>
        {z.hasLast && <button disabled={busy} onClick={() => fill('last')}>Fill empty ones like last month</button>}
      </div>
      {note && <p className="sub" role="status">{note}</p>}
      {guide && <ZeroGuide onClose={closeGuide} />}
    </section>
  );
}

/** The switch between the two ways of budgeting, at the foot of the page. Each household chooses; nothing is lost either way. */
function ZeroSwitch({ z, onChanged }: { z: any; onChanged: () => void }) {
  const [start, setStart] = useState(z.start ? String(z.start) : '');
  const [err, setErr] = useState('');
  const [guide, setGuide] = useState(false);
  const put = async (body: object) => { try { await api('/api/zero', { method: 'PUT', body }); setErr(''); forgetLoaded(); onChanged(); dispatchEvent(new CustomEvent('ledger-refresh')); } catch (e: any) { setErr(e.message); } };
  const reset = async () => { if (!confirm('Start over from this month? The amounts you have assigned so far are forgotten. Your ordinary budgets are not touched.')) return; try { await api('/api/zero/reset', { method: 'POST' }); forgetLoaded(); onChanged(); dispatchEvent(new CustomEvent('ledger-refresh')); } catch (e: any) { setErr(e.message); } };
  return (
    <Fold id="budget-zero" title="Choose your budgeting method" note={z.on ? 'Every dollar gets a job' : 'A set amount for each category'}>
      <p className="sub first">Ledger can budget in two ways. <b>A set amount for each category</b> is the usual one: each category has a monthly figure and Ledger shows how you are doing against it. <b>Give every dollar a job</b> starts from the money instead: as pay arrives it waits to be assigned, and you hand it out to categories until none is left. A category can only spend what it has been given, and what it doesn't spend stays in it for later. <button className="link" onClick={() => setGuide(true)}>See how it works</button></p>
      {guide && <ZeroGuide onClose={() => setGuide(false)} />}
      <label className="row check" data-go="zero-switch"><span className="grow">Give every dollar a job</span><input type="checkbox" checked={z.on} onChange={(e) => put({ on: e.target.checked })} /></label>
      {z.on ? <>
        <div className="add-grid">
          <label className="field"><span>Money you already had when you began</span>
            <input type="number" min="0" step="50" inputMode="decimal" value={start} placeholder="0" onChange={(e) => setStart(e.target.value)} onBlur={() => put({ start: Number(start || 0) })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            <small>Optional. For example what was in checking that day. It is added to what you can assign. Began {z.from}.</small></label>
        </div>
        <p className="sub">Switching this off puts your set amounts back exactly as they were. What you assigned is kept in case you switch it on again. <button className="link" onClick={reset}>Start over from this month</button></p>
      </> : <p className="sub">Switching it on changes this page only for {`this month onward`}; earlier months keep the budgets they had. Your set amounts are kept and come back if you switch it off.</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </Fold>
  );
}

/**
 * Category groups (server/groups.js): headings to sort the categories under. Making, naming, ordering
 * and removing them, and choosing each category's group, all in one place at the foot of the page.
 */
function CategoryGroups({ list, cats, onChanged }: { list: any[]; cats: any[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const run = async (path: string, method: string, body?: object) => { try { await api(path, { method, body }); setErr(''); forgetLoaded(); onChanged(); return true; } catch (e: any) { setErr(e.message); return false; } };
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (!name.trim()) return setErr('Enter a name for the group.'); if (await run('/api/groups', 'POST', { name })) setName(''); };
  const remove = (g: any) => { if (confirm(`Remove the group "${g.name}"? Its ${g.categories} categor${g.categories === 1 ? 'y stays' : 'ies stay'}, in no group. No category or transaction is removed.`)) run(`/api/groups/${g.id}`, 'DELETE'); };
  return (
    <Fold id="budget-groups" title="Category groups" note={list.length ? `${list.length} group${list.length === 1 ? '' : 's'}` : 'Not in use'}>
      <p className="sub first">Groups are headings to sort your categories under, such as Everyday, Bills or Kids. They change how this page is laid out and nothing else: budgets, totals and where a purchase is filed stay as they are. With no groups, the page shows flexible spending and fixed bills.</p>
      {list.map((g, i) => (
        <div key={g.id} className="row group-row">
          {editing?.id === g.id
            ? <form className="grow group-edit" onSubmit={async (e) => { e.preventDefault(); if (await run(`/api/groups/${g.id}`, 'PATCH', { name: editing!.name })) setEditing(null); }}>
                <input type="text" value={editing!.name} autoFocus aria-label={`New name for ${g.name}`} onChange={(e) => setEditing({ id: g.id, name: e.target.value })} />
                <button type="submit" className="primary">Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            : <>
                <span className="grow"><b>{g.name}</b> <small style={{ display: 'inline' }}>{g.categories} categor{g.categories === 1 ? 'y' : 'ies'}</small></span>
                <button className="link" disabled={i === 0} aria-label={`Move ${g.name} up`} onClick={() => run(`/api/groups/${g.id}`, 'PATCH', { move: -1 })}>Up</button>
                <button className="link" disabled={i === list.length - 1} aria-label={`Move ${g.name} down`} onClick={() => run(`/api/groups/${g.id}`, 'PATCH', { move: 1 })}>Down</button>
                <button className="link" aria-label={`Rename the group ${g.name}`} onClick={() => setEditing({ id: g.id, name: g.name })}>Rename</button>
                <button className="link" aria-label={`Remove the group ${g.name}`} onClick={() => remove(g)}>Remove</button>
              </>}
        </div>
      ))}
      <form className="add-actions group-add" onSubmit={add} noValidate>
        <input type="text" value={name} placeholder="Everyday" aria-label="Name of a new group" onChange={(e) => { setName(e.target.value); setErr(''); }} />
        <button type="submit">Add a group</button>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
      {list.length > 0 && <>
        <div className="group-head"><span>Which group each category is in</span></div>
        {cats.map((c: any) => (
          <label key={c.id} className="row group-pick">
            <span className="grow">{c.icon} {c.name}</span>
            <select value={c.group_id ?? ''} aria-label={`Group for ${c.name}`} onChange={(e) => run(`/api/categories/${c.id}/group`, 'PUT', { group_id: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">Not in a group</option>
              {list.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        ))}
      </>}
    </Fold>
  );
}

export default function Budgets({ month }: { month: string }) {
  const { data: s, error, reload: reloadSummary } = useData(`/api/summary?month=${month}`);
  const { data: z, reload: reloadZero } = useData<any>(`/api/zero?month=${month}`);
  const { data: gr, reload: reloadGroups } = useData<any>('/api/groups');
  const reload = () => { reloadSummary(); reloadZero(); reloadGroups(); };
  // (Before the early returns below: hooks must run in the same order on every draw.)
  const [note, setNote] = useState('');
  if (error) return <p className="error">{error}</p>;
  if (!s) return <Skeleton tiles={0} cards={2} rows={6} />;
  const suggest = <section className="card"><div className="card-head"><h2>Suggested budgets</h2></div><p className="sub first">Ledger can suggest an amount for each category from what you've really spent over the last few months, or from your take-home pay if it hasn't seen a full month yet. You check them before anything changes.</p><BudgetSuggest onApplied={reload} /></section>;
  // Removing a category moves whatever was filed in it to Other, so nothing is lost.
  const removeCategory = async (c: any) => {
    if (!confirm(`Remove the category "${c.name}"? Anything filed in it moves to Other. This can't be undone.`)) return;
    try {
      const r = await api(`/api/categories/${c.id}`, { method: 'DELETE' });
      setNote(`${c.name} removed.${r.moved ? ` ${r.moved} transaction${r.moved === 1 ? '' : 's'} moved to ${r.to}.` : ''}`);
      forgetLoaded(); reload();
    } catch (e: any) { setNote(e.message); }
  };
  // What's left at the end of a month moves into the next one (and overspending comes off it).
  const carry = async (c: any) => {
    try {
      await api(`/api/categories/${c.id}`, { method: 'PATCH', body: { rollover: !c.rollover } });
      setNote(c.rollover ? `${c.name} no longer carries over. Its budget is the same every month again.` : `${c.name} now carries over: whatever is left at the end of this month is added to next month's, and anything overspent comes off it.`);
      forgetLoaded(); reload();
    } catch (e: any) { setNote(e.message); }
  };
  // Under your own groups once there are any (a category in none, or in a group since removed, goes last);
  // otherwise the two the page has always had.
  const own: any[] = gr?.groups || [];
  const groups = own.length
    ? [
      ...own.map((g) => ({ title: g.name, items: s.categories.filter((c: any) => c.group_id === g.id) })),
      { title: 'Not in a group', items: s.categories.filter((c: any) => !own.some((g) => g.id === c.group_id)) },
    ].filter((g) => g.items.length > 0)
    : [
      { title: 'Flexible spending', items: s.categories.filter((c: any) => !c.fixed) },
      { title: 'Fixed bills', items: s.categories.filter((c: any) => c.fixed) },
    ];
  const left = s.budget - s.spent;
  const zeroNow = !!z?.on && !z.before;
  // Covering an overspent category by moving what the page suggests (zero-based mode only).
  const cover = async (c: any) => {
    try {
      for (const f of c.from) {
        const giver = s.categories.find((x: any) => x.name === f.name);
        if (giver) await api('/api/zero/move', { method: 'POST', body: { month, from: giver.id, to: c.id, amount: Math.round(f.amount * 100) / 100 } });
      }
      setNote(`${c.name} covered.`); forgetLoaded(); reload();
    } catch (e: any) { setNote(e.message); }
  };

  // For each category that's over, suggest covering it from flexible
  // categories expected to finish the month with the most left over.
  const elapsed = s.isCurrent ? s.lastDay / s.days : 1;
  const pool = s.categories
    .filter((c: any) => !c.fixed && c.budget > c.spent)
    .map((c: any) => ({ name: c.name, icon: c.icon, left: c.budget - c.spent, spare: Math.max(0, c.budget - c.spent / elapsed) }))
    .sort((a: any, b: any) => b.spare - a.spare);
  const suggestions = s.categories
    .filter((c: any) => c.spent > c.budget + 0.5)
    .sort((a: any, b: any) => b.spent - b.budget - (a.spent - a.budget))
    .map((c: any) => {
      let need = c.spent - c.budget;
      const from: { name: string; amount: number; left: number }[] = [];
      for (const p of pool) {
        if (need < 0.5) break;
        const take = Math.min(need, p.left);
        if (take < 0.5) continue;
        from.push({ name: p.name, amount: take, left: p.left });
        p.left -= take;
        p.spare = Math.max(0, p.spare - take);
        need -= take;
      }
      return { ...c, over: c.spent - c.budget, from, uncovered: need };
    });

  return (
    <div className="stack">
      {note && <p className="sub" role="status">{note}</p>}
      {z?.on && <ZeroBar z={z} month={month} onChanged={reload} />}
      <section className="tiles">
        <div className="tile"><div className="label">Budget</div><div className="value">{money(s.budget)}</div><div className="sub">{zeroNow ? 'in your categories this month' : s.categories.some((c: any) => c.rollover && Math.abs(c.carry) >= 0.005) ? 'this month, with what was carried over' : 'per month'}</div></div>
        <div className="tile"><div className="label">Spent</div><div className="value">{money(s.spent)}</div><div className="sub">{Math.round((s.spent / (s.budget || 1)) * 100)}% used</div></div>
        <div className="tile"><div className="label">{left >= 0 ? 'Left' : 'Over'}</div><div className="value">{money(Math.abs(left))}</div><div className={left >= 0 ? 'good' : 'bad'}>{left >= 0 ? 'still available' : 'past your budget'}</div></div>
        <div className="tile"><div className="label">Income</div><div className="value">{money(s.income)}</div><div className="sub">{zeroNow ? `${money(z.toAssign)} still to assign` : `${money(s.income - s.budget)} unbudgeted`}</div></div>
      </section>
      {suggestions.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Over budget</h2></div>
          {suggestions.map((c: any) => (
            <div key={c.id} className="row">
              <CatIcon icon={c.icon} edit={{ id: c.id, name: c.name }} />
              <span className="grow wrap">
                {c.name} is <b className="bad">{money(c.over)} over</b>.{' '}
                {c.from.length > 0 && (
                  <>Cover it by moving {c.from.map((f: any, i: number) => (
                    <span key={f.name}>{i > 0 ? (i === c.from.length - 1 ? ' and ' : ', ') : ''}<b>{money(f.amount)} from {f.name}</b> ({money(f.left)} unspent)</span>
                  ))}.</>
                )}
                {c.uncovered >= 0.5 && <> {c.from.length ? 'The remaining' : 'Nothing else has room, so the'} {money(c.uncovered)} comes out of your excess money this month.</>}
              </span>
              {zeroNow && c.from.length > 0 && <button onClick={() => cover(c)}>Move it</button>}
            </div>
          ))}
          <small>Suggestions favor categories on track to finish the month with the most left.</small>
        </section>
      )}
      <section className="card">
        {zeroNow ? <p className="sub" style={{ margin: 0 }}>The box on the right is what each category is given <b>this month</b>. It saves when you leave the field. Each bar shows what the category has to spend: this month's amount plus whatever it had left from before.</p> : <p className="sub" style={{ margin: 0 }}>Change a monthly amount on the right. It saves when you leave the field. <b>Carry over</b> moves whatever is left at the end of a month into the next one, which suits things you save up for, such as clothing, gifts or car repairs.</p>}
        {groups.map((g) => (
          <div key={g.title}>
            <div className="group-head">
              <span>{g.title}</span>
              <span className="num">{money(g.items.reduce((a: number, c: any) => a + c.spent, 0))} / {money(g.items.reduce((a: number, c: any) => a + c.budget, 0))}</span>
            </div>
            {g.items.map((c: any) => (
              <div key={c.id} className="budget-row">
                <div>
                  <Meter id={c.id} icon={c.icon} name={c.name} spent={c.spent} budget={c.budget} />
                  {c.zero && Math.abs(c.carry) >= 0.005 && <small className="carry-note">{c.carry > 0 ? <>{money(c.base)} this month, plus <b className="good">{money(c.carry)}</b> left from before</> : <>{money(c.base)} this month, less <b className="bad">{money(-c.carry)}</b> overspent before</>}</small>}
                  {c.rollover && <small className="carry-note">{Math.abs(c.carry) < 0.005 ? "Carries over: what's left this month moves to next month." : c.carry > 0 ? <>{money(c.base)} a month, plus <b className="good">{money(c.carry)}</b> carried over</> : <>{money(c.base)} a month, less <b className="bad">{money(-c.carry)}</b> overspent before</>}</small>}
                </div>
                <BudgetInput key={`${c.id}-${month}-${c.zero ? c.base : 'set'}`} cat={c} month={month} onSaved={reload} />
                <More name={c.name} sub={`${money(c.spent)} spent of ${money(c.budget)}`} items={() => [
                  !c.zero && { label: c.rollover ? 'Stop carrying over' : 'Carry over', hint: c.rollover ? 'The same budget every month again' : "What's left moves into next month", run: () => carry(c) },
                  !['Other', 'Income', 'Transfer'].includes(c.name) && { label: 'Rename or change the icon', run: () => dispatchEvent(new CustomEvent('ledger-icon-edit', { detail: { id: c.id, name: c.name, icon: c.icon } })) },
                  !['Other', 'Income', 'Transfer'].includes(c.name) && { label: 'Remove', danger: true, hint: 'Anything filed in it moves to Other', run: () => removeCategory(c) },
                ]} />
                <div className="budget-acts wide-only">
                {!c.zero && <button className="link budget-remove" aria-pressed={!!c.rollover} aria-label={`${c.rollover ? 'Stop carrying over' : 'Carry over'} what is left of ${c.name}`} onClick={() => carry(c)}>{c.rollover ? 'Stop carrying over' : 'Carry over'}</button>}
                {!['Other', 'Income', 'Transfer'].includes(c.name) && <button className="link budget-remove" aria-label={`Rename the category ${c.name}`} onClick={() => dispatchEvent(new CustomEvent('ledger-icon-edit', { detail: { id: c.id, name: c.name, icon: c.icon } }))}>Rename</button>}
                {!['Other', 'Income', 'Transfer'].includes(c.name) && <button className="link budget-remove" aria-label={`Remove the category ${c.name}`} onClick={() => removeCategory(c)}>Remove</button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>
      {!zeroNow && suggest}
      <AddCategory onDone={reload} />
      {gr && <CategoryGroups list={own} cats={s.categories} onChanged={reload} />}
      {z && <ZeroSwitch z={z} onChanged={reload} />}
    </div>
  );
}
