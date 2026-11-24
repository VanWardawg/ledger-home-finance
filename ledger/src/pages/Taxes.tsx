import { useEffect, useRef, useState } from 'react';
import { api, cents, money, pct, useData } from '../lib';
import { NumField, Skeleton, Fold, Modal, openFold } from '../ui';
import { FederalParts, TaxMore, TaxPack, WhereToFind } from './TaxMore';
import { TaxHints } from './TaxHints';

/**
 * The two adults' first names, kept so reminders and the pay stub form can say whose stub they mean whoever
 * is reading ("Sam's pay stub", not "your spouse's"). Optional; saved when you leave the box.
 */
export function HouseholdNames({ joint }: { joint: boolean }) {
  const { data } = useData<{ names?: { you: string; spouse: string } }>('/api/paystub');
  const [v, setV] = useState<{ you?: string; spouse?: string }>({});
  const names = data?.names || { you: '', spouse: '' };
  const save = (who: 'you' | 'spouse') => async () => {
    const t = (v[who] ?? names[who]).trim();
    if (t === names[who]) return;
    await api('/api/paystub/names', { method: 'PUT', body: { [who]: t } });
    dispatchEvent(new CustomEvent('ledger-refresh'));
  };
  const box = (who: 'you' | 'spouse', label: string) => (
    <label className="field"><span>{label}</span>
      <input type="text" maxLength={30} autoComplete="off" placeholder="Optional" value={v[who] ?? names[who]} onChange={(e) => setV({ ...v, [who]: e.target.value })} onBlur={save(who)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
  return <>{box('you', 'Your first name')}{joint && box('spouse', "Your spouse's first name")}</>;
}

// Where a payment is actually made: the governments' own sites, opened in a new tab. Ledger can't pay or see
// a payment; the household types what it paid under "estimated payments made". (The owner, 2026-11-23.)
// Checked that day: both IRS addresses answered, and atap.arkansas.gov redirected into its own site.
const PAY_IRS = 'https://www.irs.gov/payments/direct-pay-with-bank-account';
const PAY_IRS_ALL = 'https://www.irs.gov/payments';
const PAY_AR = 'https://atap.arkansas.gov/';
// Step by step through each site, from the instruction sheet the owner's tax preparer gives her clients, brought
// up to date with what she told him in October 2026 (which year to verify with, the tax period to choose).
// The sites change their wording now and then; the steps say what to look for, not exact button names.
const PAY_STEPS: [site: string, intro: string, steps: string[]][] = [
  ['The IRS: Direct Pay', 'Have ready: your bank routing and account numbers, and a tax return from an earlier year that the IRS has already processed.', [
    'Choose to make a payment from your bank account (Direct Pay). It is free. Paying by card goes through an outside company and costs a fee.',
    'Reason for payment: "Estimated Tax" for a payment during the year (due April 15, June 15, September 15 and January 15). Choose "Balance Due" or "Tax Return or Notice" only when paying what a filed return says you owe.',
    '"Apply payment to" fills itself in as Form 1040-ES once Estimated Tax is chosen.',
    'Tax period: the year the payment is FOR. A payment made on January 15 is still for the year that just ended.',
    'Verify your identity with an earlier year\'s return: use the name and Social Security number of the first person listed on it, and the address exactly as it was on that return. If your latest return was filed recently, the IRS may not have processed it yet, so pick the year before.',
    'Enter the amount and a payment date no later than the due date, then your bank details. Tick the box for an emailed confirmation.',
    'Review, sign electronically and submit. Save or print the confirmation and keep it with your tax papers.',
  ]],
  ['Arkansas: ATAP', 'Have ready: your bank routing and account numbers and your Social Security number. No sign-in is needed.', [
    'Under Income Taxes, choose "Make Income Tax Payment".',
    'Choose ACH Debit (from your bank account, no fee). A card goes through an outside company and costs a fee.',
    'Tax account type: Individual Income Tax. Enter your Social Security number, name and email address.',
    'Payment type: "Estimated Payment" for a payment during the year, or "Return Payment" for what a filed return says you owe.',
    'Tax year: the year the payment is for. For an estimated payment, choose the quarter: 1 for April 15, 2 for June 15, 3 for September 15, 4 for January 15.',
    'Choose checking or savings and enter the bank details, a payment date no later than the due date, and the amount.',
    'Review, tick the box saying you have, and submit. Save or print the confirmation.',
  ]],
];

/** The state the household pays income tax to. Used on the Taxes page and in the setup guide. */
export function StatePick({ value, onPick }: { value: string; onPick: (code: string) => void }) {
  const { data: states } = useData<any[]>('/api/tax/states');
  return (
    <label className="field"><span>Your state</span>
      <select value={value || 'AR'} onChange={(e) => onPick(e.target.value)}>
        {(states || [{ code: value || 'AR', name: '…' }]).map((x: any) => <option key={x.code} value={x.code}>{x.name}{x.none ? ' (no income tax)' : ''}</option>)}
      </select>
      <small>For state income tax. Arkansas is worked out in detail; other states by a simpler table of rates.</small>
    </label>
  );
}

function PayLinks({ year, arkansas = true, arkansasCanWait = false, state }: { year: number; arkansas?: boolean; arkansasCanWait?: boolean; state?: any }) {
  // Arkansas's payment site is the only state one Ledger links to; elsewhere it says where to look.
  const elsewhere = state && state.code !== 'AR' && !state.none ? state.name : '';
  if (state && state.code !== 'AR') arkansas = false;
  const [steps, setSteps] = useState(false);
  return (
    <div className="pay-links">
      {steps && (
        <Modal title="Making a tax payment, step by step" onClose={() => setSteps(false)}>
          <p className="sub first">You make the payment on the government's own site. Your Social Security number and bank details are typed there, never into Ledger. The sites reword their screens from time to time, so look for the choice described rather than the exact words.</p>
          {PAY_STEPS.filter(([site]) => arkansas || !site.startsWith('Arkansas')).map(([site, intro, list]) => (
            <div className="sources" key={site}>
              <h3>{site}</h3>
              <p className="sub">{intro}</p>
              <ol className="pay-steps">{list.map((t) => <li key={t}>{t}</li>)}</ol>
              <p><a className="button-link" href={site.startsWith('Arkansas') ? PAY_AR : PAY_IRS} target="_blank" rel="noreferrer">Open {site.startsWith('Arkansas') ? 'ATAP' : 'IRS Direct Pay'}</a></p>
            </div>
          ))}
          <p className="sub">Afterwards, type what you paid under "estimated payments made" on the Taxes page, so Ledger counts it. For this page, the tax period to choose is {year}.</p>
        </Modal>
      )}
      <div className="add-actions">
        <a className="button-link" href={PAY_IRS} target="_blank" rel="noreferrer">Pay the IRS (Direct Pay)</a>
        {arkansas && <a className="button-link" href={PAY_AR} target="_blank" rel="noreferrer">Pay Arkansas (ATAP)</a>}
        <button type="button" className="link" onClick={() => setSteps(true)}>Step by step</button>
      </div>
      <small>
        These open the government's own sites in a new tab. At the IRS, choose "Estimated Tax" as the reason, Form 1040-ES, and tax year {year}; Direct Pay takes it from a bank account at no charge, and <a href={PAY_IRS_ALL} target="_blank" rel="noreferrer">the IRS lists its other ways to pay</a> (a card costs a fee).
        {arkansas ? ` At Arkansas, choose to make a payment for individual income tax as an estimated payment.${arkansasCanWait ? " Arkansas doesn't require one before you file at this level, so paying ahead there is your choice." : ''}` : ''}{elsewhere ? ` For ${elsewhere}, estimated payments are made on its revenue department's own website; search for "${elsewhere} estimated income tax payment" and check the address ends in .gov.` : ''} Ledger can't make or see the payment: afterwards, type what you paid under "estimated payments made" so it counts.
      </small>
    </div>
  );
}

const QUARTERS = [
  { label: 'January to March', due: 'April 15' },
  { label: 'April and May', due: 'June 15' },
  { label: 'June to August', due: 'September 15' },
  { label: 'September to December', due: 'January 15' },
];

// The kinds of deduction. Business expenses belong to the side gig, so a household without one doesn't see them.
const kindsFor = (gig: { on: boolean; name: string }, teachers: number) => {
  const name = gig.name;
  const all = [
  { id: 'business', title: `${name} business expenses`, help: 'Costs of doing the work: computer gear, supplies, props, a share of internet. These lower your profit from it, so they cut self-employment tax as well as income tax. Add a yearly figure here only for things that are not in your transactions.', example: 'Teaching props' },
  { id: 'teaching', title: 'Teaching job expenses', help: 'Classroom supplies, books, and equipment you pay for yourselves and are not reimbursed for.', example: 'Classroom supplies' },
  { id: 'adjustment', title: 'Income adjustments', help: 'Taken off your income whether or not you itemize: IRA or HSA contributions made outside payroll, student loan interest, self-employed health insurance.', example: 'Student loan interest' },
  { id: 'itemized', title: 'Itemized deductions', help: 'Mortgage interest, charitable giving, property and state taxes, large medical bills. These only help once they add up to more than the standard deduction.', example: 'Mortgage interest' },
  ];
  return all.filter((k) => (k.id !== 'business' || gig.on) && (k.id !== 'teaching' || teachers > 0));
};

const asDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error("That file couldn't be opened.")); r.readAsDataURL(file); });
type StubRow = { this: string; ytd: string };
const STUB_ROWS: [key: 'gross' | 'pretax' | 'federal' | 'state', label: string][] = [
  ['gross', 'Gross pay'], ['pretax', 'Pre-tax deductions'], ['federal', 'Federal tax withheld'], ['state', 'State tax withheld'],
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shortDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)} ${Number(d.slice(8, 10))}` : '');
const RING_WORDS: Record<string, string> = { done: 'filled in', partial: 'partly filled in', late: 'past due', due: 'due now', later: 'not due yet', off: 'no pay that month' };
const PERSON_WORDS: Record<string, string> = { done: 'On a pay stub', late: 'Past due: nothing entered', due: 'Due now: nothing entered yet', later: 'Not due yet', off: 'Marked as no pay this month' };
// A slice of a ring between two radii, from angle a0 to a1 in degrees (0 is the top, clockwise).
const slice = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) => {
  const pt = (r: number, a: number) => { const t = ((a - 90) * Math.PI) / 180; return `${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`; };
  return `M${pt(r1, a0)} A${r1} ${r1} 0 0 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0} ${r0} 0 0 0 ${pt(r0, a0)} Z`;
};

/**
 * The year as a ring of twelve slices, one a month, each split into a band per adult (the outer band is
 * the first adult). A band is filled when a pay stub covers that month for that person, red when the month
 * has gone by with nothing, amber when it is due now, and faint when it isn't time yet. Choosing a slice
 * shows that month for each person, with the ways to fill it in.
 */
function PayRing({ c, month, onPick }: { c: any; month: number; onPick: (m: number) => void }) {
  const C = 150, people = c.people as any[];
  const bands = people.length > 1 ? [[96, 122], [66, 92]] : [[70, 122]];
  const inCount = c.ring.filter((r: string, i: number) => i < c.month && (r === 'done' || r === 'off')).length;
  return (
    <svg className="pay-ring" viewBox="0 0 300 300" role="group" aria-label={`Pay stubs for ${c.year} by month`}>
      {MONTHS.map((m, i) => {
        const a0 = i * 30 + 1.6, a1 = (i + 1) * 30 - 1.6, mid = ((i * 30 + 15 - 90) * Math.PI) / 180;
        const label = `${m}: ${RING_WORDS[c.ring[i]]}${people.length > 1 ? `. ${people.map((p) => `${p.name || (p.who === 'spouse' ? 'Spouse' : 'You')}: ${PERSON_WORDS[p.status[i]].toLowerCase()}`).join('. ')}` : ''}`;
        return (
          <g key={m} className={`ring-month ${c.ring[i]}${month === i + 1 ? ' on' : ''}${c.month === i + 1 ? ' now' : ''}`} role="button" tabIndex={0} aria-label={label} aria-pressed={month === i + 1}
            onClick={() => onPick(i + 1)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i + 1); } }}>
            <title>{label}</title>
            <path className="hit" d={slice(C, C, 60, 148, i * 30, (i + 1) * 30)} />
            {people.map((p, k) => <path key={p.who} className={`band ${p.status[i]}`} d={slice(C, C, bands[k][0], bands[k][1], a0, a1)} />)}
            <path className="pick" d={slice(C, C, bands[bands.length - 1][0] - 3, 125, a0 - 0.8, a1 + 0.8)} />
            <text x={C + 137 * Math.cos(mid)} y={C + 137 * Math.sin(mid) + 4} textAnchor="middle">{m.slice(0, 3)}</text>
          </g>
        );
      })}
      <text className="ring-big" x={C} y={C - 2} textAnchor="middle">{inCount} of {Math.max(c.month, 0)}</text>
      <text className="ring-small" x={C} y={C + 16} textAnchor="middle">months so far</text>
    </svg>
  );
}

/**
 * What pay the estimate is counting, month by month, for each adult (`payCoverage` in server/paystub.js):
 * months on a pay stub, months estimated from the last stub, and months with nothing entered, then each
 * job's stub in a line of its own. Shown above "Fill in from a pay stub" wherever that form is.
 */
function PayCoverage({ c, onChange, onAdd }: { c: any; onChange: () => void; onAdd: (who: 'you' | 'spouse', month: number, upload: boolean) => void }) {
  const [err, setErr] = useState('');
  // The month chosen on the ring: this month to begin with, or the first one that wants attention.
  const [picked, setPicked] = useState(0);
  if (!c?.people?.length) return null;
  const wants = c.ring.findIndex((r: string) => r === 'late' || r === 'partial' || r === 'due');
  const month = picked || (wants >= 0 ? wants + 1 : c.month || 1);
  const skip = (who: string, on: boolean) => async () => {
    setErr('');
    try { await api('/api/paystub/skip', { method: 'PUT', body: { who, month, on } }); onChange(); } catch (e: any) { setErr(e.message); }
  };
  const nameOf = (p: any) => p.name || (p.who === 'spouse' ? 'Your spouse' : 'You');
  const remove = (id: string) => async () => {
    if (!window.confirm("Remove this pay stub? That job's pay and withholding come out of the year's figures.")) return;
    setErr('');
    try { await api(`/api/paystub/${id}`, { method: 'DELETE' }); onChange(); } catch (e: any) { setErr(e.message); }
  };
  const used = new Set<string>([...c.ring, ...c.people.flatMap((p: any) => p.status)]);
  return (
    <div className="pay-cover">
      <h3>Pay stubs for {c.year}, month by month</h3>
      <div className="pay-wheel">
        <PayRing c={c} month={month} onPick={setPicked} />
        <div className="pay-month" aria-live="polite">
          <div className="pay-head"><b>{MONTHS[month - 1]}</b><span className={`ring-tag ${c.ring[month - 1]}`}>{RING_WORDS[c.ring[month - 1]]}</span></div>
          {c.people.map((p: any) => {
            const st = p.status[month - 1];
            const job = p.jobs.find((j: any) => !j.stale && month >= j.from && month <= j.to);
            return (
              <div className="pay-slot" key={p.who}>
                <div><span className={`dot ${st}`} /><b>{nameOf(p)}</b> <span className="when">{PERSON_WORDS[st]}{st === 'later' && month === c.month ? ` (usually paid by the ${p.dueDay}${['th', 'st', 'nd', 'rd'][p.dueDay % 10 > 3 || (p.dueDay > 10 && p.dueDay < 14) ? 0 : p.dueDay % 10]})` : ''}</span></div>
                {st === 'done' && job && <small>Covered by the {job.employer || 'job'} stub{job.pay_date ? ` dated ${shortDate(job.pay_date)}` : ''}, whose year to date runs from {MONTHS[job.from - 1]}. A later stub from the same job replaces it.</small>}
                {st !== 'done' && st !== 'off' && !p.jobs.length && p.wages > 0 && <small>A yearly figure is typed in for {p.who === 'spouse' ? 'them' : 'you'}, so the estimate still works, but no stub backs this month.</small>}
                <div className="add-actions">
                  {st !== 'off' && <button type="button" className={st === 'done' ? '' : 'primary'} onClick={() => onAdd(p.who, month, true)}>Upload a pay stub</button>}
                  {st !== 'off' && <button type="button" onClick={() => onAdd(p.who, month, false)}>Type it in</button>}
                  {st !== 'done' && st !== 'off' && <button type="button" className="link" onClick={skip(p.who, true)}>No pay this month</button>}
                  {st === 'off' && <button type="button" className="link" onClick={skip(p.who, false)}>Undo "no pay this month"</button>}
                </div>
              </div>
            );
          })}
          <p className="sub">One stub covers every month back to when that job began, because it carries the year to date. So the newest stub from each job is all Ledger needs.</p>
        </div>
      </div>
      <p className="pay-key">
        {used.has('done') && <span><i className="dot done" />Filled in</span>}
        {used.has('partial') && <span><i className="dot partial" />Partly: one of you still to add</span>}
        {used.has('due') && <span><i className="dot due" />Due now</span>}
        {used.has('late') && <span><i className="dot late" />Past due</span>}
        {used.has('later') && <span><i className="dot later" />Not due yet</span>}
        {used.has('off') && <span><i className="dot off" />No pay that month</span>}
        {c.people.length > 1 && <span>Outer band: {nameOf(c.people[0])}. Inner band: {nameOf(c.people[1])}.</span>}
      </p>
      {c.people.map((p: any) => {
        const whose = p.who === 'spouse' ? (p.name ? `${p.name}'s` : "Your spouse's") : p.name ? `${p.name}'s` : 'Your';
        return (
          <div className="pay-person" key={p.who}>
            <div className="pay-head"><b>{whose} pay</b><span className="num">{cents(p.wages)} <small>counted for the year</small></span></div>
            {p.jobs.map((j: any) => (
              <div className="pay-job" key={j.id}>
                <div className="grow">
                  <b>{j.employer || 'A job'}</b> <span className="when">{j.from === j.to ? MONTHS[j.from - 1] : `${MONTHS[j.from - 1]} to ${MONTHS[j.to - 1]}`}</span>
                  <small>
                    {cents(j.soFar)} on the stub{j.pay_date ? ` dated ${shortDate(j.pay_date)}` : ''}
                    {j.left > 0 ? `, plus ${j.left} more ${j.left === 1 ? 'check' : 'checks'} estimated at ${cents(j.toCome)}` : ', and no more checks from this job'}.
                    {' '}Tax withheld for the year: federal {cents(j.federal)}, state {cents(j.state)}.
                    {j.stale ? ` This stub isn't from ${c.year}, so it shouldn't be counted: remove it and add one from ${c.year}.` : ''}
                  </small>
                </div>
                <button className="link" onClick={remove(j.id)}>Remove</button>
              </div>
            ))}
            {p.other.map((o: any, i: number) => (
              <div className="pay-job" key={`o${i}`}><div className="grow"><b>{o.name || 'Another job'}</b><small>{cents(o.wages)} typed for the year under "More about your household", on top of the figure above. Its months aren't known.</small></div></div>
            ))}
            {!p.jobs.length && (p.earlier
              ? <p className="sub">This yearly figure came from a pay stub{p.earlier.employer ? ` (${p.earlier.employer})` : ''}{p.earlier.pay_date ? ` dated ${shortDate(p.earlier.pay_date)}` : ''}, added before Ledger kept each stub. Add the latest stub again, and the last stub of any earlier job this year, to see which months it covers.</p>
              : p.wages > 0 ? <p className="sub">This is a yearly figure typed in the salary box, so there are no months to show. Add a pay stub to see which months are covered and to fill in the tax withheld.</p> : null)}
            {p.jobs.some((j: any) => j.left > 0 && !j.stale) && <p className="sub">Pay after the newest stub's date is an estimate: its check repeated for each one still to come. A later stub replaces the estimate with what was really paid.</p>}
            {p.typedOver && <p className="sub"><b>The salary box says {cents(p.wages)}, but these stubs add up to {cents(p.total)}.</b> The estimate uses the salary box. Add a stub again to bring them back in step.</p>}
          </div>
        );
      })}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/**
 * Fills in a person's wages, pre-tax deductions and withholding from a pay stub. Claude reads the
 * stub; the figures are shown to check and correct, and the year is worked out as year to date plus
 * this check's figure for each check still to come.
 */
export function PayStub({ joint, onSaved }: { joint: boolean; onSaved: () => void }) {
  const { data: have, reload } = useData('/api/paystub');
  const named = { you: have?.names?.you || '', spouse: have?.names?.spouse || '' };
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<'you' | 'spouse'>('you');
  const fileBox = useRef<HTMLInputElement>(null);
  const [read, setRead] = useState<any>(null);
  const [rows, setRows] = useState<Record<string, StubRow>>({});
  const [left, setLeft] = useState('');
  // The first month this job paid this year, and which kept stub this one takes the place of ('' adds another job).
  const [first, setFirst] = useState('1');
  const [replaces, setReplaces] = useState('');
  const [employer, setEmployer] = useState('');
  const [payDate, setPayDate] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const blank = () => Object.fromEntries(STUB_ROWS.map(([k]) => [k, { this: '', ytd: '' }]));
  const begin = () => { setOpen(true); setRead(null); setRows(blank()); setLeft(''); setFirst('1'); setReplaces(''); setEmployer(''); setPayDate(''); setErr(''); setNote(''); };
  // The stubs already kept for the person chosen: a new stub either takes one's place or is another job.
  const mine: any[] = have?.coverage?.people?.find((p: any) => p.who === who)?.jobs || [];
  const likely = (employer: string, jobs: any[]) => {
    const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    const mineWords = words(employer || '');
    const same = jobs.find((j) => words(j.employer || '').some((w) => mineWords.includes(w)));
    return same ? same.id : !employer && jobs.length === 1 ? jobs[0].id : '';
  };
  useEffect(() => { setReplaces(likely(employer, mine)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [who, read, mine.length]);
  // Arriving from the dashboard's pay stub reminder: open the form for the person it named and bring it into view.
  const box = useRef<HTMLDivElement>(null);
  const arrived = useRef<string | null>(null);
  useEffect(() => {
    // Read once and remembered, so it still holds if this runs a second time (as it does in development).
    if (arrived.current === null) {
      arrived.current = '';
      try { arrived.current = sessionStorage.getItem('ledger-stub-open') || ''; sessionStorage.removeItem('ledger-stub-open'); } catch { /* private window */ }
    }
    const asked = arrived.current;
    if (!asked) return;
    begin();
    if (asked === 'spouse' && joint) setWho('spouse');
    // Twice: the page scrolls to its top on arrival and its cards fill in a moment later.
    const ts = [400, 1000].map((ms) => setTimeout(() => box.current?.scrollIntoView({ block: 'center' }), ms));
    return () => ts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setBusy('Reading the pay stub…');
    try {
      const r = await api('/api/paystub/read', { method: 'POST', body: { file: await asDataUrl(file) } });
      setRead(r);
      setRows(Object.fromEntries(STUB_ROWS.map(([k]) => [k, { this: r[k].this != null ? String(r[k].this) : '', ytd: r[k].ytd != null ? String(r[k].ytd) : '' }])));
      setLeft(r.checksLeft != null ? String(r.checksLeft) : '');
      setFirst(String(r.firstMonth || 1));
      setEmployer(r.employer || ''); setPayDate(r.pay_date || '');
      setReplaces(likely(r.employer || '', mine));
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  };
  // From a slice of the ring: the form opens for that person, dated in that month, and the file chooser too if asked.
  const startFor = (w: 'you' | 'spouse', month: number, upload: boolean) => {
    begin(); setWho(w);
    const y = have?.coverage?.year, today = new Date();
    if (y && !upload) {
      const last = new Date(y, month, 0).getDate();
      const day = today.getFullYear() === y && today.getMonth() + 1 === month ? today.getDate() : last;
      setPayDate(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    if (upload) fileBox.current?.click();
  };
  const form = useRef<HTMLDivElement>(null);
  const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
  const yearly = (k: string) => Math.round((num(rows[k]?.ytd ?? '') + num(rows[k]?.this ?? '') * num(left)) * 100) / 100;
  const filled = STUB_ROWS.some(([k]) => (rows[k]?.ytd ?? '') !== '' || (rows[k]?.this ?? '') !== '');
  const use = async () => {
    setErr('');
    try {
      const r = await api('/api/paystub/apply', { method: 'POST', body: {
        who, wages: yearly('gross'), pretax: yearly('pretax'), federal: yearly('federal'), state: yearly('state'), employer: employer.trim(), pay_date: payDate,
        parts: Object.fromEntries(STUB_ROWS.map(([k]) => [k, { ytd: num(rows[k]?.ytd ?? ''), this: num(rows[k]?.this ?? '') }])),
        left: num(left), first_month: Number(first), frequency: read?.frequency || 'unknown', replaces: mine.length ? replaces : 'all',
      } });
      setNote(r.complete
        ? 'Saved. Wages, pre-tax deductions and withholding are filled in, so "Owe or refund at filing" below is now worked out.'
        : `Saved. Add ${r.waitingOn === 'spouse' ? "your spouse's" : 'your own'} pay stub too and the withholding totals will be filled in.`);
      setOpen(false); reload(); onSaved();
    } catch (e: any) { setErr(e.message); }
  };
  const edit = (k: string, col: 'this' | 'ytd') => (e: any) => setRows({ ...rows, [k]: { ...rows[k], [col]: e.target.value } });
  return (
    <div className="paystub" ref={box}>
      <PayCoverage c={have?.coverage} onChange={() => { reload(); onSaved(); }} onAdd={startFor} />
      <input ref={fileBox} type="file" accept="application/pdf,image/*" onChange={pick} hidden />
      {note && <p className="good" role="status">{note}</p>}
      <button onClick={begin}>Fill in from a pay stub</button>
      {open && (
        <Modal title={`Add ${who === 'spouse' ? (named.spouse ? `${named.spouse}'s` : "your spouse's") : named.you ? `${named.you}'s` : 'a'} pay stub`} onClose={() => setOpen(false)}>
        <div className="stack stub-form" style={{ gap: 10 }} ref={form}>
          <p className="sub first">
            Upload a recent pay stub as a PDF, photo or screenshot. It is sent to Claude to be read and isn't kept. You'll see the figures before anything is saved.
            The later in the year the stub, the closer the result.
          </p>
          <div className="add-actions">
            {joint && (
              <select value={who} aria-label="Whose pay stub" onChange={(e) => setWho(e.target.value as 'you' | 'spouse')}>
                <option value="you">{named.you ? `${named.you}'s pay stub` : 'My pay stub'}</option><option value="spouse">{named.spouse ? `${named.spouse}'s pay stub` : "My spouse's pay stub"}</option>
              </select>
            )}
            <button type="button" className="primary" disabled={!!busy} onClick={() => fileBox.current?.click()}>Upload the stub</button>
          </div>
          {busy && <p className="sub" role="status">{busy}</p>}
          {read && <p className="sub">Read from {read.employer || 'the stub'}{read.pay_date ? `, paid ${read.pay_date}` : ''}. Check each figure against the stub and correct any that are wrong or blank.{read.unsure ? ` Claude's note: ${read.unsure}` : ''}{read.pay_date && !read.pay_date.startsWith(String(read.year)) ? ` This stub isn't from ${read.year}, the year the estimate is for.` : ''}</p>}
          <table className="table stub-table">
            <thead><tr><th></th><th className="r">This check</th><th className="r">Year to date</th><th className="r">Whole year</th></tr></thead>
            <tbody>
              {STUB_ROWS.map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td className="r"><input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`${label}, this check`} value={rows[k]?.this ?? ''} onChange={edit(k, 'this')} /></td>
                  <td className="r"><input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`${label}, year to date`} value={rows[k]?.ytd ?? ''} onChange={edit(k, 'ytd')} /></td>
                  <td className="r num">{cents(yearly(k))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="add-grid">
            <label className="field"><span>Employer</span>
              <input type="text" maxLength={80} autoComplete="off" value={employer} onChange={(e) => setEmployer(e.target.value)} onBlur={() => setReplaces(likely(employer, mine))} />
            </label>
            <label className="field"><span>Pay date on the stub</span>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              <small>The stub's year to date counts up to this day.</small>
            </label>
            <label className="field"><span>Checks still to come this year</span>
              <input type="number" min="0" step="1" value={left} onChange={(e) => setLeft(e.target.value)} />
              <small>Whole year is year to date plus this check for each one still to come. 0 if this job has ended.</small>
            </label>
            <label className="field"><span>This job first paid this year in</span>
              <select value={first} onChange={(e) => setFirst(e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
              <small>January unless the job began during the year. It decides which months this stub covers.</small>
            </label>
            {mine.length > 0 && (
              <label className="field"><span>This stub is</span>
                <select value={replaces} onChange={(e) => setReplaces(e.target.value)}>
                  {mine.map((j) => <option key={j.id} value={j.id}>Newer stub from {j.employer || 'the same job'}</option>)}
                  <option value="">Another job this year</option>
                </select>
                <small>{replaces ? 'It takes the place of the stub kept for that job.' : "It is added to the other jobs' pay."}</small>
              </label>
            )}
          </div>
          {!mine.length && <p className="sub">Changed jobs this year? Add the last pay stub from each job, one after the other, and Ledger adds them together.</p>}
          {err && <p className="error" role="alert">{err}</p>}
          <div className="add-actions"><button className="primary" disabled={!filled} onClick={use}>Use these figures</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
        </div>
        </Modal>
      )}
      {err && !open && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/**
 * "Needs your attention": the few things on this page that are waiting on someone, one line each, each going
 * straight to its section. Only what is true right now is listed; with nothing waiting it says so in a line.
 */
function TaxTodo({ t, stubs, hints, pack }: { t: any; stubs: any; hints: any; pack: any }) {
  const items: { text: React.ReactNode; fold?: string; at?: string }[] = [];
  const c = stubs?.coverage;
  const list = (months: string[]) => (months.length <= 3 ? months.join(', ') : `${months.slice(0, 3).join(', ')} and ${months.length - 3} more`);
  for (const p of c?.people || []) {
    const whose = p.who === 'spouse' ? (p.name ? `${p.name}'s` : "Your spouse's") : p.name ? `${p.name}'s` : 'Your';
    const late = MONTHS.filter((_, i) => p.status[i] === 'late'), due = MONTHS.filter((_, i) => p.status[i] === 'due');
    if (late.length) items.push({ text: <><b>{whose} pay stub is past due</b> for {list(late)}.</>, fold: 'tax-stubs', at: '.pay-cover' });
    else if (due.length) items.push({ text: <><b>{whose} pay stub for {due[0]} is due.</b></>, fold: 'tax-stubs', at: '.pay-cover' });
  }
  if (!t.filing.known && (c?.people || []).some((p: any) => p.wages > 0)) items.push({ text: <><b>Tax withheld isn't entered</b>, so Ledger can't say whether you'll owe or get a refund.</>, at: '.owe-card' });
  const waiting = hints ? hints.groups.reduce((n: number, g: any) => n + g.count, 0) : 0;
  if (waiting) items.push({ text: <><b>{waiting} {waiting === 1 ? 'purchase' : 'purchases'} that might count</b> to say yes or no to.</>, fold: 'tax-hints' });
  const unsent = (hints?.asking || []).filter((q: any) => !q.askedAt).length, asked = (hints?.asking || []).length - unsent;
  if (unsent) items.push({ text: <><b>{unsent} {unsent === 1 ? 'question' : 'questions'} set aside for your tax preparer</b>, not sent yet.</>, fold: 'tax-hints', at: '.hint-questions' });
  if (asked) items.push({ text: <><b>{asked} {asked === 1 ? 'question is' : 'questions are'} waiting on your tax preparer's answer.</b> Press Yes or No when you have it.</>, fold: 'tax-hints', at: '.hint-questions' });
  const noReceipt = pack?.receipts ? pack.receipts.all - pack.receipts.kept : 0;
  if (noReceipt > 0) items.push({ text: <><b>{noReceipt} claimed {noReceipt === 1 ? 'purchase has' : 'purchases have'} no receipt kept.</b></>, fold: 'tax-pack', at: '.pack-receipts' });
  const go = (i: { fold?: string; at?: string }) => () => {
    if (i.fold) openFold(i.fold, i.at);
    else if (i.at) document.querySelector(i.at)?.scrollIntoView({ block: 'center' });
  };
  if (!items.length) return <p className="tax-todo none">Nothing on this page needs your attention right now.</p>;
  return (
    <section className="card tax-todo">
      <div className="card-head"><h2>Needs your attention</h2><span className="sub">{items.length}</span></div>
      {items.map((i, n) => (
        <button type="button" className="todo-row" key={n} onClick={go(i)}>
          <span className="grow">{i.text}</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      ))}
    </section>
  );
}

function Deductions({ t, reload }: { t: any; reload: () => void }) {
  const KINDS = kindsFor(t.gig, t.teaching.fedCap > 0 ? 1 : 0);
  const [f, setF] = useState({ name: '', amount: '', kind: KINDS[0].id });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const std = t.constants.fedStandardDeduction;
  const itemized = t.with.itemizedTotal;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Enter what the deduction is for.');
    if (!(Number(f.amount) > 0)) return setErr('Enter an amount above 0.');
    try {
      await api('/api/deductions', { method: 'POST', body: { ...f, amount: Number(f.amount) } });
      setF({ name: '', amount: '', kind: f.kind });
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const remove = async (id: number) => { await api(`/api/deductions/${id}`, { method: 'DELETE' }); reload(); };

  return (
    <section className="card">
      <div className="card-head"><h2>Deductions</h2><span className="sub">Yearly amounts for {t.year}</span></div>
      <form className="deduct-form" onSubmit={add} noValidate>
        <label className="field"><span>What it's for</span><input type="text" value={f.name} onChange={set('name')} placeholder={KINDS.find((k) => k.id === f.kind)!.example} /></label>
        <label className="field"><span>Amount per year</span><input type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="600" /></label>
        <label className="field"><span>Type</span>
          <select value={f.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}</select>
        </label>
        <button type="submit" className="primary">Add deduction</button>
      </form>
      {err && <p className="error" role="alert">{err}</p>}

      {KINDS.map((k) => {
        const items = t.deductions.filter((d: any) => d.kind === k.id);
        return (
          <div key={k.id}>
            <div className="group-head"><span>{k.title}</span><span className="num">{money(t.deductionTotals[k.id])}</span></div>
            <small>{k.help}</small>
            {(k.id === 'business' || k.id === 'teaching') && (
              <div className="row">
                <span className="grow wrap">
                  Purchases claimed in Transactions
                  <small>
                    {t.claimedPurchases[k.id].count
                      ? `${t.claimedPurchases[k.id].count} so far in ${t.year}, added up automatically. `
                      : `None yet. Use "Claim for ${k.id === 'business' ? t.gig.name : 'teaching'}" on any purchase and it adds up here automatically. `}
                    <a href="#transactions">Open Transactions</a>
                  </small>
                </span>
                <span className="num">{money(t.claimedPurchases[k.id].total)}</span>
              </div>
            )}
            {k.id === 'teaching' && (
              <p className="sub">
                {t.teaching.fedCap === 0
                  ? 'Set "Teachers in household" above to count these.'
                  : <>Federal: {money(t.teaching.fedAboveLine)} of the {money(t.teaching.fedCap)} limit comes straight off your income ($350 per teacher).
                    {t.teaching.fedExcess > 0 ? ` The other ${money(t.teaching.fedExcess)} counts with your itemized deductions, so it only helps if you itemize.` : ''}{' '}
                    {(t.state?.code ?? 'AR') === 'AR' ? <>Arkansas: {money(t.teaching.arDeduction)} of its separate {money(t.teaching.arCap)} limit ($1,000 per teacher).</> : null}</>}
              </p>
            )}
            {items.map((d: any) => (
              <div key={d.id} className="row">
                <span className="grow">{d.name}</span>
                <span className="num">{money(d.amount)}</span>
                <button className="link" onClick={() => remove(d.id)} aria-label={`Remove ${d.name}`}>Remove</button>
              </div>
            ))}
            {k.id === 'itemized' && itemized > 0 && (
              <p className={`sub ${itemized > std ? 'good' : ''}`}>
                {itemized > std
                  ? `Your itemized total beats the ${money(std)} standard deduction by ${money(itemized - std)}, so the estimate uses it.`
                  : `Your itemized total is ${money(std - itemized)} short of the ${money(std)} standard deduction, so the estimate still uses the standard deduction and these don't change your tax.`}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

export default function Taxes() {
  // What the fold summaries and the attention list are drawn from. (Before any early return: hooks must run every time.)
  const { data: stubs } = useData<any>('/api/paystub');
  const { data: hints } = useData<any>('/api/tax/hints');
  const { data: pack } = useData<any>('/api/tax/pack');
  const { data: t, error, reload } = useData('/api/tax');
  if (error) return <p className="error">{error}</p>;
  if (!t) return <Skeleton tiles={0} cards={3} rows={4} />;

  const s = t.settings;
  const save = (key: string) => async (v: string) => { await api('/api/settings', { method: 'PUT', body: { [key]: v } }); reload(); dispatchEvent(new Event('ledger-gig')); };
  // Married filing jointly has two earners; single and head of household have one.
  // (Married filing separately still has two people; `joint` here means "there is a spouse".)
  const joint = t.status === 'joint' || t.status === 'separate';
  const w = t.with, wo = t.without;
  // The state the household pays income tax to. Arkansas is worked out in detail; the others by a simpler table.
  const ST: string = t.state?.name ?? 'Arkansas', isAR = (t.state?.code ?? 'AR') === 'AR', noState = !!t.state?.none;
  // The side gig, if the household has one: its name is used throughout, and its cards are left out without one.
  // With several gigs the page speaks of them together.
  const gigOn: boolean = t.gig.on, G: string = t.gigs.length > 1 ? 'side gigs' : t.gig.name;
  // With no wages at all (a household living on side income) there is no "jobs only" figure to compare with.
  const compare = gigOn && (Number(s.your_salary) > 0 || (joint && Number(s.spouse_salary) > 0) || t.more.jobs.length > 0);
  const rows = [
    { name: 'Federal income tax', a: wo.fedIncomeTax, b: w.fedIncomeTax },
    ...(gigOn ? [{ name: 'Self-employment tax', note: `Social Security and Medicare on ${G} profit`, a: wo.seTax, b: w.seTax }] : []),
    ...(noState ? [] : [{ name: `${ST} income tax`, a: wo.arTax, b: w.arTax }]),
  ];
  // Where taxable income sits inside its federal bracket.
  const span = w.bracketTop ? w.bracketTop - w.bracketFloor : 1;
  const fill = w.bracketTop ? Math.min(100, ((w.taxable - w.bracketFloor) / span) * 100) : 100;
  const nextRate = t.constants.brackets[t.constants.brackets.findIndex((b: any) => b.rate === w.fedRate) + 1]?.rate;
  // On a phone the answer comes first (the estimate, then owe or refund) and everything else folds to a title.
  const cover = stubs?.coverage;
  // Where the household stands: paid in so far (when the kept pay stubs account for the withholding in use),
  // what the checks still to come should add, and what is left.
  const wh = stubs?.withheld || { split: false, federal: 0, state: 0, federalToCome: 0, stateToCome: 0, asOf: '' };
  const paidEst = (Number(s.paid_fed) || 0) + (Number(s.paid_ar) || 0);
  const yearIn = (Number(s.withheld_fed) || 0) + (Number(s.withheld_ar) || 0) + paidEst;
  const split = !!wh.split;
  const paidSoFar = wh.federal + wh.state + paidEst, toCome = wh.federalToCome + wh.stateToCome;
  const left = t.filing.known ? t.filing.federal + t.filing.arkansas : 0;
  const nextPay = t.filing.known && t.quarterly?.needed ? Math.max(0, t.quarterly.toAvoidPenalty || 0) : 0;
  const inSoFar = cover ? cover.ring.filter((r: string, i: number) => i < cover.month && (r === 'done' || r === 'off')).length : 0;
  const behind = cover ? cover.ring.filter((r: string) => r === 'late' || r === 'partial' || r === 'due').length : 0;
  const stubNote = !cover?.people?.length ? 'Add one to fill in wages and tax withheld' : `${inSoFar} of ${cover.month} months so far are in${behind ? ` · ${behind} to add` : ''}`;
  const hintCount = hints ? hints.groups.reduce((n: number, g: any) => n + g.count, 0) : 0;
  const hintNote = hintCount ? `${hintCount} to say yes or no to` : hints?.asking?.length ? `${hints.asking.length} set aside for your tax preparer` : 'Nothing waiting';
  const owe = (
        <section className="card owe-card">
          <div className="card-head"><h2>Owe or refund at filing</h2></div>
          {t.filing.known ? (
            <>
              {([['Federal', t.filing.federal], ...(noState ? [] : [[ST, t.filing.arkansas]])] as [string, number][]).map(([name, n]) => (
                <div key={name} className="row"><span className="grow">{name}<small>{n > 0 ? 'Still owed after withholding and payments' : 'Refund expected'}</small></span><span className={`num ${n > 0 ? 'bad' : 'good'}`}>{money(Math.abs(n))} {n > 0 ? 'owed' : 'refund'}</span></div>
              ))}
              <div className="row total"><span className="grow">Together</span><span className={`num ${t.filing.federal + t.filing.arkansas > 0 ? 'bad' : 'good'}`}>{money(Math.abs(t.filing.federal + t.filing.arkansas))} {t.filing.federal + t.filing.arkansas > 0 ? 'owed' : 'refund'}</span></div>
            </>
          ) : (
            <p className="sub first">Enter the tax withheld from {joint ? 'both of your paychecks' : 'your paychecks'} for the whole year to see whether you'll owe or get a refund. Use the year-to-date amounts from each pay stub plus what the remaining checks will add.</p>
          )}
          <div className="add-grid">
            <NumField label="Federal tax withheld" value={s.withheld_fed} allowBlank step={50} onSave={save('withheld_fed')} hint={joint ? 'Both of you, whole year, including checks still to come' : 'Whole year, including checks still to come'} />
            {!noState && <NumField label={`${ST} tax withheld`} value={s.withheld_ar} allowBlank step={50} onSave={save('withheld_ar')} hint={joint ? 'Both of you, whole year, including checks still to come' : 'Whole year, including checks still to come'} />}
            <NumField label="Federal estimated payments made" value={s.paid_fed} allowBlank step={50} onSave={save('paid_fed')} />
            {!noState && <NumField label={`${ST} estimated payments made`} value={s.paid_ar} allowBlank step={50} onSave={save('paid_ar')} />}
          </div>
          <p className="where-line"><WhereToFind first="Pay and tax withheld" /></p>
        </section>
  );

  return (
    <div className="stack">
      {s.retired === '1' && !(t.more.income.ss_you + t.more.income.ss_spouse + t.more.income.pension_you + t.more.income.pension_spouse + t.more.income.ira_you + t.more.income.ira_spouse > 0) && (
        <p className="advice" role="note">
          <b>Someone in this household is retired.</b> Add Social Security, pensions and retirement account withdrawals under "More about your household", "Retirement and other income", and your birth years under "Ages", so the estimate counts them. Until then it covers wages and self-employment only.
        </p>
      )}
      <section className="tiles">
        <div className="tile"><div className="label">Tax for {t.year}</div><div className="value">{money(w.total)}</div><div className="sub">{noState ? `federal only: ${ST} has no income tax` : `federal and ${ST} together`}{gigOn ? `, ${G} included` : ''}</div></div>
        <div className="tile"><div className="label">{split ? 'Paid in so far' : 'Withheld for the year'}</div><div className="value">{t.filing.known ? money(split ? paidSoFar : yearIn) : 'Not entered'}</div><div className="sub">{!t.filing.known ? 'Add your pay stubs to fill this in' : split ? `out of your paychecks${paidEst > 0 ? ' and payments' : ''}, as of ${shortDate(wh.asOf)}` : 'whole year, as entered below'}</div></div>
        <div className="tile"><div className="label">{t.filing.known && left < 0 ? 'Refund expected' : 'Left for you to pay'}</div><div className={`value ${t.filing.known ? (left > 0 ? 'bad' : 'good') : ''}`}>{t.filing.known ? money(Math.abs(left)) : '\u2014'}</div><div className="sub">{!t.filing.known ? 'Shown once tax withheld is entered' : left > 0 ? 'after everything your paychecks withhold this year' : 'when you file'}</div></div>
        <div className="tile"><div className="label">Next payment</div><div className="value">{nextPay > 0 ? money(nextPay) : 'None due'}</div><div className="sub">{nextPay > 0 ? `to the IRS by ${t.quarterly.next?.label || 'the next due date'}, to avoid a penalty` : t.filing.known && left > 0 ? 'the rest is paid when you file' : 'nothing to send before you file'}</div></div>
      </section>

      <div className="cols">
        <section className="card standing">
          <div className="card-head"><h2>Where you stand</h2></div>
          {t.filing.known ? (
            <>
              <div className="stand-bar" role="img" aria-label={`Of ${money(w.total)} for the year: ${money(split ? paidSoFar : yearIn)} paid in${split ? `, ${money(toCome)} still to come out of paychecks` : ''}, ${money(Math.max(0, left))} left to pay`}>
                <i className="paid" style={{ flex: Math.max(0, split ? paidSoFar : yearIn) }} />
                {split && toCome > 0 && <i className="coming" style={{ flex: toCome }} />}
                {left > 0 && <i className="left" style={{ flex: left }} />}
              </div>
              <div className="stand-rows">
                <div className="row"><span className="grow"><i className="dot paid" />{split ? 'Paid in so far' : 'Withheld and paid for the year'}<small>{split ? `Tax taken out of your paychecks up to ${shortDate(wh.asOf)}${paidEst > 0 ? ', plus estimated payments made' : ''}` : 'As entered: tax withheld for the whole year, plus estimated payments'}</small></span><span className="num">{cents(split ? paidSoFar : yearIn)}</span></div>
                {split && toCome > 0 && <div className="row"><span className="grow"><i className="dot coming" />Still coming out of paychecks<small>What the checks left this year should withhold, at the last check's rate</small></span><span className="num">{cents(toCome)}</span></div>}
                <div className="row"><span className="grow"><i className={`dot ${left > 0 ? 'left' : 'paid'}`} />{left > 0 ? 'Left for you to pay' : 'Refund expected'}<small>{left > 0 ? noState ? `${cents(Math.max(0, t.filing.federal))} federal` : `${cents(Math.max(0, t.filing.federal))} federal and ${cents(Math.max(0, t.filing.arkansas))} ${ST}` : 'More was withheld than the year\'s tax'}</small></span><span className={`num ${left > 0 ? 'bad' : 'good'}`}>{cents(Math.abs(left))}</span></div>
                <div className="row total"><span className="grow">Tax for {t.year}</span><span className="num">{cents(w.total)}</span></div>
              </div>
              <p className="sub">
                {compare
                  ? <>{yearIn >= wo.total ? 'Your paychecks cover the tax on your wages.' : `Your paychecks fall about ${money(wo.total - yearIn)} short of the tax on your wages.`} {left > 0 ? <>What's left is {yearIn >= wo.total ? '' : 'mostly '}the tax on {G} income ({money(t.extra)}), which nobody withholds.</> : null}</>
                  : left > 0 ? "What's left is the gap between the year's tax and what is withheld from your pay." : 'Your withholding covers the year\'s tax.'}
                {nextPay > 0 && <> To avoid an underpayment penalty, <b>{money(nextPay)}</b> of it should reach the IRS by {t.quarterly.next?.label}; the rest can wait until you file.</>}
              </p>
              {(nextPay > 0 || left > 0) && <PayLinks year={t.year} state={t.state} arkansas={t.filing.arkansas > 0} arkansasCanWait={!t.quarterly?.arkansasNeeded} />}
            </>
          ) : <p className="sub first">The year's tax is estimated at <b>{money(w.total)}</b>. Add a pay stub for {joint ? 'each of you' : 'yourself'} under "Pay stubs", or type the tax withheld beside this, and Ledger will show what has been paid in and what is left.</p>}
        </section>

        {owe}
      </div>

      <TaxTodo t={t} stubs={stubs} hints={hints} pack={pack} />

      <h3 className="tax-group">What it's built from</h3>
      <Fold id="tax-adds" title={compare ? `What ${G} adds` : 'How the estimate adds up'} note={compare ? `${money(t.extra)} of the year's tax, which nobody withholds` : noState ? `${money(w.fedIncomeTax + (w.seTax || 0))} federal` : `${money(w.fedIncomeTax + (w.seTax || 0))} federal and ${money(w.arTax)} ${ST}`}>
      {gigOn && <section className="tiles in-fold">
        <div className="tile"><div className="label">{G} so far in {t.year}</div><div className="value">{money(t.ytd)}</div><div className="sub">{t.deposits} payments labelled {G}</div></div>
        <div className="tile"><div className="label">{t.usingOverride ? 'Your estimate for the year' : 'Projected for the year'}</div><div className="value">{money(t.vipkidIncome)}</div><div className="sub">{t.usingOverride ? `pace so far suggests ${money(t.projected)}` : 'at your pace so far'}</div></div>
        <div className="tile"><div className="label">Tax owed on {G}</div><div className="value">{money(t.extra)}</div><div className="sub">{money(t.extraFederal)} federal{noState ? '' : ` · ${money(t.extraArkansas)} ${ST}`}</div></div>
        <div className="tile"><div className="label">Set aside</div><div className="value">{pct(t.setAsideRate)}</div><div className="sub">of each {G} payment</div></div>
      </section>}
        <section className="card">
          <div className="card-head"><h2>{compare ? `What ${G} adds to your taxes` : `Your ${t.year} tax estimate`}</h2></div>
          <table className={`table ${compare ? '' : 'plain-tax'}`}>
            <thead>{compare ? <tr><th>{t.year} estimate</th><th className="r">Jobs only</th><th className="r">With {G}</th><th className="r">Added</th></tr> : <tr><th>{t.year} estimate</th><th className="r">Amount</th></tr>}</thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}{r.note && <small>{r.note}</small>}</td>
                  {compare && <td className="r num sub">{money(r.a)}</td>}<td className="r num">{money(r.b)}</td>{compare && <td className="r num">{money(r.b - r.a)}</td>}
                </tr>
              ))}
              <tr className="total-row"><td>Total for the year</td>{compare && <td className="r num">{money(wo.total)}</td>}<td className="r num">{money(w.total)}</td>{compare && <td className="r num">{money(t.extra)}</td>}</tr>
            </tbody>
          </table>
          {t.status === 'separate' && t.jointTotal != null && <p className="sub">{t.jointTotal < w.total ? <>Filing separately costs about <b>{money(w.total - t.jointTotal)} more</b> than filing jointly would ({money(t.jointTotal)}). Several credits are lost on separate returns.</> : t.jointTotal > w.total ? <>Filing separately saves about {money(t.jointTotal - w.total)} against filing jointly ({money(t.jointTotal)}).</> : <>Filing jointly would come to the same.</>} Each spouse's federal tax is worked out alone and added; the children and the deductions are put on your return.</p>}
          <FederalParts t={t} />
          {t.gigs.length > 1 && <div>{t.gigs.map((x: any) => <div key={x.name} className="row"><span className="grow">{x.name}<small>{joint ? (x.who === 'spouse' ? "Spouse's" : 'Yours') + ' · ' : ''}{money(x.received)} received so far{x.costs ? ` · ${money(x.costs)} of expenses` : ''}</small></span><span className="num">{money(x.profit)} profit</span></div>)}</div>}
          {!gigOn && <p className="sub">This is what your paychecks' withholding should roughly cover over the year. Enter the withholding below to see whether you'll owe or get a refund.</p>}
          {gigOn && !compare && <p className="sub">Nobody takes tax out of this income, so all of it is yours to put aside: about <b>{money(w.total / 12)} a month</b>, or {pct(t.setAsideRate)} of each payment.</p>}
          {compare && <p className="sub">
            "Jobs only" is what your paychecks' withholding should roughly cover. The "Added" column is what nobody is withholding, so it's the amount to save:
            about <b>{money(t.extra / 12)} a month</b>.
          </p>}
        </section>
      </Fold>
      <Fold id="tax-household" title="Your household" note={`${({ joint: 'Married, filing jointly', single: 'Single', hoh: 'Head of household', separate: 'Married, filing separately' } as Record<string, string>)[s.filing_status] || 'How you file'} · salaries, children and work`}>
        <section className="card">
          <div className="card-head"><h2>Your household</h2></div>
          <p className="where-line"><WhereToFind first="Pay and tax withheld" /></p>
          <div className="add-grid">
            <StatePick value={s.tax_state} onPick={(v) => save('tax_state')(v)} />
            <label className="field"><span>How you file</span>
              <select value={s.filing_status} onChange={(e) => save('filing_status')(e.target.value)}>
                <option value="joint">Married, filing jointly</option>
                <option value="single">Single</option>
                <option value="hoh">Head of household</option>
                <option value="separate">Married, filing separately</option>
              </select>
            </label>
            <HouseholdNames joint={joint} />
            <NumField label="Your salary" value={s.your_salary} step={500} onSave={save('your_salary')} hint="Yearly, before tax" />
            {joint && <NumField label="Spouse's salary" value={s.spouse_salary} step={500} onSave={save('spouse_salary')} hint="Yearly, before tax" />}
            <NumField label="Your pre-tax deductions" value={s.pretax_you} step={100} onSave={save('pretax_you')} hint="401(k), health premiums, HSA per year" />
            {joint && <NumField label="Spouse's pre-tax deductions" value={s.pretax_spouse} step={100} onSave={save('pretax_spouse')} hint="Per year" />}
            <NumField label="Children under 17" value={s.kids} onSave={save('kids')} />
            <label className="field"><span>Anyone retired?</span>
              <select value={s.retired} onChange={(e) => save('retired')(e.target.value)}><option value="0">No</option><option value="1">Yes</option></select>
            </label>
            <NumField label="K-12 teachers in household" value={s.educators} onSave={save('educators')} hint={joint ? '0, 1 or 2. Turns on classroom expense claims' : '0 or 1. Turns on classroom expense claims'} />
            {gigOn && <NumField label={`${G} income for the year`} value={s.vipkid_override} allowBlank step={100} placeholder={`${Math.round(t.projected)} (projected)`} onSave={save('vipkid_override')} hint="Leave blank to project from your payments" />}
          </div>
        </section>
      </Fold>
      <Fold id="tax-stubs" title="Pay stubs" note={stubNote}>
        <section className="card"><PayStub joint={joint} onSaved={reload} /></section>
      </Fold>
      <Fold id="tax-more" title="More about your household" note="Other income, credits and costs. All optional">
        <TaxMore t={t} reload={reload} />
      </Fold>

      <h3 className="tax-group">Lowering it</h3>
      <Fold id="tax-hints" title="Purchases that might count" note={hintNote}>
      <TaxHints t={t} onChange={reload} />
      </Fold>
      <Fold id="tax-deductions" title="Deductions" note={`${money(Object.values(t.deductionTotals as Record<string, number>).reduce((x, y) => x + y, 0))} claimed or entered for ${t.year}`}>
      <Deductions t={t} reload={reload} />
      </Fold>
      {gigOn && <Fold id="tax-savings" title="Tax savings" note="What's put aside against the bill"><section className="card">
          <div className="card-head"><h2>Tax savings</h2></div>
          <div className="row">
            <span className="grow">Account you save tax money in</span>
            <select value={s.tax_account} aria-label="Tax savings account" onChange={(e) => save('tax_account')(e.target.value)}>
              <option value="">Not chosen</option>
              {t.taxSavings.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {t.taxSavings.account ? (() => {
            // Measured against the whole year's bill: what's owed at filing once withholding
            // is entered, and until then the tax the side gig is projected to add.
            const have = t.taxSavings.account.balance;
            const need = t.filing.known ? Math.max(0, t.filing.federal + t.filing.arkansas) : t.extra;
            const gap = need - have;
            return (
              <>
                <div className="row"><span className="grow">Saved in {t.taxSavings.account.name}<small>Balance at the last bank sync</small></span><span className="num">{cents(have)}</span></div>
                <div className="row"><span className="grow">{t.filing.known ? 'Tax owed at filing' : `Tax ${G} adds this year`}<small>{t.filing.known ? 'All tax for the year, less withholding and payments' : `Projected for the full year; ${money(t.taxSavings.owedSoFar)} of it is on income received so far`}</small></span><span className="num">{cents(need)}</span></div>
                <div className="row total"><span className="grow">{gap > 0 ? 'Still to save' : 'Ahead by'}</span><span className={`num ${gap > 0 ? 'bad' : 'good'}`}>{cents(Math.abs(gap))}</span></div>
                <div className="track tall" role="img" aria-label={`${money(have)} saved of ${money(need)}`}><div className="fill" style={{ width: `${need > 0 ? Math.min(100, Math.max(0, (have / need) * 100)) : 0}%` }} /></div>
                {!t.filing.known && <p className="sub">This will tighten once the withholding from {joint ? 'both of your paychecks' : 'your paychecks'} is entered below; it then compares your savings with everything owed at filing.</p>}
                {t.taxSavings.lastDeposit && <p className="sub">Your last {G} payment was {cents(t.taxSavings.lastDeposit.amount)} on {t.taxSavings.lastDeposit.date}. Moving {pct(t.setAsideRate)} of it means {cents(t.taxSavings.lastDeposit.setAside)}.</p>}
              </>
            );
          })() : <p className="sub">Choose the account and this card will compare what's in it with the tax your {G} income has built up.</p>}
        </section></Fold>}

      <h3 className="tax-group">At tax time</h3>
      <Fold id="tax-paying" title="Paying it" note={t.extra >= 1000 ? `About ${money(t.extraFederal / 4)} a quarter, federal` : 'Quarterly payments not required'}>
        <section className="card">
          <div className="card-head"><h2>Paying it</h2></div>
          <p className="sub">
            {t.extra >= 1000
              ? `You'd owe more than $1,000 at filing, so the IRS expects payments during the year. Four equal payments would be about ${money(t.extraFederal / 4)} federal${t.extraArkansas >= 1000 ? ` and ${money(t.extraArkansas / 4)} to ${ST}` : ''}.`
              : "At this level you'd owe under $1,000 at filing, so quarterly payments aren't required."}
          </p>
          <PayLinks year={t.year} state={t.state} />
          {QUARTERS.map((q) => (
            <div key={q.due} className="row"><span className="grow">{q.label}<small>Due {q.due}</small></span><span className="num">{money(t.extraFederal / 4)}</span></div>
          ))}
          {t.filing.known && t.quarterly.next && t.quarterly.needed && <p className="sub"><b>From here:</b> about {money(t.quarterly.federalLeft)} federal is still unpaid for {t.year} after withholding and payments made. Spread over the {t.quarterly.dates.length === 1 ? 'one date' : `${t.quarterly.dates.length} dates`} left, that is <b>{money(t.quarterly.dates[0].federal)} by {t.quarterly.next.label}</b>{t.quarterly.arkansasNeeded ? ` and ${money(t.quarterly.dates[0].arkansas)} to ${ST}` : ''}. Paying {money(t.quarterly.toAvoidPenalty)} in all is enough to avoid the IRS penalty (based on {t.quarterly.basis === 'last year' ? "last year's tax" : "90% of this year's"}).</p>}
          <p className="sub">
            {isAR && t.extraArkansas < 1000 ? `Arkansas only requires estimated payments when you'd owe $1,000 or more; your added ${money(t.extraArkansas)} can be paid at filing. ` : ''}
            Another route is raising the withholding on one of your paychecks by about {money(t.extra / 26)} per biweekly check, which covers it without quarterly payments.
          </p>
        </section>
      </Fold>
      <Fold id="tax-pack" title="Tax pack" note={pack?.receipts?.all ? `A PDF for your tax preparer · ${pack.receipts.kept} of ${pack.receipts.all} receipts kept` : 'A PDF for your tax preparer'}>
      <TaxPack year={t.year} />
      </Fold>
      <Fold id="tax-bracket" title="Your federal bracket" note={`${pct(w.fedRate)} on your top dollars`}>
        <section className="card">
          <div className="card-head"><h2>Your federal bracket</h2></div>
          <div className="hero small">{pct(w.fedRate)}</div>
          <p className="sub">
            Taxable income of {money(w.taxable)} after {w.itemizing ? `${money(w.fedDeduction)} of itemized deductions` : `the ${money(w.fedDeduction)} standard deduction`}
            {w.qbi > 0 ? ` and a ${money(w.qbi)} business income deduction` : ''}.
          </p>
          <div className="track tall" role="img" aria-label={`Taxable income is ${Math.round(fill)}% of the way through the ${pct(w.fedRate)} bracket`}>
            <div className="fill" style={{ width: `${fill}%` }} />
          </div>
          <div className="scale"><span>{money(w.bracketFloor)}</span><span>{w.bracketTop ? money(w.bracketTop) : ''}</span></div>
          {t.roomInBracket != null && nextRate && (
            <p className="sub">
              You have <b>{money(t.roomInBracket)}</b> of room before the {pct(nextRate)} bracket. Only income above that line is taxed at {pct(nextRate)}; crossing it doesn't raise the tax on everything below.
            </p>
          )}
          <p className="sub">
            {isAR
              ? <>Arkansas: {money(w.arTax)}, figured {joint ? 'with each of you filing' : 'filing'} {w.arMethod}{w.arTopRate ? `. Your income above $26,400${joint ? ' each' : ''} is taxed at the top ${pct(w.arTopRate, 1)} rate` : ''}.</>
              : noState ? <>{ST} has no income tax on wages, so nothing is added for the state.</>
                : <>{ST}: {money(w.arTax)}, figured {w.arMethod} on {money(w.arNetYou)} of income after its deductions{w.arTopRate ? `, the last dollars at ${pct(w.arTopRate, 2)}` : ''}. This is a simpler estimate than the federal one: see the note at the foot of the page.</>}
          </p>
        </section>
      </Fold>

      <p className="fine">
        An estimate for tax year {t.year}, not tax advice. It counts what you've entered on this page and nothing else. {isAR ? "For Arkansas it leaves out the low-income tables, the child care credit and the small credit for incomes under about $27,600, so a low Arkansas figure may really be lower still. Federal figures are from IRS Rev. Proc. 2025-32; Arkansas figures are from the state's 2026 estimated tax worksheet (top rate 3.7%)." : noState ? `Federal figures are from IRS Rev. Proc. 2025-32. ${ST} has no income tax on wages; any city or county tax where you live is not counted.` : `Federal figures are from IRS Rev. Proc. 2025-32. The ${ST} figure is a simpler estimate: its rates, standard deduction and personal exemptions from the Tax Foundation's table of state taxes as of January 1, 2026, applied to your federal income. It leaves out city, county and school district income taxes, ${ST}'s own credits and subtractions, how it treats pensions and retirement withdrawals (counted in full; Social Security is not counted), deductions that shrink as income rises, and a head of household's own brackets. Treat it as a rough figure.`} Check with a tax preparer before relying on it.
      </p>
    </div>
  );
}
