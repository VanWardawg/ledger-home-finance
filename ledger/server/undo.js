// Undo after Remove (2026-11-23, the owner's go-ahead on a gap found in the pre-beta check).
// A route that removes something hands the rows it removed to keepForUndo() first and sends the token
// back; the page shows "Removed … Undo" for a few seconds, and POST /api/undo puts the rows back.
// Kept in memory only: ten minutes, the last eight removals, gone on a restart. Nothing here can bring
// back something the bank reported, because those are never removed in the first place.
import crypto from 'node:crypto';
import { db } from './db.js';

const KEEP_MS = 10 * 60 * 1000;
const kept = new Map();   // token -> { at, label, rows: [{ table, row }] }

const tidy = () => {
  const cutoff = Date.now() - KEEP_MS;
  for (const [k, v] of kept) if (v.at < cutoff) kept.delete(k);
  while (kept.size > 8) kept.delete(kept.keys().next().value);
};

/** Remembers rows about to be removed. `rows` is a list of { table, row }; transactions first, then what hangs off them. */
export function keepForUndo(label, rows) {
  tidy();
  const token = crypto.randomBytes(12).toString('hex');
  kept.set(token, { at: Date.now(), label: String(label || '').slice(0, 80), rows: rows.filter((r) => r && r.row) });
  return token;
}

const TABLES = new Set(['transactions', 'recurrings', 'receipts']);
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

function putBack(entry) {
  const ids = new Map();   // a transaction's old id -> the id it has now
  db.exec('BEGIN');
  try {
    for (const { table, row } of entry.rows) {
      if (!TABLES.has(table)) continue;
      const cols = columns(table).filter((c) => c in row);
      const r = { ...row };
      if (table === 'transactions') {
        // Its number may have been handed to something added since: then it takes a new one.
        if (db.prepare('SELECT 1 FROM transactions WHERE id = ?').get(row.id)) delete r.id;
        if (r.split_of != null && ids.has(r.split_of)) r.split_of = ids.get(r.split_of);
      }
      if (table === 'recurrings' && db.prepare('SELECT 1 FROM recurrings WHERE id = ?').get(row.id)) delete r.id;
      if (table === 'receipts') {
        delete r.id;
        if (ids.has(r.transaction_id)) r.transaction_id = ids.get(r.transaction_id);
      }
      const use = cols.filter((c) => c in r);
      const made = Number(db.prepare(`INSERT INTO ${table} (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`).run(...use.map((c) => r[c])).lastInsertRowid);
      if (table === 'transactions') {
        ids.set(row.id, made);
        // Adding a row gives it the newest place in line; it gets its old place back, so a balance kept by
        // hand counts it exactly as it did before it was removed.
        if (row.seq != null) db.prepare('UPDATE transactions SET seq = ? WHERE id = ?').run(row.seq, made);
      }
    }
    // The two halves of a recorded transfer find each other again.
    for (const { table, row } of entry.rows) {
      if (table === 'transactions' && row.pair != null && ids.has(row.pair)) db.prepare('UPDATE transactions SET pair = ? WHERE id = ?').run(ids.get(row.pair), ids.get(row.id));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function installUndo(app) {
  app.post('/api/undo', (req, res) => {
    tidy();
    const token = String(req.body?.token || '');
    const entry = kept.get(token);
    if (!entry) return res.status(400).json({ error: "That can no longer be undone. Undo is offered for ten minutes after something is removed." });
    try { putBack(entry); } catch (e) { return res.status(500).json({ error: `It couldn't be put back: ${e.message}` }); }
    kept.delete(token);
    res.json({ ok: true, label: entry.label });
  });
}
