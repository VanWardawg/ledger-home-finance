// Targets: the arithmetic on its own, then against a fresh empty database.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.LEDGER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
process.env.LEDGER_FRESH = '1';
const { db, setSetting } = await import('../server/db.js');
const { monthsLeft, targetState, setTarget, removeTarget, listTargets, attachTargets, fillTargets } = await import('../server/targets.js');
const { zeroFor } = await import('../server/zero.js');

const cat = (name) => db.prepare('SELECT id, rollover FROM categories WHERE name = ?').get(name);
const now = new Date();
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

test('months left counts both ends and crosses a year', () => {
  assert.equal(monthsLeft('2026-11', '2026-11'), 1);
  assert.equal(monthsLeft('2026-11', '2027-03'), 5);
  assert.equal(monthsLeft('2026-11', '2026-09'), -1);
});

test('an amount every month needs the rest of it', () => {
  const t = { kind: 'monthly', amount: 150 };
  assert.deepEqual(pick(targetState(t, { month: '2026-11', base: 100 })), { per: 150, need: 50, met: false });
  assert.deepEqual(pick(targetState(t, { month: '2026-11', base: 150 })), { per: 150, need: 0, met: true });
  assert.equal(targetState(t, { month: '2026-11', base: 100, carry: 500 }).need, 50);   // what was left before doesn't count
});

test('saving up by a month spreads what is missing over the months left', () => {
  const t = { kind: 'by_date', amount: 900, due: '2027-03' };
  const s = targetState(t, { month: '2026-11', base: 0, carry: 300 });   // 600 to find in 5 months
  assert.equal(s.per, 120); assert.equal(s.need, 120); assert.equal(s.months, 5); assert.equal(s.reached, false);
  assert.equal(targetState(t, { month: '2026-11', base: 120, carry: 300 }).met, true);
  assert.equal(targetState(t, { month: '2027-03', base: 0, carry: 780 }).need, 120);   // the last month takes all that is left
  const done = targetState(t, { month: '2027-01', base: 0, carry: 900 });
  assert.equal(done.reached, true); assert.equal(done.need, 0);
  const late = targetState(t, { month: '2027-05', base: 0, carry: 700 });
  assert.equal(late.late, true); assert.equal(late.need, 200);
  assert.equal(targetState(t, { month: '2026-11', base: 0, carry: -100 }).per, 200);   // overspending has to be made up too
});

test('topping up needs only what is missing', () => {
  const t = { kind: 'refill', amount: 600 };
  assert.equal(targetState(t, { month: '2026-11', base: 0, carry: 150 }).need, 450);
  assert.equal(targetState(t, { month: '2026-11', base: 200, carry: 150 }).need, 250);
  assert.equal(targetState(t, { month: '2026-11', base: 0, carry: 700 }).met, true);
});

test('a target is set, replaced and removed; bad ones are refused', () => {
  const g = cat('Groceries').id;
  assert.throws(() => setTarget(g, { kind: 'monthly', amount: 0 }), /above 0/);
  assert.throws(() => setTarget(g, { kind: 'by_date', amount: 100 }), /Choose the month/);
  assert.throws(() => setTarget(g, { kind: 'weekly', amount: 100 }), /what kind/);
  assert.throws(() => setTarget(cat('Income').id, { kind: 'monthly', amount: 100 }), /Only spending/);
  assert.throws(() => setTarget(99999, { kind: 'monthly', amount: 100 }), /no longer there/);
  assert.deepEqual(setTarget(g, { kind: 'monthly', amount: 500 }), { carryOn: false });
  setTarget(g, { kind: 'monthly', amount: 650.129 });
  assert.equal(listTargets()[g].amount, 650.13);
  assert.equal(removeTarget(g), 1);
  assert.equal(listTargets()[g], undefined);
});

test('saving up switches carry over on with set budgets, and the page gets the state', () => {
  const d = cat('Dining out');
  assert.equal(d.rollover, 0);
  assert.deepEqual(setTarget(d.id, { kind: 'by_date', amount: 1200, due: '2099-12' }), { carryOn: true });
  assert.equal(cat('Dining out').rollover, 1);
  const rows = attachTargets([{ id: d.id, base: 100, carry: 0, rollover: true }, { id: cat('Groceries').id, base: 400 }], '2099-01');
  assert.equal(rows[0].target.per, 100); assert.equal(rows[0].target.met, true); assert.equal(rows[0].target.keeps, true);
  assert.equal(rows[1].target, undefined);
  removeTarget(d.id);
});

test('with every dollar given a job, targets are filled from what is waiting and no further', () => {
  setSetting('zero_on', '1'); setSetting('zero_from', thisMonth); setSetting('zero_start', '700');
  const g = cat('Groceries').id, d = cat('Dining out').id;
  setTarget(g, { kind: 'monthly', amount: 500 });
  setTarget(d, { kind: 'refill', amount: 300 });
  const r = fillTargets(thisMonth);   // 700 to hand out, 800 needed, groceries first on the page
  assert.deepEqual(r, { funded: 1, given: 700, short: 100 });
  const z = zeroFor(thisMonth);
  assert.equal(z.cats[g].assigned, 500); assert.equal(z.cats[d].assigned, 200); assert.equal(z.toAssign, 0);
  assert.deepEqual(fillTargets(thisMonth), { funded: 0, given: 0, short: 100 });   // nothing left: nothing moves
  setSetting('zero_on', '0');
  assert.throws(() => fillTargets(thisMonth), /give every dollar a job/);
});

function pick(s) { return { per: s.per, need: s.need, met: s.met }; }
