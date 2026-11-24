// "Delete everything" on a family copy (added 2026-11-19; the owner agreed to it after asking what it was for).
//
// A household can wipe its own copy from Settings without asking the person who runs the server. The whole
// database goes: accounts, transactions, budgets, bills, goals, receipts, tax figures, the bank connection,
// passwords and sign-ins. The program then stops, the container starts it again, and it comes up as an
// empty copy, still set aside for the same household, who can start over or simply leave it.
//
// Three things are carried across, because they are the host's and not the household's: which Cloudflare
// sign-in guards the copy (team, audience tag, approved emails), and whether the host's AI was switched off
// for it. They wait in `carry.json` beside the database for the few seconds in between.
//
// Never on a copy without a setup code: that is the owner's own, whose database must not be removed this way.
// What this can't reach: the nightly backups of the server, which age out by themselves (30 nights).
import fs from 'node:fs';
import path from 'node:path';
import { db, dbPath, getSetting, setSetting } from './db.js';

const CARRIED = ['access_team', 'access_aud', 'access_emails', 'ai_host_off'];
const carryPath = path.join(path.dirname(dbPath), 'carry.json');

// At start-up: put back what was carried over an erase, once.
try {
  if (fs.existsSync(carryPath)) {
    const kept = JSON.parse(fs.readFileSync(carryPath, 'utf8'));
    for (const k of CARRIED) if (typeof kept[k] === 'string' && kept[k] !== '') setSetting(k, kept[k]);
    fs.rmSync(carryPath);
  }
} catch (e) { console.error('carry.json could not be read:', e.message); try { fs.rmSync(carryPath, { force: true }); } catch { /* leave it */ } }

/** Tells whoever runs the copies that this one is now empty. Says nothing about what was in it. */
async function tellHost() {
  const url = process.env.LEDGER_FEEDBACK_URL, key = process.env.LEDGER_FEEDBACK_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url.replace(/\/+$/, '')}/feedback`, { method: 'POST', headers: { 'x-feedback-key': key, 'content-type': 'application/json' }, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ kind: 'problem', source: process.env.LEDGER_HOUSEHOLD || 'a family copy', text: 'The household using this copy chose "Delete everything" in Settings. The copy is now empty and still set aside for them. Nothing needs fixing; free the copy when you are sure they are done with it.' }) });
  } catch { /* the erase goes ahead whether or not the note arrives */ }
}

/** Removes the database and stops, so the container starts an empty copy. Call after the answer has been sent. */
export async function eraseEverything() {
  const kept = {};
  for (const k of CARRIED) kept[k] = getSetting(k);
  await tellHost();
  fs.writeFileSync(carryPath, JSON.stringify(kept), { mode: 0o600 });
  try { db.close(); } catch { /* already closed */ }
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
  console.log('This copy was erased from Settings at its household\'s request. Stopping so it starts empty.');
  process.exit(0);
}
