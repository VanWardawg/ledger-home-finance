// Ideas, problems and questions sent from the About page ("Ask for something or report a problem").
//
// Every copy keeps what its own household sent (table `feedback`), and passes each one on to the
// person who runs the copies so they actually see it:
//   - the host's own copy (settings join_url and join_key, see server/family.js) hands it to the
//     request service directly;
//   - a family copy is started with LEDGER_FEEDBACK_URL and LEDGER_FEEDBACK_KEY (and
//     LEDGER_HOUSEHOLD, its copy's name), and posts it there. That key can only add a report: it
//     cannot read anything or approve anyone;
//   - a copy with neither just keeps it.
// The host reads them all in Settings, "Family requests", and is emailed when one arrives.
import { db, getSetting } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)`);

const KINDS = ['idea', 'problem', 'question'];
const hostCopy = () => getSetting('join_url') !== '' && getSetting('join_key') !== '';
const familyCopy = () => !!process.env.LEDGER_FEEDBACK_URL && !!process.env.LEDGER_FEEDBACK_KEY;
// A copy someone runs for themselves has nobody to pass a report to. The published images know the
// repository they came from (LEDGER_REPO, baked in by addon/build.yml), so the page sends the person to
// that project's issues on GitHub instead of saving words nobody will read (2026-11-25).
const repo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(process.env.LEDGER_REPO || '') ? process.env.LEDGER_REPO : '';
const selfHosted = () => !!repo && !hostCopy() && !familyCopy() && !process.env.LEDGER_SETUP_CODE;

async function deliver(kind, text) {
  const body = JSON.stringify({ kind, text, source: hostCopy() ? 'host' : process.env.LEDGER_HOUSEHOLD || 'a family copy' });
  const [url, headers] = hostCopy()
    ? [`${getSetting('join_url').replace(/\/+$/, '')}/admin/feedback`, { 'x-join-key': getSetting('join_key') }]
    : [`${process.env.LEDGER_FEEDBACK_URL.replace(/\/+$/, '')}/feedback`, { 'x-feedback-key': process.env.LEDGER_FEEDBACK_KEY }];
  const r = await fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`answered ${r.status}`);
}

export function installFeedback(app) {
  // Who a report goes to, so the page can say so.
  app.get('/api/feedback', (_req, res) => res.json({
    goesTo: hostCopy() ? 'you' : familyCopy() ? 'host' : selfHosted() ? 'github' : 'nowhere',
    ...(selfHosted() ? { page: `https://github.com/${repo}/issues` } : {}),
    sent: db.prepare('SELECT id, at, kind, text, delivered FROM feedback ORDER BY id DESC LIMIT 10').all(),
  }));

  app.post('/api/feedback', async (req, res) => {
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'idea';
    const text = String(req.body?.text || '').replace(/\r/g, '').trim().slice(0, 2000);
    if (text.length < 5) return res.status(400).json({ error: 'Say a little more, so it can be acted on.' });
    const id = Number(db.prepare('INSERT INTO feedback (at, kind, text) VALUES (?,?,?)').run(Date.now(), kind, text).lastInsertRowid);
    let delivered = false;
    if (hostCopy() || familyCopy()) {
      try { await deliver(kind, text); delivered = true; db.prepare('UPDATE feedback SET delivered = 1 WHERE id = ?').run(id); } catch (e) { console.warn('Feedback could not be passed on:', e.message); }
    }
    res.json({ ok: true, delivered });
  });
}
