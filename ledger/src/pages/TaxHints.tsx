import { jump } from '../go';
import { useEffect, useRef, useState } from 'react';
import { api, cents, useData } from '../lib';
import { Modal, pickReceipt } from '../ui';

const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * "Purchases that might count" on the Taxes page (`server/taxhints.js`): this year's purchases whose shop
 * name suggests a tax break, grouped by kind, each waiting for a yes or a no. Nothing here moves the
 * estimate until someone answers: a yes on a classroom or side-gig purchase claims it, and a yes on child
 * care, giving, medical bills or property tax adds it to a total that "Use" puts into the estimate.
 * `t` is the tax page's own answer, used to say when itemized costs can't change the tax yet.
 */
export function TaxHints({ t, onChange }: { t: any; onChange: () => void }) {
  const { data: h, reload } = useData<any>('/api/tax/hints');
  const [every, setEvery] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');
  // The row someone pressed "Not sure" on, and what they say the purchase was for.
  const [unsure, setUnsure] = useState<number | null>(null);
  const [what, setWhat] = useState('');
  // Goes up each time "Ask your tax preparer" is pressed, which opens the email for reading and editing.
  const [compose, setCompose] = useState(0);
  // The purchase that press set aside, so that cancelling the email puts it back where it was.
  const [fresh, setFresh] = useState<number | null>(null);
  if (!h) return null;
  if (!h.groups.length && !h.tagged.length && !h.forms.length && !h.dismissed && !h.asking?.length) return <section className="card tax-hints"><p className="sub first">Nothing to look at right now. When a purchase's shop name suggests a tax break (classroom supplies, side gig costs, child care, giving, medical bills, property tax), it will be listed here for a yes or a no.</p></section>;
  const send = (path: string, body: any) => async () => {
    setErr('');
    try { await api(`/api/tax/hints/${path}`, { method: 'POST', body }); reload(); onChange(); } catch (e: any) { setErr(e.message); }
  };
  // Ask your CFO: the question is written into the CFO's box for them to read and send. The CFO explains how
  // the rule works; whether it applies to this purchase is still the tax preparer's call.
  const askCfo = (g: any, i: any) => {
    const q = `I bought something from ${i.merchant} for ${cents(i.amount)}${what.trim() ? ` (it was for: ${what.trim()})` : ''}. Ledger flagged it as a possible "${g.title}" item for my taxes. How does that rule work, and what decides whether a purchase like this counts?`;
    try { sessionStorage.setItem('ledger-cfo-draft', q); } catch { /* private window */ }
    dispatchEvent(new Event('ledger-cfo'));
    setTimeout(() => dispatchEvent(new Event('ledger-cfo-ask')), 60);
  };
  const std = t?.constants?.fedStandardDeduction, itemized = t?.with?.itemizedTotal ?? 0, itemizing = !!t?.with?.itemizing;
  const ITEMIZED = ['giving', 'medical', 'property_tax'];
  const waiting = h.groups.reduce((a: number, g: any) => a + g.count, 0);
  return (
    <section className="card tax-hints">
      <div className="card-head"><h2>Purchases that might count</h2>{waiting > 0 && <span className="sub">{waiting} to look at</span>}</div>
      <p className="sub first">
        Ledger picked these out by the shop's name, so each one is only a maybe: it can't see what was bought. Say yes to the ones that really were for that purpose.
        Nothing changes your estimate until you do, and if you're unsure whether something counts, ask a tax preparer.
      </p>
      {h.groups.map((g: any) => {
        const shown = all[g.kind] ? g.items : g.items.slice(0, 6);
        return (
          <div className="hint-group" key={g.kind}>
            <div className="group-head"><span>{g.title}</span><span className="num">{g.count} · {cents(g.total)}</span></div>
            <small>{g.why}{ITEMIZED.includes(g.kind) && std ? (itemizing ? ' You are itemizing, so these lower your tax.' : ` These only lower your tax once your itemized costs pass the standard deduction of ${cents(std)}; you have ${cents(itemized)} so far.`) : ''}</small>
            {g.items.some((i: any) => i.mixed) && <small>Some of these shops sell plenty of other things. If only part of a purchase was for this, say no here and use Split on the Transactions page, then claim that part.</small>}
            <label className="hint-every"><input type="checkbox" checked={!!every[g.kind]} onChange={(e) => setEvery({ ...every, [g.kind]: e.target.checked })} /> Apply my answer to every purchase from the same shop, now and later</label>
            {shown.map((i: any) => (
              <div className="hint-row" key={i.id}>
                <div className="grow"><b>{i.merchant}</b> <span className="when">{shortDay(i.date)}</span>{i.mixed && <small>Sells other things too</small>}</div>
                <span className="num">{cents(i.amount)}</span>
                <span className="hint-acts">
                  {i.receipt ? <span className="when">Receipt kept</span> : <button type="button" className="link" onClick={() => pickReceipt(i.id, (error) => { if (error) setErr(error); else reload(); })}>Add a receipt</button>}
                  <button type="button" className="primary" onClick={send('answer', { id: i.id, kind: g.kind, yes: true, always: !!every[g.kind] })}>Yes</button>
                  <button type="button" onClick={send('answer', { id: i.id, kind: g.kind, yes: false, always: !!every[g.kind] })}>No</button>
                  <button type="button" aria-expanded={unsure === i.id} onClick={() => { setUnsure(unsure === i.id ? null : i.id); setWhat(''); }}>Not sure</button>
                </span>
                {unsure === i.id && (
                  <div className="hint-unsure">
                    <label className="field"><span>What was it for? (optional, but it helps whoever you ask)</span>
                      <input type="text" maxLength={200} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Markers and poster board for my classroom" /></label>
                    <div className="add-actions">
                      <button type="button" onClick={() => askCfo(g, i)}>Ask your CFO</button>
                      <button type="button" className="primary" onClick={async () => { await send('ask', { id: i.id, kind: g.kind, note: what })(); setUnsure(null); setFresh(i.id); setCompose((n) => n + 1); }}>Ask your tax preparer</button>
                    </div>
                    <small>Your CFO (Claude) can explain how the rule works. Whether it applies to this purchase is your tax preparer's call: "Ask your tax preparer" opens an email to them, written for you to read and add to before anything is sent.</small>
                  </div>
                )}
              </div>
            ))}
            {g.items.length > 6 && <button type="button" className="link" onClick={() => setAll({ ...all, [g.kind]: !all[g.kind] })}>{all[g.kind] ? 'Show fewer' : `Show all ${g.items.length}`}</button>}
          </div>
        );
      })}
      {h.asking?.length > 0 && <Questions h={h} send={send} reload={reload} setErr={setErr} compose={compose} fresh={fresh} clearFresh={() => setFresh(null)} />}
      {h.tagged.length > 0 && (
        <div className="hint-group">
          <div className="group-head"><span>What you've said yes to</span></div>
          {h.tagged.map((x: any) => (
            <div className="hint-row" key={x.kind}>
              <div className="grow"><b>{x.title}</b> <span className="when">{x.count} {x.count === 1 ? 'purchase' : 'purchases'}</span>
                <small>{Math.abs(x.typed - x.total) < 0.005 ? 'The estimate is using this total.' : x.typed > 0 ? `The estimate is using ${cents(x.typed)}, the figure typed under "Costs that lower your tax".` : 'Not in the estimate yet.'}</small></div>
              <span className="num">{cents(x.total)}</span>
              <span className="hint-acts">
                {Math.abs(x.typed - x.total) >= 0.005 && <button type="button" className="primary" onClick={send('use', { kind: x.kind })}>Use {cents(x.total)}</button>}
                <button type="button" className="link" onClick={send('clear', { kind: x.kind })}>Start over</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {h.forms.map((f: any) => (
        <p className="sub" key={f.cost}><b>{f.payments} {f.what} {f.payments === 1 ? 'payment' : 'payments'} to {f.to} this year.</b> Only the interest part may count, and the lender's Form {f.form} in January says how much. Enter that figure under "Costs that lower your tax".</p>
      ))}
      {!h.groups.length && !h.tagged.length && !h.forms.length && <p className="sub">Nothing left to look at.</p>}
      {h.dismissed > 0 && <p className="sub">You said no to {h.dismissed}. <button type="button" className="link" onClick={send('clear', { kind: 'no' })}>Show them again</button></p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

/**
 * Purchases set aside to ask the tax preparer about, and the email that asks. Ledger writes the email; the
 * person reads and changes it, then sends it from the household's own email (the one set up for the summary
 * email) or opens it in their own email app. Nothing is sent without the press of Send. Each question stays
 * here, marked as asked, until it is answered with Yes or No.
 */
function Questions({ h, send, reload, setErr, compose, fresh, clearFresh }: { h: any; send: (path: string, body: any) => () => Promise<void>; reload: () => void; setErr: (e: string) => void; compose: number; fresh: number | null; clearFresh: () => void }) {
  const [who, setWho] = useState({ email: h.preparer.email || '', name: h.preparer.name || '' });
  const [mail, setMail] = useState<{ subject: string; body: string; receipts: number } | null>(null);
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { setWho({ email: h.preparer.email || '', name: h.preparer.name || '' }); }, [h.preparer.email, h.preparer.name]);
  const saveWho = async () => {
    if (who.email === (h.preparer.email || '') && who.name === (h.preparer.name || '')) return true;
    try { await api('/api/tax/preparer', { method: 'PUT', body: who }); reload(); return true; } catch (e: any) { setErr(e.message); return false; }
  };
  const box = useRef<HTMLDivElement>(null);
  const write = async () => {
    setErr(''); setNote('');
    if (!(await saveWho())) return;
    try { const d = await api('/api/tax/hints/draft'); setMail({ subject: d.subject, body: d.body, receipts: d.receipts }); } catch (e: any) { setErr(e.message); }
  };
  // "Ask your tax preparer" on a purchase lands here with the email open, so it can be read and added to
  // (what exactly was bought, say) straight away. It is written afresh to include the purchase just set aside.
  useEffect(() => {
    if (!compose) return;
    write();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose]);
  const sendIt = async () => {
    if (!mail) return;
    setBusy(true); setErr('');
    if (!(await saveWho())) { setBusy(false); return; }
    try {
      const r = await api('/api/tax/hints/email', { method: 'POST', body: { subject: mail.subject, body: mail.body, receipts: attach && mail.receipts > 0 } });
      setNote(`Sent to ${r.sent.to}. Their reply will come to ${h.sender}. When you have the answer, press Yes or No on each one.`);
      setMail(null); clearFresh(); reload();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  // Cancel means "don't ask after all": the purchase that was just set aside goes back to the list above.
  // An email opened with "Preview the email" for purchases already set aside is only closed.
  const undo = fresh != null && h.asking.some((q: any) => q.id === fresh && !q.askedAt);
  const cancel = async () => {
    setMail(null);
    if (undo) { await send('ask', { id: fresh, off: true })(); setNote('Cancelled. Nothing was sent, and that purchase is back in the list above.'); }
    clearFresh();
  };
  const waiting = h.asking.filter((q: any) => !q.askedAt).length;
  const mailto = mail ? `mailto:${encodeURIComponent(who.email)}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}` : '';
  return (
    <div className="hint-group hint-questions">
      <div className="group-head"><span>Questions for your tax preparer</span><span className="num">{h.asking.length}</span></div>
      {h.asking.map((q: any) => (
        <div className="hint-row" key={q.id}>
          <div className="grow"><b>{q.merchant}</b> <span className="when">{shortDay(q.date)} · {q.title}</span>
            <small>{q.note ? `For: ${q.note}. ` : ''}{q.askedAt ? `Asked ${new Date(q.askedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}. Press Yes or No once you have the answer.` : 'Not sent yet.'}</small></div>
          <span className="num">{cents(q.amount)}</span>
          <span className="hint-acts">
            <button type="button" className="primary" onClick={send('answer', { id: q.id, kind: q.kind, yes: true })}>Yes</button>
            <button type="button" onClick={send('answer', { id: q.id, kind: q.kind, yes: false })}>No</button>
            <button type="button" className="link" onClick={send('ask', { id: q.id, off: true })}>Put back</button>
          </span>
        </div>
      ))}
      {!mail ? (
        <div className="hint-mail">
          <div className="add-grid">
            <label className="field"><span>Your tax preparer's email</span><input type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} onBlur={saveWho} placeholder="name@example.com" /></label>
            <label className="field"><span>Their name (optional)</span><input type="text" maxLength={60} autoComplete="off" value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} onBlur={saveWho} /></label>
          </div>
          <div className="add-actions"><button type="button" className="primary" onClick={write}>{waiting ? `Preview the email (${waiting} set aside, not sent)` : 'Preview the email again'}</button></div>
        </div>
      ) : (
        <Modal title="Email to your tax preparer" onClose={cancel}>
        <div className="hint-mail" ref={box}>
          <p className="sub">Ledger wrote this for you. Change anything you like, and add whatever your tax preparer would need to know, such as exactly what was bought. Nothing is sent until you press Send.</p>
          <label className="field"><span>To (your tax preparer's email)</span><input type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} onBlur={saveWho} placeholder="name@example.com" /></label>
          <label className="field"><span>Subject</span><input type="text" maxLength={150} value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></label>
          <label className="field"><span>Message</span><textarea rows={10} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} /></label>
          {h.canSend && mail.receipts > 0 && <label className="hint-every"><input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Attach the {mail.receipts === 1 ? 'receipt' : `${mail.receipts} receipts`} kept for {mail.receipts === 1 ? 'that purchase' : 'those purchases'}</label>}
          <div className="add-actions">
            {h.canSend && <button type="button" className="primary" disabled={busy || !who.email.trim()} onClick={sendIt}>{busy ? 'Sending…' : `Send from ${h.sender}`}</button>}
            <a className="button-link" href={mailto} onClick={() => setNote('Opened in your email app. Once you have sent it there, press "I sent it" so Ledger marks these as asked.')}>Open in my email app</a>
            <button type="button" onClick={async () => { await send('asked', {})(); setMail(null); clearFresh(); }}>I sent it</button>
            <button type="button" className="link" onClick={cancel}>{undo ? 'Cancel' : 'Close'}</button>
          </div>
          {!h.canSend && <small>To send straight from Ledger, set up the <a href="#connections" onClick={jump({ page: 'connections', fold: 'email' })}>summary email in Settings</a> (it uses your own Gmail). Until then, "Open in my email app" starts the same message in your own mail program; receipts can't be attached that way.</small>}
        </div>
        </Modal>
      )}
      {note && <p className="good" role="status">{note}</p>}
    </div>
  );
}
