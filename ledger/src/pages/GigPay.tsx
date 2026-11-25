// How each side gig's coming pay is worked out (server/gigpay.js), shown inside Settings, "Side gig": the
// average of its deposits, a rough figure typed in, booked sessions from a calendar at a rate you set, or
// jobs typed in one by one. One block per gig; each keeps its own settings.
import { GO, goTo } from '../go';
import { useState } from 'react';
import { api, cents, dayLong, dayShort, forgetLoaded, money, useData } from '../lib';
import { Fold, MoneyInput } from '../ui';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ago = (ms: number) => { const m = Math.round((Date.now() - ms) / 60000); return m < 2 ? 'just now' : m < 90 ? `${m} minutes ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
const MODE_NAMES: Record<string, string> = { '': 'It varies', rough: 'About the same each time', sessions: 'By booked sessions', jobs: 'By the job' };

/** Every gig's block. Draws nothing until a side gig is switched on. */
export function GigPay() {
  const { data: loaded, reload } = useData<any>('/api/gig/pay');
  const [fresh, setFresh] = useState<any>(null);
  const data = fresh ?? loaded;
  if (!data?.on) return null;
  const took = (d: any) => { setFresh(d); forgetLoaded(); reload(); dispatchEvent(new Event('ledger-refresh')); };
  const list = data.gigs.filter((g: any) => !g.vipkid);
  if (!list.length) return null;
  return (
    <div className="gig-pay">
      <h3>How your side work pays</h3>
      <p className="sub">This decides what the dashboard's forecast expects. Whichever you choose, money that arrives is still filed by the words in its deposits.</p>
      {list.map((g: any) => (
        <Fold key={g.id} plain id={`gigpay-${g.id}`} title={g.name} startOpen={list.length === 1} note={`${MODE_NAMES[g.mode]}${g.owed.count ? ` · ${money(g.owed.total)} owed to you` : g.mode && g.comingTotal ? ` · ${money(g.comingTotal)} expected in the next two months` : ''}`}>
          <OneGig g={g} ha={data.haCalendars} took={took} />
        </Fold>
      ))}
    </div>
  );
}

function OneGig({ g, ha, took }: { g: any; ha: { id: string; name: string }[]; took: (d: any) => void }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [rate, setRate] = useState<string | null>(null);
  const [rough, setRough] = useState<string | null>(null);
  const [cal, setCal] = useState('');
  const [byLink, setByLink] = useState(false);
  const [match, setMatch] = useState<string | null>(null);
  const [job, setJob] = useState({ name: '', amount: '', date: today() });
  const [moving, setMoving] = useState<number | null>(null);
  const send = async (url: string, init: { method: string; body?: object }, label = 'saving') => {
    setBusy(label); setErr('');
    try { took(await api(url, init)); return true; } catch (e: any) { setErr(e.message); return false; } finally { setBusy(''); }
  };
  const put = (body: object, label?: string) => send('/api/gig/pay', { method: 'PUT', body: { gig: g.id, ...body } }, label);
  const [paidKind, paidOn] = g.paid === 'same' ? ['same', ''] : g.paid.split(':');
  const waiting = g.jobs.filter((j: any) => !j.done && !j.off && j.date >= today());
  const owed = g.jobs.filter((j: any) => !j.done && !j.off && j.date < today());
  const got = g.jobs.filter((j: any) => j.done);
  const dayNote = g.roughEvery === 'month' ? 'Day of the month it usually arrives' : 'Day it usually arrives';

  // The rough figure: its own way of being paid, and the stand-in for weeks with nothing booked or typed.
  const roughFields = (
    <div className="add-grid">
      <label className="field"><span>About</span>
        <MoneyInput value={rough ?? (g.rough === '' ? '' : String(g.rough))} placeholder="600" label="A rough amount" onChange={(v) => { setRough(v); setErr(''); }} />
        <small>{rough != null && rough !== String(g.rough) ? <button type="button" className="link" onClick={async () => { if (await put({ rough })) setRough(null); }}>Save</button> : g.mode === 'rough' ? 'What it usually brings in' : g.estimate && !g.estimate.typed ? `Empty: Ledger uses ${money(g.estimate.amount)} a week, the average of recent deposits.` : 'Optional. Leave empty to use the average of recent deposits.'}</small></label>
      <label className="field"><span>Every</span><select value={g.roughEvery} onChange={(e) => put({ roughEvery: e.target.value })}><option value="week">Week</option><option value="month">Month</option></select></label>
      <label className="field"><span>{dayNote}</span>
        {g.roughEvery === 'month'
          ? <select value={g.roughDay ?? 1} onChange={(e) => put({ roughDay: e.target.value })}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select>
          : <select value={g.roughDay ?? 5} onChange={(e) => put({ roughDay: e.target.value })}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>}
      </label>
    </div>
  );

  return (
    <div className="gig-pay-one">
      <div className="budget-ways" role="radiogroup" aria-label={`How ${g.name} pays`}>
        {([
          ['', 'It varies', 'The average of recent deposits, on the rhythm you set under Paydays.', "Least upkeep. Good for deliveries, tips and anything you can't see coming."],
          ['rough', 'About the same each time', 'You say roughly what a week or a month brings in.', "Good when you don't know the jobs ahead but know about what you make, or have no history in Ledger yet."],
          ['sessions', 'By booked sessions', 'Ledger reads your booking calendar and works out pay from what is on it, at your rate.', 'Good for tutoring, lessons, training, sitting: anything by appointment.'],
          ['jobs', 'By the job', 'You type each job in: who it is for, what you expect, and when.', 'Good for a handyman, a contractor, freelance projects and one-off work.'],
        ] as const).map(([id, title, text, who]) => (
          <button key={id} type="button" role="radio" aria-checked={g.mode === id} disabled={!!busy} className={`budget-way ${g.mode === id ? 'on' : ''}`} onClick={() => g.mode !== id && put({ mode: id })}>
            <b>{title}</b><span>{text}</span><small>{who}</small>
          </button>
        ))}
      </div>

      {g.mode === 'rough' && <div className="gig-pay-body">{roughFields}</div>}

      {g.mode === 'sessions' && (
        <div className="gig-pay-body">
          <div className="add-grid">
            <label className="field"><span>You charge</span>
              <select value={g.rateKind} onChange={(e) => put({ rateKind: e.target.value })}><option value="hour">By the hour</option><option value="session">A set amount per session</option></select></label>
            <label className="field"><span>{g.rateKind === 'hour' ? 'Rate per hour' : 'Amount per session'}</span>
              <MoneyInput value={rate ?? (g.rate === '' ? '' : String(g.rate))} placeholder="40" label="Your rate" onChange={(v) => { setRate(v); setErr(''); }} />
              <small>{rate != null && rate !== String(g.rate) ? <button type="button" className="link" onClick={async () => { if (await put({ rate })) setRate(null); }}>Save the rate</button> : g.rateKind === 'hour' ? 'A 30-minute session counts as half of this.' : 'Whatever its length.'}</small></label>
            <label className="field"><span>You are paid</span>
              <select value={paidKind} onChange={(e) => put({ paid: e.target.value === 'same' ? 'same' : e.target.value === 'weekly' ? 'weekly:5' : 'monthly:1' })}>
                <option value="same">On the day of the session</option><option value="weekly">Once a week</option><option value="monthly">Once a month</option>
              </select></label>
            {paidKind === 'weekly' && <label className="field"><span>Each</span><select value={paidOn} onChange={(e) => put({ paid: `weekly:${e.target.value}` })}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select><small>For sessions up to the day before. A session on that very day is paid the week after.</small></label>}
            {paidKind === 'monthly' && <label className="field"><span>On day</span><select value={paidOn} onChange={(e) => put({ paid: `monthly:${e.target.value}` })}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select><small>Of the month after the sessions.</small></label>}
          </div>

          <h4>Your booking calendar</h4>
          {g.calendar.set ? (
            <>
              <p className="sub">Reading {g.calendar.kind === 'ha' ? <>your Home Assistant calendar <b>{ha.find((c) => c.id === g.calendar.entity)?.name ?? g.calendar.entity}</b></> : <>a calendar at <b>{g.calendar.host}</b></>}: {g.calendar.sessions} session{g.calendar.sessions === 1 ? '' : 's'} booked from now on{g.calendar.at ? `, last read ${ago(g.calendar.at)}` : ''}. Ledger looks again every few hours.</p>
              {g.calendar.error && <p className="error">The last reading failed, so these are the sessions from the reading before: {g.calendar.error}</p>}
              <div className="add-grid">
                <label className="field"><span>Only events that mention (optional)</span><input type="text" value={match ?? g.calendar.match} maxLength={120} placeholder="lesson, tutoring" onChange={(e) => setMatch(e.target.value)} />
                  <small>{match != null && match !== g.calendar.match ? <button type="button" className="link" onClick={async () => { if (await put({ match })) setMatch(null); }}>Save and read again</button> : 'Leave empty if the calendar holds nothing but your sessions. Separate words with commas.'}</small></label>
              </div>
              <div className="add-actions">
                <button disabled={!!busy} onClick={() => send('/api/gig/pay/sync', { method: 'POST', body: { gig: g.id } }, 'sync')}>{busy === 'sync' ? 'Reading…' : 'Read it now'}</button>
                <button disabled={!!busy} onClick={() => confirm('Stop reading this calendar? Sessions still to come are forgotten; ones already held are kept.') && put({ calendar: '' })}>Disconnect</button>
              </div>
            </>
          ) : (
            <>
              {ha.length > 0 && !byLink && (
                <div className="add-grid">
                  <label className="field gig-pay-wide"><span>One of your Home Assistant calendars</span>
                    <select value="" disabled={!!busy} onChange={(e) => e.target.value && put({ haCalendar: e.target.value }, 'calendar')}>
                      <option value="">{busy === 'calendar' ? 'Reading it…' : 'Choose a calendar…'}</option>
                      {ha.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <small>Home Assistant already has these, so there is nothing to paste. Ledger only reads the one you choose, and keeps the times of its events (their titles too, only if you filter by words below). <button type="button" className="link" onClick={() => setByLink(true)}>Use a calendar link instead</button></small></label>
                </div>
              )}
              {(ha.length === 0 || byLink) && (
                <form className="add-grid" noValidate onSubmit={async (e) => { e.preventDefault(); if (await put({ calendar: cal }, 'calendar')) setCal(''); }}>
                  <label className="field gig-pay-wide"><span>Your calendar's private iCal address</span>
                    <input type="url" value={cal} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autoComplete="off" onChange={(e) => { setCal(e.target.value); setErr(''); }} />
                    <small>Google Calendar: Settings, your calendar, "Secret address in iCal format". Apple: share the calendar as a public calendar and copy its link. Outlook and most booking tools have one too. Ledger only reads it, and keeps the times of events, not who they are with. Treat the address like a password.{byLink ? <> <button type="button" className="link" onClick={() => setByLink(false)}>Use a Home Assistant calendar instead</button></> : null}</small></label>
                  <div className="add-actions"><button type="submit" className="primary" disabled={!!busy || !cal.trim()}>{busy === 'calendar' ? 'Reading it…' : 'Connect'}</button></div>
                </form>
              )}
            </>
          )}
          <h4>Past what is booked</h4>
          <p className="sub">A calendar only knows a few weeks ahead. After your last booked session, the forecast uses an estimate so it doesn't fall to nothing.{!g.estimate ? <b> There is nothing to estimate from yet, so the forecast stops at your last booked session: add a rough figure here to cover the weeks your calendar doesn't show.</b> : null}</p>
          {roughFields}
        </div>
      )}

      {g.mode === 'jobs' && (
        <div className="gig-pay-body">
          {g.asks.map((a: any) => (
            <div key={a.tx.id} className="gig-ask" role="group" aria-label="A deposit that may be one of your jobs">
              <p><b>{cents(a.tx.amount)} arrived on {dayShort(a.tx.date)}</b> ({a.tx.merchant}). Is it one of these?</p>
              <div className="add-actions">
                {a.jobs.map((j: any) => <button key={j.id} disabled={!!busy} onClick={() => send('/api/gig/jobs/match', { method: 'POST', body: { tx: a.tx.id, job: j.id } })}>{j.name} ({cents(j.amount)})</button>)}
                <button className="link" disabled={!!busy} onClick={() => send('/api/gig/jobs/match', { method: 'POST', body: { tx: a.tx.id, job: null } })}>None of these</button>
              </div>
            </div>
          ))}

          {owed.length > 0 && (
            <div className="gig-owed" data-go="gig-owed">
              <h4>Owed to you: {cents(g.owed.total)}</h4>
              <p className="sub">Past the day you expected them. They stay here until you say what happened; after two weeks they stop counting in the forecast.</p>
              {owed.map((j: any) => (
                <div key={j.id} className="row gig-job">
                  <span className="grow">{j.name}<small>Expected {dayLong(j.date)}</small></span>
                  <span className="num">{cents(j.amount)}</span>
                  {moving === j.id ? (
                    <span className="gig-job-acts"><input type="date" aria-label={`New date for ${j.name}`} defaultValue={today()} min={today()} onChange={async (e) => { if (e.target.value && await send(`/api/gig/jobs/${j.id}`, { method: 'PATCH', body: { date: e.target.value } })) setMoving(null); }} /><button className="link" onClick={() => setMoving(null)}>Cancel</button></span>
                  ) : (
                    <span className="gig-job-acts">
                      <button className="link" onClick={() => send(`/api/gig/jobs/${j.id}`, { method: 'PATCH', body: { done: true } })}>Got paid</button>
                      <button className="link" onClick={() => setMoving(j.id)}>Still coming</button>
                      <button className="link" onClick={() => confirm(`Write off ${j.name} (${cents(j.amount)})? It stops showing as owed.`) && send(`/api/gig/jobs/${j.id}`, { method: 'PATCH', body: { off: true } })}>Write it off</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <h4>Add a job</h4>
          <form className="add-grid" noValidate onSubmit={async (e) => { e.preventDefault(); if (await send('/api/gig/jobs', { method: 'POST', body: { gig: g.id, ...job } }, 'job')) setJob({ name: '', amount: '', date: job.date }); }}>
            <label className="field"><span>The job</span><input type="text" value={job.name} maxLength={80} placeholder="Deck repair, the Hendersons" onChange={(e) => { setJob({ ...job, name: e.target.value }); setErr(''); }} /></label>
            <label className="field"><span>What you expect</span><MoneyInput value={job.amount} placeholder="450" label="What you expect to be paid" onChange={(v) => { setJob({ ...job, amount: v }); setErr(''); }} /></label>
            <label className="field"><span>When you expect it</span><input type="date" value={job.date} onChange={(e) => setJob({ ...job, date: e.target.value })} /></label>
            <div className="add-actions" style={{ alignSelf: 'end' }}><button type="submit" className="primary" disabled={!!busy}>Add the job</button></div>
          </form>
          {waiting.length === 0 && owed.length === 0 && <p className="sub">No jobs waiting to be paid. Add one and it shows in the dashboard's forecast on the day you expect the money.</p>}
          {waiting.map((j: any) => (
            <div key={j.id} className="row gig-job">
              <span className="grow">{j.name}<small>Expected {dayLong(j.date)}</small></span>
              <span className="num">{cents(j.amount)}</span>
              <span className="gig-job-acts"><button className="link" onClick={() => send(`/api/gig/jobs/${j.id}`, { method: 'PATCH', body: { done: true } })}>Got paid</button><button className="link" onClick={() => send(`/api/gig/jobs/${j.id}`, { method: 'DELETE' })}>Remove</button></span>
            </div>
          ))}
          {got.length > 0 && <p className="sub">Paid lately: {got.slice(0, 5).map((j: any) => `${j.name} (${money(j.amount)})`).join(', ')}.</p>}
          <p className="sub">When a deposit close to a job's amount arrives and is filed as {g.name}, Ledger ticks the job off by itself, as long as there is only one job it could be. If it could be more than one, it asks you here.</p>
          <h4>Weeks with no job typed in</h4>
          <p className="sub">So the forecast doesn't show you earning nothing once your typed jobs run out, it uses an estimate for any week or month without one.</p>
          {roughFields}
        </div>
      )}

      {g.mode !== '' && g.coming.length > 0 && (
        <p className="sub gig-pay-coming"><b>The forecast now expects {money(g.comingTotal)}</b> from {g.name} over the next two months{g.comingFirm < g.comingTotal ? ` (${money(g.comingFirm)} booked or typed in, the rest estimated)` : ''}: {g.coming.slice(0, 4).map((c: any) => `${money(c.amount)} on ${dayShort(c.date)}${c.firm ? '' : ' (estimate)'}`).join(', ')}{g.coming.length > 4 ? ', and more' : ''}.</p>
      )}
      {g.mode !== '' && g.coming.length === 0 && <p className="sub gig-pay-coming">The forecast expects nothing from {g.name} yet. {g.mode === 'rough' ? 'Enter a rough amount above.' : g.mode === 'sessions' ? 'Connect your calendar and enter your rate, or give a rough amount for the weeks ahead.' : 'Add a job, or give a rough amount for the weeks ahead.'}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/** The dashboard's line when jobs are past the day their pay was expected. */
export function OwedNotice() {
  const { data } = useData<{ total: number; count: number; oldest: string | null }>('/api/gig/owed');
  const [, redraw] = useState(0);
  if (!data || !data.count) return null;
  const key = `${data.count}:${data.total}`;
  try { const h = JSON.parse(localStorage.getItem('ledger-owed-hide') || 'null'); if (h && h.key === key && h.until > Date.now()) return null; } catch { /* show it */ }
  const go = () => goTo(GO.gig);
  return (
    <div className="bank-attention" role="status">
      <span className="grow"><b>{cents(data.total)} is owed to you</b> for {data.count === 1 ? 'a job' : `${data.count} jobs`} past the day you expected the money{data.oldest ? `, the oldest since ${dayShort(data.oldest)}` : ''}.</span>
      <button className="button-link" onClick={go}>See them</button>
      <button className="link" onClick={() => { try { localStorage.setItem('ledger-owed-hide', JSON.stringify({ key, until: Date.now() + 7 * 86400000 })); } catch { /* private window */ } redraw((n) => n + 1); }}>Hide for a week</button>
    </div>
  );
}
