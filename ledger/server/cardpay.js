// Money set aside to pay each credit card.
//
// A purchase on a card comes out of its category the day it is made, but the money leaves checking only
// when the card is paid. In between it is easy to lose sight of: the grocery money looks spent, the
// checking balance looks healthy, and nothing says that part of that balance already belongs to the card.
// This works it out for each card, so the Budgets page can say "you owe $1,240 on this card and $900 is
// set aside for it".
//
// In both ways of budgeting, for a month: what was charged to the card in spending categories, what was
// paid to it, and (for the current month) what is owed today.
//
// With "give every dollar a job" on (server/zero.js) there is more, counted from the month it began:
//
//   set aside = card purchases your categories had money for
//             + what you assigned to the card itself (to pay down what was already owed)
//             - payments made to the card
//
// A category's purchases are "had money for" up to what the category has been given in all. Ledger carries
// overspending forward inside the category, so giving it more next month covers last month's card purchases
// too. Where a category is overspent and was used from more than one account, the shortfall is shared in
// proportion.
//
// Money assigned to a card is taken out of "to be assigned" like any other assignment (server/zero.js does
// that sum). Nothing here moves money or changes a transaction.
//
//   table   card_assign (month, account_id, amount)   made in server/zero.js, beside zero_assign
import { db, iso } from './db.js';
import { zeroFor, zeroOn } from './zero.js';

const round = (n) => Math.round(n * 100) / 100;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const next = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
const thisMonth = () => iso(new Date()).slice(0, 7);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/**
 * How much of one category's card purchases the category had money for.
 *   spent      everything spent in the category, on any account
 *   onCard     the part of that charged to this card
 *   assigned   everything the category has been given
 */
export function coveredOnCard({ spent, onCard, assigned }) {
  if (!(spent > 0) || !(onCard > 0)) return 0;
  const covered = Math.max(0, Math.min(spent, assigned));
  return round(covered * Math.min(onCard, spent) / spent);
}

// Purchases less refunds, in spending categories, by category.
const SPENT = `SELECT t.category_id id, -SUM(t.amount) s FROM transactions t JOIN categories c ON c.id = t.category_id
  WHERE c.kind = 'expense' AND t.date >= ? AND t.date < ?`;
// Money in on a card that is filed as a transfer: a payment (the same test the Debt page uses).
const PAID = `SELECT COALESCE(SUM(t.amount), 0) s FROM transactions t JOIN categories c ON c.id = t.category_id
  WHERE t.account_id = ? AND t.amount > 0 AND c.kind = 'transfer' AND COALESCE(c.key, c.name) != 'Deposit' AND t.date >= ? AND t.date < ?`;

/** Every credit card that counts toward the budget, and where its payment stands in `month`. */
export function cardsFor(monthArg) {
  const month = MONTH.test(String(monthArg)) ? String(monthArg) : thisMonth();
  const mStart = `${month}-01`, mEnd = `${next(month)}-01`;
  const current = month === thisMonth();
  const z = zeroFor(month);
  const first = z ? `${z.from}-01` : null;
  const byCat = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.s]));
  const spentAll = z ? byCat(db.prepare(`${SPENT} GROUP BY t.category_id`).all(first, mEnd)) : {};
  const assigned = z ? byCat(db.prepare('SELECT category_id id, SUM(amount) s FROM zero_assign WHERE month >= ? AND month <= ? GROUP BY category_id').all(z.from, month)) : {};
  const cards = db.prepare("SELECT id, name, institution, balance FROM accounts WHERE type = 'credit' AND COALESCE(off_budget, 0) = 0 ORDER BY name").all().map((a) => {
    const onCard = (from, to) => db.prepare(`${SPENT} AND t.account_id = ? GROUP BY t.category_id`).all(from, to, a.id);
    const paid = (from, to) => db.prepare(PAID).get(a.id, from, to).s;
    const card = {
      id: a.id, name: a.name, institution: a.institution,
      charged: round(onCard(mStart, mEnd).reduce((s, r) => s + r.s, 0)),
      paid: round(paid(mStart, mEnd)),
      owed: current ? round(Math.max(0, -a.balance)) : null,
    };
    if (!z) return card;
    const fromSpending = round(onCard(first, mEnd).reduce((s, r) => s + coveredOnCard({ spent: spentAll[r.id] || 0, onCard: r.s, assigned: assigned[r.id] || 0 }), 0));
    const given = db.prepare('SELECT COALESCE(SUM(amount), 0) all_, COALESCE(SUM(CASE WHEN month = ? THEN amount END), 0) now FROM card_assign WHERE account_id = ? AND month >= ? AND month <= ?').get(month, a.id, z.from, month);
    const setAside = round(fromSpending + given.all_ - paid(first, mEnd));
    return {
      ...card, fromSpending, assigned: round(given.all_), assignedNow: round(given.now), setAside,
      // More has been paid than was set aside: money has left checking that the budget still thinks is free.
      overpaid: round(Math.max(0, -setAside)),
      // What is owed today and has nothing set aside for it (only known for the current month).
      short: current ? round(Math.max(0, -a.balance - Math.max(0, setAside))) : null,
    };
  });
  return { month, zero: !!z, current, cards };
}

/** Sets what one card is given in one month, on top of what its purchases bring. "Give every dollar a job" only. */
export function assignToCard(accountId, monthArg, amount) {
  const month = String(monthArg || '');
  if (!zeroOn() || !zeroFor(month)) throw fail('This works while "give every dollar a job" is on, for a month since it began.');
  const acc = db.prepare("SELECT id FROM accounts WHERE id = ? AND type = 'credit' AND COALESCE(off_budget, 0) = 0").get(Number(accountId));
  if (!acc) throw fail('Choose one of your credit cards.', 404);
  const n = Number(amount);
  if (amount === '' || amount === null || !Number.isFinite(n) || n < 0 || n > 1e7) throw fail('Enter an amount, 0 or more.');
  db.prepare('INSERT INTO card_assign (month, account_id, amount) VALUES (?,?,?) ON CONFLICT(month, account_id) DO UPDATE SET amount = excluded.amount').run(month, acc.id, round(n));
}

export function installCardPay(app) {
  app.get('/api/cards', (req, res) => res.json(cardsFor(req.query.month)));
  app.put('/api/cards/:id/assign', (req, res) => {
    try { assignToCard(req.params.id, req.body?.month, req.body?.amount); res.json(cardsFor(req.body?.month)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}
