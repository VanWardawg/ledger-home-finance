// Money in that isn't pay (added 2026-11-18, the owner's idea).
//
// Until now any deposit Ledger didn't recognise was filed as Income, so birthday money, a card's
// rewards, a balance transfer, a reimbursement or cash paid in all inflated a household's income.
// On his own copy fifteen such deposits, about $18,600, were counted as income in 2026.
//
// Now only what the household has said is pay counts as income by default:
//   - a deposit matching one of their Paydays (Settings, Income),
//   - a deposit matching a side gig's words (server/gig.js),
//   - a deposit the bank itself words as payroll or direct deposit,
//   - anything they file under Income themselves, or a merchant rule they set.
// Every other deposit goes to "Other deposits" (key 'Deposit'). That category has kind 'transfer',
// which every total in the app already leaves out of both income and spending, so no sum had to
// change. It still shows as its own category, and a row there offers "It's income" and "It's a refund".
//
// Nothing already in a database is moved by itself. Deposits sitting in Income that don't match
// any pay are offered for review on the Transactions page; the household says which are income.
import { db } from './db.js';
import { gigCategoryFor } from './gig.js';

if (!db.prepare('PRAGMA table_info(transactions)').all().some((c) => c.name === 'income_ok')) db.exec('ALTER TABLE transactions ADD COLUMN income_ok INTEGER');

/** The "Other deposits" category, made the first time it is needed. */
export function depositCategoryId() {
  const there = db.prepare("SELECT id FROM categories WHERE key = 'Deposit'").get();
  if (there) return there.id;
  const transfer = db.prepare("SELECT sort FROM categories WHERE COALESCE(key, name) = 'Transfer'").get()?.sort ?? 14;
  // A household may already have made a category with this name by hand: adopt it.
  const same = db.prepare("SELECT id FROM categories WHERE lower(name) = 'other deposits'").get();
  if (same) { db.prepare("UPDATE categories SET key = 'Deposit', kind = 'transfer', budget = 0 WHERE id = ?").run(same.id); return same.id; }
  return Number(db.prepare("INSERT INTO categories (name, key, icon, color, kind, fixed, budget, sort) VALUES ('Other deposits', 'Deposit', '📥', '#4f8f9c', 'transfer', 0, 0, ?)").run(transfer - 0.1).lastInsertRowid);
}
depositCategoryId();

const PAYROLL = /payroll|direct dep|salary|dir dep/i;
/** Does this deposit's wording match one of the household's paydays, or payroll wording from the bank? */
export function looksLikePay(merchant) {
  const m = String(merchant || '').toLowerCase();
  if (PAYROLL.test(m)) return true;
  let pays = [];
  try { pays = db.prepare('SELECT merchant_like FROM pay_schedules').all(); } catch { /* no paydays table yet */ }
  return pays.some((p) => { const w = String(p.merchant_like || '').toLowerCase().split('%').join('').trim(); return w.length >= 3 && m.includes(w); });
}

/** Deposits filed as Income that nothing marks as pay and nobody has confirmed. */
function toReview() {
  return db.prepare(`SELECT t.id, t.date, t.merchant, t.amount, t.notes, a.name account FROM transactions t
      JOIN categories c ON c.id = t.category_id JOIN accounts a ON a.id = t.account_id
      WHERE COALESCE(c.key, c.name) = 'Income' AND t.amount > 0 AND t.income_ok IS NULL AND t.split_of IS NULL AND t.pending = 0
      ORDER BY t.date DESC, t.id DESC`).all()
    .filter((t) => !looksLikePay(t.merchant) && !gigCategoryFor(t.merchant, t.amount));
}

export function installDeposits(app) {
  app.get('/api/deposits/review', (_req, res) => {
    const rows = toReview();
    res.json({ rows: rows.slice(0, 200), count: rows.length, total: Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100 });
  });
  // The household's answer for some or all of them: income (leave it, and don't ask again) or not (move to Other deposits).
  app.post('/api/deposits/review', (req, res) => {
    const waiting = new Set(toReview().map((r) => r.id));
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((id) => waiting.has(id));
    if (!ids.length) return res.status(400).json({ error: 'Nothing to change.' });
    if (typeof req.body?.income !== 'boolean') return res.status(400).json({ error: 'Say whether these are income.' });
    const set = req.body.income ? db.prepare('UPDATE transactions SET income_ok = 1 WHERE id = ?') : db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
    const dep = depositCategoryId();
    for (const id of ids) req.body.income ? set.run(id) : set.run(dep, id);
    res.json({ changed: ids.length });
  });
  // "It's income" on a row in Other deposits.
  app.post('/api/transactions/:id/income', (req, res) => {
    const income = db.prepare("SELECT id FROM categories WHERE COALESCE(key, name) = 'Income'").get()?.id;
    const r = db.prepare("UPDATE transactions SET category_id = ?, income_ok = 1 WHERE id = ? AND amount > 0").run(income, Number(req.params.id));
    if (!r.changes) return res.status(400).json({ error: "That isn't money in." });
    res.json({ ok: true });
  });
}
