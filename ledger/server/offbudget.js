// An account left out of the budget: "fun money" checking, a child's account, anything a household wants to
// see but not count (asked for by a friend of the owner's with joint accounts plus three personal ones,
// 2026-11-24).
//
// How it works. Nothing new is taught to the totals. Spending on such an account is filed under Transfer,
// which every total in the app already leaves out, the same way a health savings account's is. The
// category it would have had is kept in `transactions.acct_out`, so switching the account back restores it.
//
//   accounts.off_budget       1 = left out
//   transactions.acct_out     set on a row once this has looked at it: the category it had (for a row
//                             that was moved to Transfer), so each row is only ever moved once. A category
//                             chosen by hand afterwards therefore stays: that is how one purchase on a
//                             left-out account can be made to count.
//
// Only spending (and refunds of it) is moved. Money in filed as income stays income: pay that lands in a
// personal account is still pay, and the tax estimate needs it. Other deposits and transfers were never
// counted in the first place.
//
// New rows are caught by a trigger, so the bank sync, a file import, a typed purchase, a receipt, an Apple
// Pay report and the parts of a split all behave the same with no code of their own.
//
// The balance is untouched: the account still shows on the Accounts page and counts in net worth. A
// checking account left out is also left out of the checking forecast (server/cashflow.js), since money
// set aside for fun isn't there to pay bills.
//
//   PATCH /api/accounts/:id/budget   { out: true | false }
import { db } from './db.js';

const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!has('accounts', 'off_budget')) db.exec('ALTER TABLE accounts ADD COLUMN off_budget INTEGER NOT NULL DEFAULT 0');
if (!has('transactions', 'acct_out')) db.exec('ALTER TABLE transactions ADD COLUMN acct_out INTEGER');

const TRANSFER = "(SELECT id FROM categories WHERE kind = 'transfer' ORDER BY COALESCE(key, name) = 'Transfer' DESC, id LIMIT 1)";
db.exec(`
  CREATE TRIGGER IF NOT EXISTS tx_off_budget_ai AFTER INSERT ON transactions
  WHEN (SELECT off_budget FROM accounts WHERE id = NEW.account_id) = 1
  BEGIN
    UPDATE transactions SET acct_out = NEW.category_id,
      category_id = CASE WHEN (SELECT kind FROM categories WHERE id = NEW.category_id) = 'expense' THEN ${TRANSFER} ELSE NEW.category_id END
    WHERE id = NEW.id;
  END;`);

/** The kinds of account whose purchases count as spending, and so can be left out. */
export const CAN_LEAVE_OUT = ['checking', 'savings', 'credit'];

export function setOffBudget(id, out) {
  const acc = db.prepare('SELECT id, type, off_budget FROM accounts WHERE id = ?').get(id);
  if (!acc) return { status: 404, error: 'That account is no longer there.' };
  if (!CAN_LEAVE_OUT.includes(acc.type)) return { status: 400, error: "That kind of account already doesn't count toward spending." };
  if (!!acc.off_budget === !!out) return { ok: true, moved: 0 };
  let moved = 0;
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE accounts SET off_budget = ? WHERE id = ?').run(out ? 1 : 0, id);
    if (out) {
      // Every row is marked as looked at, with the category it has now; then spending moves to Transfer.
      // A tax claim is left alone: whether a purchase is deductible has nothing to do with whose pocket
      // it came from.
      db.prepare('UPDATE transactions SET acct_out = category_id WHERE account_id = ? AND acct_out IS NULL').run(id);
      moved = db.prepare(`UPDATE transactions SET category_id = ${TRANSFER} WHERE account_id = ? AND category_id = acct_out
        AND category_id IN (SELECT id FROM categories WHERE kind = 'expense')`).run(id).changes;
    } else {
      moved = db.prepare(`UPDATE transactions SET category_id = acct_out WHERE account_id = ? AND acct_out IS NOT NULL
        AND category_id = ${TRANSFER} AND acct_out != category_id AND acct_out IN (SELECT id FROM categories)`).run(id).changes;
      db.prepare('UPDATE transactions SET acct_out = NULL WHERE account_id = ?').run(id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { ok: true, moved };
}

export function installOffBudget(app) {
  app.patch('/api/accounts/:id/budget', (req, res) => {
    const r = setOffBudget(Number(req.params.id), !!req.body?.out);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json(r);
  });
}
