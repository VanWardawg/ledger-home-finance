// How much a copy of Ledger is used, for the person who hosts it (their Settings, Family requests,
// a click on the household's name). Agreed with the owner on 2026-11-18, with a line drawn on purpose:
//
//   Reported: which days the copy was opened, whether setup was finished, whether a bank is
//   connected (yes or no), how many devices are signed in, what the AI has cost, how big the
//   database file is, and which build it runs.
//
//   Never reported: balances, transactions, budgets, merchants, any dollar figure of theirs, what
//   they ask the CFO, which pages they look at, or counts that hint at their finances (accounts,
//   debts). The welcome email promises "nobody else can see what you put in it"; keep it true.
//   About says what the host can see. If something is added here, add it there too.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, getSetting } from './db.js';
import { hostAi } from './ai.js';

db.exec('CREATE TABLE IF NOT EXISTS active_days (day TEXT PRIMARY KEY, first INTEGER NOT NULL, last INTEGER NOT NULL)');

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Notes that the copy is in use right now. Called for every signed-in request; writes at most once a minute. */
let noted = 0;
export function noteActive() {
  const now = Date.now();
  if (now - noted < 60_000) return;
  noted = now;
  try { db.prepare('INSERT INTO active_days (day, first, last) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET last = excluded.last').run(dayOf(now), now, now); } catch { /* never in the way of the request */ }
}

/** The fingerprint of the built page this server is serving ('' when run from source). The same value /version.json gives. */
let fingerprint;
export function buildId() {
  if (fingerprint === undefined) {
    try { fingerprint = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'dist', 'index.html'))).digest('hex').slice(0, 12); } catch { fingerprint = ''; }
  }
  return fingerprint;
}

/** What the host is told about this copy. See the list at the top of this file before adding to it. */
export function copyActivity() {
  const now = Date.now();
  const since = dayOf(now - 29 * 86400_000);
  const days = db.prepare('SELECT day FROM active_days WHERE day >= ? ORDER BY day').all(since).map((r) => r.day);
  const span = db.prepare('SELECT MIN(first) first, MAX(last) last, COUNT(*) n FROM active_days').get();
  const dir = process.env.LEDGER_DATA_DIR || path.join(root, 'data');
  let bytes = 0;
  for (const f of ['ledger.db', 'ledger.db-wal']) { try { bytes += fs.statSync(path.join(dir, f)).size; } catch { /* no such file yet */ } }
  return {
    lastUsed: span.last || null,
    firstUsed: span.first || null,
    daysEver: span.n || 0,
    days,                                   // the days it was opened, of the last 30 (dates only)
    today: dayOf(now),
    passwordSet: getSetting('password_hash') !== '' || getSetting('access_login') === '1',   // claimed, by password or by Cloudflare's check alone
    setupDone: getSetting('setup_done', '1') !== '0',
    bank: getSetting('simplefin_access') !== '',
    devices: db.prepare('SELECT COUNT(*) n FROM sessions WHERE expires > ?').get(now).n,
    bytes,
    build: buildId(),
    ai: hostAi(),
  };
}
