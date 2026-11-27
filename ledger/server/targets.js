// Targets for a category.
//
// A budget says what a category may spend. A target says what it should be given: rent needs $1,400
// every month, the car insurance needs $900 by March, the grocery money should be back up to $600 at the
// start of each month. With a target set, the Budgets page says each month how much the category still
// needs, and one press gives it that.
//
// Three kinds:
//   monthly   set aside `amount` every month
//   by_date   have `amount` saved up by the month `due` ('YYYY-MM'); the rest is spread over the months left
//   refill    have `amount` to spend each month: whatever was left from before is topped up to it
//
// A target never moves money by itself and never changes a total. It is worked out from what the Budgets
// page already knows about a category in a month:
//   base    what it is given this month (the monthly budget; in "give every dollar a job", this month's amount)
//   carry   what it brought in from earlier months (only for a category that carries over, or in that mode)
//
//   table   category_targets (category_id, kind, amount, due)
import { db } from './db.js';
import { zeroFor, zeroOn } from './zero.js';
import { setRollover } from './rollover.js';

db.exec('CREATE TABLE IF NOT EXISTS category_targets (category_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, amount REAL NOT NULL, due TEXT)');

const round = (n) => Math.round(n * 100) / 100;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const KINDS = ['monthly', 'by_date', 'refill'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** Months from `month` to `due`, counting both. 1 when they are the same month; 0 or less once `due` has passed. */
export function monthsLeft(month, due) {
  const [y, m] = month.split('-').map(Number), [dy, dm] = due.split('-').map(Number);
  return (dy - y) * 12 + (dm - m) + 1;
}

/**
 * Where one target stands in one month.
 *   per     what the category should be given this month to stay on course
 *   need    how much of that it has not been given yet
 *   met     nothing more is needed this month
 *   reached (by_date) the whole amount is already there
 *   late    (by_date) the month it was due has passed
 */
export function targetState(target, { month, base = 0, carry = 0 }) {
  const amount = Number(target.amount) || 0;
  let per = amount, months = null, late = false, reached = false;
  if (target.kind === 'by_date') {
    months = monthsLeft(month, target.due);
    late = months < 1;
    reached = carry + base >= amount - 0.005;
    per = Math.max(0, (amount - carry) / Math.max(1, months));
  } else if (target.kind === 'refill') {
    per = Math.max(0, amount - carry);
  }
  per = round(per);
  const need = round(Math.max(0, per - base));
  return { kind: target.kind, amount: round(amount), due: target.due || null, per, need, met: need < 0.005, months: months === null ? null : Math.max(0, months), late, reached };
}

/** Every target, by category id. A target whose category has gone is cleared away first. */
export function listTargets() {
  db.exec('DELETE FROM category_targets WHERE category_id NOT IN (SELECT id FROM categories)');
  return Object.fromEntries(db.prepare('SELECT category_id, kind, amount, due FROM category_targets').all().map((t) => [t.category_id, { ...t }]));
}

/**
 * Adds `target` to each of a month's categories that has one. The categories are the ones summaryFor()
 * (server/index.js) has just worked out, so `base`, `carry`, `zero` and `rollover` are already on them.
 * `keeps` says whether what the category is given stays with it into later months; saving up by a date
 * and topping up both depend on that.
 */
export function attachTargets(categories, month) {
  const all = listTargets();
  for (const c of categories) {
    const t = all[c.id];
    if (!t) continue;
    const keeps = !!c.zero || !!c.rollover;
    c.target = { ...targetState(t, { month, base: c.base ?? c.budget ?? 0, carry: keeps ? c.carry || 0 : 0 }), keeps };
  }
  return categories;
}

/** Sets or replaces a category's target. Returns { carryOn: true } when carrying over was switched on for it. */
export function setTarget(categoryId, { kind, amount, due } = {}) {
  const cat = db.prepare('SELECT id, kind, rollover FROM categories WHERE id = ?').get(Number(categoryId));
  if (!cat) throw fail('That category is no longer there.', 404);
  if (cat.kind !== 'expense') throw fail('Only spending categories have targets.');
  if (!KINDS.includes(kind)) throw fail('Choose what kind of target this is.');
  const n = Number(amount);
  if (amount === '' || amount === null || !Number.isFinite(n) || n <= 0 || n > 1e7) throw fail('Enter an amount above 0.');
  if (kind === 'by_date' && !MONTH.test(String(due || ''))) throw fail('Choose the month to have it by.');
  db.prepare('INSERT INTO category_targets (category_id, kind, amount, due) VALUES (?,?,?,?) ON CONFLICT(category_id) DO UPDATE SET kind = excluded.kind, amount = excluded.amount, due = excluded.due')
    .run(cat.id, kind, round(n), kind === 'by_date' ? String(due) : null);
  // Saving up and topping up only mean something if what is set aside stays in the category. With set
  // monthly budgets that is the "Carry over" switch, so it goes on with the target (and is said on the page).
  let carryOn = false;
  if (kind !== 'monthly' && !zeroOn() && !cat.rollover) { setRollover(cat.id, true); carryOn = true; }
  return { carryOn };
}

export function removeTarget(categoryId) {
  return Number(db.prepare('DELETE FROM category_targets WHERE category_id = ?').run(Number(categoryId)).changes);
}

/**
 * "Give every dollar a job" only: hands each category what its target still needs this month, in the
 * order of the page, from the money waiting to be assigned and no further. Says what it could not cover.
 */
export function fillTargets(month) {
  const z = zeroFor(month);
  if (!z) throw fail('This works while "give every dollar a job" is on, for a month since it began.');
  const all = listTargets();
  let left = Math.max(0, z.toAssign), given = 0, funded = 0, short = 0;
  const put = db.prepare('INSERT INTO zero_assign (month, category_id, amount) VALUES (?,?,?) ON CONFLICT(month, category_id) DO UPDATE SET amount = excluded.amount');
  for (const c of db.prepare("SELECT id FROM categories WHERE kind = 'expense' ORDER BY sort").all()) {
    const t = all[c.id], now = z.cats[c.id];
    if (!t || !now) continue;
    const { need } = targetState(t, { month, base: now.assigned, carry: now.carryIn });
    if (need < 0.005) continue;
    const give = round(Math.min(need, left));
    if (give >= 0.005) { put.run(month, c.id, round(now.assigned + give)); left = round(left - give); given = round(given + give); }
    if (give >= need - 0.005) funded++; else short = round(short + need - give);
  }
  return { funded, given, short };
}

export function installTargets(app) {
  const reply = (res, work) => { try { res.json({ ok: true, ...(work() || {}) }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.put('/api/categories/:id/target', (req, res) => reply(res, () => setTarget(req.params.id, req.body || {})));
  app.delete('/api/categories/:id/target', (req, res) => reply(res, () => ({ removed: removeTarget(req.params.id) })));
  app.post('/api/targets/fill', (req, res) => reply(res, () => fillTargets(String(req.body?.month || ''))));
}
