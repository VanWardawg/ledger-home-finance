// Investments: what each investment account holds, and how its value has moved (added 2026-11-18, the owner's
// choice after comparing Ledger with other budget apps, which show holdings and performance).
//
// Holdings come two ways. Where the bank connection lists them (SimpleFIN gives `holdings` on some
// investment accounts: a name, a symbol, shares, market value and what was paid), each sync replaces that
// account's list. For an account kept by hand, or one whose bank lists nothing, they are typed in on the
// Accounts page and their values are updated by hand: Ledger does not look prices up anywhere.
//
// Performance is read from what Ledger already keeps: the account's value on each day it was recorded
// (`balance_history`), giving the change over a month, three months, this year and a year; and, where a
// holding has a cost, the gain against what was paid. A change in value includes money you added, so
// deposits recorded on the account in the same stretch are shown beside it.
import { db, iso } from './db.js';
import { setStart } from './tap.js';

db.exec(`CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, symbol TEXT NOT NULL DEFAULT '',
  shares REAL, value REAL NOT NULL DEFAULT 0, cost REAL, manual INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, UNIQUE (account_id, key))`);

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** At sync: the bank's own list for one account takes the place of the last one. Holdings typed by hand are left alone. */
export function saveHoldings(accountId, list) {
  if (!Array.isArray(list)) return 0;
  const rows = [];
  for (const h of list.slice(0, 300)) {
    const value = num(h.market_value);
    const name = text(h.description || h.symbol, 120);
    if (value === null || !name) continue;
    rows.push({ key: `s:${text(h.id || `${h.symbol}:${h.description}`, 120)}`, name, symbol: text(h.symbol, 20).toUpperCase(), shares: num(h.shares), value: round(value), cost: num(h.cost_basis) === null ? null : round(num(h.cost_basis)) });
  }
  db.prepare('DELETE FROM holdings WHERE account_id = ? AND manual = 0').run(accountId);
  const put = db.prepare('INSERT OR REPLACE INTO holdings (account_id, key, name, symbol, shares, value, cost, manual, updated) VALUES (?,?,?,?,?,?,?,0,?)');
  for (const r of rows) put.run(accountId, r.key, r.name, r.symbol, r.shares, r.value, r.cost, Date.now());
  return rows.length;
}

/** The account's recorded value on or just before a date, or null when Ledger didn't know the account then. */
const valueOn = (accountId, date) => db.prepare('SELECT balance, date FROM balance_history WHERE account_id = ? AND date <= ? ORDER BY date DESC LIMIT 1').get(accountId, date) || null;
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));

export function investments() {
  const today = iso(new Date());
  const accounts = db.prepare("SELECT id, name, institution, type, balance, sfin_id, manual FROM accounts WHERE type = 'investment' OR (type = 'hsa' AND id IN (SELECT account_id FROM holdings)) ORDER BY balance DESC").all();
  const out = accounts.map((a) => {
    const holdings = db.prepare('SELECT * FROM holdings WHERE account_id = ? ORDER BY value DESC').all(a.id)
      .map((h) => ({ ...h, manual: !!h.manual, gain: h.cost === null ? null : round(h.value - h.cost), gainPct: h.cost ? Math.round(((h.value - h.cost) / h.cost) * 1000) / 10 : null }));
    const first = db.prepare('SELECT MIN(date) d FROM balance_history WHERE account_id = ?').get(a.id).d;
    const span = (label, from) => {
      const then = valueOn(a.id, from);
      if (!then) return null;                                    // Ledger hadn't met the account yet
      const added = round(db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM transactions WHERE account_id = ? AND date > ? AND date <= ? AND pending = 0').get(a.id, then.date, today).s);
      const change = round(a.balance - then.balance);
      return { label, from: then.date, was: then.balance, change, pct: then.balance > 0 ? Math.round((change / then.balance) * 1000) / 10 : null, added, growth: round(change - added) };
    };
    const spans = [span('1 month', daysAgo(30)), span('3 months', daysAgo(91)), span('This year', `${today.slice(0, 4)}-01-01`), span('1 year', daysAgo(365))].filter(Boolean);
    // Since Ledger first saw it, when that is all there is to go on.
    const since = first && first < today ? span('Since Ledger first saw it', first) : null;
    const withCost = holdings.filter((h) => h.cost !== null);
    return {
      id: a.id, name: a.name, institution: a.institution, balance: a.balance, byHand: !a.sfin_id && !!a.manual, since: first,
      holdings, held: round(holdings.reduce((s, h) => s + h.value, 0)),
      cost: withCost.length ? round(withCost.reduce((s, h) => s + h.cost, 0)) : null,
      gain: withCost.length ? round(withCost.reduce((s, h) => s + h.value - h.cost, 0)) : null,
      spans: spans.length ? spans : since ? [since] : [],
      history: db.prepare('SELECT date, balance FROM balance_history WHERE account_id = ? AND date >= ? ORDER BY date').all(a.id, daysAgo(365)),
    };
  });
  return { accounts: out, total: round(out.reduce((s, a) => s + a.balance, 0)) };
}

export function installHoldings(app) {
  app.get('/api/investments', (_req, res) => res.json(investments()));

  // The value of an account kept by hand follows the holdings typed on it.
  const follow = (accountId) => {
    const a = db.prepare('SELECT id, sfin_id, manual FROM accounts WHERE id = ?').get(accountId);
    if (!a || a.sfin_id || !a.manual) return;
    setStart(a.id, round(db.prepare('SELECT COALESCE(SUM(value), 0) s FROM holdings WHERE account_id = ?').get(a.id).s));
  };
  const clean = (b) => {
    const name = text(b?.name, 80), value = num(b?.value), shares = num(b?.shares), cost = num(b?.cost);
    if (!name) return { error: 'Enter what it is, for example "Total market index fund".' };
    if (value === null || value < 0 || value > 1e9) return { error: "Enter what it's worth today, 0 or more." };
    if (shares !== null && (shares < 0 || shares > 1e9)) return { error: 'Enter the number of shares, or leave it blank.' };
    if (cost !== null && (cost < 0 || cost > 1e9)) return { error: 'Enter what you paid in all, or leave it blank.' };
    return { name, symbol: text(b?.symbol, 12).toUpperCase(), value: round(value), shares, cost: cost === null ? null : round(cost) };
  };
  app.post('/api/investments/:account/holdings', (req, res) => {
    const a = db.prepare("SELECT id FROM accounts WHERE id = ? AND type IN ('investment', 'hsa')").get(Number(req.params.account));
    if (!a) return res.status(400).json({ error: 'Choose an investment account.' });
    const h = clean(req.body);
    if (h.error) return res.status(400).json(h);
    if (db.prepare('SELECT COUNT(*) n FROM holdings WHERE account_id = ?').get(a.id).n >= 100) return res.status(400).json({ error: 'That is as many holdings as one account takes.' });
    const id = Number(db.prepare("INSERT INTO holdings (account_id, key, name, symbol, shares, value, cost, manual, updated) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)")
      .run(a.id, `m:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, h.name, h.symbol, h.shares, h.value, h.cost, Date.now()).lastInsertRowid);
    follow(a.id);
    res.json({ id });
  });
  app.patch('/api/holdings/:id', (req, res) => {
    const row = db.prepare('SELECT id, account_id FROM holdings WHERE id = ? AND manual = 1').get(Number(req.params.id));
    if (!row) return res.status(400).json({ error: 'Only holdings you typed in can be changed. The bank keeps the rest up to date.' });
    const h = clean(req.body);
    if (h.error) return res.status(400).json(h);
    db.prepare('UPDATE holdings SET name = ?, symbol = ?, shares = ?, value = ?, cost = ?, updated = ? WHERE id = ?').run(h.name, h.symbol, h.shares, h.value, h.cost, Date.now(), row.id);
    follow(row.account_id);
    res.json({ ok: true });
  });
  app.delete('/api/holdings/:id', (req, res) => {
    const row = db.prepare('SELECT id, account_id FROM holdings WHERE id = ? AND manual = 1').get(Number(req.params.id));
    if (!row) return res.status(400).json({ error: 'Only holdings you typed in can be removed.' });
    db.prepare('DELETE FROM holdings WHERE id = ?').run(row.id);
    follow(row.account_id);
    res.json({ ok: true });
  });
}
