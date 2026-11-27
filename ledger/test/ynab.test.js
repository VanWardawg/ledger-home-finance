// Bringing a YNAB export in, against a fresh empty database.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.LEDGER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
process.env.LEDGER_FRESH = '1';   // starter categories only, no sample household
const { db } = await import('../server/db.js');
const { amountOf, dateOrder, dateOf, guessType, readRegister, readPlan, learnRules, preview, importYnab } = await import('../server/ynab.js');

const HEAD = '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"';
const row = (account, date, payee, group, category, memo, out, inn) => `"${account}","","${date}","${payee}","${group ? `${group}: ${category}` : ''}","${group}","${category}","${memo}",$${out.toFixed(2)},$${inn.toFixed(2)},"Cleared"`;
const REGISTER = [
  HEAD,
  row('Checking', '01/01/2026', 'Starting Balance', 'Inflow', 'Ready to Assign', '', 0, 2500),
  row('Checking', '01/03/2026', 'Employer Inc', 'Inflow', 'Ready to Assign', 'Jan pay', 0, 3000),
  row('Checking', '01/04/2026', 'Kroger', 'Everyday', 'Groceries', '', 84.12, 0),
  row('Checking', '01/11/2026', 'Kroger', 'Everyday', 'Groceries', 'party food', 121.5, 0),
  row('Checking', '01/18/2026', 'Kroger', 'Everyday', 'Groceries', '', 66, 0),
  row('Checking', '01/20/2026', 'Transfer : Visa', '', '', '', 400, 0),
  row('Visa', '01/20/2026', 'Transfer : Checking', '', '', '', 0, 400),
  row('Visa', '01/09/2026', 'Shell', 'Everyday', 'Fuel', '', 45.2, 0),
  row('Visa', '01/15/2026', 'Amazon', 'Everyday', 'Household', '', 30, 0),
  row('Visa', '01/16/2026', 'Amazon', 'Fun', 'Hobbies', '', 55, 0),
  row('Visa', '01/17/2026', 'Amazon', 'Everyday', 'Household', 'Split (1/2) soap', 12, 0),
  row('Visa', '01/22/2026', 'Mystery', '', '', '', 9.99, 0),
  row('Visa', '01/25/2026', 'Shell', 'Everyday', 'Fuel', 'refund', 0, 5),
  '"Visa","","01/26/2026","Zero row","Everyday: Fuel","Everyday","Fuel","",$0.00,$0.00,"Cleared"',
].join('\r\n');
const PLAN = ['"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"',
  '"Dec 2025","Everyday: Groceries","Everyday","Groceries",$450.00,-$410.00,$40.00',
  '"Jan 2026","Everyday: Groceries","Everyday","Groceries",$500.00,-$271.62,$228.38',
  '"Jan 2026","Everyday: Fuel","Everyday","Fuel",$120.00,-$40.20,$79.80',
  '"Jan 2026","Credit Card Payments: Visa","Credit Card Payments","Visa",$0.00,$0.00,$400.00',
  '"Jan 2030","Everyday: Groceries","Everyday","Groceries",$999.00,$0.00,$999.00'].join('\n');

test('amounts in the ways YNAB writes them', () => {
  assert.equal(amountOf('$1,234.56'), 1234.56);
  assert.equal(amountOf('-$5.00'), -5);
  assert.equal(amountOf('1.234,56 €'), 1234.56);
  assert.equal(amountOf('(12.00)'), -12);
  assert.equal(amountOf('1,000'), 1000);
  assert.equal(amountOf(''), 0);
});

test('the date order is worked out from the file', () => {
  assert.equal(dateOrder(['01/03/2026', '01/20/2026']), 'mdy');
  assert.equal(dateOrder(['03/01/2026', '20/01/2026']), 'dmy');
  assert.equal(dateOrder(['2026-01-20']), 'ymd');
  assert.equal(dateOf('20/01/2026', 'dmy'), '2026-01-20');
  assert.equal(dateOf('1/3/26', 'mdy'), '2026-01-03');
  assert.equal(dateOf('13/40/2026', 'mdy'), null);
});

test('account types are guessed from names', () => {
  assert.equal(guessType('Chase Visa'), 'credit');
  assert.equal(guessType('Emergency Savings'), 'savings');
  assert.equal(guessType('Roth IRA'), 'investment');
  assert.equal(guessType('Joint'), 'checking');
  assert.equal(guessType('Honda Auto Loan'), 'auto');
});

test('the register is read with each row put in its place', () => {
  const { rows, order } = readRegister(REGISTER);
  assert.equal(order, 'mdy');
  assert.equal(rows.length, 13);                                  // the zero row is dropped
  const pay = rows.find((r) => r.payee === 'Employer Inc');
  assert.deepEqual([pay.kind, pay.amount, pay.memo], ['income', 3000, 'Jan pay']);
  const out = rows.find((r) => r.account === 'Checking' && r.transfer);
  assert.deepEqual([out.kind, out.payee, out.amount], ['transfer', 'Transfer to Visa', -400]);
  assert.equal(rows.find((r) => r.account === 'Visa' && r.transfer).payee, 'Transfer from Checking');
  assert.equal(rows.find((r) => r.memo === 'refund').amount, 5);
  assert.throws(() => readRegister('Date,Description,Amount\n2026-01-01,x,1'), /Register file/);
});

test('the plan gives the latest month that is not in the future, without the card-payment rows', () => {
  const p = readPlan(PLAN, new Date(2026, 1, 10));
  assert.equal(p.month, '2026-01');
  assert.deepEqual(Object.fromEntries(p.amounts), { Groceries: 500, Fuel: 120 });
});

test('only shops always filed the same way become rules', () => {
  const rules = learnRules(readRegister(REGISTER).rows);
  assert.deepEqual(rules, [{ merchant: 'Kroger', category: 'Groceries' }]);   // Amazon is split between two; Shell has two purchases only
});

test('the preview says what is in the files and changes nothing', () => {
  const before = db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
  const p = preview(REGISTER, PLAN);
  assert.equal(p.rows, 13);
  assert.deepEqual(p.accounts.map((a) => [a.name, a.rows, a.balance, a.type]), [['Visa', 7, 252.81, 'credit'], ['Checking', 6, 4828.38, 'checking']]);
  assert.ok(p.categories.fresh.includes('Fuel'));
  assert.equal(p.categories.uncategorized, 1);
  assert.equal(p.transfers, 2);
  assert.equal(p.rules, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n, before);
});

test('bringing it in makes the accounts, categories, rules and budgets, and a second time adds nothing', () => {
  const r = importYnab(REGISTER, PLAN, { accounts: { Visa: { type: 'credit' } } });
  assert.equal(r.added, 13);
  assert.equal(r.accountsMade, 2);
  assert.equal(r.rulesLearned, 1);
  assert.ok(r.categoriesMade >= 2);

  const acc = Object.fromEntries(db.prepare("SELECT name, type, balance, manual FROM accounts WHERE institution = 'Brought in from YNAB'").all().map((a) => [a.name, a]));
  assert.deepEqual([acc.Checking.type, acc.Checking.balance, acc.Checking.manual], ['checking', 4828.38, 1]);
  assert.deepEqual([acc.Visa.type, acc.Visa.balance], ['credit', 252.81]);

  const kind = (payee) => db.prepare('SELECT c.kind, c.name FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.merchant = ? ORDER BY t.id LIMIT 1').get(payee);
  assert.equal(kind('Employer Inc').kind, 'income');
  assert.equal(kind('Transfer to Visa').kind, 'transfer');
  assert.equal(kind('Starting Balance').kind, 'transfer');   // already-held money is not income
  assert.equal(db.prepare("SELECT SUM(t.amount) s FROM transactions t JOIN categories c ON c.id = t.category_id WHERE c.kind = 'income'").get().s, 3000);
  assert.deepEqual({ ...kind('Shell') }, { kind: 'expense', name: 'Fuel' });
  assert.equal(db.prepare("SELECT notes FROM transactions WHERE merchant = 'Kroger' AND amount = -121.5").get().notes, 'party food');
  assert.equal(db.prepare("SELECT c.name FROM rules r JOIN categories c ON c.id = r.category_id WHERE r.merchant = 'Kroger'").get().name, 'Groceries');
  // Groceries is one of Ledger's own starter categories: the YNAB rows join it and its budget is set from the plan.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM categories WHERE lower(name) = 'groceries'").get().n, 1);
  assert.equal(db.prepare("SELECT budget FROM categories WHERE name = 'Groceries'").get().budget, 500);
  assert.equal(db.prepare("SELECT budget FROM categories WHERE name = 'Fuel'").get().budget, 120);
  // Spending adds up to what the register says.
  const spent = db.prepare("SELECT ROUND(-SUM(t.amount), 2) s FROM transactions t JOIN categories c ON c.id = t.category_id WHERE c.kind = 'expense'").get().s;
  assert.equal(spent, 418.81);

  const again = importYnab(REGISTER, PLAN, { accounts: { Checking: { to: db.prepare("SELECT id FROM accounts WHERE name = 'Checking'").get().id }, Visa: { to: db.prepare("SELECT id FROM accounts WHERE name = 'Visa'").get().id } } });
  assert.deepEqual([again.added, again.skipped, again.accountsMade], [0, 13, 0]);
});

test('an account can be left out, and rows already in an existing account are not doubled', () => {
  const id = Number(db.prepare("INSERT INTO accounts (name, institution, type, balance, manual) VALUES ('Old checking', 'Bank', 'checking', 0, 0)").run().lastInsertRowid);
  const other = db.prepare("SELECT id FROM categories WHERE kind = 'expense' LIMIT 1").get().id;
  db.prepare("INSERT INTO transactions (account_id, date, merchant, amount, category_id, sfin_id) VALUES (?, '2026-02-02', 'KROGER #123', -40, ?, 'bank-1')").run(id, other);
  const file = [HEAD,
    row('Joint', '02/02/2026', 'Kroger', 'Everyday', 'Groceries', '', 40, 0),
    row('Joint', '02/03/2026', 'Kroger', 'Everyday', 'Groceries', '', 41, 0),
    row('Old car loan', '02/03/2026', 'Payment', '', '', '', 0, 200)].join('\n');
  const r = importYnab(file, '', { accounts: { Joint: { to: id }, 'Old car loan': { skip: true } }, rules: false });
  assert.deepEqual([r.added, r.skipped, r.left, r.accountsMade], [1, 1, 1, 0]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions WHERE account_id = ?').get(id).n, 2);
});

test('a broken file changes nothing', () => {
  const before = db.prepare('SELECT COUNT(*) n FROM accounts').get().n;
  assert.throws(() => importYnab(`${HEAD}\n"X","","01/01/2026","Y","","","","",$1.00,$0.00,""`, '', { accounts: { X: { to: 999999 } } }), /isn't in Ledger any more/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounts').get().n, before);
});

test("YNAB's category groups come across, and a choice made here is kept", () => {
  const inGroup = (name) => db.prepare('SELECT g.name FROM categories c LEFT JOIN category_groups g ON g.id = c.group_id WHERE c.name = ?').get(name)?.name ?? null;
  assert.equal(inGroup('Groceries'), 'Everyday');
  assert.equal(inGroup('Fuel'), 'Everyday');
  assert.equal(inGroup('Income'), null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM category_groups WHERE lower(name) IN ('inflow', 'credit card payments')").get().n, 0);
  // Moved in Ledger, then the same file brought in again: it stays where it was put.
  const other = Number(db.prepare("INSERT INTO category_groups (name, sort) VALUES ('Car', 99)").run().lastInsertRowid);
  db.prepare("UPDATE categories SET group_id = ? WHERE name = 'Fuel'").run(other);
  const again = importYnab(REGISTER, PLAN, {});
  assert.equal(again.groupsSet, 0);
  assert.equal(inGroup('Fuel'), 'Car');
});
