// The family request service: a small program of its own, started with `node server/join.js`.
//
// It serves one public page (public/join.html) where a family member asks for their own copy of
// Ledger, and keeps the requests. It is the only part of the whole setup meant to face the
// internet, so it is kept apart from every copy of the app on purpose: it holds no financial data,
// it cannot reach any copy's database, and all it stores is who asked (name, email, how they know
// the host if an older request said, a note). The page stopped asking how they know the host on
// 2026-11-18: the name and email are enough for him to recognise a family member.
//
// The host's own copy of Ledger (server/family.js) reads and answers the requests through the
// /admin routes, which need the shared key in the JOIN_KEY environment variable. Requests are only
// accepted while the host has the page switched open; it starts closed.
//
// Environment: JOIN_KEY (required, at least 24 characters), LEDGER_DATA_DIR (where join.db is
// kept), PORT and HOST as for the app.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.LEDGER_DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'join.db'));
db.exec(`CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending');
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new');`);
const meta = (k, fallback = '') => db.prepare('SELECT value FROM meta WHERE key = ?').get(k)?.value ?? fallback;
const setMeta = (k, v) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
const isOpen = () => meta('open', '0') === '1';

const KEY = String(process.env.JOIN_KEY || '');
if (KEY.length < 24) { console.error('The request service needs JOIN_KEY (at least 24 characters).'); process.exit(1); }
const sameText = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// At most this many requests may wait for an answer; past it the page says to try later.
const MAX_WAITING = 10;
// And each visitor may send three an hour. Behind Cloudflare the visitor's address is in a header.
const sent = new Map();
const missed = new Map();
const visitor = (req) => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');
function tooMany(req) {
  const who = visitor(req), now = Date.now();
  const recent = (sent.get(who) || []).filter((t) => t > now - 3600000);
  if (sent.size > 5000) sent.clear();
  sent.set(who, recent);
  return recent.length >= 3;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
// Nothing here should be kept by a browser or shown inside another site.
app.use((_req, res, next) => { res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
  // Added 2026-11-18 (the NAS session's review). The page's own script and styles are written in the page,
  // and the only outside thing it loads is Cloudflare's "are you a person" box. Browsers are told to use
  // https for this address from now on (this name only, not the rest of the domain).
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (_req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next(); });

const page = (name) => [path.join(root, 'dist', name), path.join(root, 'public', name)].find((p) => fs.existsSync(p));
app.get('/', (_req, res) => res.sendFile(page('join.html')));
// What Ledger is, and its privacy statement: two plain pages anyone can read, whether or not requests are
// open. Google asks every published sign-in app for both (added 2026-11-18). Nothing in them is about any household.
app.get('/about', (_req, res) => res.sendFile(page('join-about.html')));
app.get('/privacy', (_req, res) => res.sendFile(page('join-privacy.html')));
app.get('/seasonal-backdrop.js', (_req, res) => res.sendFile(page('seasonal-backdrop.js')));

// ---- A check that a person is filling the form in (2026-11-18) ----
// The page is the one part of Ledger anyone on the internet can reach, and automated tools try
// every form they find. Three things have to hold before a request is taken: a small sum the page
// asks (the answer is never sent to the browser; it is sealed into a token only this program can
// check), a hidden box that people never see and so leave empty, and at least three seconds between
// the page loading and the form being sent. It stops simple automation, not a determined person;
// the hourly limits and the closed-by-default switch are still the main protection.
const SEAL = crypto.randomBytes(32);
const seal = (stamp, answer) => crypto.createHmac('sha256', SEAL).update(`${stamp}:${answer}`).digest('base64url');
function newCheck() {
  const a = 2 + crypto.randomInt(7), b = 1 + crypto.randomInt(8), stamp = Date.now();
  return { question: `What is ${a} plus ${b}?`, token: `${stamp}.${seal(stamp, a + b)}` };
}
function passes(body) {
  if (String(body?.website || '') !== '') return false; // the hidden box
  const [stamp, mark] = String(body?.token || '').split('.');
  const age = Date.now() - Number(stamp);
  if (!mark || !(age >= 3000) || age > 30 * 60000) return false;
  const answer = String(body?.answer ?? '').trim();
  return /^\d{1,3}$/.test(answer) && sameText(seal(stamp, Number(answer)), mark);
}
// Cloudflare's own check (Turnstile), used in place of the sum when its two keys are set in join.env:
// TURNSTILE_SITE_KEY (public, goes to the page) and TURNSTILE_SECRET (stays here). The page shows
// Cloudflare's box, which gives the browser a token; the token is confirmed with Cloudflare before a
// request is taken. If Cloudflare can't be reached the request is refused, not waved through.
const TURNSTILE = { site: String(process.env.TURNSTILE_SITE_KEY || ''), secret: String(process.env.TURNSTILE_SECRET || '') };
const useTurnstile = () => TURNSTILE.site !== '' && TURNSTILE.secret !== '';
async function turnstileOk(req) {
  if (String(req.body?.website || '') !== '') return false;
  const token = String(req.body?.turnstile || '');
  if (!token || token.length > 4000) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ secret: TURNSTILE.secret, response: token, remoteip: visitor(req) }),
    });
    return (await r.json()).success === true;
  } catch { return false; }
}
app.get('/api/join/status', (_req, res) => res.json(!isOpen() ? { open: false } : useTurnstile() ? { open: true, turnstile: TURNSTILE.site } : { open: true, check: newCheck() }));

app.post('/api/join/request', async (req, res) => {
  if (!isOpen()) return res.status(403).json({ error: 'Requests are closed right now.' });
  if (tooMany(req)) return res.status(429).json({ error: 'That is enough requests for now. Try again in an hour.' });
  // A wrong or missing answer gets a fresh question; it counts toward the hourly limit so it can't be guessed at.
  if (useTurnstile() ? !(await turnstileOk(req)) : !passes(req.body)) {
    // Wrong answers have their own limit (eight an hour), so a mistype doesn't use up a person's three requests.
    const who = visitor(req), now = Date.now();
    const recent = (missed.get(who) || []).filter((t) => t > now - 3600000);
    if (missed.size > 5000) missed.clear();
    missed.set(who, [...recent, now]);
    if (recent.length >= 8) return res.status(429).json({ error: 'Too many tries for now. Come back in an hour.' });
    return res.status(400).json(useTurnstile() ? { error: "The check that you're a person didn't pass. Try it again.", retry: true } : { error: "That answer isn't right. Here is another one to try.", check: newCheck() });
  }
  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const name = clean(req.body?.name, 60), email = clean(req.body?.email, 120).toLowerCase(), relation = clean(req.body?.relation, 80), note = clean(req.body?.note, 300);
  if (name.length < 2) return res.status(400).json({ error: 'Enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "That email address doesn't look right." });
  sent.get(visitor(req))?.push(Date.now());
  // The same address asking again while its first request waits is taken as one request, and the
  // answer is the same either way, so the page can't be used to learn who has already asked.
  if (!db.prepare("SELECT 1 FROM requests WHERE email = ? AND status = 'pending'").get(email)) {
    if (db.prepare("SELECT COUNT(*) n FROM requests WHERE status = 'pending'").get().n >= MAX_WAITING) return res.status(429).json({ error: 'There are a lot of requests waiting. Try again in a day or two.' });
    db.prepare('INSERT INTO requests (at, name, email, relation, note) VALUES (?,?,?,?,?)').run(Date.now(), name, email, relation, note);
  }
  res.json({ ok: true });
});

// ---- Ideas and problems reported from a family copy's About page (server/feedback.js) ----
// A family copy holds FEEDBACK_KEY, which lets it add a report and nothing else.
const FEEDBACK_KEY = String(process.env.FEEDBACK_KEY || '');
const reports = new Map();
function addFeedback(body) {
  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
  const kind = ['idea', 'problem', 'question'].includes(body?.kind) ? body.kind : 'idea';
  const text = clean(body?.text, 2000), source = clean(body?.source, 40) || 'unknown';
  if (text.length < 5) return false;
  db.prepare('INSERT INTO feedback (at, source, kind, text) VALUES (?,?,?,?)').run(Date.now(), source, kind, text);
  return true;
}
app.post('/feedback', (req, res) => {
  if (FEEDBACK_KEY.length < 24 || !sameText(req.headers['x-feedback-key'] || '', FEEDBACK_KEY)) return res.status(401).json({ error: 'Not allowed.' });
  // No more than twenty an hour from one copy.
  const who = String(req.body?.source || ''), now = Date.now();
  const recent = (reports.get(who) || []).filter((t) => t > now - 3600000);
  if (recent.length >= 20) return res.status(429).json({ error: 'Too many for now.' });
  reports.set(who, [...recent, now]);
  res.status(addFeedback(req.body) ? 200 : 400).json({ ok: true });
});

// ---- "Email me a reset code", asked from a family copy's sign-in screen ----
// The copy holds FEEDBACK_KEY (which can add a note or one of these, nothing else). The request
// names only the copy; the host's Ledger knows whose it is and which email to use, so nothing typed
// by a visitor decides where a code is sent. At most three an hour for one copy.
db.exec("CREATE TABLE IF NOT EXISTS resets (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting')");
app.post('/reset-request', (req, res) => {
  if (FEEDBACK_KEY.length < 24 || !sameText(req.headers['x-feedback-key'] || '', FEEDBACK_KEY)) return res.status(401).json({ error: 'Not allowed.' });
  const source = String(req.body?.source || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  if (!source) return res.status(400).json({ error: 'Which copy?' });
  if (db.prepare('SELECT COUNT(*) n FROM resets WHERE source = ? AND at > ?').get(source, Date.now() - 3600000).n >= 3) return res.status(429).json({ error: 'Too many for now.' });
  db.prepare('INSERT INTO resets (at, source) VALUES (?, ?)').run(Date.now(), source);
  res.json({ ok: true });
});

// ---- For the host's own copy of Ledger only ----
app.use('/admin', (req, res, next) => (sameText(req.headers['x-join-key'] || '', KEY) ? next() : res.status(401).json({ error: 'Not allowed.' })));
app.get('/admin/requests', (_req, res) => res.json({ open: isOpen(), requests: db.prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 200').all() }));
app.post('/admin/requests/:id', (req, res) => {
  const status = ['approved', 'declined', 'pending'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Unknown answer.' });
  const r = db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  res.json({ changed: r.changes });
});
app.post('/admin/feedback', (req, res) => res.status(addFeedback(req.body) ? 200 : 400).json({ ok: true }));
app.get('/admin/feedback', (_req, res) => res.json(db.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT 200').all()));
app.post('/admin/feedback/:id', (req, res) => res.json({ changed: db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(req.body?.status === 'new' ? 'new' : 'done', Number(req.params.id)).changes }));
app.get('/admin/resets', (_req, res) => res.json(db.prepare("SELECT id, at, source FROM resets WHERE status = 'waiting' AND at > ? ORDER BY id").all(Date.now() - 3600000)));
app.post('/admin/resets/:id', (req, res) => res.json({ changed: db.prepare('UPDATE resets SET status = ? WHERE id = ?').run(String(req.body?.status || 'done').slice(0, 20), Number(req.params.id)).changes }));
app.put('/admin/open', (req, res) => { setMeta('open', req.body?.open ? '1' : '0'); res.json({ open: isOpen() }); });

app.use((_req, res) => res.status(404).send('Not found'));
const PORT = Number(process.env.PORT) || 4317;
app.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`The Ledger request page is running at http://localhost:${PORT} (${isOpen() ? 'open' : 'closed'})`));
