// Splitting a purchase across categories: one Walmart trip that was part groceries, part clothes.
//
// A split doesn't keep a separate list of parts. The original transaction stays where it is, with
// its amount reduced to what's left, and each part becomes a transaction of its own beside it
// (same account, date and merchant) carrying `split_of`, the original's id. So every total in the
// app (budgets, reports, the dashboard, tax claims) counts the parts with no changes, and each part
// can be recategorised or claimed like any other purchase. The original plus its parts always add
// up to what the bank charged.
//
// What keeps that true elsewhere:
//   - bank sync (server/simplefin.js) sets a split original to the bank's amount less its parts;
//   - a file import (server/importer.js) recognises a split purchase by its whole amount;
//   - "apply to every purchase from this merchant" leaves split purchases alone (server/index.js);
//   - removing an original you added by hand removes its parts too.
// A purchase the bank lists as pending can't be split: its row is replaced when it posts. One you
// entered yourself that is waiting for the bank can (since 2026-11-18; see server/waiting.js).
import { db } from './db.js';

if (!db.prepare("SELECT 1 FROM pragma_table_info('transactions') WHERE name = 'split_of'").get()) {
  db.exec('ALTER TABLE transactions ADD COLUMN split_of INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS tx_split_of ON transactions(split_of) WHERE split_of IS NOT NULL');
}

const round = (n) => Math.round(n * 100) / 100;
/** The total of a transaction's parts (0 when it isn't split). */
export const partsTotal = (id) => db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM transactions WHERE split_of = ?').get(id).s;

/** Puts a split purchase back together. Returns how many parts were merged. */
export function unsplit(id) {
  const total = partsTotal(id);
  const n = db.prepare('DELETE FROM transactions WHERE split_of = ?').run(id).changes;
  if (n) db.prepare('UPDATE transactions SET amount = ROUND(amount + ?, 2) WHERE id = ?').run(total, id);
  return n;
}

export function installSplits(app) {
  // parts: [{ category_id, amount }], each amount a positive share of the purchase. Whatever is
  // left stays on the original, in its own category.
  app.post('/api/transactions/:id/split', (req, res) => {
    let t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'That transaction is no longer there.' });
    if (t.split_of) t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(t.split_of);
    if (!t) return res.status(404).json({ error: 'That transaction is no longer there.' });
    // A purchase you entered that is waiting for the bank can be split (its parts wait with it, and
    // server/waiting.js hands the whole thing over when the bank's entry arrives). One the bank itself
    // lists as pending can't: that row is replaced when it posts.
    if (t.pending) return res.status(400).json({ error: 'This purchase is still pending at the bank. Split it once it has posted.' });
    const parts = Array.isArray(req.body?.parts) ? req.body.parts : [];
    if (!parts.length || parts.length > 8) return res.status(400).json({ error: 'Add between one and eight parts.' });
    const hasCat = db.prepare('SELECT 1 FROM categories WHERE id = ?');
    for (const p of parts) {
      if (!(Number(p?.amount) > 0)) return res.status(400).json({ error: 'Enter an amount above 0 for each part.' });
      if (!hasCat.get(Number(p.category_id))) return res.status(400).json({ error: 'Choose a category for each part.' });
    }
    const sign = t.amount < 0 ? -1 : 1;
    const whole = round(Math.abs(t.amount + partsTotal(t.id)));
    const already = round(Math.abs(partsTotal(t.id)));
    const taking = round(parts.reduce((a, p) => a + Number(p.amount), 0));
    if (taking + already > whole - 0.005) return res.status(400).json({ error: `The parts add up to ${(taking + already).toFixed(2)}, which is all or more of the ${whole.toFixed(2)} purchase. Leave something for the original category, or change its category instead.` });
    db.exec('BEGIN');
    try {
      const add = db.prepare('INSERT INTO transactions (account_id, date, merchant, amount, category_id, notes, manual, waiting, split_of) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const p of parts) add.run(t.account_id, t.date, t.merchant, sign * round(Number(p.amount)), Number(p.category_id), String(p.note || '').slice(0, 200), t.waiting ? 1 : 0, t.waiting ? 1 : 0, t.id);
      db.prepare('UPDATE transactions SET amount = ? WHERE id = ?').run(sign * round(whole - already - taking), t.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true, parts: db.prepare('SELECT COUNT(*) n FROM transactions WHERE split_of = ?').get(t.id).n });
  });

  app.post('/api/transactions/:id/unsplit', (req, res) => {
    const t = db.prepare('SELECT id, split_of FROM transactions WHERE id = ?').get(Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'That transaction is no longer there.' });
    res.json({ merged: unsplit(t.split_of || t.id) });
  });
}
