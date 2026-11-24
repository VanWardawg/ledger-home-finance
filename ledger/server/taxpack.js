// The tax pack (2026-11-18): everything Ledger holds that someone preparing the household's return
// would ask for, as one PDF, with the claimed purchases also as a spreadsheet file.
//
// It is made on request (Taxes page: download it, or email it to an address you type, such as your
// preparer's) and once by itself in January after the tax year ends, to the summary email's
// addresses. It never goes anywhere the household didn't name. The PDF is built with pdfkit; the
// figures come from the same taxEstimate() the Taxes page shows, handed in by server/index.js.
//
// Settings: taxpack_sent (the tax year whose January copy has gone out).
import PDFDocument from 'pdfkit';
import { db, getSetting, setSetting } from './db.js';
import { canSendMail, sendWithFiles } from './mail.js';
import './receipts.js';
import { appendPdfs, docList, docsForPack, docsOn, installTaxDocs } from './taxdocs.js';

const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const FILING = { joint: 'Married filing jointly', separate: 'Married filing separately', single: 'Single', hoh: 'Head of household' };
const csv = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Every purchase claimed for tax in the year, business and classroom. */
function claimed(year) {
  return db.prepare(`SELECT t.id, COALESCE(t.split_of, t.id) holder, t.date, t.merchant, -t.amount amount, t.deduct_pct pct, t.deduct_kind kind, a.name account, t.notes,
      (SELECT 1 FROM receipts r WHERE r.transaction_id = COALESCE(t.split_of, t.id)) receipt
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE t.deduct_pct > 0 AND t.amount < 0 AND t.date >= ? AND t.date < ? ORDER BY t.deduct_kind, t.date`).all(`${year}-01-01`, `${year + 1}-01-01`)
    .map((r) => ({ ...r, claim: Math.round(r.amount * r.pct) / 100, kind: r.kind === 'teaching' ? 'teaching' : 'business' }));
}

// Purchases said yes to under "Purchases that might count" for the costs the estimate takes as yearly figures.
const TAGS = { care: 'Child care', giving: 'Giving', medical: 'Medical and dental bills', property_tax: 'Property tax' };
function tagged(year) {
  return db.prepare(`SELECT t.id, COALESCE(t.split_of, t.id) holder, t.date, t.merchant, -t.amount amount, t.tax_tag tag,
      (SELECT 1 FROM receipts r WHERE r.transaction_id = COALESCE(t.split_of, t.id)) receipt
    FROM transactions t WHERE t.tax_tag IN ('care', 'giving', 'medical', 'property_tax') AND t.amount < 0 AND t.date >= ? AND t.date < ? ORDER BY t.tax_tag, t.date`).all(`${year}-01-01`, `${year + 1}-01-01`);
}
/** How many of the year's claimed and tagged purchases have a receipt kept, and which don't. */
export function receiptState(year) {
  const all = [...claimed(year).map((r) => ({ ...r, as: r.kind === 'teaching' ? 'Classroom' : 'Business' })), ...tagged(year).map((r) => ({ ...r, as: TAGS[r.tag] }))];
  return { all: all.length, kept: all.filter((r) => r.receipt).length, missing: all.filter((r) => !r.receipt).slice(0, 80).map((r) => ({ id: r.id, date: r.date, merchant: r.merchant, amount: r.amount, as: r.as })) };
}

// Questions and notes the household wants its tax preparer to see (The owner, 2026-11-23: "add that to my PDF
// I'll bring to her at tax season"). Written on the Taxes page, kept in setting `taxpack_notes` as a list of
// { id, text, at }, and printed near the front of the tax pack until removed. Purchases set aside with
// "Ask your tax preparer" and not yet answered are printed with them.
export const packNotes = () => { try { const v = JSON.parse(getSetting('taxpack_notes') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
function openQuestions(year) {
  try {
    return db.prepare(`SELECT t.date, t.merchant, -t.amount amount, q.kind, q.note, q.asked_at FROM tax_questions q JOIN transactions t ON t.id = q.transaction_id
      WHERE t.tax_tag = 'ask' AND t.date >= ? AND t.date < ? ORDER BY t.date`).all(`${year}-01-01`, `${year + 1}-01-01`);
  } catch { return []; }
}
const ASK_AS = { teaching: 'a classroom (educator) expense', business: 'a business expense', care: 'child care for the credit', giving: 'a charitable gift', medical: 'a medical expense', property_tax: 'property tax' };

export function packCsv(year) {
  const head = ['Date', 'Bought from', 'Paid', 'Share claimed %', 'Amount claimed', 'Claimed as', 'Account', 'Note', 'Receipt kept'];
  const rows = claimed(year).map((r) => [r.date, r.merchant, r.amount.toFixed(2), r.pct, r.claim.toFixed(2), r.kind === 'teaching' ? 'Classroom expense' : 'Business expense', r.account, r.notes, r.receipt ? 'yes' : 'no'].map(csv).join(','));
  return '﻿' + [head.join(','), ...rows].join('\r\n');
}

/** The PDF, as a Buffer. `t` is taxEstimate()'s answer. With `receipts`, each kept receipt follows on a page of its own. */
export function packPdf(t, { receipts = false, docs = [] } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: `Ledger tax pack ${t.year}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width - 108;
    const h1 = (text) => { doc.moveDown(0.9).font('Helvetica-Bold').fontSize(13).fillColor('#111').text(text); doc.moveTo(54, doc.y + 2).lineTo(54 + W, doc.y + 2).strokeColor('#bbb').lineWidth(0.6).stroke(); doc.moveDown(0.45); };
    const line = (label, value, bold) => {
      if (doc.y > doc.page.height - 90) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5).fillColor('#111').text(label, 54, y, { width: W - 120 });
      const after = doc.y;
      doc.text(value, 54 + W - 120, y, { width: 120, align: 'right' });
      doc.y = Math.max(after, doc.y); doc.x = 54;
    };
    const note = (text) => { doc.font('Helvetica').fontSize(9).fillColor('#555').text(text, 54, doc.y, { width: W }); doc.fillColor('#111'); };
    const s = t.settings, m = t.more, w = t.with;
    const two = t.status === 'joint' || t.status === 'separate';

    doc.font('Helvetica-Bold').fontSize(20).text(`Tax pack for ${t.year}`);
    doc.font('Helvetica').fontSize(10.5).fillColor('#555').text(`From Ledger, made ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}. Figures the household entered or that came from its bank records, gathered for whoever prepares the return. It is not a tax return, and its tax figures are estimates.`, { width: W });
    doc.fillColor('#111');

    const notes = packNotes(), asks = openQuestions(t.year);
    if (notes.length || asks.length) {
      h1('Questions and notes for our tax preparer');
      const para = (text) => { if (doc.y > doc.page.height - 110) doc.addPage(); doc.font('Helvetica').fontSize(10.5).fillColor('#111').text(text, 54, doc.y, { width: W }); doc.moveDown(0.55); };
      notes.forEach((n, i) => para(`${notes.length + asks.length > 1 ? `${i + 1}. ` : ''}${n.text}`));
      asks.forEach((q, i) => para(`${notes.length + asks.length > 1 ? `${notes.length + i + 1}. ` : ''}A purchase we weren't sure about: ${q.merchant}, ${q.date}, ${money(q.amount)}.${q.note ? ` It was for: ${q.note}.` : ''} Could it count as ${ASK_AS[q.kind] || 'a deduction'}?`));
    }

    h1('Household');
    line('Filing status', FILING[t.status] || t.status);
    if (m.dependents.length) for (const d of m.dependents) line(`${d.kind === 'child' ? 'Child' : 'Other dependent'}, born ${d.born}${d.student ? ' (full-time student)' : ''}`, `age ${t.year - d.born} at year end`);
    else line('Children under 17', String(Math.round(Number(s.kids) || 0)));
    if (m.born_you !== '') line(two ? 'Year of birth (first spouse)' : 'Year of birth', String(m.born_you));
    if (two && m.born_spouse !== '') line('Year of birth (second spouse)', String(m.born_spouse));
    if (Number(s.educators) > 0) line('K-12 educators in the household', String(s.educators));

    h1('Wages entered');
    line(two ? 'Main job, first spouse (year, before tax)' : 'Main job (year, before tax)', money(s.your_salary));
    if (Number(s.pretax_you) > 0) line('  pre-tax deductions from it', money(s.pretax_you));
    if (two) { line('Main job, second spouse', money(s.spouse_salary)); if (Number(s.pretax_spouse) > 0) line('  pre-tax deductions from it', money(s.pretax_spouse)); }
    for (const j of m.jobs) line(`${j.name || 'Another job'}${two ? ` (${j.who === 'spouse' ? 'second' : 'first'} spouse)` : ''}`, money(j.wages));
    note('Wages are as typed into Ledger or read from a pay stub; the W-2s are the record.');

    if (t.gigs.length) {
      h1('Self-employment');
      for (const g of t.gigs) {
        line(`${g.name}${two ? ` (${g.who === 'spouse' ? 'second' : 'first'} spouse)` : ''}: deposits received so far`, money(g.received));
        line('  income used for the year', money(g.income));
        line('  expenses', money(g.costs));
        line('  profit', money(g.profit), true);
      }
      note('Deposits are read from the bank records. Income for the year is projected from them until the year ends, or is the figure typed over it.');
    }

    const I = m.income, other = [['Social Security, first spouse', I.ss_you], ['Social Security, second spouse', I.ss_spouse], ['Pension, first spouse', I.pension_you], ['Pension, second spouse', I.pension_spouse], ['IRA or 401(k) withdrawals, first spouse', I.ira_you], ['IRA or 401(k) withdrawals, second spouse', I.ira_spouse], ['Unemployment, first spouse', I.unemployment_you], ['Unemployment, second spouse', I.unemployment_spouse], ['Bank interest', I.interest], ['Dividends', I.dividends], ['Profit from selling investments', I.gains], ['Rental profit', I.rental], ['Other taxable income', I.other], ['Child support received (not taxed)', I.support]].filter(([, v]) => v);
    if (other.length) { h1('Other income entered'); for (const [k, v] of other) line(k, money(v)); }

    const rows = claimed(t.year);
    const hand = (kind) => t.deductions.filter((d) => d.kind === kind);
    for (const [kind, title] of [['business', 'Business expenses claimed'], ['teaching', 'Classroom expenses claimed']]) {
      const mine = rows.filter((r) => r.kind === kind), typed = hand(kind);
      if (!mine.length && !typed.length) continue;
      h1(title);
      for (const r of mine) line(`${r.date}  ${r.merchant}${r.pct < 100 ? `  (${Math.round(r.pct)}% of ${money(r.amount)})` : ''}${r.receipt ? '' : '  [no receipt kept]'}`, money(r.claim));
      for (const d of typed) line(`${d.name} (entered by hand)`, money(d.amount));
      line('Total', money(mine.reduce((a, r) => a + r.claim, 0) + typed.reduce((a, d) => a + d.amount, 0)), true);
    }
    const adj = [...hand('adjustment').map((d) => [d.name, d.amount]), ...hand('itemized').map((d) => [`${d.name} (itemized)`, d.amount])];
    const C = m.costs, costs = [['Student loan interest paid', C.student_loan], ['Child care paid', C.care], ['College tuition and fees paid', C.college], ['Mortgage interest', C.mortgage], ['Property taxes', C.property_tax], ['Giving to church and charity', C.giving], ['Medical and dental bills paid', C.medical]].filter(([, v]) => v);
    if (adj.length || costs.length) { h1('Other deductions and costs entered'); for (const [k, v] of [...adj, ...costs]) line(k, money(v)); if (C.college_students) line('Students in their first four years of college', String(C.college_students)); }

    const tags = tagged(t.year);
    if (tags.length) {
      h1('Purchases the household marked toward those costs');
      for (const r of tags) line(`${r.date}  ${r.merchant}  (${TAGS[r.tag]})${r.receipt ? '' : '  [no receipt kept]'}`, money(r.amount));
      note('Picked out in Ledger by the shop\'s name and confirmed by the household. A yearly figure above may have been typed in separately and need not equal these.');
    }

    h1('Tax already paid');
    const blank = (v) => (v === '' ? 'not entered' : money(v));
    line('Federal tax withheld from pay', blank(s.withheld_fed)); line(`${t.state?.name || 'Arkansas'} tax withheld from pay`, blank(s.withheld_ar));
    line('Federal estimated payments made', blank(s.paid_fed)); line(`${t.state?.name || 'Arkansas'} estimated payments made`, blank(s.paid_ar));

    h1("Ledger's estimate");
    line('Federal income tax, after credits', money(w.fedIncomeTax));
    if (w.seTax) line('Self-employment tax', money(w.seTax));
    line(`${t.state?.name || 'Arkansas'} income tax`, money(w.arTax));
    line('Total for the year', money(w.total), true);
    if (t.filing.known) { line('Federal: owed at filing (a minus is a refund)', money(t.filing.federal)); line(`${t.state?.name || 'Arkansas'}: owed at filing (a minus is a refund)`, money(t.filing.arkansas)); }
    note(`An estimate for planning from Ledger's own reading of the ${t.year} rules. The return, prepared from the actual forms, is what counts.`);

    // The receipts themselves, one to a page, each under the purchase it belongs to. A split purchase's
    // receipt is printed once. Only JPEG and PNG pictures can be put in a PDF.
    if (receipts) {
      const seen = new Set();
      const kept = [...rows.map((r) => ({ ...r, as: r.kind === 'teaching' ? 'Classroom expense' : 'Business expense' })), ...tags.map((r) => ({ ...r, as: TAGS[r.tag] }))].filter((r) => r.receipt && !seen.has(r.holder) && seen.add(r.holder));
      for (const r of kept) {
        const pic = db.prepare('SELECT image, type FROM receipts WHERE transaction_id = ?').get(r.holder);
        if (!pic) continue;
        doc.addPage();
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#111').text(`${r.merchant}`, 54, 54, { width: W });
        doc.font('Helvetica').fontSize(10).fillColor('#555').text(`${r.date}   ${money(r.amount)}   ${r.as}`, { width: W });
        doc.fillColor('#111').moveDown(0.6);
        try {
          if (!/^image\/(jpeg|png)$/.test(pic.type)) throw new Error('kind');
          doc.image(Buffer.from(pic.image), 54, doc.y, { fit: [W, doc.page.height - doc.y - 60], align: 'center' });
        } catch { note('The picture kept for this purchase is in a form that cannot be printed here. It can be seen in Ledger, on the purchase.'); }
      }
    }
    // Documents the household keeps for its preparer (server/taxdocs.js): a list of them, each photo on a
    // page of its own, and the PDFs' own pages added at the very end once this file is finished.
    if (docs.length) {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text('Documents included', 54, 54, { width: W });
      doc.moveTo(54, doc.y + 2).lineTo(54 + W, doc.y + 2).strokeColor('#bbb').lineWidth(0.6).stroke(); doc.moveDown(0.6);
      for (const d of docs) line(d.name, d.type === 'application/pdf' ? (d.ok ? `${d.pages} ${d.pages === 1 ? 'page' : 'pages'}, at the end` : 'NOT included') : 'next pages');
      if (docs.some((d) => !d.ok)) note('A document marked "NOT included" could not be opened to copy its pages (it may be password-protected). Bring it separately.');
      for (const d of docs.filter((x) => x.type !== 'application/pdf')) {
        doc.addPage();
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#111').text(d.name, 54, 54, { width: W });
        doc.moveDown(0.6);
        try { doc.image(d.data, 54, doc.y, { fit: [W, doc.page.height - doc.y - 60], align: 'center' }); } catch { note('This picture could not be printed here. It can be opened in Ledger, under Tax pack.'); }
      }
    }
    doc.end();
  });
}

export function installTaxPack(app, { taxEstimate }) {
  installTaxDocs(app, { year: () => taxEstimate().year });
  const build = async (receipts = false) => {
    const t = taxEstimate();
    // The full download carries the kept documents as well as the receipts; the plain and emailed ones never do.
    const docs = receipts ? await docsForPack(t.year) : [];
    const pdf = await appendPdfs(await packPdf(t, { receipts, docs }), docs);
    return { t, files: [
      { filename: `ledger-tax-pack-${t.year}${receipts ? '-with-receipts' : ''}.pdf`, content: pdf, contentType: 'application/pdf' },
      { filename: `claimed-purchases-${t.year}.csv`, content: Buffer.from(packCsv(t.year), 'utf8'), contentType: 'text/csv' },
    ] };
  };
  const text = (year) => `Attached is the tax pack for ${year} from Ledger: a PDF of what the household entered and what its bank records show (wages, side income, purchases claimed, other deductions, tax already paid, and Ledger's estimate), and a spreadsheet file listing each claimed purchase.\n\nIt is a summary to work from, not a tax return, and the tax figures in it are estimates.`;

  // ?receipts=1 adds the receipt pictures. The emailed copy never carries them: it would be too large to send.
  app.get('/api/tax/pack.pdf', async (req, res) => {
    const { t, files } = await build(req.query.receipts === '1');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${files[0].filename}"`);
    res.send(files[0].content);
    void t;
  });
  app.get('/api/tax/pack', (_req, res) => res.json({ canSend: canSendMail(), to: getSetting('mail_to') || getSetting('mail_user'), sentFor: getSetting('taxpack_sent'), receipts: receiptState(taxEstimate().year), notes: packNotes(), questions: openQuestions(taxEstimate().year).length, docs: { on: docsOn(), list: docList(taxEstimate().year) } }));
  // A question or note for the tax preparer, printed in the pack until it is removed.
  app.post('/api/tax/pack/notes', (req, res) => {
    const text = String(req.body?.text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200);
    if (!text) return res.status(400).json({ error: 'Write the question or note first.' });
    const all = packNotes();
    if (all.length >= 30) return res.status(400).json({ error: 'That is a lot of notes. Remove one that has been answered first.' });
    all.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, at: Date.now() });
    setSetting('taxpack_notes', JSON.stringify(all));
    res.json({ notes: all });
  });
  app.delete('/api/tax/pack/notes/:id', (req, res) => {
    const all = packNotes().filter((n) => n.id !== req.params.id);
    setSetting('taxpack_notes', JSON.stringify(all));
    res.json({ notes: all });
  });
  // Email it to an address typed on the Taxes page (your own, or your preparer's).
  app.post('/api/tax/pack/email', async (req, res) => {
    if (!canSendMail()) return res.status(400).json({ error: 'Set up the summary email in Settings first: the tax pack is sent through it.' });
    const to = String(req.body?.to || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!to.length || to.some((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x)) || to.length > 4) return res.status(400).json({ error: 'Enter one to four email addresses, separated by commas.' });
    try { const { t, files } = await build(); await sendWithFiles(to.join(', '), `Tax pack for ${t.year}`, text(t.year), files); res.json({ ok: true, to }); }
    catch (e) { res.status(502).json({ error: e.message }); }
  });
  // In January after the tax year, once, to the household's own addresses.
  const january = async () => {
    const now = new Date();
    const t = taxEstimate();
    if (!(now.getFullYear() === t.year + 1 && now.getMonth() === 0 && now.getDate() >= 2) || getSetting('taxpack_sent') === String(t.year)) return;
    if (!canSendMail() || getSetting('mail_on') !== '1' || now.getHours() < 8 || now.getHours() >= 20) return;
    const { files } = await build();
    await sendWithFiles(getSetting('mail_to'), `Your ${t.year} tax pack from Ledger`, `${text(t.year)}\n\nForward this to whoever prepares your taxes, or send it to them from the Taxes page. You can make a fresh copy there at any time, for example once the last W-2 figures are in.`, files);
    setSetting('taxpack_sent', String(t.year));
  };
  setInterval(() => january().catch(() => {}), 3600_000).unref();
}
