import { jump } from '../go';
import { at } from '../base';
import { useState } from 'react';
import { api, cents, money, useData } from '../lib';
import { Modal, NumField, pickReceipt, shrinkPicture } from '../ui';

// "More about your household" on the Taxes page (added 2026-11-18): everything the tax estimate can
// take into account beyond the main salaries. All of it is optional and kept in one setting,
// `tax_more` (GET and PUT /api/tax/more); the sections stay folded until opened, each showing a
// one-line summary of what has been filled in.

type Field = [key: string, label: string, hint?: string];
const INCOME = (two: boolean): [title: string, fields: Field[]][] => [
  ['Retirement', [
    ['ss_you', two ? 'Your Social Security' : 'Social Security', 'For the year, before Medicare premiums come out'],
    ...(two ? [['ss_spouse', "Spouse's Social Security"] as Field] : []),
    ['pension_you', two ? 'Your pension' : 'Pension', 'From an employer or teacher retirement plan, for the year'],
    ...(two ? [['pension_spouse', "Spouse's pension"] as Field] : []),
    ['ira_you', two ? 'Your IRA or 401(k) withdrawals' : 'IRA or 401(k) withdrawals', 'Traditional accounts only; Roth withdrawals are usually not taxed'],
    ...(two ? [['ira_spouse', "Spouse's IRA or 401(k) withdrawals"] as Field] : []),
  ]],
  ['Other income', [
    ['unemployment_you', two ? 'Your unemployment pay' : 'Unemployment pay', 'For the year. It is taxed federally, and by most states with an income tax'],
    ...(two ? [['unemployment_spouse', "Spouse's unemployment pay"] as Field] : []),
    ['interest', 'Bank interest', 'Savings accounts and CDs, for the year'],
    ['dividends', 'Dividends', 'From investments outside a retirement account'],
    ['gains', 'Profit from selling investments', 'Held over a year, outside a retirement account'],
    ['rental', 'Rental profit', 'Rent received less the costs of the property'],
    ['other', 'Any other taxable income', 'Prizes, jury pay, alimony from a divorce before 2019'],
    ['support', 'Child support received', 'Not taxed. Listed here only so you know it was left out on purpose'],
  ]],
];
const COSTS: Field[] = [
  ['student_loan', 'Student loan interest paid', 'For the year; up to $2,500 comes off income'],
  ['care', 'Child care you pay to be able to work', 'Daycare, after-school care or day camp for children under 13'],
  ['college_students', 'Students in their first four years of college', 'How many you pay tuition for'],
  ['college', 'Tuition and fees you pay', 'For those students, for the year, after scholarships'],
  ['mortgage', 'Mortgage interest', 'From the lender\'s year-end statement'],
  ['property_tax', 'Property taxes', 'Home, land and vehicles'],
  ['giving', 'Giving to church and charity', 'Money given during the year'],
  ['medical', 'Medical and dental bills you paid', 'Only the part above 7.5% of your income counts'],
];
const MARKET: Field[] = [
  ['benchmark_month', 'Benchmark plan, per month', 'The "second lowest cost silver plan" on your Marketplace letter or Form 1095-A'],
  ['advance_month', 'Help applied to your premium, per month', 'The advance credit the Marketplace pays your insurer'],
  ['months', 'Months covered this year', '12 unless you joined or left part-way'],
  ['people', 'People on your tax return', 'You, a spouse and dependents'],
];

function Part({ title, summary, go, children }: { title: string; summary: string; go?: string; children: React.ReactNode }) {
  return (
    <details className="tax-part" data-go={go}>
      <summary><span>{title}</span><small>{summary}</small></summary>
      <div className="tax-part-body">{children}</div>
    </details>
  );
}

export function TaxMore({ t, reload }: { t: any; reload: () => void }) {
  const m = t.more;
  const two = t.status === 'joint' || t.status === 'separate';
  const [err, setErr] = useState('');
  const put = async (body: object) => {
    try { await api('/api/tax/more', { method: 'PUT', body }); setErr(''); reload(); } catch (e: any) { setErr(e.message); throw e; }
  };
  const group = (name: 'income' | 'costs' | 'market') => (key: string) => (v: string) => put({ [name]: { ...m[name], [key]: v === '' ? 0 : Number(v) } });
  const shown = (n: number) => (n ? String(n) : '');
  const filled = (name: 'income' | 'costs' | 'market', fields: Field[]) => fields.filter(([k]) => m[name][k] > 0).length;
  const year = new Date().getFullYear();
  const age = (born: number | '') => (born === '' ? null : t.year - born);

  // Dependents and other jobs are short lists edited in place.
  const [dep, setDep] = useState({ born: '', kind: 'child', student: false });
  const [job, setJob] = useState({ who: 'you', name: '', wages: '', pretax: '' });
  const addDep = async () => {
    const born = Number(dep.born);
    if (!(born >= 1900 && born <= year)) return setErr('Enter the year they were born, like 2014.');
    await put({ dependents: [...m.dependents, { born, kind: dep.kind, student: dep.student }] });
    setDep({ born: '', kind: 'child', student: false });
  };
  const addJob = async () => {
    if (!(Number(job.wages) > 0)) return setErr('Enter what that job pays this year.');
    await put({ jobs: [...m.jobs, { who: job.who, name: job.name, wages: Number(job.wages), pretax: Number(job.pretax) || 0 }] });
    setJob({ who: 'you', name: '', wages: '', pretax: '' });
  };
  const d = t.dependents;
  const income = INCOME(two), incomeFields = income.flatMap(([, f]) => f);
  const w = t.with;

  return (
    <section className="card">
      <div className="card-head"><h2>More about your household</h2><span className="sub">All optional</span></div>
      <p className="where-line"><WhereToFind first="Costs that lower your tax" /></p>
      <p className="sub first">Open only what applies to you. Each of these changes the estimate, and anything left blank is simply not counted.</p>
      {err && <p className="error" role="alert">{err}</p>}

      <Part title="Ages" summary={m.born_you === '' ? 'Not entered' : `You: ${age(m.born_you)}${two && m.born_spouse !== '' ? `, spouse: ${age(m.born_spouse)}` : ''}`}>
        <p className="sub">From 65 the standard deduction is larger and there is an extra $6,000 deduction each. Age also decides who can get the earned income credit without children.</p>
        <div className="add-grid">
          <NumField label="Year you were born" value={m.born_you} allowBlank placeholder="1975" onSave={(v) => put({ born_you: v })} />
          {two && <NumField label="Year your spouse was born" value={m.born_spouse} allowBlank placeholder="1975" onSave={(v) => put({ born_spouse: v })} />}
        </div>
      </Part>

      <Part title="Children and other dependents" summary={m.dependents.length ? `${m.dependents.length} listed` : Number(t.settings.kids) > 0 ? `${t.settings.kids} under 17 (ages not entered)` : 'None'}>
        <p className="sub">The credit depends on age: $2,200 for a child under 17, $500 for an older child or another dependent such as a parent you support. Children under 13 count for the child care credit, and children under 19 (under 24 if a student) for the earned income credit. Once anyone is listed here, this list is used in place of "Children under 17" above.</p>
        {m.dependents.map((x: any, i: number) => (
          <div key={i} className="row">
            <span className="grow">{x.kind === 'child' ? 'Child' : 'Other dependent'}, born {x.born}<small>Age {age(x.born)} at the end of {t.year}{x.student ? ' · full-time student' : ''}</small></span>
            <button className="link" onClick={() => put({ dependents: m.dependents.filter((_: any, j: number) => j !== i) })}>Remove</button>
          </div>
        ))}
        <div className="add-grid">
          <label className="field"><span>Year born</span><input type="number" inputMode="numeric" value={dep.born} placeholder="2014" onChange={(e) => { setDep({ ...dep, born: e.target.value }); setErr(''); }} /></label>
          <label className="field"><span>Who</span><select value={dep.kind} onChange={(e) => setDep({ ...dep, kind: e.target.value })}><option value="child">Your child</option><option value="other">Another dependent</option></select></label>
          <label className="field"><span>Full-time student?</span><select value={dep.student ? '1' : '0'} onChange={(e) => setDep({ ...dep, student: e.target.value === '1' })}><option value="0">No</option><option value="1">Yes</option></select></label>
          <div className="field"><span>&nbsp;</span><button onClick={addDep}>Add</button></div>
        </div>
        {d && <small className="sub">Counted as: {d.under17} under 17, {d.other} other, {d.eitc} for the earned income credit, {d.under13} under 13.</small>}
      </Part>

      <Part title="Other jobs this year" summary={m.jobs.length ? `${m.jobs.length} more, ${money(m.jobs.reduce((a: number, j: any) => a + j.wages, 0))}` : 'None'}>
        <p className="sub">If someone changed jobs or has a second one, the salary boxes above should hold what the main job pays <b>in this calendar year</b>, and each other job goes here with what it paid or will pay this year. A pay stub's year-to-date figure is the easy source.</p>
        {m.jobs.map((x: any, i: number) => (
          <div key={i} className="row">
            <span className="grow">{x.name || 'Another job'}<small>{two ? (x.who === 'spouse' ? "Spouse's" : 'Yours') + ' · ' : ''}{money(x.wages)} this year{x.pretax ? ` · ${money(x.pretax)} pre-tax` : ''}</small></span>
            <button className="link" onClick={() => put({ jobs: m.jobs.filter((_: any, j: number) => j !== i) })}>Remove</button>
          </div>
        ))}
        <div className="add-grid">
          {two && <label className="field"><span>Whose</span><select value={job.who} onChange={(e) => setJob({ ...job, who: e.target.value })}><option value="you">Yours</option><option value="spouse">Spouse's</option></select></label>}
          <label className="field"><span>Employer</span><input type="text" maxLength={40} value={job.name} placeholder="Where" onChange={(e) => setJob({ ...job, name: e.target.value })} /></label>
          <label className="field"><span>Pay this year, before tax</span><input type="number" min="0" inputMode="decimal" value={job.wages} onChange={(e) => { setJob({ ...job, wages: e.target.value }); setErr(''); }} /></label>
          <label className="field"><span>Pre-tax deductions</span><input type="number" min="0" inputMode="decimal" value={job.pretax} onChange={(e) => setJob({ ...job, pretax: e.target.value })} /></label>
          <div className="field"><span>&nbsp;</span><button onClick={addJob}>Add</button></div>
        </div>
      </Part>

      <Part title="Retirement and other income" go="other-income" summary={filled('income', incomeFields) ? `${filled('income', incomeFields)} filled in` : 'None'}>
        {income.map(([title, fields]) => (
          <div key={title}>
            <div className="group-head"><span>{title}</span></div>
            <div className="add-grid">
              {fields.map(([k, label, hint]) => <NumField key={k} label={label} value={shown(m.income[k])} allowBlank step={100} hint={hint} onSave={group('income')(k)} />)}
            </div>
          </div>
        ))}
        {w.ssTaxed > 0 && <small className="sub">{money(w.ssTaxed)} of the Social Security counts as taxable income federally. Ledger doesn't count it for your state: Arkansas and most others don't tax it, though a few do.</small>}
      </Part>

      <Part title="Costs that lower your tax" summary={filled('costs', COSTS) ? `${filled('costs', COSTS)} filled in` : 'None'}>
        <p className="sub">Mortgage interest, property taxes, giving and medical bills only help once together they beat the standard deduction; Ledger works that out and uses whichever is larger{w.itemizing ? ' (right now: itemizing)' : ' (right now: the standard deduction)'}.</p>
        <div className="add-grid">
          {COSTS.map(([k, label, hint]) => <NumField key={k} label={label} value={shown(m.costs[k])} allowBlank step={k === 'college_students' ? 1 : 100} hint={hint} onSave={group('costs')(k)} />)}
        </div>
      </Part>

      <Part title="Marketplace health insurance" summary={m.market.benchmark_month > 0 ? 'Entered' : 'Not used'}>
        <p className="sub">Only for insurance bought through HealthCare.gov. The help with premiums is settled on the tax return: earn more than expected and some is paid back, earn less and you get more. For {t.year} there is no help at all above four times the poverty line.</p>
        <div className="add-grid">
          {MARKET.map(([k, label, hint]) => <NumField key={k} label={label} value={shown(m.market[k])} allowBlank step={k === 'months' || k === 'people' ? 1 : 10} hint={hint} onSave={group('market')(k)} />)}
        </div>
        {m.market.benchmark_month > 0 && <small className="sub">{w.credits.market >= 0 ? `About ${money(w.credits.market)} more credit at filing.` : `About ${money(-w.credits.market)} of the help would be paid back at filing.`}</small>}
      </Part>

      <Part title="Last year's tax" summary={m.last_year_tax === '' ? 'Not entered' : money(m.last_year_tax)}>
        <p className="sub">The "total tax" line on last year's federal return (Form 1040 line 24, or line 2 of the Form 8879 you signed to e-file). It is the whole year's tax, not what you paid when you filed. Paying at least that much during this year, through withholding and quarterly payments, avoids the IRS's underpayment penalty even if this year turns out higher.</p>
        <div className="add-grid">
          <NumField label="Total federal tax last year" value={m.last_year_tax} allowBlank step={100} onSave={(v) => put({ last_year_tax: v })} />
        </div>
      </Part>
    </section>
  );
}

/** The tax pack: one PDF of everything a preparer would ask Ledger for, to download or email. */
export function TaxPack({ year }: { year: number }) {
  const { data: p, reload } = useData('/api/tax/pack');
  const [showMissing, setShowMissing] = useState(false);
  const [draft, setDraft] = useState('');
  const addNote = async () => {
    setErr('');
    try { await api('/api/tax/pack/notes', { method: 'POST', body: { text: draft } }); setDraft(''); reload(); } catch (x: any) { setErr(x.message); }
  };
  const dropNote = (id: string) => async () => { await api(`/api/tax/pack/notes/${id}`, { method: 'DELETE' }); reload(); };
  // Documents for the preparer: off until the household switches it on, because of what such papers carry.
  const [docName, setDocName] = useState('');
  const [docBusy, setDocBusy] = useState(false);
  const docsSwitch = (on: boolean) => async () => {
    if (!on && !window.confirm('Stop keeping tax documents in Ledger? Every document stored here is removed. (They stay in the backups for about a month.)')) return;
    setErr('');
    try { await api('/api/tax/docs/on', { method: 'PUT', body: { on } }); reload(); } catch (x: any) { setErr(x.message); }
  };
  const addDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setDocBusy(true);
    try {
      const pdf = file.type === 'application/pdf';
      const data = pdf ? await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error("That file couldn't be opened.")); r.readAsDataURL(file); })
        : await shrinkPicture(file).catch(() => { throw new Error("That picture couldn't be opened. Try a screenshot of it, or a PDF."); });
      await api('/api/tax/docs', { method: 'POST', body: { name: docName.trim() || file.name.replace(/\.[a-z0-9]+$/i, ''), file: data } });
      setDocName(''); reload();
    } catch (x: any) { setErr(x.message || "That file couldn't be added."); }
    setDocBusy(false);
  };
  const dropDoc = (id: number) => async () => { if (!window.confirm('Remove this document from Ledger?')) return; await api(`/api/tax/docs/${id}`, { method: 'DELETE' }); reload(); };
  const hasDocs = !!p?.docs?.on && p.docs.list.length > 0;
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  if (!p) return null;
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(''); setNote('');
    try { const r = await api('/api/tax/pack/email', { method: 'POST', body: { to: to || p.to } }); setNote(`Sent to ${r.to.join(', ')}.`); } catch (x: any) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <section className="card">
      <div className="card-head"><h2>Tax pack for {year}</h2></div>
      <p className="sub first">Everything on this page in one PDF for whoever prepares your return: household, wages, side income, each purchase you claimed, other deductions, tax already paid and Ledger's estimate. A spreadsheet of the claimed purchases comes with the emailed copy. It is a summary to work from, not a tax return.</p>
      <div className="add-actions">
        <a className="button-link" href={at('/api/tax/pack.pdf')} download>Download the PDF</a>
        {(p.receipts?.kept > 0 || hasDocs) && <a className="button-link" href={at('/api/tax/pack.pdf?receipts=1')} download>Download it with the {p.receipts?.kept > 0 && hasDocs ? 'receipts and documents' : hasDocs ? 'documents' : 'receipts'}</a>}
      </div>
      <div className="pack-notes">
        <div className="group-head"><span>Questions and notes for your tax preparer</span><span className="num">{(p.notes?.length || 0) + (p.questions || 0) || ''}</span></div>
        <small>Anything you want to remember to ask or tell them. Each one is printed near the front of the PDF until you remove it.{p.questions > 0 ? ` The ${p.questions === 1 ? 'purchase' : `${p.questions} purchases`} you set aside with "Ask your tax preparer" ${p.questions === 1 ? 'is' : 'are'} printed with them.` : ''}</small>
        {(p.notes || []).map((n: any) => (
          <div className="hint-row" key={n.id}><div className="grow pack-note">{n.text}</div><span className="hint-acts"><button type="button" className="link" onClick={dropNote(n.id)}>Remove</button></span></div>
        ))}
        <label className="field"><span>Add a question or note</span>
          <textarea rows={3} maxLength={1200} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="We bought a car in December. Does the interest on its loan count for anything?" /></label>
        <div className="add-actions"><button type="button" disabled={!draft.trim()} onClick={addNote}>Add to the tax pack</button></div>
      </div>
      <div className="pack-notes pack-docs">
        <div className="group-head"><span>Documents for your tax preparer</span><span className="num">{p.docs?.on ? p.docs.list.length || '' : 'Off'}</span></div>
        {!p.docs?.on ? (
          <>
            <small>Ledger can keep your tax forms and year-end statements (a W-2, a Form 1098, a lender's statement) and print them with the tax pack, so everything is in one hand-over. <b>These papers carry Social Security and account numbers.</b> Switched on, they are stored in your Ledger's own database and its backups, on the server your Ledger runs on. They are never sent to Claude or anyone else and never emailed. It stays off unless you turn it on, and turning it off again removes them.</small>
            <div className="add-actions"><button type="button" onClick={docsSwitch(true)}>Keep tax documents in Ledger</button></div>
          </>
        ) : (
          <>
            <small>Photos and screenshots are printed on a page each; a PDF is added page for page at the end. They are included only in "Download it with the documents", never in the emailed pack. Stored in your Ledger's own database and backups; never sent to Claude or anyone else.</small>
            {p.docs.list.map((d: any) => (
              <div className="hint-row" key={d.id}>
                <div className="grow"><b>{d.name}</b> <span className="when">{d.type === 'application/pdf' ? 'PDF' : 'Picture'} · {d.size > 1e6 ? `${(d.size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(d.size / 1000))} KB`}</span></div>
                <span className="hint-acts"><a className="link" href={at(`/api/tax/docs/${d.id}`)} target="_blank" rel="noreferrer">Open</a><button type="button" className="link" onClick={dropDoc(d.id)}>Remove</button></span>
              </div>
            ))}
            <div className="add-grid">
              <label className="field"><span>What is it? (optional)</span><input type="text" maxLength={80} value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Car loan year-end statement" /></label>
            </div>
            <div className="add-actions">
              <label className={`button primary ${docBusy ? 'busy' : ''}`}>{docBusy ? 'Adding…' : 'Add a document'}<input type="file" accept="application/pdf,image/*" disabled={docBusy} onChange={addDoc} hidden /></label>
              <button type="button" className="link" onClick={docsSwitch(false)}>Stop keeping documents here</button>
            </div>
          </>
        )}
      </div>
      {p.receipts?.all > 0 && (
        <div className="pack-receipts">
          <p className="sub"><b>{p.receipts.kept} of {p.receipts.all} claimed purchases have a receipt kept.</b> Your preparer works from the totals; the receipts are yours to keep in case the tax office ever asks. The version with receipts prints each one on a page of its own and is too large to email.
            {p.receipts.missing.length > 0 && <> <button type="button" className="link" onClick={() => setShowMissing(!showMissing)}>{showMissing ? 'Hide' : 'Show'} the {p.receipts.all - p.receipts.kept} without one</button></>}</p>
          {showMissing && p.receipts.missing.map((r: any) => (
            <div className="hint-row" key={r.id}>
              <div className="grow"><b>{r.merchant}</b> <span className="when">{r.date} · {r.as}</span></div>
              <span className="num">{cents(r.amount)}</span>
              <span className="hint-acts"><button type="button" onClick={() => pickReceipt(r.id, (error) => { if (error) setErr(error); else reload(); })}>Add a receipt</button></span>
            </div>
          ))}
        </div>
      )}
      {p.canSend ? (
        <form className="token-form" style={{ marginTop: 12 }} onSubmit={send} noValidate>
          <label className="field grow"><span>Email it to</span><input type="text" inputMode="email" autoCapitalize="none" value={to} placeholder={p.to || 'you@example.com'} onChange={(e) => { setTo(e.target.value); setErr(''); }} /></label>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
        </form>
      ) : <p className="sub">To email it, set up the <a href="#connections" onClick={jump({ page: 'connections', fold: 'email' })}>summary email in Settings</a> first.</p>}
      <small className="sub">Leave the box empty to send it to yourself, or type your preparer's address. In January, once the year has ended, Ledger emails you a copy by itself if the summary email is switched on.</small>
      {note && <p className="good" role="status">{note}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

/** What went into the federal figure: the tax before credits, then each credit, when there is anything to show. */
export function FederalParts({ t }: { t: any }) {
  const w = t.with, c = w.credits;
  const rows: [string, number, string?][] = [
    ['Federal income tax before credits', w.taxBefore],
    ['Children and other dependents', -c.family, 'Child tax credit and the credit for other dependents'],
    ['Earned income credit', -c.eitc, 'Paid even when no tax is owed'],
    ['Child care credit', -c.care],
    ['College credit', -c.college],
    [c.market >= 0 ? 'Marketplace insurance credit' : 'Marketplace help to pay back', -c.market],
  ];
  const used = rows.filter(([, n], i) => i === 0 || Math.abs(n) >= 1);
  if (used.length < 2 && !(w.senior > 0)) return null;
  return (
    <details className="tax-part plain">
      <summary><span>How the federal figure adds up</span><small>{used.length - 1} credit{used.length === 2 ? '' : 's'}</small></summary>
      <div className="tax-part-body">
        {w.senior > 0 && <p className="sub">Includes the extra {money(w.senior)} deduction for age 65 and over.</p>}
        {used.map(([name, n, note]) => <div key={name} className="row"><span className="grow">{name}{note && <small>{note}</small>}</span><span className={`num ${n < 0 ? 'good' : ''}`}>{n < 0 ? '−' : ''}{money(Math.abs(n))}</span></div>)}
        <div className="row total"><span className="grow">Federal income tax{w.fedIncomeTax < 0 ? ' (a refund)' : ''}</span><span className={`num ${w.fedIncomeTax < 0 ? 'good' : ''}`}>{w.fedIncomeTax < 0 ? '−' : ''}{money(Math.abs(w.fedIncomeTax))}</span></div>
      </div>
    </details>
  );
}

// Where each figure on the Taxes page can be read from: the paper or form that carries it and the line or
// box to look at. The owner, 2026-11-23, after hunting for last year's total tax: "we should probably include in
// the app where we can find these sources for the figures to enter". Box and line numbers are from the
// current federal forms; if a form is renumbered, change it here. Keep it to where to look, never what to claim.
const SOURCES: [group: string, rows: [figure: string, where: string][]][] = [
  ['Pay and tax withheld', [
    ['Salary (yearly, before tax)', 'Your pay stub: gross pay, year to date. Adding a stub under "Pay stubs" fills this in for you.'],
    ['Pre-tax deductions', 'Your pay stub: retirement, health, dental and vision premiums, and HSA or FSA taken out before tax, year to date.'],
    ['Federal tax withheld', 'During the year: "Federal income tax" year to date on each pay stub. After the year ends: box 2 of each W-2.'],
    ['State tax withheld', 'During the year: "State income tax" year to date on each pay stub. After the year ends: box 17 of each W-2.'],
    ['Estimated payments made', 'Your own record of each quarterly payment, or your account at irs.gov (federal) and the state revenue department site (atap.arkansas.gov in Arkansas).'],
  ]],
  ["Last year's return", [
    ["Total federal tax last year", 'Form 1040, the line "total tax" (line 24). The e-file signature form your preparer gave you, Form 8879, shows the same figure on line 2. It is the whole tax for the year, not the amount you paid when you filed, and it leaves out any penalty or interest.'],
  ]],
  ['Costs that lower your tax', [
    ['Student loan interest', 'Form 1098-E from the loan servicer, box 1. It arrives in January, or is on their website.'],
    ['Mortgage interest', "Form 1098 from the lender, box 1. It arrives in January."],
    ['Property taxes', "Your county's tax receipts for the home, land and vehicles. If the mortgage pays the home's tax for you, it is on Form 1098 (often box 10) or the lender's year-end escrow statement."],
    ['Child care', "A year-end statement from each provider showing what you paid. Your tax preparer will also want the provider's name, address and tax ID."],
    ['College tuition and fees', 'Form 1098-T from the college, box 1, less scholarships in box 5.'],
    ['Giving', 'The acknowledgement letter or year-end giving statement from each church or charity, or your bank record for a small gift.'],
    ['Medical and dental bills', "The bills and insurance statements for what you paid yourselves. Leave out anything paid from a health savings account."],
  ]],
  ['Other income', [
    ['Social Security', 'Form SSA-1099, box 5, mailed each January.'],
    ['Pension, or IRA and 401(k) withdrawals', 'Form 1099-R from each payer: box 1 is what was paid out, box 2a the taxable part.'],
    ['Unemployment', 'Form 1099-G, box 1.'],
    ['Interest', 'Form 1099-INT from each bank, box 1.'],
    ['Dividends', 'Form 1099-DIV, box 1a.'],
    ['Gains from selling investments', "Form 1099-B from the broker, or its year-end summary of realized gains."],
  ]],
  ['Marketplace health insurance', [
    ['Benchmark plan and help applied', 'Form 1095-A from the Marketplace, Part III: column B is the benchmark plan and column C the help paid to your insurer, by month.'],
  ]],
];

/**
 * "Where do I find these?": a link that opens the list above in a pop-up. Put it beside any group of boxes
 * whose figures come off a form; `open` names the group to show first.
 */
export function WhereToFind({ first }: { first?: string }) {
  const [show, setShow] = useState(false);
  const groups = first ? [...SOURCES.filter(([g]) => g === first), ...SOURCES.filter(([g]) => g !== first)] : SOURCES;
  return (
    <>
      <button type="button" className="link where-find" onClick={() => setShow(true)}>Where do I find these figures?</button>
      {show && (
        <Modal title="Where to find each figure" onClose={() => setShow(false)}>
          <p className="sub first">The paper or form each figure comes from, and the line or box to read. Forms for a year arrive in January and February of the next; during the year, your pay stubs and your own records are the source.</p>
          {groups.map(([group, rows]) => (
            <div className="sources" key={group}>
              <h3>{group}</h3>
              {rows.map(([figure, where]) => <div className="source-row" key={figure}><b>{figure}</b><span>{where}</span></div>)}
            </div>
          ))}
          <p className="sub">Ledger only tells you where to look. Whether something counts for you is a question for your tax preparer.</p>
        </Modal>
      )}
    </>
  );
}
