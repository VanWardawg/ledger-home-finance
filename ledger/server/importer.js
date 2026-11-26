// Import transactions from a CSV file exported by a bank or card (for
// accounts the bank feed can't reach, such as Apple Card).
import { nameLoanPayments, loanFor, paymentName } from './loans.js';
import { applyNames, friendlyName } from './names.js';
import crypto from 'node:crypto';
import { db } from './db.js';
import { findWaiting, settle } from './waiting.js';
import { makeCategorizer, removeSampleData } from './simplefin.js';

/** Minimal CSV reader: handles quoted fields, embedded commas and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const find = (headers, patterns) => {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

function toDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}
const toNumber = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : null;
};

// A bank's export can list charges that are still pending ("Pending: CKCD AUTH 11/16 WHATABURGER 14").
// They aren't transactions yet: the date beside them is a guess at when they'll post
// and the wording changes when they do. So they are kept as waiting entries, the same
// as a purchase typed in by hand, and the posted version takes each one over later.
const PENDING = /^(?:memo\s?post:\s*)?pending:\s*/i;
const AUTH = /^(?:(?:ckcd auth|pos db|pos debit|pos purchase|debit card purchase|ach debit)\s+)?(?:(\d{1,2})\/(\d{1,2})\s+)?/i;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** A pending row's merchant without the bank's boilerplate, and the day of the purchase (never in the future). */
function pendingDetails(merchant, date) {
  const today = todayIso();
  const text = merchant.replace(PENDING, '');
  const m = AUTH.exec(text);
  const name = text.slice(m[0].length).replace(/^AC-/i, '').trim() || text;
  if (m[1]) {
    const y = Number(today.slice(0, 4));
    for (const year of [y, y - 1]) {
      const d = `${year}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
      if (!Number.isNaN(Date.parse(d)) && d <= today) return { name, date: d };
    }
  }
  return { name, date: date > today ? today : date };
}

/** Read a CSV into rows of { date, merchant, amount } where spending is negative. */
export function readFile(text, flip) {
  const rows = parseCsv(String(text || ''));
  if (rows.length < 2) throw new Error("That file doesn't have any transactions in it.");
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = {
    date: find(headers, [/^transaction date$/, /^date$/, /^posted date$/, /^posting date$/, /date/]),
    merchant: find(headers, [/^merchant$/, /^payee$/, /^description$/, /^name$/, /description|merchant|payee|memo/]),
    amount: find(headers, [/^amount/, /amount/]),
    debit: find(headers, [/^debit/, /withdrawal/]),
    credit: find(headers, [/^credit/, /deposit/]),
    type: find(headers, [/^type$/, /transaction type/]),
  };
  if (col.date < 0 || col.merchant < 0 || (col.amount < 0 && col.debit < 0)) {
    throw new Error("Couldn't find date, description, and amount columns in that file. Export it as CSV and try again.");
  }
  const out = [];
  for (const r of rows.slice(1)) {
    const date = toDate(r[col.date]);
    let amount = col.amount >= 0 ? toNumber(r[col.amount]) : null;
    if (amount == null && col.debit >= 0) {
      const debit = toNumber(r[col.debit]), credit = col.credit >= 0 ? toNumber(r[col.credit]) : null;
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    }
    if (!date || amount == null || amount === 0) continue;
    const merchant = String(r[col.merchant] || 'Unknown').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Unknown';
    out.push({ date, merchant, amount, type: col.type >= 0 ? String(r[col.type] || '').toLowerCase() : '', pending: PENDING.test(merchant) });
  }
  if (!out.length) throw new Error("Couldn't read any transactions from that file.");
  // Card exports usually list purchases as positive numbers. Detect that from
  // a Type column when there is one, otherwise from which sign is more common.
  const purchases = out.filter((t) => /purchase|sale|debit/.test(t.type));
  const suggestFlip = col.amount >= 0 && (purchases.length ? purchases.filter((t) => t.amount > 0).length > purchases.length / 2 : out.filter((t) => t.amount > 0).length > out.length * 0.6);
  const useFlip = flip == null ? suggestFlip : !!flip;
  for (const t of out) if (useFlip) t.amount = -t.amount;
  return { rows: out, suggestFlip, flipped: useFlip };
}

export function preview(text, flip) {
  const { rows: all, suggestFlip, flipped } = readFile(text, flip);
  const rows = all.filter((r) => !r.pending).length ? all.filter((r) => !r.pending) : all;
  const dates = rows.map((r) => r.date).sort();
  return {
    pending: all.filter((r) => r.pending).length,
    count: rows.length, from: dates[0], to: dates.at(-1), suggestFlip, flipped,
    spending: Math.round(-rows.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0) * 100) / 100,
    sample: rows.slice(0, 6).map(({ date, merchant, amount }) => ({ date, merchant, amount })),
  };
}

// Fingerprints of file rows the bank connection has since taken over (server/simplefin.js), so the same file,
// or one that overlaps it, can be brought in again without adding them back.
db.exec('CREATE TABLE IF NOT EXISTS file_rows (id TEXT PRIMARY KEY)');
if (!db.prepare('PRAGMA table_info(file_rows)').all().some((c) => c.name === 'tx_id')) db.exec('ALTER TABLE file_rows ADD COLUMN tx_id INTEGER');

export function importFile(text, flip, accountId) {
  const account = db.prepare('SELECT id, type, manual FROM accounts WHERE id = ?').get(Number(accountId));
  if (!account) throw new Error('Choose an account to import into.');
  const { rows } = readFile(text, flip);
  const categorize = makeCategorizer();
  const claimRule = db.prepare('SELECT pct, kind FROM deduct_rules WHERE ? LIKE merchant ORDER BY length(merchant) DESC LIMIT 1');
  // A row is already here under its own fingerprint, or was and the bank's entry has since taken it over (file_rows).
  const exists = db.prepare('SELECT date FROM transactions WHERE sfin_id = ?1 UNION ALL SELECT (SELECT date FROM transactions WHERE id = f.tx_id) FROM file_rows f WHERE f.id = ?1');
  const insert = db.prepare('INSERT INTO transactions (account_id, date, merchant, amount, category_id, notes, sfin_id, deduct_pct, deduct_kind) VALUES (?,?,?,?,?,?,?,?,?)');
  // Each row gets a fingerprint, so importing the same file twice (or two
  // overlapping months) doesn't create duplicates. Identical rows on the same
  // day are told apart by their position.
  const seen = {};
  // Rows the bank feed already delivered are skipped too: a row counts as
  // already here if this account has a synced transaction with the same date
  // and amount that an earlier row in this file hasn't been matched to.
  // A purchase that was split across categories is matched by its whole amount (its own row plus its parts).
  // Rows that came from an earlier file count as well (2026-11-24): months first loaded from statements are
  // worded differently in the bank's own export, so their fingerprints never match, and without this a file
  // reaching back that far added them all again. Only rows that were here before this import began count
  // (`before`), so two alike in one file are still two; and a row of this file that is matched some other way
  // (its fingerprint, or a waiting entry it took over) uses up one of the matches for its day and amount.
  const before = db.prepare('SELECT COALESCE(MAX(id), 0) m FROM transactions').get().m;
  const synced = db.prepare(`SELECT COUNT(*) n FROM transactions t WHERE account_id = ? AND date = ? AND split_of IS NULL AND waiting = 0 AND (sfin_id IS NULL OR sfin_id NOT LIKE 'csv:%' OR t.id <= ${before})
    AND ABS(amount + COALESCE((SELECT SUM(k.amount) FROM transactions k WHERE k.split_of = t.id), 0) - ?) < 0.005`);
  const matched = {};
  let added = 0, skipped = 0, pendingAdded = 0, pendingKnown = 0;
  // Only an account the bank reports on can have entries waiting for the bank.
  const waits = account.type !== 'cash' && !account.manual;
  const posted = waits ? rows.filter((t) => !t.pending) : rows;
  const pending = waits ? rows.filter((t) => t.pending) : [];
  const insertWaiting = db.prepare('INSERT INTO transactions (account_id, date, merchant, amount, category_id, notes, manual, waiting) VALUES (?,?,?,?,?,?,1,1)');
  db.exec('BEGIN');
  try {
    removeSampleData();
    // Pending charges: one you've already entered is left alone; the rest are added as waiting.
    const used = new Set();
    for (const t of pending) {
      const { name, date } = pendingDetails(t.merchant, t.date);
      const mine = findWaiting(account.id, date, t.amount, name, used);
      if (mine) { used.add(mine.id); pendingKnown++; continue; }
      const loan = t.amount < 0 ? loanFor(name, t.amount) : null;
      const shown = loan ? paymentName(loan) : friendlyName(name, t.amount) || name;
      const id = Number(insertWaiting.run(account.id, date, shown, t.amount, categorize(name, t.amount, account.type), `Pending at the bank, from a file${shown === name ? '' : ` (${name})`}`).lastInsertRowid);
      used.add(id);
      pendingAdded++;
    }
    for (const t of posted) {
      const key = `${account.id}|${t.date}|${t.amount.toFixed(2)}|${t.merchant}`;
      seen[key] = (seen[key] || 0) + 1;
      const id = 'csv:' + crypto.createHash('sha1').update(`${key}|${seen[key]}`).digest('hex').slice(0, 20);
      const sameDay = `${t.date}|${t.amount.toFixed(2)}`;
      const here = exists.get(id);
      if (here) { if (here.date === t.date) matched[sameDay] = (matched[sameDay] || 0) + 1; skipped++; continue; }
      // A purchase you typed in ahead of the statement: this row takes over your entry.
      const mine = findWaiting(account.id, t.date, t.amount, t.merchant);
      if (mine) { settle(mine.id, id, t.date, t.amount, t.merchant); matched[sameDay] = (matched[sameDay] || 0) + 1; added++; continue; }
      if ((matched[sameDay] || 0) < synced.get(account.id, t.date, t.amount).n) { matched[sameDay] = (matched[sameDay] || 0) + 1; skipped++; continue; }
      const claim = t.amount < 0 ? claimRule.get(t.merchant) : null;
      insert.run(account.id, t.date, t.merchant, t.amount, categorize(t.merchant, t.amount, account.type), '', id, claim?.pct ?? 0, claim?.kind ?? 'vipkid');
      added++;
    }
    db.exec('COMMIT');
    applyNames();
    nameLoanPayments();
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { added, skipped, pendingAdded, pendingKnown };
}
