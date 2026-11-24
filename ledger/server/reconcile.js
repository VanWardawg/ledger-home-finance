// Checking a stretch of an account against the bank's statement (added 2026-11-19, the owner's choice from the
// comparison with other budget apps, which call this reconciling).
//
// A statement prints four things this needs: the day it starts, the day it ends, and the balance at each
// end. Whatever the balance moved by between them is what the transactions in between must add up to. Ledger
// adds up the ones it has for those days and compares. When they agree, every transaction in that stretch
// is accounted for. When they don't, the gap is a single figure, and most mistakes leave a recognisable
// one: something missing, something entered twice, something dated just the other side of the line, or an
// amount typed the wrong way round. The answer lists whichever of those fit.
//
// Nothing is changed by a check: it only reads transactions and remembers the result (`statement_checks`),
// so the next one can start where this one ended.
import { db, iso } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS statement_checks (
  account_id INTEGER NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, opening REAL NOT NULL, closing REAL NOT NULL,
  gap REAL NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (account_id, end))`);

const round = (n) => Math.round(n * 100) / 100;
const OWED = ['credit', 'auto', 'mortgage', 'loan'];
/** Kinds of account whose balance only moves by its transactions, so a statement can be checked. */
export const CHECKABLE = ['checking', 'savings', 'credit', 'hsa'];
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && iso(new Date(`${s}T12:00:00`)) === s;
const shift = (date, days) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return iso(d); };
const EDGE = 4;      // days either side of a statement's first and last day where the bank's date may differ

/** The last check of each account, for the Accounts page. */
export function lastChecks() {
  const out = {};
  for (const r of db.prepare('SELECT account_id, start, end, closing, gap FROM statement_checks ORDER BY end').all()) out[r.account_id] = r;
  return out;
}

/**
 * Compares one account's transactions between two days with what the statement says the balance moved by.
 * `opening` and `closing` are as printed: what was in the account, or for a card what was owed.
 */
export function checkStatement(accountId, { start, end, opening, closing }) {
  const acc = db.prepare('SELECT id, name, type, manual, sfin_id FROM accounts WHERE id = ?').get(accountId);
  if (!acc || !CHECKABLE.includes(acc.type)) return { error: "A statement can be checked for a checking, savings, card or health savings account." };
  if (!isDate(start) || !isDate(end)) return { error: "Enter the statement's first and last day." };
  if (end < start) return { error: 'The last day comes before the first day.' };
  if (end > iso(new Date())) return { error: "The statement's last day is in the future." };
  if (Date.parse(end) - Date.parse(start) > 400 * 86400000) return { error: 'Check a year or less at a time.' };
  const o = Number(opening), c = Number(closing);
  if (opening === '' || opening == null || !Number.isFinite(o) || Math.abs(o) > 1e9) return { error: "Enter the balance at the start of the statement." };
  if (closing === '' || closing == null || !Number.isFinite(c) || Math.abs(c) > 1e9) return { error: "Enter the balance at the end of the statement." };
  const owed = OWED.includes(acc.type);
  const sign = owed ? -1 : 1;                           // what's owed is kept as a negative balance
  const expected = round(sign * (c - o));               // what the transactions should add up to

  // On a connected account a purchase still waiting for the bank, or one the bank lists as pending, hasn't
  // reached a statement. On an account kept by hand everything entered counts.
  const fed = !acc.manual;
  const all = db.prepare(`SELECT t.id, t.date, t.merchant, t.amount, t.manual, t.waiting, t.pending, t.split_of
    FROM transactions t WHERE t.account_id = ? AND t.date >= ? AND t.date <= ? ORDER BY t.date, t.id`).all(acc.id, shift(start, -EDGE), shift(end, EDGE));
  const counts = (t) => !t.pending && !(fed && t.waiting);
  const inside = (t) => t.date >= start && t.date <= end;
  const rows = all.filter((t) => inside(t) && counts(t));
  const got = round(rows.reduce((s, t) => s + t.amount, 0));
  const gap = round(expected - got);                    // above 0: the statement has more money in (or less out) than Ledger

  const moneyIn = round(rows.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  const moneyOut = round(-rows.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const show = (t) => ({ id: t.id, date: t.date, merchant: t.merchant, amount: t.amount, typed: !!t.manual });
  const same = (a, b) => Math.abs(a - b) < 0.005;

  const ideas = [];
  if (!same(gap, 0)) {
    // 1. Entered twice: two alike within a few days, and one of them is the gap.
    const twice = [];
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (same(a.amount, -gap) && same(a.amount, b.amount) && Date.parse(b.date) - Date.parse(a.date) <= 4 * 86400000 && !a.split_of && !b.split_of) twice.push(show(a), show(b));
    }
    if (twice.length) ideas.push({ kind: 'twice', rows: twice.filter((r, i, l) => l.findIndex((x) => x.id === r.id) === i).slice(0, 8) });
    // 2. Not on the statement at all: one entry in the stretch is exactly the gap.
    const extra = rows.filter((t) => same(t.amount, -gap) && !twice.some((r) => r.id === t.id));
    if (extra.length) ideas.push({ kind: 'extra', rows: extra.slice(0, 8).map(show) });
    // 3. Dated just outside, though the bank put it on this statement.
    const outside = all.filter((t) => !inside(t) && counts(t) && same(t.amount, gap));
    if (outside.length) ideas.push({ kind: 'outside', rows: outside.slice(0, 8).map(show) });
    // 4. Entered and still waiting for the bank, though the statement already has it.
    const held = all.filter((t) => inside(t) && !counts(t) && same(t.amount, gap));
    if (held.length) ideas.push({ kind: 'waiting', rows: held.slice(0, 8).map(show) });
    // 5. The wrong way round: money in typed as money out, or the reverse, leaves twice the amount.
    const flipped = rows.filter((t) => t.manual && same(t.amount * 2, -gap));
    if (flipped.length) ideas.push({ kind: 'flipped', rows: flipped.slice(0, 8).map(show) });
    // 6. Two digits swapped when typing (54 for 45) always leaves a gap that divides by 9.
    const typed = rows.filter((t) => t.manual && !t.split_of);
    if (typed.length && Math.round(Math.abs(gap) * 100) % 9 === 0) ideas.push({ kind: 'swapped', rows: typed.slice(0, 12).map(show) });
    // 7. Otherwise something is on the statement that Ledger doesn't have.
    ideas.push({ kind: 'missing', amount: gap });
  }

  db.prepare(`INSERT INTO statement_checks (account_id, start, end, opening, closing, gap, created) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(account_id, end) DO UPDATE SET start = excluded.start, opening = excluded.opening, closing = excluded.closing, gap = excluded.gap, created = excluded.created`)
    .run(acc.id, start, end, round(o), round(c), gap, Date.now());

  return {
    account: { id: acc.id, name: acc.name, owed, byHand: !fed },
    start, end, opening: round(o), closing: round(c),
    expected, got, gap, matches: same(gap, 0),
    count: rows.length, moneyIn, moneyOut,
    // What the statement's own totals should read, in its own words: for a card, charges and payments.
    ideas, rows: rows.slice(0, 500).map(show),
    left: all.filter((t) => inside(t) && !counts(t)).length,
  };
}

export function installReconcile(app) {
  // Where the next check of an account would start: the day after the last one, at its closing balance.
  app.get('/api/accounts/:id/statement', (req, res) => {
    const last = db.prepare('SELECT start, end, opening, closing, gap FROM statement_checks WHERE account_id = ? ORDER BY end DESC LIMIT 1').get(Number(req.params.id));
    res.json({ last: last || null, next: last ? { start: shift(last.end, 1), opening: last.closing } : null });
  });
  app.post('/api/accounts/:id/statement', (req, res) => {
    const out = checkStatement(Number(req.params.id), req.body || {});
    res.status(out.error ? 400 : 200).json(out);
  });
  app.delete('/api/accounts/:id/statement', (req, res) => {
    db.prepare('DELETE FROM statement_checks WHERE account_id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
}
