// The bank describes a loan payment by where it went ("Arkansas Federal
// External"), which says nothing about which loan it paid. When a payment out of
// a bank account matches one loan's regular payment and its lender, it is shown
// under the name that loan has on the Accounts page instead ("Toyota Rav4
// payment"), and the bank's wording is kept as the note.
import { db } from './db.js';

const GENERIC = new Set(['credit', 'union', 'bank', 'the', 'and', 'external', 'payment', 'loan', 'loans', 'login', 'center', 'online', 'transfer', 'debit', 'ach']);
const words = (s) => new Set((String(s).toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !GENERIC.has(w)));

const loans = () => db.prepare("SELECT id, name, institution, min_payment FROM accounts WHERE type IN ('auto', 'loan', 'mortgage') AND min_payment > 0").all();

/** The loan a payment belongs to, or null: the amount is that loan's regular payment and the names share a word. Null when two loans fit. */
export function loanFor(merchant, amount) {
  if (!(amount < 0)) return null;
  const theirs = words(merchant);
  const fits = loans().filter((l) => Math.abs(-amount - l.min_payment) < 0.005 && [...words(l.institution)].some((w) => theirs.has(w)));
  return fits.length === 1 ? fits[0] : null;
}
export const paymentName = (loan) => `${loan.name} payment`;

/** Gives payments already saved their loan's name. Safe to run again: renamed rows no longer match. */
export function nameLoanPayments() {
  const rows = db.prepare(`SELECT t.id, t.merchant, t.amount, t.notes, t.category_id FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.type IN ('checking', 'savings') AND t.amount < 0 AND t.waiting = 0 AND t.pending = 0`);
  const set = db.prepare("UPDATE transactions SET merchant = ?, notes = CASE WHEN notes = '' THEN ? ELSE notes END WHERE id = ?");
  const rule = db.prepare('INSERT OR IGNORE INTO rules (merchant, category_id) VALUES (?, ?)');
  const all = loans();
  if (!all.length) return 0;
  const amounts = new Set(all.map((l) => Math.round(l.min_payment * 100)));
  let n = 0;
  for (const r of rows.all()) {
    if (!amounts.has(Math.round(-r.amount * 100))) continue;
    const loan = loanFor(r.merchant, r.amount);
    if (!loan || r.merchant === paymentName(loan)) continue;
    set.run(paymentName(loan), r.merchant, r.id);
    // Keep whatever category these payments already had.
    rule.run(paymentName(loan), r.category_id);
    n++;
  }
  return n;
}
