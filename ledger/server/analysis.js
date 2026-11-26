// The money review: what stands out in a household's money, worked out from its own history.
//
// Everything here is arithmetic. The figures, the comparisons and the list of things worth a look are all
// produced by this file from the transactions, with no AI involved, so the page works on a copy with no AI
// at all and says the same thing every time it is asked. Where the household has a model to write with
// (its own, Home Assistant's), that model is handed these finished figures and asked only to put them in
// plain words: it is never asked to find anything or to add anything up.
//
// The top half of the file is pure functions over plain lists, so they can be tested without a database
// (test/analysis.test.js). The bottom half reads the database and serves the page.
import { db, getSetting, setSetting, iso } from './db.js';
import { notPrivate, privateCats } from './ai.js';
import { viaPlain, plainAsk, plainRoute, aiName, plainWhere } from './plainai.js';
import { localModel } from './localai.js';
import { currencyNote } from './money.js';

const round = (n) => Math.round(n * 100) / 100;
const sum = (list) => list.reduce((a, b) => a + b, 0);
const mean = (list) => (list.length ? sum(list) / list.length : 0);
const median = (list) => { if (!list.length) return 0; const s = [...list].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthOf = (date) => date.slice(0, 7);
const addMonths = (month, n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const daysIn = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const keyOf = (merchant) => String(merchant || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Each category this month against its own usual (the average of up to six full months before).
 * `rows` are purchases: { date, category, fixed, amount } with money out as a positive `amount`.
 * A flexible category is projected to the month's end from its pace so far; a fixed one (rent, insurance)
 * is expected to come to its usual, since its bills land on set days.
 */
export function categoryTrends(rows, today) {
  const month = monthOf(today);
  const day = Number(today.slice(8)), days = daysIn(month);
  const elapsed = day / days;
  const cats = new Map();
  for (const r of rows) {
    const m = monthOf(r.date);
    if (m > month || m < addMonths(month, -6)) continue;
    const c = cats.get(r.category) || { category: r.category, fixed: !!r.fixed, months: {} };
    c.months[m] = (c.months[m] || 0) + r.amount;
    cats.set(r.category, c);
  }
  // Months before the household's first purchase aren't "a month with nothing spent".
  const first = rows.length ? monthOf(rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date)) : month;
  const past = [];
  for (let i = 1; i <= 6; i++) { const m = addMonths(month, -i); if (m >= first) past.push(m); }
  const out = [];
  for (const c of cats.values()) {
    const history = past.map((m) => c.months[m] || 0);
    const usual = mean(history);
    const spent = c.months[month] || 0;
    const projected = c.fixed ? Math.max(spent, usual) : elapsed > 0 ? spent / elapsed : spent;
    // Early in the month a pace means little: one grocery trip on the 2nd is not a trend.
    const settled = c.fixed || day >= 8;
    let state = 'usual';
    if (past.length >= 2 && usual > 0) {
      if (spent > usual * 1.15 && spent - usual >= 20) state = 'over';                      // already past a normal whole month
      else if (settled && projected > usual * 1.25 && projected - usual >= 25) state = 'high';
      else if (settled && elapsed >= 0.5 && projected < usual * 0.65 && usual - projected >= 25) state = 'low';
    } else if (past.length >= 2 && usual === 0 && spent >= 50) state = 'new';
    out.push({ category: c.category, fixed: c.fixed, spent: round(spent), usual: round(usual), projected: round(projected), months_compared: past.length, state });
  }
  return out.sort((a, b) => (b.projected - b.usual) - (a.projected - a.usual));
}

/** Where the whole month is heading: spent so far, the pace, and the usual. */
export function monthOutlook(rows, today, budget = 0) {
  const trends = categoryTrends(rows, today);
  const spent = round(sum(trends.map((t) => t.spent)));
  const projected = round(sum(trends.map((t) => t.projected)));
  const usual = round(sum(trends.map((t) => t.usual)));
  return { month: monthOf(today), day: Number(today.slice(8)), days_in_month: daysIn(monthOf(today)), spent, projected, usual, projected_against_usual: round(projected - usual), ...(budget > 0 ? { budget: round(budget), projected_against_budget: round(projected - budget) } : {}) };
}

/**
 * Purchases in the last `window` days that are unusually large for their shop: at least twice what the
 * household usually pays there and $30 more, judged against four or more earlier visits.
 */
export function unusualPurchases(rows, today, window = 30) {
  const since = addDays(today, -window);
  const by = new Map();
  for (const r of rows) { const k = keyOf(r.merchant); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const out = [];
  for (const list of by.values()) {
    const earlier = list.filter((r) => r.date < since).map((r) => r.amount);
    if (earlier.length < 4) continue;
    const typical = median(earlier);
    for (const r of list) {
      if (r.date < since || r.date > today) continue;
      if (r.amount >= typical * 2 && r.amount - typical >= 30) out.push({ date: r.date, merchant: r.merchant, amount: round(r.amount), usual_there: round(typical), times_usual: Math.round((r.amount / typical) * 10) / 10, category: r.category });
    }
  }
  return out.sort((a, b) => (b.amount - b.usual_there) - (a.amount - a.usual_there)).slice(0, 6);
}

/**
 * Charges that look doubled: the same shop, the same amount, the same account, on the same day or the next,
 * within the last `window` days. Shops where the household often pays the same price twice close together
 * (a coffee, a transit fare) are left out, as are amounts under $10.
 */
export function possibleDoubles(rows, today, window = 45) {
  const since = addDays(today, -window);
  const by = new Map();
  for (const r of rows) {
    if (r.amount < 10) continue;
    const k = `${keyOf(r.merchant)}|${r.amount.toFixed(2)}|${r.account ?? ''}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const out = [];
  for (const list of by.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const pairs = [];
    for (let i = 1; i < list.length; i++) if (daysBetween(list[i - 1].date, list[i].date) <= 1) pairs.push([list[i - 1], list[i]]);
    // A habit, not a mistake: it has happened three times or more.
    if (!pairs.length || pairs.length >= 3) continue;
    for (const [a, b] of pairs) if (b.date >= since && b.date <= today) out.push({ merchant: b.merchant, amount: round(b.amount), first: a.date, second: b.date, category: b.category });
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 5);
}

/**
 * Regular charges whose price has changed: a shop that charges about once a month, the same amount each
 * time, and whose latest charge differs from the one it had settled at by more than 3% and 50 cents.
 */
export function priceChanges(rows, today, window = 75) {
  const since = addDays(today, -window);
  const by = new Map();
  for (const r of rows) { const k = keyOf(r.merchant); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const out = [];
  for (const list of by.values()) {
    // One charge a month at most, or it isn't a subscription.
    const months = new Map();
    for (const r of list) months.set(monthOf(r.date), (months.get(monthOf(r.date)) || 0) + 1);
    if (months.size < 4 || [...months.values()].some((n) => n > 1)) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = list.at(-1);
    if (last.date < since || last.date > today) continue;
    const before = list.slice(-4, -1).map((r) => r.amount);
    const was = median(before);
    // The earlier charges have to agree with each other, or there was no settled price to change from.
    if (before.some((a) => Math.abs(a - was) > Math.max(0.5, was * 0.03))) continue;
    const diff = last.amount - was;
    if (Math.abs(diff) > Math.max(0.5, was * 0.03)) out.push({ merchant: last.merchant, was: round(was), now: round(last.amount), change: round(diff), a_year: round(diff * 12), since: last.date, category: last.category });
  }
  return out.sort((a, b) => Math.abs(b.a_year) - Math.abs(a.a_year)).slice(0, 6);
}

/** Shops the household first paid in the last `window` days, where it has spent $25 or more since. */
export function newMerchants(rows, today, window = 30) {
  const since = addDays(today, -window);
  const by = new Map();
  for (const r of rows) {
    if (r.date > today) continue;
    const k = keyOf(r.merchant);
    const m = by.get(k) || { merchant: r.merchant, first: r.date, total: 0, times: 0, category: r.category };
    if (r.date < m.first) m.first = r.date;
    m.total += r.amount; m.times++;
    by.set(k, m);
  }
  // With less than three months of history every shop is "new".
  const oldest = rows.length ? rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date) : today;
  if (daysBetween(oldest, today) < 90) return [];
  return [...by.values()].filter((m) => m.first >= since && m.total >= 25).map((m) => ({ merchant: m.merchant, first: m.first, total: round(m.total), times: m.times, category: m.category }))
    .sort((a, b) => b.total - a.total).slice(0, 6);
}

/** The last three full months against the three before, by category: where spending has moved most. */
export function quarterShift(rows, today) {
  const month = monthOf(today);
  const recent = [1, 2, 3].map((i) => addMonths(month, -i)), earlier = [4, 5, 6].map((i) => addMonths(month, -i));
  const first = rows.length ? monthOf(rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date)) : month;
  if (first > earlier[2]) return null;   // not six full months of history yet
  const cats = new Map();
  for (const r of rows) {
    const m = monthOf(r.date);
    const side = recent.includes(m) ? 'recent' : earlier.includes(m) ? 'earlier' : null;
    if (!side) continue;
    const c = cats.get(r.category) || { category: r.category, recent: 0, earlier: 0 };
    c[side] += r.amount;
    cats.set(r.category, c);
  }
  const list = [...cats.values()].map((c) => ({ category: c.category, a_month_lately: round(c.recent / 3), a_month_before: round(c.earlier / 3), change_a_month: round((c.recent - c.earlier) / 3) }));
  const total = { a_month_lately: round(sum(list.map((c) => c.a_month_lately))), a_month_before: round(sum(list.map((c) => c.a_month_before))) };
  total.change_a_month = round(total.a_month_lately - total.a_month_before);
  const moved = list.filter((c) => Math.abs(c.change_a_month) >= 20).sort((a, b) => b.change_a_month - a.change_a_month);
  return { months_lately: recent.reverse(), months_before: earlier.reverse(), total, up: moved.filter((c) => c.change_a_month > 0).slice(0, 4), down: moved.filter((c) => c.change_a_month < 0).reverse().slice(0, 4) };
}

/**
 * How old the money being spent is, in days, worked out the way YNAB's "Age of Money" is: every dollar that
 * comes in joins a queue, every dollar spent is taken from the front of it, and a purchase's age is how long
 * its dollars had waited. The answer is the average over the last ten days on which money was spent.
 * `flows` are { date, amount } with money in positive and money out negative, oldest first or not.
 * `opening` is the cash already on hand before the first of them (it is treated as arriving on that first day).
 * Returns null when there is too little to go on.
 */
export function ageOfMoney(flows, opening = 0) {
  const list = flows.filter((f) => f.amount).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  if (!list.length) return null;
  const queue = [];
  if (opening > 0) queue.push({ date: list[0].date, left: opening });
  const ages = new Map();   // spending day -> [dollars, dollar-days]
  for (const f of list) {
    if (f.amount > 0) { queue.push({ date: f.date, left: f.amount }); continue; }
    let need = -f.amount, dollars = 0, dollarDays = 0;
    while (need > 0.005 && queue.length) {
      const q = queue[0];
      const take = Math.min(q.left, need);
      dollars += take; dollarDays += take * daysBetween(q.date, f.date);
      q.left -= take; need -= take;
      if (q.left <= 0.005) queue.shift();
    }
    // Spent more than the queue held (a card, or history that starts mid-stream): that part has no age.
    if (dollars > 0) { const d = ages.get(f.date) || [0, 0]; d[0] += dollars; d[1] += dollarDays; ages.set(f.date, d); }
  }
  const days = [...ages.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-10);
  if (days.length < 5) return null;
  const dollars = sum(days.map(([, d]) => d[0]));
  return dollars > 0 ? Math.round(sum(days.map(([, d]) => d[1])) / dollars) : null;
}

/** The things worth a look, most important first, as short plain sentences. No AI: these are fixed wordings. */
export function highlights(r, money = (n) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) {
  const out = [];
  const add = (weight, kind, text) => out.push({ weight, kind, text });
  for (const d of r.doubles) add(90 + d.amount / 100, 'double', `${d.merchant} charged ${money(d.amount)} twice, on ${d.first} and ${d.second}. Worth checking that both are right.`);
  for (const p of r.price_changes) add(60 + Math.abs(p.a_year) / 10, 'price', `${p.merchant} went ${p.change > 0 ? 'up' : 'down'} from ${money(p.was)} to ${money(p.now)}: ${money(p.a_year)} ${p.change > 0 ? 'more' : 'less'} over a year.`);
  for (const t of r.categories.filter((c) => c.state === 'over')) add(70 + (t.spent - t.usual) / 20, 'over', `${t.category} is already at ${money(t.spent)}, past a usual whole month (${money(t.usual)}).`);
  for (const t of r.categories.filter((c) => c.state === 'high')) add(50 + (t.projected - t.usual) / 20, 'high', `${t.category} is on pace for ${money(t.projected)} this month against a usual ${money(t.usual)}.`);
  for (const u of r.unusual) add(45 + (u.amount - u.usual_there) / 20, 'unusual', `${money(u.amount)} at ${u.merchant} on ${u.date} is ${u.times_usual} times what you usually spend there (${money(u.usual_there)}).`);
  for (const t of r.categories.filter((c) => c.state === 'new')) add(35, 'new-category', `${t.category} has ${money(t.spent)} this month after months with nothing.`);
  for (const t of r.categories.filter((c) => c.state === 'low').slice(0, 2)) add(20 + (t.usual - t.projected) / 40, 'low', `${t.category} is running well under its usual: on pace for ${money(t.projected)} against ${money(t.usual)}.`);
  for (const m of r.new_merchants.slice(0, 3)) add(15 + m.total / 50, 'new-merchant', `New this month: ${m.merchant}, ${money(m.total)}${m.times > 1 ? ` over ${m.times} purchases` : ''}.`);
  if (r.quarter?.total && Math.abs(r.quarter.total.change_a_month) >= 50) {
    const q = r.quarter, lead = (q.total.change_a_month > 0 ? q.up : q.down)[0];
    add(40 + Math.abs(q.total.change_a_month) / 25, 'quarter', `Over the last three months you have spent ${money(q.total.change_a_month)} a month ${q.total.change_a_month > 0 ? 'more' : 'less'} than in the three before${lead ? `, mostly ${lead.category} (${money(lead.change_a_month)} a month ${lead.change_a_month > 0 ? 'more' : 'less'})` : ''}.`);
  }
  if (r.outlook.budget > 0 && r.outlook.day >= 8 && r.outlook.projected_against_budget >= 25) add(65 + r.outlook.projected_against_budget / 50, 'budget', `At this pace the month ends at ${money(r.outlook.projected)}, ${money(r.outlook.projected_against_budget)} over the budget of ${money(r.outlook.budget)}.`);
  if (r.cash?.days_covered != null && r.cash.days_covered < 30) add(55, 'cushion', `The cash on hand covers about ${r.cash.days_covered} days of your usual spending.`);
  return out.sort((a, b) => b.weight - a.weight).map(({ kind, text }) => ({ kind, text }));
}

/** The whole review from plain lists. `spending` rows have money out as positive amounts. */
export function buildReview({ spending, flows = [], cash = 0, budget = 0, today, income = [] }) {
  const categories = categoryTrends(spending, today);
  const outlook = monthOutlook(spending, today, budget);
  const since90 = addDays(today, -90);
  const spent90 = sum(spending.filter((r) => r.date >= since90 && r.date <= today).map((r) => r.amount));
  const history = spending.length ? Math.min(90, Math.max(1, daysBetween(spending.reduce((a, r) => (r.date < a ? r.date : a), spending[0].date), today))) : 0;
  const aDay = history >= 30 ? spent90 / history : 0;
  const month = monthOf(today);
  const last3 = [1, 2, 3].map((i) => addMonths(month, -i));
  const in3 = sum(income.filter((r) => last3.includes(monthOf(r.date))).map((r) => r.amount));
  const out3 = sum(spending.filter((r) => last3.includes(monthOf(r.date))).map((r) => r.amount));
  // The opening balance is whatever makes the flows end at today's cash: money that was already there.
  const net = sum(flows.map((f) => f.amount));
  const review = {
    as_of: today,
    outlook,
    categories: categories.filter((c) => c.state !== 'usual' || c.spent > 0 || c.usual > 0),
    unusual: unusualPurchases(spending, today),
    doubles: possibleDoubles(spending, today),
    price_changes: priceChanges(spending, today),
    new_merchants: newMerchants(spending, today),
    quarter: quarterShift(spending, today),
    cash: {
      on_hand: round(cash),
      usual_spending_a_day: round(aDay),
      days_covered: aDay > 0 && cash > 0 ? Math.round(cash / aDay) : null,
      age_of_money_days: ageOfMoney(flows, Math.max(0, cash - net)),
    },
    saving: in3 > 0 ? { months: [...last3].reverse(), income: round(in3), spending: round(out3), kept: round(in3 - out3), kept_percent: Math.round(((in3 - out3) / in3) * 100) } : null,
  };
  review.highlights = highlights(review);
  return review;
}

// ---- The database, the page and the model ----

/** Reads what the review needs. `forAi` leaves out the categories the household keeps away from its AI. */
export function moneyReview({ forAi = false, today = iso(new Date()), budget = 0 } = {}) {
  const from = `${addMonths(monthOf(today), -13)}-01`;
  const hide = forAi ? notPrivate('t.category_id') : '';
  const spending = db.prepare(`
    SELECT t.date, t.merchant, -t.amount amount, c.name category, c.fixed, t.account_id account
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND t.amount < 0 AND t.date >= ? AND t.date <= ?${hide}`).all(from, today);
  // Refunds lower a category's spending, as they do everywhere else in the app.
  const refunds = db.prepare(`
    SELECT t.date, t.merchant, -t.amount amount, c.name category, c.fixed, t.account_id account
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND t.amount > 0 AND t.date >= ? AND t.date <= ?${hide}`).all(from, today);
  const income = db.prepare(`
    SELECT t.date, t.amount FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'income' AND t.date >= ? AND t.date <= ?`).all(from, today);
  const cash = db.prepare("SELECT COALESCE(SUM(balance), 0) s FROM accounts WHERE type IN ('checking', 'savings', 'cash') AND COALESCE(off_budget, 0) = 0").get().s;
  const flows = [...income.map((r) => ({ date: r.date, amount: r.amount })), ...spending.map((r) => ({ date: r.date, amount: -r.amount })), ...refunds.map((r) => ({ date: r.date, amount: -r.amount }))];
  const review = buildReview({ spending, flows, cash, budget, today, income });
  // The totals count refunds; the shop-by-shop findings above look at purchases only.
  if (refunds.length) {
    const withRefunds = [...spending, ...refunds];
    review.categories = categoryTrends(withRefunds, today).filter((c) => c.state !== 'usual' || c.spent > 0 || c.usual > 0);
    review.outlook = monthOutlook(withRefunds, today, budget);
    review.quarter = quarterShift(withRefunds, today);
    review.highlights = highlights(review);
  }
  review.history_months = spending.length ? Math.max(0, daysBetween(spending.reduce((a, r) => (r.date < a ? r.date : a), spending[0].date), today) / 30.4) | 0 : 0;
  if (forAi && privateCats().length) review.note = 'Some categories are kept private by the household and are not in these figures.';
  return review;
}

const SYSTEM = `You are writing a short review of a household's money for the people who live in it. It appears inside Ledger, their own private finance app. Everything you need has already been worked out and is given below as figures: do not add anything up, do not estimate, and do not mention any figure, shop or category that is not in what you are given.

Write in plain everyday words, to "you". Three parts, each a short paragraph with no heading:
1. How this month is going against their usual, in a sentence or two, using outlook.spent, outlook.projected and outlook.projected_against_usual exactly as given (a negative projected_against_usual means below their usual).
2. The two to four things most worth their attention, most important first. Say what was seen and why it is worth a look. A charge that looks doubled or a subscription whose price went up comes before a category running a little high.
3. One or two things they could do about it this week, each specific to what was found (check a charge with the shop, look at a subscription, set a budget for a category). If nothing stands out, say so in one sentence and stop.

At most 170 words. No lists, no bold, no headings, no greeting and no sign-off. Do not give tax or investment advice. If the household has less than three months of history, say the review will sharpen as more months come in.`;

const inFlight = new Map();
async function written(review, force) {
  const key = `2|${review.as_of}|${plainRoute()}${plainRoute() === 'local' ? `:${localModel()}` : ''}|${review.highlights.length}|${review.outlook.spent}`;
  let cache = {};
  try { cache = JSON.parse(getSetting('review_cache', '{}')); } catch { /* start fresh */ }
  if (!force && cache[key]) return cache[key];
  if (inFlight.has(key)) return inFlight.get(key);
  const job = (async () => {
    const { highlights: found, ...figures } = review;
    const text = await plainAsk('the money review', `${SYSTEM}${currencyNote() ? '\n\n' + currencyNote() : ''}\n\nWhat Ledger found, most important first:\n${found.length ? found.map((h) => `- ${h.text}`).join('\n') : '- Nothing stands out.'}\n\nThe figures behind it:\n${JSON.stringify(figures, null, 1).slice(0, 30000)}`,
      'review', "this month's spending by category against your usual, and the purchases, price changes and new shops the review picked out");
    const result = { text, by: aiName(), where: plainWhere(), at: Date.now() };
    setSetting('review_cache', JSON.stringify(Object.fromEntries(Object.entries({ ...cache, [key]: result }).sort((a, b) => b[1].at - a[1].at).slice(0, 4))));
    return result;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

export function installAnalysis(app, deps = {}) {
  const budgetNow = () => { try { return Number(deps.summaryFor?.()?.budget) || 0; } catch { return 0; } };
  app.get('/api/review', (_req, res) => res.json({ ...moneyReview({ budget: budgetNow() }), canWrite: viaPlain(), aiName: aiName(), where: viaPlain() ? plainWhere() : '' }));
  // In the model's words. The figures it is given leave out the categories kept private.
  app.post('/api/review/written', async (req, res) => {
    if (!viaPlain()) return res.status(400).json({ error: 'Writing the review up needs a model of your own, or the AI in your Home Assistant, switched on in Settings. The findings above need neither.' });
    try { res.json(await written(moneyReview({ forAi: true, budget: budgetNow() }), !!req.body?.again)); } catch (e) { res.status(502).json({ error: e.message }); }
  });
}
