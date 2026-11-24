// Purchases entered by hand on a bank or card account are "waiting for the
// bank": they count toward spending straight away, and when the bank's own
// entry arrives it takes over the row (keeping the category, note and any tax
// claim) instead of being added a second time.
import { db } from './db.js';

/** A waiting entry older than this is shown as "not found at the bank". */
export const WAITING_DAYS = 10;

const FILLER = new Set(['the', 'and', 'inc', 'llc', 'store', 'pos', 'debit', 'card', 'purchase', 'payment', 'com', 'www']);
const words = (s) => new Set((String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !FILLER.has(w)));

/**
 * The waiting entry a bank transaction most likely is, or null.
 * Same account, entered up to ten days before the bank's date (or a day after).
 * The same amount is enough. A different amount is accepted only when the names
 * share a word and the bank's figure is close (5% under to 30% over, which
 * covers a tip added after the card was run).
 */
export function findWaiting(accountId, date, amount, merchant, skip = new Set()) {
  // A waiting purchase that was split (a receipt read into two or more categories) is matched by
  // its whole amount, and its parts are never matched by themselves.
  const rows = db.prepare(`SELECT id, date, amount + COALESCE((SELECT SUM(k.amount) FROM transactions k WHERE k.split_of = t.id), 0) amount, merchant FROM transactions t
    WHERE waiting = 1 AND split_of IS NULL AND account_id = ? AND date >= date(?, '-${WAITING_DAYS} days') AND date <= date(?, '+1 day')`).all(accountId, date, date);
  const theirs = words(merchant);
  let best = null;
  for (const r of rows) {
    if (skip.has(r.id) || r.amount * amount <= 0) continue;
    const exact = Math.abs(r.amount - amount) < 0.005;
    if (!exact) {
      const ratio = amount / r.amount;
      if (ratio < 0.95 || ratio > 1.3 || ![...words(r.merchant)].some((w) => theirs.has(w))) continue;
    }
    const score = (exact ? 0 : 100) + Math.abs(Date.parse(date) - Date.parse(r.date)) / 86400000;
    if (!best || score < best.score) best = { ...r, score };
  }
  return best;
}

/** Hand a waiting entry over to the bank's version of it. What you typed as the description is kept as the note if there wasn't one. */
export function settle(id, sfinId, date, amount, merchant) {
  // If it was split, the parts keep their amounts and the original takes what's left of the bank's
  // figure (so a tip added later lands on the original). Should the bank's amount be no more than
  // the parts, the split no longer makes sense and the purchase is put back together.
  const parts = db.prepare('SELECT COALESCE(SUM(amount), 0) s, COUNT(*) n FROM transactions WHERE split_of = ?').get(id);
  if (parts.n) {
    if (Math.abs(amount) - Math.abs(parts.s) > 0.005 && amount * parts.s > 0) {
      db.prepare('UPDATE transactions SET date = ?, merchant = ?, manual = 0, waiting = 0, pending = 0 WHERE split_of = ?').run(date, merchant, id);
      amount = Math.round((amount - parts.s) * 100) / 100;
    } else db.prepare('DELETE FROM transactions WHERE split_of = ?').run(id);
  }
  db.prepare(`UPDATE transactions SET sfin_id = ?, date = ?, amount = ?,
      notes = CASE WHEN notes = '' AND lower(merchant) != lower(?) THEN merchant ELSE notes END,
      merchant = ?, manual = 0, waiting = 0, pending = 0, settled_at = ? WHERE id = ?`).run(sfinId, date, amount, merchant, merchant, Date.now(), id);
}
