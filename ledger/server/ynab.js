// Moving in from YNAB (You Need A Budget).
//
// YNAB's "Export budget" gives a zip holding two files. The first, Register.csv, is every transaction in
// every account:
//   "Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"
// The second, Plan.csv (Budget.csv in older exports), is what each category was given each month:
//   "Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"
//
// The ordinary file import (server/importer.js) takes one account's statement and files it afresh. This
// one keeps what YNAB already knows: which account each row belongs to, the category the household chose
// for it, the memo, and which rows are transfers. It also learns from the history, so that a shop always
// filed under one category in YNAB is filed there by Ledger from now on (the `rules` table).
//
// Nothing is sent anywhere: the files are read on this server and nowhere else.
//
// What does not come across, said plainly on the page too: category groups (Ledger has none), flags,
// cleared marks, scheduled transactions, and targets. Two YNAB categories with the same name in different
// groups become one.
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';
import { parseCsv } from './importer.js';
import { removeSampleData } from './simplefin.js';
// These two add the columns this file writes to (split_of, income_ok); loading them here means the order
// the server happens to load its parts in doesn't matter.
import './splits.js';
import './deposits.js';

const round = (n) => Math.round(n * 100) / 100;
const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'investment', 'hsa', 'auto', 'mortgage', 'loan'];
const NEW_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#4f8f9c', '#a0672b'];

/** "$1,234.56", "-$5.00", "1.234,56 €", "(12.00)": a plain number, or 0. */
export function amountOf(v) {
  let s = String(v ?? '').trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || /^-|-$/.test(s.replace(/[^\d.,()-]/g, ''));
  s = s.replace(/[^\d.,]/g, '');
  // The last separator followed by one or two digits is the decimal mark; the others group thousands.
  const m = s.match(/^(.*?)[.,](\d{1,2})$/);
  const n = m ? Number(`${m[1].replace(/[.,]/g, '')}.${m[2]}`) : Number(s.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? (negative ? -n : n) : 0;
}

/** Which way round a file writes its dates: 'ymd', 'dmy' or 'mdy'. YNAB follows the budget's own setting. */
export function dateOrder(values) {
  let first = 0, second = 0;
  for (const v of values) {
    const s = String(v || '').trim();
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) return 'ymd';
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) continue;
    if (Number(m[1]) > 12) first++;
    if (Number(m[2]) > 12) second++;
  }
  return first > second ? 'dmy' : 'mdy';
}
export function dateOf(v, order) {
  const s = String(v || '').trim();
  let y, m, d;
  let x = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (x) [, y, m, d] = x;
  else if ((x = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) { y = x[3].length === 2 ? `20${x[3]}` : x[3]; [m, d] = order === 'dmy' ? [x[2], x[1]] : [x[1], x[2]]; }
  else return null;
  const out = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31 && !Number.isNaN(Date.parse(out)) ? out : null;
}

const col = (headers, ...names) => { for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; } return -1; };

/** A guess at what kind of account a name is. The household can change it before bringing anything in. */
export function guessType(name, balance = 0) {
  const s = String(name).toLowerCase();
  if (/mortgage|home loan/.test(s)) return 'mortgage';
  if (/auto loan|car loan|vehicle/.test(s)) return 'auto';
  if (/student|loan|line of credit|heloc/.test(s)) return 'loan';
  if (/\bhsa\b|health sav/.test(s)) return 'hsa';
  if (/401|403|ira\b|roth|brokerage|invest|retire|529|vanguard|fidelity|schwab/.test(s)) return 'investment';
  if (/saving|emergency|money market|\bcd\b/.test(s)) return 'savings';
  if (/credit|card|visa|master|amex|american express|discover|apple card|chase (sapphire|freedom)/.test(s)) return 'credit';
  return balance < -200 ? 'credit' : 'checking';
}

/**
 * Reads Register.csv into rows: { account, date, payee, group, category, memo, amount, kind, transfer }.
 * `kind` is 'income' (YNAB's "Inflow: Ready to Assign"), 'transfer', 'card payment', or 'expense'.
 */
export function readRegister(text) {
  const rows = parseCsv(String(text || ''));
  if (rows.length < 2) throw new Error("That file doesn't have any transactions in it.");
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const c = {
    account: col(h, 'account'), date: col(h, 'date'), payee: col(h, 'payee'), group: col(h, 'category group', 'master category'),
    category: col(h, 'category', 'sub category'), both: col(h, 'category group/category'), memo: col(h, 'memo'),
    outflow: col(h, 'outflow'), inflow: col(h, 'inflow'), cleared: col(h, 'cleared'),
  };
  if (c.account < 0 || c.date < 0 || c.outflow < 0 || c.inflow < 0) throw new Error("That doesn't look like YNAB's Register file. In YNAB choose your budget's name, then Export budget, unzip what it gives you, and pick the file with Register in its name.");
  const body = rows.slice(1);
  const order = dateOrder(body.map((r) => r[c.date]));
  const out = [];
  let unread = 0;
  for (const r of body) {
    const date = dateOf(r[c.date], order);
    const amount = round(amountOf(r[c.inflow]) - amountOf(r[c.outflow]));
    const account = String(r[c.account] || '').trim().slice(0, 80);
    if (!date || !account) { unread++; continue; }
    if (amount === 0) continue;   // YNAB keeps zero rows for split parents and cleared-balance notes
    const payee = String(c.payee >= 0 ? r[c.payee] || '' : '').replace(/\s+/g, ' ').trim();
    let group = String(c.group >= 0 ? r[c.group] || '' : '').trim(), category = String(c.category >= 0 ? r[c.category] || '' : '').trim();
    if (!category && c.both >= 0) { const both = String(r[c.both] || ''); const i = both.indexOf(':'); if (i >= 0) { group = both.slice(0, i).trim(); category = both.slice(i + 1).trim(); } else category = both.trim(); }
    const transfer = /^transfer\s*:/i.test(payee) ? payee.replace(/^transfer\s*:\s*/i, '').trim() : '';
    const kind = /^inflow$/i.test(group) || /ready to assign|to be budgeted|available this month|available next month/i.test(category) ? 'income'
      : /^credit card payments?$/i.test(group) ? 'card payment'
      : transfer && !category ? 'transfer' : 'expense';
    const memo = String(c.memo >= 0 ? r[c.memo] || '' : '').replace(/\s+/g, ' ').trim().slice(0, 500);
    out.push({
      account, date, amount, group, category: category.slice(0, 40), memo, kind, transfer,
      payee: (transfer ? `Transfer ${amount < 0 ? 'to' : 'from'} ${transfer}` : payee || (kind === 'income' ? 'Income' : 'Unknown')).slice(0, 120),
      starting: /^starting balance$/i.test(payee),
    });
  }
  if (!out.length) throw new Error("Couldn't read any transactions from that file.");
  return { rows: out, order, unread };
}

/** Reads Plan.csv / Budget.csv into the latest month that was given any money: { month, amounts: Map(category -> assigned) }. */
export function readPlan(text, today = new Date()) {
  const rows = parseCsv(String(text || ''));
  if (rows.length < 2) return null;
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const c = { month: col(h, 'month'), category: col(h, 'category', 'sub category'), group: col(h, 'category group', 'master category'), assigned: col(h, 'assigned', 'budgeted') };
  if (c.month < 0 || c.category < 0 || c.assigned < 0) throw new Error("That doesn't look like YNAB's Plan (or Budget) file. It is the other file in the zip YNAB gave you.");
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthOf = (v) => {
    const s = String(v || '').trim().toLowerCase();
    let m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
    if (m && MONTHS.includes(m[1])) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;
    m = s.match(/^(\d{4})[-/](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
  };
  const now = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const months = new Map();
  for (const r of rows.slice(1)) {
    const month = monthOf(r[c.month]);
    const name = String(r[c.category] || '').trim().slice(0, 40);
    if (!month || month > now || !name || /^(inflow|credit card payments?|hidden categories)$/i.test(String(c.group >= 0 ? r[c.group] || '' : '').trim())) continue;
    const amount = round(amountOf(r[c.assigned]));
    if (!months.has(month)) months.set(month, new Map());
    if (amount > 0) months.get(month).set(name, round((months.get(month).get(name) || 0) + amount));
  }
  const latest = [...months.entries()].filter(([, m]) => m.size).sort((a, b) => (a[0] < b[0] ? 1 : -1))[0];
  return latest ? { month: latest[0], amounts: latest[1] } : null;
}

/**
 * The shops YNAB's history files under one category nearly every time: at least three purchases, nine in
 * ten of them in the same category. These become Ledger's own filing rules.
 */
export function learnRules(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.kind !== 'expense' || !r.category || r.transfer || r.amount >= 0 || r.starting) continue;
    const k = r.payee.toLowerCase();
    const m = by.get(k) || { payee: r.payee, cats: new Map(), n: 0 };
    m.cats.set(r.category, (m.cats.get(r.category) || 0) + 1); m.n++;
    by.set(k, m);
  }
  const out = [];
  for (const m of by.values()) {
    const [category, n] = [...m.cats.entries()].sort((a, b) => b[1] - a[1])[0];
    if (m.n >= 3 && n / m.n >= 0.9) out.push({ merchant: m.payee, category });
  }
  return out;
}

const existingAccounts = () => db.prepare("SELECT id, name, type FROM accounts WHERE type NOT IN ('cash', 'insurance') ORDER BY name").all();
const sampleStill = () => getSetting('sample_removed') !== '1';

/** What the files hold, before anything is brought in. */
export function preview(registerCsv, planCsv) {
  const { rows, order, unread } = readRegister(registerCsv);
  // Sample accounts are about to be cleared away, so nothing can be matched to them.
  const here = sampleStill() ? [] : existingAccounts();
  const accounts = new Map();
  for (const r of rows) {
    const a = accounts.get(r.account) || { name: r.account, rows: 0, balance: 0, from: r.date, to: r.date };
    a.rows++; a.balance += r.amount;
    if (r.date < a.from) a.from = r.date;
    if (r.date > a.to) a.to = r.date;
    accounts.set(r.account, a);
  }
  const known = new Set(db.prepare('SELECT lower(name) n FROM categories').all().map((c) => c.n));
  const cats = new Map();
  for (const r of rows) if (r.kind === 'expense' && r.category) cats.set(r.category, (cats.get(r.category) || 0) + 1);
  let plan = null, planError = '';
  if (String(planCsv || '').trim()) { try { plan = readPlan(planCsv); } catch (e) { planError = e.message; } }
  const dates = rows.map((r) => r.date).sort();
  return {
    rows: rows.length, unread, from: dates[0], to: dates.at(-1), dates: order,
    accounts: [...accounts.values()].map((a) => ({ ...a, balance: round(a.balance), type: guessType(a.name, a.balance), match: here.find((x) => x.name.toLowerCase() === a.name.toLowerCase())?.id ?? null })).sort((a, b) => b.rows - a.rows),
    existing: here,
    types: ACCOUNT_TYPES,
    categories: { total: cats.size, fresh: [...cats.keys()].filter((c) => !known.has(c.toLowerCase())).sort(), uncategorized: rows.filter((r) => r.kind === 'expense' && !r.category).length },
    transfers: rows.filter((r) => r.kind === 'transfer' || r.kind === 'card payment').length,
    income: rows.filter((r) => r.kind === 'income').length,
    rules: learnRules(rows).length,
    plan: plan ? { month: plan.month, categories: plan.amounts.size, total: round([...plan.amounts.values()].reduce((a, b) => a + b, 0)) } : null,
    planError,
    sample: sampleStill(),
  };
}

/**
 * Brings the files in. `choices.accounts` says what to do with each YNAB account by name:
 *   { to: <id of an account already in Ledger> } | { type: 'checking' | ... } (make a new one) | { skip: true }
 * An account not mentioned is made new with its guessed type. `choices.rules` and `choices.budgets`
 * (both on unless false) say whether to learn filing rules and to copy the latest month's amounts.
 */
export function importYnab(registerCsv, planCsv, choices = {}) {
  const { rows } = readRegister(registerCsv);
  let plan = null;
  if (choices.budgets !== false && String(planCsv || '').trim()) plan = readPlan(planCsv);
  const want = choices.accounts && typeof choices.accounts === 'object' ? choices.accounts : {};
  const result = { added: 0, skipped: 0, accountsMade: 0, categoriesMade: 0, rulesLearned: 0, budgetsSet: 0, left: 0 };
  db.exec('BEGIN');
  try {
    removeSampleData();
    const income = db.prepare("SELECT id FROM categories WHERE kind = 'income' ORDER BY sort, id LIMIT 1").get()?.id;
    const transfer = db.prepare("SELECT id FROM categories WHERE kind = 'transfer' ORDER BY sort, id LIMIT 1").get()?.id;
    const other = db.prepare("SELECT id, sort FROM categories WHERE COALESCE(key, name) = 'Other'").get() || db.prepare("SELECT id, sort FROM categories WHERE kind = 'expense' ORDER BY sort DESC LIMIT 1").get();
    if (!income || !transfer || !other) throw new Error('This copy of Ledger is missing its Income, Transfer or Other category, so there is nowhere to file those rows.');

    // Accounts.
    const accountId = new Map(), made = new Set();
    const totals = new Map();
    for (const r of rows) totals.set(r.account, (totals.get(r.account) || 0) + r.amount);
    for (const [name, total] of totals) {
      const w = want[name] || {};
      if (w.skip) continue;
      if (w.to != null) {
        const a = db.prepare("SELECT id FROM accounts WHERE id = ? AND type NOT IN ('cash', 'insurance')").get(Number(w.to));
        if (!a) throw new Error(`The account chosen for "${name}" isn't in Ledger any more. Choose again.`);
        accountId.set(name, a.id);
        continue;
      }
      const type = ACCOUNT_TYPES.includes(w.type) ? w.type : guessType(name, total);
      const id = Number(db.prepare('INSERT INTO accounts (name, institution, type, balance, manual) VALUES (?,?,?,?,1)').run(name, 'Brought in from YNAB', type, round(total)).lastInsertRowid);
      accountId.set(name, id); made.add(id);
      result.accountsMade++;
    }

    // Categories, made the way the Budgets page makes them.
    const catId = new Map(db.prepare("SELECT id, lower(name) n FROM categories WHERE kind = 'expense'").all().map((c) => [c.n, c.id]));
    const taken = new Set(db.prepare('SELECT lower(name) n FROM categories').all().map((c) => c.n));
    let count = db.prepare('SELECT COUNT(*) n FROM categories').get().n;
    const insCat = db.prepare("INSERT INTO categories (name, icon, color, kind, fixed, budget, sort) VALUES (?, '🏷️', ?, 'expense', 0, 0, ?)");
    const categoryFor = (name) => {
      const k = name.toLowerCase();
      if (catId.has(k)) return catId.get(k);
      // A YNAB category that shares a name with Ledger's Income or Transfer is filed under Other rather than there.
      if (taken.has(k)) return other.id;
      const id = Number(insCat.run(name, NEW_COLORS[count % NEW_COLORS.length], other.sort - 0.5 + count * 0.001).lastInsertRowid);
      count++; catId.set(k, id); taken.add(k); result.categoriesMade++;
      return id;
    };

    // Transactions. Each gets a fingerprint, so the same export (or a later, longer one) can be brought in
    // again without doubling anything. In an account that was already in Ledger, a row is also skipped when
    // that account has a transaction of the same date and amount that this file hasn't already been matched to.
    const exists = db.prepare('SELECT 1 FROM transactions WHERE sfin_id = ?');
    const before = db.prepare('SELECT COALESCE(MAX(id), 0) m FROM transactions').get().m;
    const alike = db.prepare(`SELECT COUNT(*) n FROM transactions WHERE account_id = ? AND date = ? AND ABS(amount - ?) < 0.005 AND split_of IS NULL AND id <= ${before}`);
    const insert = db.prepare('INSERT INTO transactions (account_id, date, merchant, amount, category_id, notes, sfin_id) VALUES (?,?,?,?,?,?,?)');
    const okIncome = db.prepare('UPDATE transactions SET income_ok = 1 WHERE id = ?');
    const seen = {}, matched = {};
    for (const r of rows) {
      const acc = accountId.get(r.account);
      if (!acc) { result.left++; continue; }
      const key = `ynab|${r.account}|${r.date}|${r.amount.toFixed(2)}|${r.payee}|${r.category}|${r.memo}`;
      seen[key] = (seen[key] || 0) + 1;
      const id = 'csv:y' + crypto.createHash('sha1').update(`${key}|${seen[key]}`).digest('hex').slice(0, 19);
      if (exists.get(id)) { result.skipped++; continue; }
      if (!made.has(acc)) {
        const day = `${acc}|${r.date}|${r.amount.toFixed(2)}`;
        if ((matched[day] || 0) < alike.get(acc, r.date, r.amount).n) { matched[day] = (matched[day] || 0) + 1; result.skipped++; continue; }
      }
      // A starting balance is money that was already there, not money that came in: it counts toward the
      // account's balance and toward nothing else.
      const category = r.starting ? transfer : r.kind === 'income' ? income : r.kind === 'transfer' || r.kind === 'card payment' ? transfer : r.category ? categoryFor(r.category) : r.amount > 0 && !r.transfer ? income : other.id;
      const tx = Number(insert.run(acc, r.date, r.payee, r.amount, category, r.memo, id).lastInsertRowid);
      if (category === income && r.amount > 0) okIncome.run(tx);
      result.added++;
    }

    // What YNAB's history says about where each shop is filed.
    if (choices.rules !== false) {
      const put = db.prepare('INSERT INTO rules (merchant, category_id) VALUES (?, ?) ON CONFLICT(merchant) DO NOTHING');
      for (const rule of learnRules(rows)) {
        const id = catId.get(rule.category.toLowerCase());
        if (id) result.rulesLearned += Number(put.run(rule.merchant, id).changes);
      }
    }

    // The latest month's amounts become each category's monthly budget (only where none is set yet).
    if (plan) {
      const set = db.prepare("UPDATE categories SET budget = ? WHERE id = ? AND kind = 'expense' AND budget = 0");
      for (const [name, amount] of plan.amounts) {
        const id = catId.get(name.toLowerCase());
        if (id) result.budgetsSet += Number(set.run(amount, id).changes);
      }
      if (result.budgetsSet) result.budgetMonth = plan.month;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  setSetting('ynab_imported', new Date().toISOString());
  return result;
}

export function installYnab(app) {
  app.post('/api/ynab/preview', (req, res) => {
    try { res.json(preview(req.body?.register, req.body?.plan)); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/ynab/import', (req, res) => {
    try { res.json(importYnab(req.body?.register, req.body?.plan, req.body?.choices || {})); } catch (e) { res.status(400).json({ error: e.message }); }
  });
}
