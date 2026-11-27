// Money set aside for a credit card: the sharing rule on its own, then against a fresh empty database.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.LEDGER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
process.env.LEDGER_FRESH = '1';
const { db, setSetting } = await import('../server/db.js');
await import('../server/offbudget.js');   // adds accounts.off_budget, as the server does
const { zeroFor } = await import('../server/zero.js');
const { coveredOnCard, cardsFor, assignToCard } = await import('../server/cardpay.js');

const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const cat = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;
const account = (name, type, balance) => Number(db.prepare('INSERT INTO accounts (name, institution, type, balance) VALUES (?,?,?,?)').run(name, 'Test bank', type, balance).lastInsertRowid);
const tx = (acc, merchant, amount, category) => db.prepare('INSERT INTO transactions (account_id, date, merchant, amount, category_id) VALUES (?,?,?,?,?)').run(acc, `${month}-01`, merchant, amount, cat(category));

test('a card gets what its category had money for, shared when the category is overspent', () => {
  assert.equal(coveredOnCard({ spent: 200, onCard: 200, assigned: 300 }), 200);   // all covered
  assert.equal(coveredOnCard({ spent: 400, onCard: 200, assigned: 300 }), 150);   // half the spending, half of what was covered
  assert.equal(coveredOnCard({ spent: 400, onCard: 400, assigned: 0 }), 0);
  assert.equal(coveredOnCard({ spent: 400, onCard: 400, assigned: -50 }), 0);
  assert.equal(coveredOnCard({ spent: 0, onCard: 0, assigned: 300 }), 0);
  assert.equal(coveredOnCard({ spent: 100, onCard: -20, assigned: 300 }), 0);     // refunds only
});

const checking = account('Checking', 'checking', 2000);
const card = account('Visa', 'credit', -500);
const one = () => cardsFor(month).cards.find((c) => c.id === card);

test('with set budgets a card shows what was charged, paid and owed, and nothing more', () => {
  tx(card, 'Kroger', -200, 'Groceries');
  tx(checking, 'Kroger', -200, 'Groceries');
  tx(card, 'Payment thank you', 100, 'Transfer');
  tx(checking, 'Visa payment', -100, 'Transfer');
  const r = cardsFor(month);
  assert.equal(r.zero, false);
  assert.deepEqual(one(), { id: card, name: 'Visa', institution: 'Test bank', charged: 200, paid: 100, owed: 500 });
  assert.throws(() => assignToCard(card, month, 50), /give every dollar a job/);
});

test('with every dollar given a job, covered card purchases wait for the payment', () => {
  setSetting('zero_on', '1'); setSetting('zero_from', month); setSetting('zero_start', '1000');
  db.prepare('INSERT INTO zero_assign (month, category_id, amount) VALUES (?,?,?)').run(month, cat('Groceries'), 300);
  const c = one();   // 400 spent on groceries with 300 given: 150 of the card's 200 is covered; 100 already paid
  assert.equal(c.fromSpending, 150); assert.equal(c.setAside, 50); assert.equal(c.overpaid, 0);
  assert.equal(c.short, 450);        // 500 owed, 50 set aside
});

test('money given to the card is set aside and comes off what is left to assign', () => {
  assert.equal(zeroFor(month).toAssign, 700);
  assignToCard(card, month, 450);
  const c = one();
  assert.equal(c.assignedNow, 450); assert.equal(c.setAside, 500); assert.equal(c.short, 0);
  const z = zeroFor(month);
  assert.equal(z.toAssign, 250); assert.equal(z.assignedMonth, 750);
  assignToCard(card, month, 0);   // the box sets the month's amount; it doesn't add to it
  assert.equal(zeroFor(month).toAssign, 700);
  assert.throws(() => assignToCard(card, month, -5), /0 or more/);
  assert.throws(() => assignToCard(checking, month, 5), /credit cards/);
});

test('paying more than was set aside is pointed out', () => {
  tx(card, 'Payment thank you', 120, 'Transfer');
  const c = one();
  assert.equal(c.setAside, -70); assert.equal(c.overpaid, 70);
  assert.equal(c.short, 500);     // nothing is set aside for what is still owed
});

test('a card left out of the budget is not listed', () => {
  db.prepare('UPDATE accounts SET off_budget = 1 WHERE id = ?').run(card);
  assert.equal(cardsFor(month).cards.length, 0);
});
