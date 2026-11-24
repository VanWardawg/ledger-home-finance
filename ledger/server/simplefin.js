// SimpleFIN Bridge sync: read-only balances and transactions from your banks.
// Protocol: https://www.simplefin.org/protocol.html
import { loanFor, paymentName, nameLoanPayments } from './loans.js';
import { applyNames } from './names.js';
import { db, iso, getSetting, setSetting } from './db.js';
import { saveHoldings } from './holdings.js';
import { findWaiting, settle } from './waiting.js';
import { gigCategoryFor } from './gig.js';
import { depositCategoryId, looksLikePay } from './deposits.js';

// Every time the bank's own time on an account's figures moves, it is written down here, so the app
// can learn how often the feed really goes back to the bank (SimpleFIN says about once a day).
db.exec('CREATE TABLE IF NOT EXISTS bank_reads (account_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (account_id, at))');
db.exec('INSERT OR IGNORE INTO bank_reads (account_id, at) SELECT id, balance_at FROM accounts WHERE balance_at IS NOT NULL');

const HOUR = 3600000;
/**
 * When the feed should next have newer figures from the bank for checking: the bank's time on the
 * current figures plus the usual gap between its updates (24 hours until four updates have been
 * seen, then the middle one of the recent gaps, kept between 6 and 48 hours). An estimate: the
 * service doesn't publish its timetable.
 */
export function bankUpdateExpected() {
  const acct = db.prepare("SELECT id, balance_at FROM accounts WHERE type = 'checking' AND balance_at IS NOT NULL ORDER BY manual, id LIMIT 1").get();
  if (!acct) return null;
  const seen = db.prepare('SELECT at FROM bank_reads WHERE account_id = ? ORDER BY at DESC LIMIT 9').all(acct.id).map((r) => r.at);
  const gaps = seen.slice(0, -1).map((at, i) => at - seen[i + 1]).sort((a, b) => a - b);
  const gap = gaps.length >= 3 ? Math.min(48 * HOUR, Math.max(6 * HOUR, gaps[Math.floor(gaps.length / 2)])) : 24 * HOUR;
  return { asOf: acct.balance_at, expected: acct.balance_at + gap, learned: gaps.length >= 3 };
}

/** When the app will next read the feed by itself: every four hours, and hourly once new figures from the bank are due. */
export function nextReadAt() {
  const last = (Number(getSetting('simplefin_last_sync')) || 0) * 1000;
  if (!last || !connected()) return null;
  // While SimpleFIN says a bank wants signing in to again, look hourly: the household fixes that over at
  // SimpleFIN, and the notice here should clear soon after, not up to four hours later.
  let waiting = false;
  try { waiting = (JSON.parse(getSetting('simplefin_last_result', 'null'))?.messages || []).some((m) => /may need attention/i.test(m)); } catch { /* no result yet */ }
  if (waiting) return last + HOUR;
  const due = bankUpdateExpected()?.expected;
  return due ? Math.min(last + 4 * HOUR, Math.max(last + HOUR, due + 10 * 60000)) : last + 4 * HOUR;
}

const DAY = 86400;
const WINDOW_DAYS = 44; // SimpleFIN recommends at most 45 days per request
const FIRST_SYNC_WINDOWS = 8; // about a year of history on the first sync

db.exec('CREATE TABLE IF NOT EXISTS file_rows (id TEXT PRIMARY KEY, tx_id INTEGER)');   // see server/importer.js

export const connected = () => getSetting('simplefin_access') !== '';

/** Trade the one-time setup token for a private access link. */
export async function connect(setupToken) {
  let claimUrl;
  try {
    claimUrl = new URL(Buffer.from(String(setupToken).trim(), 'base64').toString('utf8'));
  } catch {
    throw new Error("That doesn't look like a SimpleFIN setup token. Copy the whole token and try again.");
  }
  if (claimUrl.protocol !== 'https:') throw new Error("That doesn't look like a SimpleFIN setup token. Copy the whole token and try again.");
  // Never follow a redirect here: the reply to this one request is the secret.
  const res = await fetch(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' }, redirect: 'manual' });
  if (res.status === 403) throw new Error('That token has already been used or has expired. Create a new one in SimpleFIN and paste it here.');
  if (!res.ok) throw new Error(`SimpleFIN didn't accept the token (status ${res.status}). Create a new one and try again.`);
  const access = (await res.text()).trim();
  let url;
  try { url = new URL(access); } catch { url = null; }
  if (!url || url.protocol !== 'https:' || !url.username) throw new Error('SimpleFIN returned an unexpected reply. Create a new token and try again.');
  setSetting('simplefin_access', access);
  setSetting('simplefin_last_sync', '');
}

export function disconnect() {
  setSetting('simplefin_access', '');
}

async function fetchAccounts(startSec, endSec) {
  const access = new URL(getSetting('simplefin_access'));
  const auth = Buffer.from(`${decodeURIComponent(access.username)}:${decodeURIComponent(access.password)}`).toString('base64');
  const url = `${access.origin}${access.pathname.replace(/\/$/, '')}/accounts?version=2&pending=1&start-date=${startSec}&end-date=${endSec}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (res.status === 403) throw new Error('SimpleFIN refused the connection. Access may have been turned off; reconnect with a new token.');
  if (res.status === 402) throw new Error('Your SimpleFIN subscription needs attention. Check your account at SimpleFIN.');
  if (!res.ok) throw new Error(`SimpleFIN returned an error (status ${res.status}). Try again later.`);
  return res.json();
}

// ---- Turning bank data into our rows ---------------------------------------

function guessType(name, balance, institution = '') {
  const n = name.toLowerCase();
  // "Auto Policy" at an insurer is a policy, not a car loan.
  if (/polic(y|ies)|insurance|premium/.test(n) || /insurance|state farm|allstate|geico|progressive|farm bureau|shelter insurance/.test(String(institution).toLowerCase())) return 'insurance';
  // A health savings account is its own type: savings set aside for medical costs, not everyday cash.
  if (/\bhsa\b|health savings|health spending/.test(n) || /\bhsa\b|healthequity|health equity|optum bank|wex health|further/.test(String(institution).toLowerCase())) return 'hsa';
  if (/mortgage|home loan/.test(n)) return 'mortgage';
  if (/auto|car loan|vehicle/.test(n)) return 'auto';
  if (/loan|student|line of credit/.test(n)) return 'loan';
  if (/card|credit|visa|mastercard|amex|discover|rewards/.test(n)) return 'credit';
  if (/401|403|ira\b|roth|brokerage|invest|retire|pension/.test(n)) return 'investment';
  if (/saving|money market|\bcd\b|certificate/.test(n)) return 'savings';
  if (/check|share draft|spending/.test(n)) return 'checking';
  return balance < 0 ? 'credit' : 'checking';
}

// Checked in order, so more specific names come first (fuel before groceries).
const KEYWORDS = [
  ['Transfer', /transfer|xfer |payment thank you|autopay|automatic payment|online payment|epayment|e-payment|credit card|store card|card payment|zelle|ach pmt|^payment$/],
  ['Income', /payroll|direct dep|salary|dir dep/],
  ['Fees and interest', /interest charge|late fee|service fee|overdraft|annual fee|finance charge/],
  ['Housing', /mortgage|\brent\b|hoa\b/],
  ['Loan payments', /capital one auto|aidvantage|nelnet|navient|mohela|student loan|loan payment|auto loan/],
  ['Gas and car', /fuel|gasoline|love'?s (?:travel|country|outs|#)|huck'?s|ntta|parkmobile|shell|exxon|chevron|casey|kum & go|murphy|uber|lyft|gas station|parking|valero|phillips 66|buc-ee|circle ?k|car ?wash|oil shop|autozone|o'reilly/],
  ['Groceries', /kroger|walmart|wal[- ]mart|huel|aldi|whole foods|trader joe|safeway|costco|sam's club|sams club|harps|grocer|food lion|publix/],
  ['Subscriptions', /malwarebytes|netflix|spotify|hulu|disney\+|disney plus|apple\.com\/bill|^apple$|apple services|youtube|icloud|prime video|max\.com|paramount|anthropic|openai|runway|oculus|adobe|microsoft|google/],
  ['Dining out', /krispy kreme|restaurant|cafe|coffee|koffee|starbucks|mcdonald|chick-fil|doordash|grubhub|uber eats|pizza|taco|sonic|chipotle|wendy|burger|grill|diner|bakery|donut|dunkin|whataburger|papa john|wingstop|hardee|freddy|dairy queen|panda express|olive garden|roadhouse|mcalister|arby|sushi|hibachi|smoothie|deli\b|chicken|catfish|7 brew|bundt|hacienda|tequila|lounge|bbq|wing|subway|kfc|popeyes|ihop|waffle/],
  ['Bills and utilities', /electric|energy|water|internet|at&t|verizon|t-mobile|cox|xfinity|entergy|swepco|utility|utilities|terminix|trash|municipal|waste/],
  ['Insurance', /insurance|geico|state farm|progressive|allstate/],
  ['Health', /pharm|\bphar\b|cvs|walgreens|clinic|dental|medical|hospital|doctor|pediatric|urgent care|vision/],
  ['Pets', /petsmart|petco|veterinar|\bvet\b|chewy/],
  ['Travel', /airline|delta air|united air|american air|southwest|hotel|airbnb|marriott|hilton/],
  ['Entertainment', /cinema|theatre|theater|amc|ticketmaster|seatgeek|steam|playstation|xbox|nintendo|roblox/],
  ['Shopping', /nike|under ?armou?r|(?:^|[^a-z])ua(?:[^a-z]|$)|amazon|target|best buy|ikea|apple store|ebay|etsy|home depot|lowe's|lowes|ulta|maurices|kohl|tj maxx|hobby lobby|five below|dollar general|dollar tree|kirkland|rack room|j crew|academy sports|harbor freight|bath & body|aliexpress|old navy|ross|marshalls/],
];

export function makeCategorizer() {
  // Built-in categories are found by the name they started with (`key`), so one that has been renamed still gets its purchases.
  const cats = db.prepare('SELECT id, name, key, kind FROM categories').all();
  const byName = Object.fromEntries(cats.map((c) => [c.key || c.name, c.id]));
  const rule = db.prepare('SELECT category_id FROM rules WHERE merchant = ?');
  return (merchant, amount, accountType) => {
    const learned = rule.get(merchant);
    if (learned) return learned.category_id;
    // Money moving in and out of investments and loans isn't spending.
    if (['investment', 'hsa', 'loan', 'auto', 'mortgage', 'insurance'].includes(accountType)) return byName.Transfer;
    // A deposit that carries one of the side gig's words is its pay (server/gig.js).
    const gigPay = gigCategoryFor(merchant, amount);
    if (gigPay) return gigPay;
    const m = merchant.toLowerCase();
    for (const [name, pattern] of KEYWORDS) {
      if (!pattern.test(m) || !byName[name]) continue;
      if (name === 'Income' && amount < 0) continue;
      return byName[name];
    }
    // Money in that nothing marks as pay is a plain deposit, not income (server/deposits.js): a gift,
    // rewards, a balance transfer, cash paid in. A deposit matching one of the household's paydays is pay.
    if (amount > 0) return accountType === 'credit' ? byName.Transfer : looksLikePay(merchant) ? byName.Income : depositCategoryId();
    return byName.Other;
  };
}

const cleanName = (s) => String(s || 'Unknown').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Unknown';

/** Remove the sample data the app shipped with, once real accounts arrive. */
export function removeSampleData() {
  if (getSetting('sample_removed') === '1') return;
  const sample = "SELECT id FROM accounts WHERE sfin_id IS NULL AND manual = 0 AND type != 'cash'";
  db.exec(`DELETE FROM transactions WHERE account_id IN (${sample});
           DELETE FROM balance_history WHERE account_id IN (${sample});
           DELETE FROM accounts WHERE sfin_id IS NULL AND manual = 0 AND type != 'cash';
           DELETE FROM recurrings;`);
  setSetting('sample_removed', '1');
}

export async function sync() {
  if (!connected()) throw new Error('Connect SimpleFIN first.');
  const now = Math.floor(Date.now() / 1000);
  const last = Number(getSetting('simplefin_last_sync')) || 0;
  // After the first sync, re-read the last week as well: banks post late.
  const windows = [];
  if (!last) for (let i = FIRST_SYNC_WINDOWS; i > 0; i--) windows.push([now - i * WINDOW_DAYS * DAY, now - (i - 1) * WINDOW_DAYS * DAY + DAY]);
  else windows.push([Math.max(last - 7 * DAY, now - WINDOW_DAYS * DAY), now + DAY]);

  const messages = new Set();
  const seenAccounts = new Map();
  const txs = [];
  for (const [start, end] of windows) {
    const data = await fetchAccounts(start, end);
    for (const e of data.errlist || []) messages.add(cleanName(e.msg));
    for (const e of data.errors || []) messages.add(cleanName(e));
    const conns = Object.fromEntries((data.connections || []).map((c) => [c.conn_id, c.name]));
    for (const a of data.accounts || []) {
      seenAccounts.set(a.id, { ...a, institution: conns[a.conn_id] || a.conn_name || a.org?.name || 'Bank' });
      for (const t of a.transactions || []) txs.push({ ...t, account: a.id });
    }
  }

  let added = 0, updated = 0, newAccounts = 0, matched = 0;
  db.exec('BEGIN');
  try {
    if (seenAccounts.size) removeSampleData();
    const findAcc = db.prepare('SELECT id, type FROM accounts WHERE sfin_id = ?');
    const local = new Map();
    for (const a of seenAccounts.values()) {
      const balance = Number(a.balance) || 0;
      let row = findAcc.get(a.id);
      if (!row) {
        const type = guessType(a.name, balance, a.institution);
        db.prepare('INSERT INTO accounts (name, institution, type, balance, sfin_id) VALUES (?,?,?,?,?)').run(cleanName(a.name), cleanName(a.institution), type, balance, a.id);
        row = findAcc.get(a.id);
        newAccounts++;
      } else {
        db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(balance, row.id);
      }
      // Banks also report what's available once pending purchases are taken
      // out. Only meaningful for accounts that hold money.
      const available = Number(a['available-balance']);
      db.prepare('UPDATE accounts SET available = ? WHERE id = ?')
        .run(['checking', 'savings'].includes(row.type) && a['available-balance'] != null && Number.isFinite(available) ? available : null, row.id);
      if (Number(a['balance-date']) > 0) {
        db.prepare('UPDATE accounts SET balance_at = ? WHERE id = ?').run(Number(a['balance-date']) * 1000, row.id);
        db.prepare('INSERT OR IGNORE INTO bank_reads (account_id, at) VALUES (?, ?)').run(row.id, Number(a['balance-date']) * 1000);
      }
      local.set(a.id, row);
      // What an investment account holds, where the bank lists it (server/holdings.js).
      if (Array.isArray(a.holdings) && ['investment', 'hsa'].includes(row.type)) saveHoldings(row.id, a.holdings);
      db.prepare('INSERT INTO balance_history (account_id, date, balance) VALUES (?,?,?) ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance')
        .run(row.id, iso(new Date()), balance);
    }

    const pending = [];
    const pendingIds = new Set();
    const held = new Set(); // waiting entries a pending charge has been paired with in this sync
    const heldPids = new Set();
    const categorize = makeCategorizer();
    const findTx = db.prepare('SELECT id FROM transactions WHERE sfin_id = ?');
    const claimRule = db.prepare('SELECT pct, kind FROM deduct_rules WHERE ? LIKE merchant ORDER BY length(merchant) DESC LIMIT 1');
    // A row that came from a file, on this account, for the same amount (its parts included) within three days.
    const fromFile = db.prepare(`SELECT t.id, t.category_id, t.sfin_id FROM transactions t WHERE t.account_id = ? AND t.sfin_id LIKE 'csv:%' AND t.split_of IS NULL AND t.waiting = 0 AND t.pending = 0
      AND ABS(t.amount + COALESCE((SELECT SUM(k.amount) FROM transactions k WHERE k.split_of = t.id), 0) - ?) < 0.005
      AND t.date >= date(?, '-3 days') AND t.date <= date(?, '+3 days') ORDER BY ABS(julianday(t.date) - julianday(?)), t.id LIMIT 1`);
    const otherId = db.prepare("SELECT id FROM categories WHERE COALESCE(key, name) = 'Other'").get()?.id ?? -1;
    for (const t of txs) {
      const acc = local.get(t.account);
      const when = t.posted || t.transacted_at;
      if (acc && t.pending) {
        // Pending purchases aren't final, so they're kept apart and replaced on each sync.
        const amt = Number(t.amount);
        if (!Number.isFinite(amt)) continue;
        const pDate = iso(new Date((t.transacted_at || t.posted || now) * 1000));
        const pName = cleanName(t.payee || t.description);
        pending.push([acc.id, pDate, pName, amt]);
        // Also listed with your transactions, flagged as pending, so spending is up to date.
        // The row goes away when the bank stops listing it (the posted charge takes its place).
        const pid = `${t.account}:${t.id}`;
        pendingIds.add(pid);
        const had = findTx.get(pid);
        // If you already typed this purchase in, your entry stands in for it until it posts.
        const mine = heldPids.has(pid) ? null : findWaiting(acc.id, pDate, amt, pName, held);
        if (mine || heldPids.has(pid)) {
          if (mine) { held.add(mine.id); heldPids.add(pid); }
          if (had) db.prepare('DELETE FROM transactions WHERE id = ? AND pending = 1').run(had.id);
          continue;
        }
        if (had) db.prepare('UPDATE transactions SET amount = ?, date = ? WHERE id = ? AND pending = 1').run(amt, pDate, had.id);
        else db.prepare('INSERT INTO transactions (account_id, date, merchant, amount, category_id, notes, sfin_id, pending) VALUES (?,?,?,?,?,?,?,1)')
          .run(acc.id, pDate, pName, amt, categorize(pName, amt, acc.type), '', pid);
        continue;
      }
      if (!acc || !when) continue;
      const sfinId = `${t.account}:${t.id}`;
      const amount = Number(t.amount);
      if (!Number.isFinite(amount)) continue;
      const date = iso(new Date(when * 1000));
      const existing = findTx.get(sfinId);
      if (existing) {
        // Keep your category and claims; only the bank's own facts are refreshed.
        // A purchase you split keeps its parts: its own row holds the bank's amount less theirs.
        const parts = db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM transactions WHERE split_of = ?').get(existing.id).s;
        const own = Math.round((amount - parts) * 100) / 100;
        updated += db.prepare('UPDATE transactions SET amount = ?, date = ? WHERE id = ? AND (ABS(amount - ?) > 0.004 OR date != ?)').run(own, date, existing.id, own, date).changes;
        if (parts) db.prepare('UPDATE transactions SET date = ? WHERE split_of = ?').run(date, existing.id);
        db.prepare('UPDATE transactions SET pending = 0 WHERE id = ? AND pending = 1').run(existing.id);
        continue;
      }
      const merchant = cleanName(t.payee || t.description);
      // A purchase you typed in while it was on its way: the bank's entry takes over your row.
      const mine = findWaiting(acc.id, date, amount, merchant);
      if (mine) { settle(mine.id, sfinId, date, amount, merchant); matched++; continue; }
      // The same transaction, brought in earlier from the bank's own export file (Import a file, or the CFO's
      // paperclip) because the connection was running behind: the bank's entry takes that row over, so it is
      // not there twice. It takes the connection's name for it, which the rest of the app knows; the category
      // stays unless it was only ever "Other". (Found 2026-11-24, when a file was imported on a connected account.)
      const filed = fromFile.get(acc.id, amount, date, date, date);
      if (filed) {
        db.prepare('INSERT OR IGNORE INTO file_rows (id, tx_id) VALUES (?, ?)').run(filed.sfin_id, filed.id);
        const loanName = ['checking', 'savings'].includes(acc.type) ? loanFor(merchant, amount) : null;
        const cat = filed.category_id === otherId ? categorize(merchant, amount, acc.type) : filed.category_id;
        db.prepare("UPDATE transactions SET sfin_id = ?, date = ?, merchant = ?, category_id = ?, notes = CASE WHEN notes = '' AND ? != '' THEN ? ELSE notes END WHERE id = ?")
          .run(sfinId, date, loanName ? paymentName(loanName) : merchant, cat, loanName ? merchant : '', loanName ? merchant : '', filed.id);
        db.prepare('UPDATE transactions SET date = ?, merchant = ? WHERE split_of = ?').run(date, loanName ? paymentName(loanName) : merchant, filed.id);
        matched++;
        continue;
      }
      const claim = amount < 0 ? claimRule.get(merchant) : null;
      // A regular loan payment is shown under the loan's own name; the bank's wording becomes the note.
      const loan = ['checking', 'savings'].includes(acc.type) ? loanFor(merchant, amount) : null;
      if (loan) db.prepare('INSERT OR IGNORE INTO rules (merchant, category_id) VALUES (?, ?)').run(paymentName(loan), categorize(merchant, amount, acc.type));
      db.prepare('INSERT INTO transactions (account_id, date, merchant, amount, category_id, notes, sfin_id, deduct_pct, deduct_kind) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(acc.id, date, loan ? paymentName(loan) : merchant, amount, categorize(merchant, amount, acc.type), loan ? merchant : '', sfinId, claim?.pct ?? 0, claim?.kind ?? 'vipkid');
      added++;
    }
    // Drop pending rows the bank no longer lists, for the accounts this sync heard from.
    const dropPending = db.prepare('DELETE FROM transactions WHERE id = ?');
    for (const acc of local.values()) {
      for (const r of db.prepare('SELECT id, sfin_id FROM transactions WHERE pending = 1 AND account_id = ?').all(acc.id)) {
        if (!pendingIds.has(r.sfin_id)) dropPending.run(r.id);
      }
    }
    db.exec('DELETE FROM pending_tx');
    const insPending = db.prepare('INSERT INTO pending_tx (account_id, date, merchant, amount) VALUES (?,?,?,?)');
    for (const p of pending) insPending.run(...p);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // New payments take their friendly bill names and loan names.
  applyNames();
  nameLoanPayments();

  const result = { at: Date.now(), added, updated, matched, accounts: seenAccounts.size, newAccounts, messages: [...messages] };
  setSetting('simplefin_last_sync', now);
  setSetting('simplefin_last_result', JSON.stringify(result));
  return result;
}

export function status() {
  let lastResult = null;
  try { lastResult = JSON.parse(getSetting('simplefin_last_result', 'null')); } catch { /* ignore */ }
  // What needs the household's attention (added 2026-11-18, from comparing with other budget apps, whose
  // commonest complaint is a bank connection breaking without anyone noticing): banks that want signing
  // in to again at SimpleFIN, a sync that failed, and accounts whose figures haven't moved in five days.
  const again = [...new Set((lastResult?.messages || []).map((m) => /^Connection to (.+?) may need attention/i.exec(m)?.[1]).filter(Boolean))];
  // An account counts as stale only when nothing at its bank has moved in five days. One quiet account
  // beside a sibling that updates (an HSA's empty investment side, say) is the bank not restating a figure,
  // not a broken connection.
  const cut = Date.now() - 5 * 86400000;
  const stale = connected() ? db.prepare(`SELECT name FROM accounts a WHERE sfin_id IS NOT NULL AND type != 'insurance' AND balance_at IS NOT NULL AND balance_at < ?
    AND NOT EXISTS (SELECT 1 FROM accounts b WHERE b.sfin_id IS NOT NULL AND b.institution = a.institution AND b.balance_at >= ?) ORDER BY name`).all(cut, cut).map((a) => a.name) : [];
  const failed = getSetting('simplefin_last_error');
  return {
    attention: connected() && (again.length || stale.length || failed) ? { again, stale, failed } : null,
    connected: connected(), lastResult, lastError: getSetting('simplefin_last_error'),
    sampleData: getSetting('sample_removed') !== '1',
    accounts: db.prepare('SELECT id, name, institution, type, balance FROM accounts WHERE sfin_id IS NOT NULL ORDER BY institution, name').all(),
  };
}

/**
 * One-time tidy-up after the categorizer improves: adds the newer categories
 * and re-files synced transactions that were left in "Other". Anything you
 * categorized yourself with a merchant rule is respected.
 */
export function upgradeCategories() {
  if (getSetting('categories_v2') === '1') return;
  db.prepare("UPDATE categories SET name = 'Housing' WHERE name = 'Rent'").run();
  const add = db.prepare("INSERT INTO categories (name, icon, color, kind, fixed, budget, sort) SELECT ?, ?, ?, 'expense', ?, 0, ? WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = ?)");
  add.run('Loan payments', '🏦', '#5b6b8c', 1, 11.2, 'Loan payments');
  add.run('Fees and interest', '💸', '#b0413e', 0, 11.4, 'Fees and interest');
  add.run('Pets', '🐾', '#8a6d3b', 0, 7.5, 'Pets');
  const other = db.prepare("SELECT id FROM categories WHERE name = 'Other'").get()?.id;
  const categorize = makeCategorizer();
  const rows = db.prepare(`SELECT t.id, t.merchant, t.amount, a.type FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE t.sfin_id IS NOT NULL AND (t.category_id = ? OR t.merchant LIKE '%fuel%')`).all(other);
  const set = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
  for (const r of rows) set.run(categorize(r.merchant, r.amount, r.type), r.id);
  setSetting('categories_v2', '1');
}

/** Sync every four hours while the app is running, and hourly while new figures from the bank are due (the bank feed allows 24 requests a day). */
export function startAutoSync() {
  const tick = async () => {
    const next = nextReadAt();
    if (!connected() || (next && Date.now() < next)) return;
    try {
      await sync();
      setSetting('simplefin_last_error', '');
    } catch (e) {
      setSetting('simplefin_last_error', e.message);
    }
  };
  setTimeout(tick, 20000);
  // Looked at every five minutes, so a reading happens close to the time `nextReadAt` gives.
  setInterval(tick, 5 * 60000);
}
