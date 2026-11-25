// Purchases that might count toward a tax break (Taxes, "Purchases that might count").
//
// The owner, 2026-11-23: he had learned of deductions he didn't know could be claimed, and asked whether the
// app should tag likely ones from the words in a purchase's name. It does, as suggestions only:
//
//   * Nothing here changes the tax estimate by itself. A match is a "maybe" in a review list; the estimate
//     moves only when a person says yes (classroom and side-gig purchases become ordinary claims, the same
//     as "Claim" on the Transactions page) or presses "Use" on a tagged total (child care, giving, medical
//     bills and property tax, which the estimate takes as yearly figures under "Costs that lower your tax").
//   * Only the kinds that fit the household are looked for: classroom shops with a teacher in the house,
//     gear and software with a side gig, child care with children. Giving, medical bills and property tax
//     are always looked for, and the page says when they can't change the tax (the standard deduction).
//   * It goes by the shop's name, so it can't know what was bought. The wording on the page is "might
//     count", never "claim this": Anthropic's usage policy and plain caution both say a person or their
//     tax preparer decides. No Claude call is made here; it is a word list.
//
// Keep every word long and unmistakable: 'tithe' once matched "Ticketi The Colony" on his real data, because
// squeezing joins the end of one word to the start of the next.
// Bank names run words together ("NikePOS_US"), so names are squeezed to letters and digits before
// matching and the words below are written the same way (no spaces).
import { cents } from './money.js';
import { db, getSetting, setSetting } from './db.js';
import { TAX_YEAR } from './tax.js';
import { gig } from './gig.js';
import './receipts.js';
import { canSendMail, sendWithFiles } from './mail.js';

if (!db.prepare('PRAGMA table_info(transactions)').all().some((c) => c.name === 'tax_tag')) db.exec('ALTER TABLE transactions ADD COLUMN tax_tag TEXT');
// "Every purchase from this shop": the answer to repeat, 'no' or a kind of cost, keyed by the bank's name for it.
db.exec('CREATE TABLE IF NOT EXISTS tax_hint_rules (merchant TEXT PRIMARY KEY, tag TEXT NOT NULL)');
// Purchases someone wasn't sure about and set aside to ask their tax preparer (tax_tag 'ask'): which kind
// of break it might be, what they say it was for, and when the question was emailed (0 until it is).
db.exec("CREATE TABLE IF NOT EXISTS tax_questions (transaction_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', asked_at INTEGER NOT NULL DEFAULT 0)");

// [words, mixed]: `mixed` marks shops that sell plenty of other things too, where often only part counts.
const W = (list, mixed = false) => list.split(' ').map((w) => [w, mixed]);
const KINDS = {
  teaching: {
    title: 'Classroom purchases', claim: 'teaching',
    why: 'Supplies, books and software a K-12 teacher pays for and is not paid back for may count as educator expenses.',
    words: [...W('teacherspayteachers lakeshore scholastic mardel orientaltrading reallygoodstuff schoolspecialty discountschool carsondellosa kahoot gimkit blooket quizizz wayground edpuzzle nearpod seesaw classdojo flocabulary brainpop teachersupply'),
      ...W('hobbylobby michaels joann dollartree officedepot officemax staples', true)],
  },
  business: {
    title: 'Side gig costs', claim: 'vipkid',
    why: 'Gear, software, postage and fees paid for self-employed work may count as business expenses, which lower both income tax and self-employment tax.',
    words: [...W('bhphoto adorama zoomus zoomvideo adobe dropbox grammarly squarespace godaddy namecheap quickbooks freshbooks logitech upsstore fedexoffice vistaprint'),
      ...W('bestbuy newegg microcenter microsoft usps staples officedepot officemax canva', true)],
  },
  care: {
    title: 'Child care', cost: 'care',
    why: 'Daycare, after-school care and day camp paid so you can work may count toward the child care credit.',
    words: [...W('daycare childcare preschool kindercare primrose goddardschool montessori afterschool daycamp brighthorizons lapetite childtime learningcenter childdevelopment nanny'),
      ...W('ymca boysgirlsclub', true)],
  },
  giving: {
    title: 'Giving', cost: 'giving',
    why: 'Money given to a church or a registered charity may count. Things bought from a charity shop do not.',
    words: W('church ministr baptist methodist lutheran presbyterian catholic assemblyofgod tithely tithing pushpay givelify subsplash redcross salvationarmy stjude unitedway unicef worldvision compassionint samaritan habitatforhumanity feedingamerica foodbank woundedwarrior aspca humanesociety donorschoose wikimedia donation charity'),
  },
  medical: {
    title: 'Medical and dental bills', cost: 'medical',
    why: 'Bills you pay yourselves for doctors, dentists, glasses and prescriptions may count. Anything paid from a health savings account does not, and only the part above 7.5% of income helps.',
    words: [...W('dental dentist orthodont pediatric clinic hospital urgentcare physician optometr eyecare chiropract dermatolog physicaltherapy labcorp questdiag radiology medical familymedicine surgery'),
      ...W('pharmacy cvs walgreens', true)],
  },
  property_tax: {
    title: 'Property tax', cost: 'property_tax',
    why: 'Tax paid on a home, land or vehicles may count.',
    words: W('taxcollector propertytax countycollector personalproperty'),
  },
};
// Payments where only part of what was paid counts, and the lender's year-end form says how much.
const FORMS = [
  { cost: 'student_loan', form: '1098-E', what: 'student loan', words: 'nelnet navient mohela aidvantage edfinancial greatlakes salliemae fedloan studentloan deptofed'.split(' ') },
  { cost: 'mortgage', form: '1098', what: 'mortgage', words: 'mortgage onity mrcooper loancare pennymac newrez rocketmtg'.split(' ') },
];
const COST_KINDS = Object.values(KINDS).filter((k) => k.cost).map((k) => k.cost);
const squeeze = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const r2 = (v) => Math.round(v * 100) / 100;

/** Which kinds are worth looking for in this household. */
function wanted(kids) {
  const out = [];
  if (Number(getSetting('educators', '0')) > 0) out.push('teaching');
  if (gig().on) out.push('business');
  if (kids > 0) out.push('care');
  out.push('giving', 'medical', 'property_tax');
  return out;
}

/** This year's purchases, newest first: what a suggestion can be made from. Health-savings accounts are left out. */
const purchases = () => db.prepare(`
  SELECT t.id, t.date, t.merchant, t.amount, t.deduct_pct, t.tax_tag, c.name category,
         (SELECT 1 FROM receipts r WHERE r.transaction_id = COALESCE(t.split_of, t.id)) receipt
  FROM transactions t JOIN categories c ON c.id = t.category_id JOIN accounts a ON a.id = t.account_id
  WHERE t.amount < 0 AND t.date >= ? AND t.date < ? AND c.kind = 'expense' AND a.type != 'hsa' AND COALESCE(t.pending, 0) = 0
  ORDER BY t.date DESC, t.id DESC`).all(`${TAX_YEAR}-01-01`, `${TAX_YEAR + 1}-01-01`);

/**
 * The review list. `ctx` comes from the tax page's own data: `kids` (children in the household) and
 * `costs` (the yearly figures already typed under "Costs that lower your tax").
 */
export function taxHints(ctx = { kids: 0, costs: {} }) {
  const kinds = wanted(ctx.kids);
  const rules = new Map(db.prepare('SELECT merchant, tag FROM tax_hint_rules').all().map((r) => [r.merchant, r.tag]));
  const rows = purchases();
  // A shop answered with "every purchase": later purchases from it take the same answer without asking.
  const tag = db.prepare('UPDATE transactions SET tax_tag = ? WHERE id = ?');
  for (const t of rows) {
    const rule = rules.get(t.merchant);
    if (rule && !t.tax_tag && !(t.deduct_pct > 0)) { tag.run(rule, t.id); t.tax_tag = rule; }
  }
  const groups = [];
  for (const kind of kinds) {
    const K = KINDS[kind];
    const items = [];
    for (const t of rows) {
      if (t.tax_tag || t.deduct_pct > 0) continue;
      const name = squeeze(t.merchant);
      const hit = K.words.find(([w]) => name.includes(w)) || (kind === 'teaching' && /classroom/i.test(t.category) ? ['', false] : null);
      if (hit) items.push({ id: t.id, date: t.date, merchant: t.merchant, amount: r2(-t.amount), mixed: hit[1], receipt: !!t.receipt });
    }
    if (items.length) groups.push({ kind, title: K.title, why: K.why, claim: !!K.claim, count: items.length, total: r2(items.reduce((a, i) => a + i.amount, 0)), items: items.slice(0, 60) });
  }
  // A purchase is offered once: under the first kind that matches it.
  const seen = new Set();
  for (const g of groups) { g.items = g.items.filter((i) => !seen.has(i.id) && seen.add(i.id)); g.count = Math.min(g.count, g.items.length); g.total = r2(g.items.reduce((a, i) => a + i.amount, 0)); }
  // What has been said yes to so far for the yearly-figure kinds, beside the figure typed for the estimate.
  const tagged = COST_KINDS.map((cost) => {
    const mine = rows.filter((t) => t.tax_tag === cost);
    return { kind: cost, title: Object.values(KINDS).find((k) => k.cost === cost).title, count: mine.length, total: r2(mine.reduce((a, t) => a - t.amount, 0)), typed: Number(ctx.costs?.[cost]) || 0 };
  }).filter((x) => x.count > 0);
  // Loan payments: the interest part is on the lender's form, so point there instead of adding payments up.
  const all = db.prepare(`SELECT merchant, COUNT(*) n FROM transactions WHERE amount < 0 AND date >= ? AND date < ? GROUP BY merchant`).all(`${TAX_YEAR}-01-01`, `${TAX_YEAR + 1}-01-01`);
  const forms = FORMS.filter((f) => !(Number(ctx.costs?.[f.cost]) > 0)).map((f) => {
    const hits = all.filter((m) => f.words.some((w) => squeeze(m.merchant).includes(w)));
    return hits.length ? { cost: f.cost, form: f.form, what: f.what, payments: hits.reduce((a, m) => a + m.n, 0), to: hits.sort((a, b) => b.n - a.n)[0].merchant } : null;
  }).filter(Boolean);
  // Set aside to ask a tax preparer about.
  const notes = new Map(db.prepare('SELECT transaction_id id, kind, note, asked_at FROM tax_questions').all().map((q) => [q.id, q]));
  const asking = rows.filter((t) => t.tax_tag === 'ask' && notes.has(t.id)).map((t) => {
    const q = notes.get(t.id);
    return { id: t.id, date: t.date, merchant: t.merchant, amount: r2(-t.amount), kind: q.kind, title: KINDS[q.kind]?.title || '', note: q.note, askedAt: q.asked_at, receipt: !!t.receipt };
  });
  return {
    year: TAX_YEAR, groups: groups.filter((g) => g.items.length), tagged, forms, dismissed: rows.filter((t) => t.tax_tag === 'no').length, asking,
    preparer: { email: getSetting('preparer_email'), name: getSetting('preparer_name') }, canSend: canSendMail(), sender: getSetting('mail_user'),
  };
}

/** `more` gives this module the tax page's own figures: `kids()`, `costs()` and `setCost(kind, amount)`. */
export function installTaxHints(app, more) {
  const answer = () => taxHints({ kids: more.kids(), costs: more.costs() });
  app.get('/api/tax/hints', (_req, res) => res.json(answer()));

  // Yes or no to one suggestion; with `always`, to every purchase from that shop this year and from now on.
  app.post('/api/tax/hints/answer', (req, res) => {
    const kind = String(req.body?.kind || ''), K = KINDS[kind];
    const t = db.prepare('SELECT id, merchant, amount FROM transactions WHERE id = ? AND amount < 0').get(Number(req.body?.id));
    if (!K || !t) return res.status(400).json({ error: 'That purchase is no longer there.' });
    const yes = req.body?.yes !== false, always = req.body?.always === true;
    // An answer settles a question that was set aside for the tax preparer.
    db.prepare("UPDATE transactions SET tax_tag = NULL WHERE id = ? AND tax_tag = 'ask'").run(t.id);
    db.prepare('DELETE FROM tax_questions WHERE transaction_id = ?').run(t.id);
    const span = [`${TAX_YEAR}-01-01`, `${TAX_YEAR + 1}-01-01`];
    if (yes && K.claim) {
      // A classroom or side-gig purchase: an ordinary claim, as on the Transactions page.
      if (always) {
        db.prepare("UPDATE transactions SET deduct_pct = 100, deduct_kind = ? WHERE merchant = ? AND amount < 0 AND deduct_pct = 0 AND COALESCE(tax_tag, '') = ''").run(K.claim, t.merchant);
        db.prepare('INSERT INTO deduct_rules (merchant, pct, kind) VALUES (?, 100, ?) ON CONFLICT(merchant) DO UPDATE SET pct = 100, kind = excluded.kind').run(t.merchant, K.claim);
      } else db.prepare('UPDATE transactions SET deduct_pct = 100, deduct_kind = ? WHERE id = ?').run(K.claim, t.id);
    } else {
      const tag = yes ? K.cost : 'no';
      if (always) {
        db.prepare("UPDATE transactions SET tax_tag = ? WHERE merchant = ? AND amount < 0 AND deduct_pct = 0 AND COALESCE(tax_tag, '') = '' AND date >= ? AND date < ?").run(tag, t.merchant, ...span);
        db.prepare('INSERT INTO tax_hint_rules (merchant, tag) VALUES (?, ?) ON CONFLICT(merchant) DO UPDATE SET tag = excluded.tag').run(t.merchant, tag);
      } else db.prepare('UPDATE transactions SET tax_tag = ? WHERE id = ?').run(tag, t.id);
    }
    res.json(answer());
  });

  // "Not sure": sets a purchase aside to ask the tax preparer about, with what it was for in the person's own
  // words. Sent again for one already set aside, it changes the words. `off` puts it back in the list.
  app.post('/api/tax/hints/ask', (req, res) => {
    const kind = String(req.body?.kind || '');
    const t = db.prepare('SELECT id FROM transactions WHERE id = ? AND amount < 0').get(Number(req.body?.id));
    if (!t || (!KINDS[kind] && !req.body?.off)) return res.status(400).json({ error: 'That purchase is no longer there.' });
    if (req.body?.off) {
      db.prepare("UPDATE transactions SET tax_tag = NULL WHERE id = ? AND tax_tag = 'ask'").run(t.id);
      db.prepare('DELETE FROM tax_questions WHERE transaction_id = ?').run(t.id);
    } else {
      const note = String(req.body?.note || '').split(/\s+/).join(' ').trim().slice(0, 200);
      db.prepare("UPDATE transactions SET tax_tag = 'ask' WHERE id = ?").run(t.id);
      db.prepare('INSERT INTO tax_questions (transaction_id, kind, note) VALUES (?, ?, ?) ON CONFLICT(transaction_id) DO UPDATE SET note = excluded.note').run(t.id, kind, note);
    }
    res.json(answer());
  });

  // The tax preparer's address, typed once.
  app.put('/api/tax/preparer', (req, res) => {
    const email = String(req.body?.email || '').trim().slice(0, 120), name = String(req.body?.name || '').split(/\s+/).join(' ').trim().slice(0, 60);
    if (email && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/.test(email)) return res.status(400).json({ error: "That doesn't look like an email address." });
    setSetting('preparer_email', email); setSetting('preparer_name', name);
    res.json(answer());
  });

  // The email as Ledger would word it, for the person to read and change before anything is sent.
  const draft = () => {
    const h = answer(), mine = h.asking;
    const who = more.names();
    const money = cents;
    const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const what = { teaching: 'a classroom (educator) expense', business: 'a business expense for self-employed work', care: 'child care toward the child care credit', giving: 'a charitable gift', medical: 'a medical expense', property_tax: 'property tax' };
    const lines = mine.map((q, i) => `${mine.length > 1 ? `${i + 1}. ` : ''}${q.merchant}, ${day(q.date)}, ${money(q.amount)}.${q.note ? ` It was for: ${q.note}.` : ''} Could this count as ${what[q.kind] || 'a deduction'}?`);
    const body = [
      `Hello${h.preparer.name ? ` ${h.preparer.name}` : ''},`,
      '',
      mine.length === 1 ? `I have a question about a purchase for our ${TAX_YEAR} taxes, and whether it can be counted.` : `I have questions about ${mine.length} purchases for our ${TAX_YEAR} taxes, and whether each can be counted.`,
      '',
      ...lines.flatMap((l) => [l, '']),
      'Thank you,',
      who || '',
    ].join('\n').trim();
    return { to: h.preparer.email, subject: `A question for our ${TAX_YEAR} taxes${mine.length > 1 ? ` (${mine.length} purchases)` : ''}`, body, count: mine.length, receipts: mine.filter((q) => q.receipt).length };
  };
  app.get('/api/tax/hints/draft', (_req, res) => res.json(draft()));

  // Sends it, from the household's own email (the one set up for the summary email), to the preparer's
  // address. Only ever on the press of Send, with the words the person saw. `receipts` attaches the
  // pictures kept for those purchases.
  app.post('/api/tax/hints/email', async (req, res) => {
    const d = draft();
    if (!canSendMail()) return res.status(400).json({ error: 'Set up the summary email in Settings first, or use "Open in my email app".' });
    if (!d.to) return res.status(400).json({ error: "Add your tax preparer's email address first." });
    if (!d.count) return res.status(400).json({ error: 'There is nothing set aside to ask about.' });
    const subject = String(req.body?.subject || d.subject).split(/[\r\n]+/).join(' ').trim().slice(0, 150), body = String(req.body?.body || d.body).slice(0, 6000);
    if (!body.trim()) return res.status(400).json({ error: 'The email is empty.' });
    const asking = answer().asking;
    const files = [];
    if (req.body?.receipts) {
      for (const q of asking.filter((x) => x.receipt)) {
        const pic = db.prepare('SELECT r.image, r.type FROM receipts r JOIN transactions t ON r.transaction_id = COALESCE(t.split_of, t.id) WHERE t.id = ?').get(q.id);
        if (pic) files.push({ filename: `receipt-${q.date}-${squeeze(q.merchant).slice(0, 20) || 'purchase'}.${pic.type === 'image/png' ? 'png' : pic.type === 'image/webp' ? 'webp' : 'jpg'}`, content: Buffer.from(pic.image), contentType: pic.type });
      }
    }
    try { await sendWithFiles(d.to, subject, body, files, more.names()); } catch (e) { return res.status(502).json({ error: e.message }); }
    const now = Date.now();
    for (const q of asking) db.prepare('UPDATE tax_questions SET asked_at = ? WHERE transaction_id = ?').run(now, q.id);
    res.json({ ...answer(), sent: { to: d.to, count: asking.length } });
  });

  // For someone who sent it from their own email app: marks the questions as asked.
  app.post('/api/tax/hints/asked', (_req, res) => {
    db.prepare('UPDATE tax_questions SET asked_at = ? WHERE asked_at = 0').run(Date.now());
    res.json(answer());
  });

  // Puts a tagged total into the estimate, as the yearly figure for that cost.
  app.post('/api/tax/hints/use', (req, res) => {
    const kind = String(req.body?.kind || '');
    if (!COST_KINDS.includes(kind)) return res.status(400).json({ error: "That isn't a cost Ledger adds up." });
    const total = answer().tagged.find((x) => x.kind === kind)?.total || 0;
    more.setCost(kind, total);
    res.json(answer());
  });

  // Takes the answers back for one kind (or the "no" answers, with kind 'no'), so its purchases are offered again.
  app.post('/api/tax/hints/clear', (req, res) => {
    const kind = String(req.body?.kind || '');
    if (kind !== 'no' && !COST_KINDS.includes(kind)) return res.status(400).json({ error: 'Nothing to clear.' });
    // If the estimate was using this total, it goes back to nothing along with the answers.
    const was = kind === 'no' ? null : answer().tagged.find((x) => x.kind === kind);
    if (was && Math.abs(was.typed - was.total) < 0.005) more.setCost(kind, 0);
    db.prepare('UPDATE transactions SET tax_tag = NULL WHERE tax_tag = ?').run(kind);
    db.prepare('DELETE FROM tax_hint_rules WHERE tag = ?').run(kind);
    res.json(answer());
  });
}
