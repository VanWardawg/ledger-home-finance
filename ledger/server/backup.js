// Copies of the database.
//
// Everything a household has put into Ledger is one SQLite file. Until this was added the only ways to
// keep a copy were to stop the program and copy that file by hand, or to rely on Home Assistant's backups.
// Now Ledger keeps its own: a whole, consistent copy made each night into a "backups" folder beside the
// database (the last 7 are kept unless told otherwise), and one that can be downloaded from Settings.
//
// A copy is made with SQLite's own VACUUM INTO, which is safe while the program is running: it is a
// complete database as of one moment, never half of a change.
//
// A copy holds everything the database does, including the bank connection and any keys saved in Settings.
// It should be kept as carefully as those. The folder is private to this program, as the database is.
//
// The nightly copies sit on the same disk as the database, so they guard against a mistake or a bad
// update, not against losing the disk. For that, the backups folder (or a downloaded copy) has to be
// carried somewhere else by whatever backs up the rest of the machine.
//
//   settings   backup_keep (how many nightly copies to keep, 1 to 60; 0 switches them off), backup_last
import fs from 'node:fs';
import path from 'node:path';
import { db, dbPath, getSetting, setSetting } from './db.js';

const dir = path.join(path.dirname(dbPath), 'backups');
const NAME = /^ledger-\d{4}-\d{2}-\d{2}(?:-\d{6})?\.db$/;
const stamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clock = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

export const keep = () => { const v = getSetting('backup_keep', ''); const n = Number(v); return v !== '' && Number.isInteger(n) && n >= 0 && n <= 60 ? n : 7; };

/** Writes a whole copy of the database to `file`. Throws if it can't. */
export function copyTo(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.rmSync(file);
  // The path is made here from a date, never from a request; a quote in the data folder's own path is doubled.
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  try { fs.chmodSync(file, 0o600); } catch { /* not every file system has permissions */ }
  return fs.statSync(file).size;
}

export function list() {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => NAME.test(n)); } catch { /* none yet */ }
  return names.map((name) => { const s = fs.statSync(path.join(dir, name)); return { name, size: s.size, at: s.mtimeMs }; }).sort((a, b) => b.at - a.at);
}

/** Makes tonight's copy and clears away the oldest beyond the number kept. */
export function nightly(now = new Date()) {
  const n = keep();
  if (n === 0) return null;
  const file = path.join(dir, `ledger-${stamp(now)}.db`);
  const size = copyTo(file);
  for (const old of list().slice(n)) { try { fs.rmSync(path.join(dir, old.name)); } catch { /* try again tomorrow */ } }
  setSetting('backup_last', String(now.getTime()));
  return { name: path.basename(file), size };
}

const status = () => ({ keep: keep(), last: Number(getSetting('backup_last')) || null, folder: dir, copies: list().slice(0, 60) });

export function installBackup(app) {
  app.get('/api/backup', (_req, res) => res.json(status()));
  app.put('/api/backup', (req, res) => {
    const n = Number(req.body?.keep);
    if (!Number.isInteger(n) || n < 0 || n > 60) return res.status(400).json({ error: 'Keep between 1 and 60 copies, or 0 to switch nightly copies off.' });
    setSetting('backup_keep', String(n));
    res.json(status());
  });
  app.post('/api/backup/now', (_req, res) => {
    try {
      const now = new Date();
      const file = path.join(dir, `ledger-${stamp(now)}-${clock(now)}.db`);
      copyTo(file);
      for (const old of list().slice(Math.max(keep(), 1) + 3)) { try { fs.rmSync(path.join(dir, old.name)); } catch { /* left */ } }
      res.json(status());
    } catch (e) { res.status(500).json({ error: `The copy couldn't be made: ${e.message}` }); }
  });
  // A fresh copy, handed to the browser and not kept on the server.
  app.get('/api/backup/download', (_req, res) => {
    const file = path.join(dir, `download-${process.pid}-${Date.now()}.tmp`);
    try { copyTo(file); } catch (e) { return res.status(500).json({ error: `The copy couldn't be made: ${e.message}` }); }
    res.setHeader('Cache-Control', 'no-store');
    // 'allow': the data folder's own path may have a part that starts with a dot, which Express otherwise refuses to serve from.
    res.download(file, `ledger-${stamp()}.db`, { dotfiles: 'allow' }, (err) => {
      try { fs.rmSync(file); } catch { /* cleared on the next start */ }
      if (err && !res.headersSent) res.status(500).json({ error: "The copy couldn't be sent." });
    });
  });

  // Left over from a download that was cut off.
  try { for (const n of fs.readdirSync(dir)) if (/^download-.*.tmp$/.test(n)) fs.rmSync(path.join(dir, n)); } catch { /* no folder yet */ }
  // Once a day: shortly after starting if the last copy is more than 20 hours old, then every hour's check.
  const due = () => { try { if (keep() > 0 && Date.now() - (Number(getSetting('backup_last')) || 0) > 20 * 3600 * 1000) nightly(); } catch (e) { console.warn('Backup: the nightly copy failed:', e.message); } };
  if (process.env.LEDGER_NO_TIMERS !== '1') { setTimeout(due, 60_000).unref(); setInterval(due, 3600 * 1000).unref(); }
}
