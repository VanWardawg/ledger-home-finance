// Local SQLite database (a single file in ./data) plus sample-data seeding.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// LEDGER_DATA_DIR points the app at a different database (used for testing).
const dataDir = process.env.LEDGER_DATA_DIR || path.join(root, 'data');
export const dbPath = path.join(dataDir, 'ledger.db');

if (process.argv.includes('--reset') && fs.existsSync(dbPath)) fs.rmSync(dbPath);
fs.mkdirSync(dataDir, { recursive: true });

// The database files are for this program alone: new ones are made readable only by its own user,
// and existing ones are tightened to match (suggested by the NAS's Claude session on 2026-11-18;
// the folder was already private, this holds even if that ever changes).
process.umask(0o077);
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.chmodSync(f, 0o600); } catch { /* not there yet */ } }

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, institution TEXT NOT NULL,
  type TEXT NOT NULL, balance REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS balance_history (
  account_id INTEGER NOT NULL REFERENCES accounts(id), date TEXT NOT NULL, balance REAL NOT NULL,
  PRIMARY KEY (account_id, date)
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'expense', fixed INTEGER NOT NULL DEFAULT 0,
  budget REAL NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL, merchant TEXT NOT NULL, amount REAL NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id), notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
CREATE TABLE IF NOT EXISTS recurrings (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount REAL NOT NULL, day INTEGER NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id)
);
CREATE TABLE IF NOT EXISTS rules (
  merchant TEXT PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id)
);
`);

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function seed() {
  // Deterministic random numbers so the sample data is the same on every reset.
  let s = 20261115;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100) / 100;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const cats = [
    [1, 'Groceries', '🛒', '#2a78d6', 'expense', 0, 600],
    [2, 'Dining out', '🍜', '#eb6834', 'expense', 0, 250],
    [3, 'Gas and car', '⛽', '#1baf7a', 'expense', 0, 200],
    [4, 'Shopping', '🛍️', '#eda100', 'expense', 0, 300],
    [5, 'Entertainment', '🎬', '#e87ba4', 'expense', 0, 120],
    [6, 'Health', '💊', '#008300', 'expense', 0, 100],
    [7, 'Travel', '✈️', '#6250d6', 'expense', 0, 200],
    [8, 'Rent', '🏠', '#e34948', 'expense', 1, 1650],
    [9, 'Bills and utilities', '💡', '#4f8f9c', 'expense', 1, 225],
    [10, 'Subscriptions', '🔁', '#a0672b', 'expense', 1, 76],
    [11, 'Insurance', '🛡️', '#7a7f8c', 'expense', 1, 118],
    [12, 'Other', '📦', '#9a9aa5', 'expense', 0, 50],
    [13, 'Income', '💵', '#0a8f4f', 'income', 0, 0],
    [14, 'Transfer', '↔️', '#9a9aa5', 'transfer', 0, 0],
  ];
  const insCat = db.prepare('INSERT INTO categories (id,name,icon,color,kind,fixed,budget,sort) VALUES (?,?,?,?,?,?,?,?)');
  // The amounts above belong to the sample household. A copy that starts empty (another household's, or the
  // Home Assistant add-on) starts with no budgets: a stranger was otherwise told they were "$3,111 under
  // budget" on a budget nobody had set (found by the NAS session's look at the add-on, 2026-11-24).
  const blank = !!process.env.LEDGER_SETUP_CODE || process.env.LEDGER_FRESH === '1';
  cats.forEach((c, i) => insCat.run(...c.slice(0, 6), blank ? 0 : c[6], i));

  // A copy made for another household (it is given a one-time setup code) starts with the starter
  // categories and nothing else: no sample accounts or purchases to clear away.
  // LEDGER_FRESH=1 (the Home Assistant add-on) also starts empty, with the setup guide and no code to type.
  if (process.env.LEDGER_SETUP_CODE || process.env.LEDGER_FRESH === '1') return;

  const accounts = [
    [1, 'Everyday checking', 'Chase', 'checking', 4812.4],
    [2, 'High-yield savings', 'Ally', 'savings', 18400],
    [3, 'Gold card', 'American Express', 'credit', -1240.18],
    [4, 'Brokerage', 'Fidelity', 'investment', 52310],
    [5, '401(k)', 'Fidelity', 'investment', 31080],
    [6, 'Car loan', 'Toyota Financial', 'loan', -9800],
  ];
  const insAcc = db.prepare('INSERT INTO accounts (id,name,institution,type,balance) VALUES (?,?,?,?,?)');
  accounts.forEach((a) => insAcc.run(...a));

  const recurrings = [
    ['Rent', 1650, 1, 8], ['Gym membership', 45, 2, 10], ['iCloud+', 2.99, 3, 10],
    ['Internet', 70, 5, 9], ['Spotify', 11.99, 8, 10], ['Phone plan', 55, 12, 9],
    ['Electric', 95, 18, 9], ['Netflix', 15.99, 19, 10], ['Car insurance', 118, 22, 11],
  ];
  const insRec = db.prepare('INSERT INTO recurrings (name,amount,day,category_id) VALUES (?,?,?,?)');
  recurrings.forEach((r) => insRec.run(...r));

  const daily = [
    { cat: 1, p: 0.3, min: 22, max: 118, m: ["Trader Joe's", 'Whole Foods', 'Safeway', 'Costco'] },
    { cat: 2, p: 0.3, min: 8, max: 62, m: ['Thai Basil', 'Blue Bottle Coffee', 'Chipotle', 'Sweetgreen', 'Pizzeria Delfina'] },
    { cat: 3, p: 0.16, min: 9, max: 58, m: ['Shell', 'Chevron', 'Uber', 'City parking'] },
    { cat: 4, p: 0.1, min: 12, max: 140, m: ['Amazon', 'Target', 'Uniqlo', 'Apple Store'] },
    { cat: 5, p: 0.06, min: 10, max: 58, m: ['AMC Theatres', 'Steam', 'Ticketmaster'] },
    { cat: 6, p: 0.035, min: 10, max: 80, m: ['CVS Pharmacy', 'One Medical'] },
    { cat: 7, p: 0.012, min: 120, max: 460, m: ['Delta Air Lines', 'Airbnb'] },
    { cat: 12, p: 0.03, min: 5, max: 45, m: ['USPS', 'Venmo'] },
  ];

  const insTx = db.prepare('INSERT INTO transactions (account_id,date,merchant,amount,category_id) VALUES (?,?,?,?,?)');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getFullYear(), today.getMonth() - 12, 1);
  let payday = new Date(start);
  payday.setDate(payday.getDate() + 4);

  db.exec('BEGIN');
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const date = iso(d);
    for (const g of daily) {
      if (rnd() < g.p) insTx.run(3, date, pick(g.m), -between(g.min, g.max), g.cat);
    }
    for (const [name, amount, day, cat] of recurrings) {
      if (d.getDate() === day) {
        const amt = name === 'Electric' ? between(72, 128) : amount;
        insTx.run(cat === 10 ? 3 : 1, date, name, -amt, cat);
      }
    }
    if (d.getDate() === 2) {
      insTx.run(1, date, 'Transfer to savings', -500, 14);
      insTx.run(2, date, 'Transfer from checking', 500, 14);
    }
    if (d.getTime() === payday.getTime()) {
      insTx.run(1, date, 'Payroll', 2700, 13);
      payday.setDate(payday.getDate() + 14);
    }
  }

  // Month-start balance snapshots, walked backwards from today's balances.
  const insHist = db.prepare('INSERT INTO balance_history (account_id,date,balance) VALUES (?,?,?)');
  for (const [id, , , type, balance] of accounts) {
    let b = balance;
    for (let i = 0; i <= 12; i++) {
      const date = iso(new Date(today.getFullYear(), today.getMonth() - i, 1));
      insHist.run(id, date, Math.round(b * 100) / 100);
      if (type === 'savings') b -= 500;
      else if (type === 'investment') b = b / (1 + between(-0.012, 0.03)) - (id === 5 ? 450 : 200);
      else if (type === 'loan') b -= 310;
      else if (type === 'credit') b = -between(700, 1900);
      else b = between(3200, 6100);
    }
  }
  db.exec('COMMIT');
}

// Whether this start-up is the database's first.
const firstRun = db.prepare('SELECT COUNT(*) n FROM categories').get().n === 0;
if (firstRun) seed();

// Manually entered transactions (cash purchases) are flagged so they can be removed.
if (!db.prepare('PRAGMA table_info(transactions)').all().some((c) => c.name === 'manual')) {
  db.exec('ALTER TABLE transactions ADD COLUMN manual INTEGER NOT NULL DEFAULT 0');
}
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);

// Debt details: interest rate and minimum payment drive the payoff estimates.
if (!hasColumn('accounts', 'apr')) {
  db.exec(`ALTER TABLE accounts ADD COLUMN apr REAL;
           ALTER TABLE accounts ADD COLUMN min_payment REAL;
           ALTER TABLE accounts ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;`);
  db.prepare("UPDATE accounts SET apr = 24.99, min_payment = 40 WHERE name = 'Gold card' AND institution = 'American Express'").run();
  db.prepare("UPDATE accounts SET apr = 6.9, min_payment = 310, type = 'auto' WHERE name = 'Car loan' AND institution = 'Toyota Financial'").run();
}

db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
export const getSetting = (key, fallback = '') => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
export const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

// No state is assumed for the tax estimate any more (server/states.js). A copy that was already in use when
// that changed had been shown Arkansas all along, so it keeps Arkansas; a new copy, or one nobody has claimed
// yet, has no state until its household chooses. Done once.
if (getSetting('state_v1') === '') {
  if (!firstRun && getSetting('tax_state') === '' && getSetting('setup_done') !== '0') setSetting('tax_state', 'AR');
  setSetting('state_v1', '1');
}

// First-run setup (src/pages/Setup.tsx) is for a new household's copy. Every database that existed
// before it was built, and any started without a setup code, counts as already set up.
if (getSetting('setup_done') === '') {
  const household = firstRun && (!!process.env.LEDGER_SETUP_CODE || process.env.LEDGER_FRESH === '1');
  setSetting('setup_done', household ? '0' : '1');
  if (household) setSetting('sample_removed', '1');
}

// A side gig (self-employment income with no tax taken out) is optional: see server/gig.js. This app
// began as one household's, whose gig was VIPKid, with a category made here at start-up. A database
// from then is carried over as a gig named VIPKid, switched on; a new database starts with none.
if (getSetting('gig_on') === '') {
  const had = getSetting('vipkid_category_id') !== '';
  setSetting('gig_on', had ? '1' : '0');
  if (had) {
    setSetting('gig_name', 'VIPKid');
    setSetting('gig_match', 'vipkid, vip kid');
    setSetting('gig_classes', '1');
  }
}

// Tax deductions the user lists by hand. kind: business | adjustment | itemized.
db.exec('CREATE TABLE IF NOT EXISTS deductions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount REAL NOT NULL, kind TEXT NOT NULL)');

// A purchase can be claimed as a VIPKid business expense, in full or in part
// (deduct_pct is 0 to 100). Merchant rules repeat the claim on later purchases.
if (!hasColumn('transactions', 'deduct_pct')) db.exec('ALTER TABLE transactions ADD COLUMN deduct_pct REAL NOT NULL DEFAULT 0');
db.exec('CREATE TABLE IF NOT EXISTS deduct_rules (merchant TEXT PRIMARY KEY, pct REAL NOT NULL)');
// What a claim is for: 'vipkid' (business expense) or 'teaching' (classroom
// expenses for the regular teaching jobs).
// A category's first name, kept when it is renamed (server/index.js), so automatic filing still finds a built-in one.
if (!hasColumn('categories', 'key')) db.exec('ALTER TABLE categories ADD COLUMN key TEXT');
if (!hasColumn('transactions', 'deduct_kind')) db.exec("ALTER TABLE transactions ADD COLUMN deduct_kind TEXT NOT NULL DEFAULT 'vipkid'");
if (!hasColumn('deduct_rules', 'kind')) db.exec("ALTER TABLE deduct_rules ADD COLUMN kind TEXT NOT NULL DEFAULT 'vipkid'");

// Bank sync: SimpleFIN's ids link synced accounts and transactions to ours,
// so a repeat sync updates rows instead of duplicating them.
if (!hasColumn('accounts', 'sfin_id')) db.exec('ALTER TABLE accounts ADD COLUMN sfin_id TEXT');
if (!hasColumn('transactions', 'sfin_id')) db.exec('ALTER TABLE transactions ADD COLUMN sfin_id TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS accounts_sfin ON accounts(sfin_id) WHERE sfin_id IS NOT NULL;
         CREATE UNIQUE INDEX IF NOT EXISTS tx_sfin ON transactions(sfin_id) WHERE sfin_id IS NOT NULL;
         CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);

// When you rename an account, the bank's own name is kept so it can be shown and restored.
if (!hasColumn('accounts', 'bank_name')) db.exec('ALTER TABLE accounts ADD COLUMN bank_name TEXT');

// Available balance (posted balance less pending purchases) for bank accounts,
// and the pending purchases themselves, refreshed on every sync.
if (!hasColumn('accounts', 'available')) db.exec('ALTER TABLE accounts ADD COLUMN available REAL');
// Deduction rules match a merchant name exactly, or as a pattern when the rule contains %
// (new purchases are checked with "name LIKE rule").

// Charges the bank lists as pending are shown as transactions and flagged until they post.
if (!hasColumn('transactions', 'pending')) db.exec('ALTER TABLE transactions ADD COLUMN pending INTEGER NOT NULL DEFAULT 0');
// "Transport" was really fuel, car washes and oil changes; the name now says so.
db.prepare("UPDATE categories SET name = 'Gas and car' WHERE name = 'Transport' AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Gas and car')").run();

if (!hasColumn('transactions', 'settled_at')) db.exec('ALTER TABLE transactions ADD COLUMN settled_at INTEGER');

// When the bank itself last updated the balance it sends (the feed can be many hours behind the bank's app).
if (!hasColumn('accounts', 'balance_at')) db.exec('ALTER TABLE accounts ADD COLUMN balance_at INTEGER');

// Purchases typed in on a bank account, until the bank's own entry replaces them (server/waiting.js).
if (!hasColumn('transactions', 'waiting')) db.exec('ALTER TABLE transactions ADD COLUMN waiting INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE TABLE IF NOT EXISTS pending_tx (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, date TEXT NOT NULL, merchant TEXT NOT NULL, amount REAL NOT NULL)');

// A wallet for cash spending. Its balance stays at 0 so it never affects net worth.
if (!db.prepare("SELECT 1 FROM accounts WHERE type = 'cash'").get()) {
  db.prepare("INSERT INTO accounts (name, institution, type, balance) VALUES ('Cash', 'Wallet', 'cash', 0)").run();
}
