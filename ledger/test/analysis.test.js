// The money review's arithmetic, on small made-up histories. No database, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// analysis.js opens the database when it is loaded, so it is pointed at an empty one first.
process.env.LEDGER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
process.env.LEDGER_FRESH = '1';
const { categoryTrends, monthOutlook, unusualPurchases, possibleDoubles, priceChanges, newMerchants, quarterShift, ageOfMoney, buildReview, highlights } = await import('../server/analysis.js');

const buy = (date, merchant, amount, category = 'Groceries', extra = {}) => ({ date, merchant, amount, category, fixed: 0, account: 1, ...extra });
/** One purchase on the 10th of each of the `n` months before 2026-11, plus anything given for November. */
const monthly = (merchant, amount, category, n = 6, extra = {}) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9 - i, 10));
  return buy(d.toISOString().slice(0, 10), merchant, typeof amount === 'function' ? amount(i) : amount, category, extra);
});

test('a category already past its usual whole month is "over"', () => {
  const rows = [...monthly('Kroger', 400, 'Groceries'), buy('2026-11-05', 'Kroger', 300), buy('2026-11-12', 'Kroger', 250)];
  const g = categoryTrends(rows, '2026-11-15').find((c) => c.category === 'Groceries');
  assert.equal(g.usual, 400);
  assert.equal(g.spent, 550);
  assert.equal(g.state, 'over');
});

test('a flexible category is projected from its pace; a fixed one is expected to come to its usual', () => {
  const rows = [...monthly('Kroger', 600, 'Groceries'), buy('2026-11-10', 'Kroger', 450),
    ...monthly('Landlord', 1500, 'Rent', 6, { fixed: 1 })];
  const t = categoryTrends(rows, '2026-11-15');
  const g = t.find((c) => c.category === 'Groceries'), r = t.find((c) => c.category === 'Rent');
  assert.equal(g.projected, 900);          // 450 by day 15 of 30
  assert.equal(g.state, 'high');
  assert.equal(r.spent, 0);
  assert.equal(r.projected, 1500);         // not "running low": the rent simply hasn't landed yet
  assert.equal(r.state, 'usual');
});

test('nothing is called a trend in the first week of a month', () => {
  const rows = [...monthly('Kroger', 300, 'Groceries'), buy('2026-11-02', 'Kroger', 120)];
  assert.equal(categoryTrends(rows, '2026-11-03')[0].state, 'usual');
});

test('months before the first purchase are not counted as months with nothing spent', () => {
  const rows = [buy('2026-09-10', 'Kroger', 300), buy('2026-10-10', 'Kroger', 300), buy('2026-11-10', 'Kroger', 100)];
  const g = categoryTrends(rows, '2026-11-20')[0];
  assert.equal(g.months_compared, 2);
  assert.equal(g.usual, 300);
});

test('the outlook adds the categories up and compares with the budget', () => {
  const rows = [...monthly('Kroger', 600, 'Groceries'), buy('2026-11-10', 'Kroger', 450)];
  const o = monthOutlook(rows, '2026-11-15', 700);
  assert.deepEqual([o.spent, o.projected, o.usual, o.projected_against_usual, o.projected_against_budget], [450, 900, 600, 300, 200]);
});

test('a purchase far above what is usual at that shop is picked out', () => {
  const rows = [...monthly('Costco', 80, 'Groceries'), buy('2026-11-08', 'Costco', 310), buy('2026-11-09', 'Costco', 95)];
  const u = unusualPurchases(rows, '2026-11-20');
  assert.equal(u.length, 1);
  assert.deepEqual([u[0].amount, u[0].usual_there, u[0].times_usual], [310, 80, 3.9]);
});

test('a shop with too little history has nothing unusual', () => {
  const rows = [buy('2026-08-01', 'Newplace', 20), buy('2026-11-08', 'Newplace', 500)];
  assert.equal(unusualPurchases(rows, '2026-11-20').length, 0);
});

test('the same charge twice on one day is flagged; a habit of it is not; small amounts are not', () => {
  const twice = [buy('2026-11-10', 'Hotel Uno', 212.4, 'Travel'), buy('2026-11-10', 'Hotel Uno', 212.4, 'Travel')];
  assert.equal(possibleDoubles(twice, '2026-11-20').length, 1);
  const habit = ['2026-09-01', '2026-10-01', '2026-11-01'].flatMap((d) => [buy(d, 'Parking', 12), buy(d, 'Parking', 12)]);
  assert.equal(possibleDoubles(habit, '2026-11-20').length, 0);
  const coffee = [buy('2026-11-10', 'Cafe', 4.5), buy('2026-11-10', 'Cafe', 4.5)];
  assert.equal(possibleDoubles(coffee, '2026-11-20').length, 0);
  const otherCard = [buy('2026-11-10', 'Hotel Uno', 212.4, 'Travel'), buy('2026-11-10', 'Hotel Uno', 212.4, 'Travel', { account: 2 })];
  assert.equal(possibleDoubles(otherCard, '2026-11-20').length, 0);
});

test('a subscription whose price went up is found, with what it adds over a year', () => {
  const rows = [...monthly('Streamly', 15.99, 'Subscriptions'), buy('2026-11-10', 'Streamly', 18.99, 'Subscriptions')];
  const p = priceChanges(rows, '2026-11-20');
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].was, p[0].now, p[0].change, p[0].a_year], [15.99, 18.99, 3, 36]);
});

test('a bill that always varies is not a price change', () => {
  const rows = [...monthly('Electric Co', (i) => 80 + i * 13, 'Bills'), buy('2026-11-10', 'Electric Co', 140, 'Bills')];
  assert.equal(priceChanges(rows, '2026-11-20').length, 0);
});

test('new shops are named only once there is enough history to know they are new', () => {
  const old = [...monthly('Kroger', 300, 'Groceries'), buy('2026-11-12', 'Garden Centre', 140, 'Shopping')];
  assert.deepEqual(newMerchants(old, '2026-11-20').map((m) => m.merchant), ['Garden Centre']);
  const young = [buy('2026-11-01', 'Kroger', 300), buy('2026-11-12', 'Garden Centre', 140, 'Shopping')];
  assert.equal(newMerchants(young, '2026-11-20').length, 0);
});

test('the last three months are compared with the three before', () => {
  const rows = monthly('Kroger', (i) => (i < 3 ? 500 : 350), 'Groceries');
  const q = quarterShift(rows, '2026-11-20');
  assert.deepEqual(q.months_lately, ['2026-08', '2026-09', '2026-10']);
  assert.equal(q.total.change_a_month, 150);
  assert.equal(q.up[0].category, 'Groceries');
  assert.equal(quarterShift(rows.slice(0, 3), '2026-11-20'), null);   // under six months: nothing to compare
});

test('age of money: dollars are spent oldest first', () => {
  // 1,000 arrives on the 1st. 100 is spent on each of the next ten days: every dollar spent came from the 1st.
  const flows = [{ date: '2026-01-01', amount: 1000 }, ...Array.from({ length: 10 }, (_, i) => ({ date: `2026-01-${String(i + 2).padStart(2, '0')}`, amount: -100 }))];
  assert.equal(ageOfMoney(flows), 6);   // the mean of 1..10 days, rounded (5.5)
  // With 3,000 already on hand the same spending never reaches January's pay: it is all opening money, aged from day one too.
  assert.equal(ageOfMoney(flows, 3000), 6);
  // A second paycheck is only reached once the first is used up.
  const two = [{ date: '2026-01-01', amount: 500 }, { date: '2026-01-15', amount: 500 }, ...['16', '17', '18', '19', '20'].map((d) => ({ date: `2026-01-${d}`, amount: -150 }))];
  // Day 16-18 spend 450 of the first 500 (ages 15,16,17); day 19 spends its last 50 (age 18) and 100 of the second (age 4); day 20 spends 150 of the second (age 5).
  assert.equal(ageOfMoney(two), Math.round((150 * 15 + 150 * 16 + 150 * 17 + 50 * 18 + 100 * 4 + 150 * 5) / 750));
  assert.equal(ageOfMoney([{ date: '2026-01-01', amount: 100 }, { date: '2026-01-02', amount: -50 }]), null);   // too few spending days
});

test('the whole review holds together and its highlights lead with what matters most', () => {
  const spending = [
    ...monthly('Kroger', 400, 'Groceries'), buy('2026-11-05', 'Kroger', 300), buy('2026-11-12', 'Kroger', 250),
    ...monthly('Streamly', 15.99, 'Subscriptions'), buy('2026-11-10', 'Streamly', 18.99, 'Subscriptions'),
    buy('2026-11-14', 'Hotel Uno', 212.4, 'Travel'), buy('2026-11-14', 'Hotel Uno', 212.4, 'Travel'),
  ];
  const income = Array.from({ length: 6 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9 - i, 1)).toISOString().slice(0, 10), amount: 3000 }));
  const flows = [...income, ...spending.map((r) => ({ date: r.date, amount: -r.amount }))];
  const r = buildReview({ spending, income, flows, cash: 5000, budget: 500, today: '2026-11-20' });
  assert.equal(r.doubles.length, 1);
  assert.equal(r.price_changes.length, 1);
  assert.equal(r.highlights[0].kind, 'double');
  assert.ok(r.highlights.some((h) => h.kind === 'price'));
  assert.ok(r.highlights.some((h) => h.kind === 'over' && /Groceries/.test(h.text)));
  assert.equal(r.saving.income, 9000);
  assert.ok(r.cash.days_covered > 0);
  // The wording is fixed and carries the figures it was given.
  assert.match(highlights(r)[0].text, /Hotel Uno charged \$212\.40 twice/);
});

test('an empty household gets an empty review, not an error', () => {
  const r = buildReview({ spending: [], today: '2026-11-20' });
  assert.deepEqual(r.highlights, []);
  assert.equal(r.outlook.spent, 0);
  assert.equal(r.cash.age_of_money_days, null);
});
