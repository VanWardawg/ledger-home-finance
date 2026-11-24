// Graphs for the Debt page (The owner, 2026-11-23: "a click to show graph ... how much it's gone down with
// principal and interest"). Two things are served:
//
//   GET /api/debts/graph       every debt's balance from now to the day the last one is paid, under the
//                              payoff plan (smallest first, the mortgage last), for one stacked picture.
//   GET /api/debts/:id/graph   one debt: its balance so far and ahead, and what each year's payments go to.
//
// The past comes from two places. `balance_history` holds the balance the bank reported each day since the
// account was connected. `debt_history` holds payments split into principal and interest, loaded from a
// lender's own payment history when someone has one (a mortgage's five-year history, a student loan's);
// nothing fills it by itself. The future is plain arithmetic from the balance, rate and payment, including
// any standing extra, the same as the payoff dates on the page.
import { db } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS debt_history (
  account_id INTEGER NOT NULL, date TEXT NOT NULL, extra INTEGER NOT NULL DEFAULT 0,
  principal REAL NOT NULL DEFAULT 0, interest REAL NOT NULL DEFAULT 0, balance REAL,
  PRIMARY KEY (account_id, date, extra))`);

const round = (n) => Math.round(n * 100) / 100;
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthAfter = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d; };

/** One debt paid at a fixed amount a month: the balance after each month, and each month's principal and interest. */
function schedule(balance, apr, payment, cap = 720) {
  const out = [];
  let bal = balance;
  for (let m = 1; m <= cap && bal > 0.005; m++) {
    const interest = (bal * apr) / 1200;
    const pay = Math.min(bal + interest, payment);
    if (pay <= interest + 0.005 && m > 1) return { rows: out, never: true };
    bal = bal + interest - pay;
    out.push({ m, balance: round(Math.max(0, bal)), principal: round(pay - interest), interest: round(interest) });
  }
  return { rows: out, never: false };
}

const dollars = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/**
 * "What stands out" under a debt's graph (The owner, 2026-11-23, in place of an AI summary): up to four plain
 * facts worked out from the statements loaded for it. Facts only: no advice, nothing about what to pay
 * first. Each needs enough history to be true, so a debt with little loaded says little or nothing.
 */
export function standOut(d, hist, today = new Date()) {
  const s = hist.filter((h) => !h.extra && h.balance != null);
  if (s.length < 3) return [];
  const out = [];
  const card = d.type === 'credit';
  const year = today.getFullYear();

  // 1. Where it stands against about six months ago.
  const sixAgo = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate());
  const then = s.filter((h) => new Date(`${h.date}T12:00:00`) <= sixAgo).pop() || (s.length >= 4 ? s[0] : null);
  if (then && then.balance > 0) {
    const diff = d.balance - then.balance;
    if (Math.abs(diff) < Math.max(25, then.balance * 0.01)) out.push(`About where it was in ${monthName(then.date)} (${dollars(then.balance)}).`);
    else out.push(`${diff < 0 ? 'Down' : 'Up'} ${dollars(Math.abs(diff))} since ${monthName(then.date)}, when it was ${dollars(then.balance)}.`);
  }

  // 2. Interest this year, and which way it is going.
  const mine = hist.filter((h) => h.date.startsWith(String(year)));
  const interest = mine.reduce((a, h) => a + (h.interest || 0), 0);
  if (interest > 0.5) {
    const avg = (rows) => rows.reduce((a, h) => a + (h.interest || 0), 0) / rows.length;
    let trend = '';
    if (s.length >= 6) {
      const late = avg(s.slice(-3)), early = avg(s.slice(-6, -3));
      if (late > early * 1.15 && late - early > 3) trend = ` It is rising: about ${dollars(late)} a month lately, up from ${dollars(early)}.`;
      else if (late < early * 0.85 && early - late > 3) trend = ` It is falling: about ${dollars(late)} a month lately, down from ${dollars(early)}.`;
    }
    out.push(`Interest so far in ${year}: ${dollars(interest)}.${trend}`);
  } else if (card && mine.length >= 3) {
    out.push(`No interest charged so far in ${year}.`);
  }

  // 3. Cards: how often the statement was cleared, and how often nothing was paid.
  if (card) {
    const pairs = s.slice(-13).map((h, i, a) => (i ? { prev: a[i - 1].balance, paid: h.principal || 0 } : null)).filter((p) => p && p.prev > 0.5);
    if (pairs.length >= 3) {
      const full = pairs.filter((p) => p.paid >= p.prev - 0.01).length;
      const none = pairs.filter((p) => p.paid < 0.01).length;
      if (full === pairs.length) out.push(`Paid in full after every one of the last ${pairs.length} statements.`);
      else if (full > 0) out.push(`Paid in full after ${full} of the last ${pairs.length} statements.`);
      if (none > 0) out.push(`No payment was made in ${none} of the last ${pairs.length} statement periods.`);
    }
    const top = Math.max(...s.map((h) => h.balance));
    if (s.length >= 6 && d.balance > 0 && d.balance >= top - 0.01) out.push(`What you owe today is the most in the ${s.length} months on record.`);
  } else {
    // 4. Loans: how much of each payment now reaches the principal.
    const share = (h) => (h.principal + h.interest > 0 ? Math.round((h.principal / (h.principal + h.interest)) * 100) : null);
    const paying = s.filter((h) => h.principal > 0 && h.interest > 0);
    if (paying.length >= 6) {
      const first = share(paying[0]), last = share(paying[paying.length - 1]);
      if (first != null && last != null && Math.abs(last - first) >= 2) out.push(`Of each payment, ${last}% now goes to principal. It was ${first}% in ${monthName(paying[0].date)}.`);
      else if (last != null) out.push(`Of each payment, about ${last}% goes to principal and the rest to interest.`);
    }
  }
  return out.slice(0, 4);
}

export function installDebtGraph(app, { debtPlan }) {
  // Everything together, under the plan: minimums (with any standing extra) on all, the spare money to the
  // smallest balance first, and once those are gone, to the mortgage.
  app.get('/api/debts/graph', (_req, res) => {
    const p = debtPlan();
    const live = p.debts.filter((d) => d.status === 'ok');
    const order = [...live.filter((d) => d.order).sort((a, b) => a.order - b.order), ...live.filter((d) => !d.order)];
    const bal = order.map((d) => d.balance);
    const pay = order.map((d) => d.min_payment + (d.extra_monthly || 0));
    const months = [ym(monthAfter(0))];
    const series = order.map((d, i) => ({ id: d.id, name: d.name, type: d.type, values: [round(bal[i])] }));
    let debtFree = null;
    for (let m = 1; m <= 480 && bal.some((b) => b > 0.005); m++) {
      let pool = p.extra;
      order.forEach((d, i) => {
        // A finished payment rolls on to the next debt, except a minimum-only loan's, which was never part of the pool.
        if (bal[i] <= 0.005) return void (pool += d.min_only ? 0 : pay[i]);
        bal[i] += (bal[i] * d.apr) / 1200;
        bal[i] -= Math.min(bal[i], pay[i]);
      });
      for (let i = 0; i < order.length && pool > 0.005; i++) {
        if (bal[i] <= 0.005 || order[i].min_only) continue;
        const x = Math.min(bal[i], pool); bal[i] -= x; pool -= x;
      }
      // A point every three months keeps the picture light; the last month is always there.
      const done = !bal.some((b) => b > 0.005);
      if (m % 3 === 0 || done) { months.push(ym(monthAfter(m))); series.forEach((s, i) => s.values.push(round(Math.max(0, bal[i])))); }
      if (done) debtFree = ym(monthAfter(m));
    }
    res.json({ months, series, debtFree, total: round(order.reduce((a, d) => a + d.balance, 0)), waiting: p.debts.filter((d) => d.status === 'missing').map((d) => d.name) });
  });

  app.get('/api/debts/:id/graph', (req, res) => {
    const p = debtPlan();
    const d = p.debts.find((x) => x.id === Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'That debt is no longer there.' });
    // What has happened: the balance by month, from the lender's history where there is one and the bank's
    // daily figures since the account was connected.
    const hist = db.prepare('SELECT date, extra, principal, interest, balance FROM debt_history WHERE account_id = ? ORDER BY date, extra').all(d.id);
    const byMonth = new Map();
    for (const h of hist) if (h.balance != null) byMonth.set(h.date.slice(0, 7), round(h.balance));
    for (const b of db.prepare('SELECT date, balance FROM balance_history WHERE account_id = ? ORDER BY date').all(d.id)) byMonth.set(b.date.slice(0, 7), round(Math.abs(b.balance)));
    const now = ym(new Date());
    if (d.balance > 0) byMonth.set(now, d.balance);
    const past = [...byMonth.entries()].sort().map(([month, balance]) => ({ month, balance }));

    // What is ahead, at the payment as it is made today, and at the regular payment alone when there is an extra.
    const ready = d.status === 'ok';
    const mine = ready ? schedule(d.balance, d.apr, d.min_payment + (d.extra_monthly || 0)) : { rows: [], never: false };
    const plain = ready && d.extra_monthly > 0 ? schedule(d.balance, d.apr, d.min_payment) : null;
    const ahead = (s) => s.rows.filter((r) => r.m % (s.rows.length > 120 ? 3 : 1) === 0 || r.m === s.rows.length).map((r) => ({ month: ym(monthAfter(r.m)), balance: r.balance }));

    // Each year's payments: what went (or will go) to principal and what to interest.
    const years = new Map();
    const year = (y) => years.get(y) || years.set(y, { year: y, principal: 0, interest: 0, projPrincipal: 0, projInterest: 0 }).get(y);
    for (const h of hist) { const y = year(Number(h.date.slice(0, 4))); y.principal += h.principal; y.interest += h.interest; }
    for (const r of mine.rows) { const y = year(monthAfter(r.m).getFullYear()); y.projPrincipal += r.principal; y.projInterest += r.interest; }
    const yearRows = [...years.values()].sort((a, b) => a.year - b.year).map((y) => ({ year: y.year, principal: round(y.principal), interest: round(y.interest), projPrincipal: round(y.projPrincipal), projInterest: round(y.projInterest) }));
    const sum = (rows, k) => round(rows.reduce((a, r) => a + r[k], 0));
    res.json({
      id: d.id, name: d.name, type: d.type, balance: d.balance, apr: d.apr, payment: d.min_payment, extra: d.extra_monthly || 0, ready, never: mine.never,
      past, future: ahead(mine), regular: plain ? ahead(plain) : null, years: yearRows,
      paid: hist.length ? { principal: sum(hist, 'principal'), interest: sum(hist, 'interest'), since: hist[0].date } : null,
      toCome: ready && !mine.never ? { interest: sum(mine.rows, 'interest'), months: mine.rows.length, payoff: mine.rows.length ? ym(monthAfter(mine.rows.length)) : now } : null,
      regularToCome: plain && !plain.never ? { interest: sum(plain.rows, 'interest'), months: plain.rows.length, payoff: ym(monthAfter(plain.rows.length)) } : null,
      // Under the payoff plan this debt may go sooner than at its own payment, once smaller ones are cleared.
      planMonths: d.planMonths ?? null,
      notes: standOut(d, hist),
    });
  });
}
