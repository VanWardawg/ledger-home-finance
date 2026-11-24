// Passkeys: signing in with Face ID, Touch ID or a security key instead of
// typing the password. The password still works and is never replaced.
//
// How it stays safe:
//   - A passkey can only be added by someone who is already signed in.
//   - Browsers only offer passkeys on a secure address (https with a name, not
//     an IP address), so the address a passkey was added on is remembered and
//     sign-in is only accepted from those addresses.
//   - Every sign-in must pass the device's own check (face, finger or PIN).
//   - Only the public half of each passkey is stored here.
import crypto from 'node:crypto';
import net from 'node:net';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { db, getSetting, setSetting } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, public_key BLOB NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_used INTEGER)`);

const USER_ID = new TextEncoder().encode('ledger-household');

/** The addresses passkeys have been added on, as [{ origin, rpId }]. */
function places() {
  try { return JSON.parse(getSetting('passkey_origins') || '[]'); } catch { return []; }
}
export const passkeyOrigins = () => (db.prepare('SELECT COUNT(*) n FROM passkeys').get().n ? places().map((p) => p.origin) : []);

/** Checks an address the browser says it is on, and returns { origin, rpId } if passkeys can work there. */
function place(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  const local = url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !local) return null;
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) return null;
  return { origin: url.origin, rpId: url.hostname };
}

// A challenge is a one-time number the device signs. Each lives for five minutes.
const challenges = new Map();
function issue(kind, challenge, extra = {}) {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
  if (challenges.size > 200) challenges.clear();
  const ticket = crypto.randomBytes(18).toString('base64url');
  challenges.set(ticket, { kind, challenge, expires: now + 5 * 60000, ...extra });
  return ticket;
}
function redeem(kind, ticket) {
  const c = challenges.get(String(ticket || ''));
  challenges.delete(String(ticket || ''));
  return c && c.kind === kind && c.expires > Date.now() ? c : null;
}

/** Sign-in routes. These run before the gate that requires a session. */
export function installPasskeyLogin(app, { startSession, tooManyFailures, noteFailure }) {
  app.post('/api/auth/passkey/options', async (req, res) => {
    const here = place(req.body?.origin);
    const known = here && places().find((p) => p.origin === here.origin);
    if (!known || !passkeyOrigins().length) return res.status(400).json({ error: 'No passkey has been added for this address. Sign in with your password.' });
    // No list of passkeys is sent: the device offers the one it holds for this address.
    const options = await generateAuthenticationOptions({ rpID: known.rpId, userVerification: 'required' });
    res.json({ options, ticket: issue('login', options.challenge) });
  });

  app.post('/api/auth/passkey/verify', async (req, res) => {
    if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    const fail = () => { noteFailure(req); res.status(401).json({ error: "That passkey didn't work. Try again, or use your password." }); };
    const issued = redeem('login', req.body?.ticket);
    const response = req.body?.response;
    const row = issued && response?.id ? db.prepare('SELECT * FROM passkeys WHERE id = ?').get(String(response.id)) : null;
    if (!row) return fail();
    try {
      const all = places();
      const result = await verifyAuthenticationResponse({
        response, expectedChallenge: issued.challenge,
        expectedOrigin: all.map((p) => p.origin), expectedRPID: all.map((p) => p.rpId), requireUserVerification: true,
        credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: JSON.parse(row.transports) },
      });
      if (!result.verified) return fail();
      db.prepare('UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?').run(result.authenticationInfo.newCounter, Date.now(), row.id);
    } catch {
      return fail();
    }
    startSession(res, req);
    res.json({ ok: true });
  });
}

/** Adding, listing and removing passkeys. These sit behind the sign-in gate. */
export function installPasskeys(app) {
  const list = () => db.prepare('SELECT id, name, created_at, last_used FROM passkeys ORDER BY created_at').all();
  app.get('/api/passkeys', (_req, res) => res.json({ passkeys: list(), origins: places().map((p) => p.origin) }));

  app.post('/api/passkeys/options', async (req, res) => {
    const here = place(req.body?.origin);
    if (!here) return res.status(400).json({ error: 'Passkeys only work on a secure address that starts with https and uses a name, not numbers.' });
    const options = await generateRegistrationOptions({
      rpName: 'Ledger', rpID: here.rpId, userID: USER_ID, userName: 'Ledger', userDisplayName: 'Ledger',
      attestationType: 'none',
      // A passkey the device can offer by itself, and only after checking it's you.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: db.prepare('SELECT id, transports FROM passkeys').all().map((p) => ({ id: p.id, transports: JSON.parse(p.transports) })),
    });
    res.json({ options, ticket: issue('add', options.challenge, { here }) });
  });

  app.post('/api/passkeys', async (req, res) => {
    const issued = redeem('add', req.body?.ticket);
    if (!issued) return res.status(400).json({ error: 'That took too long. Try adding the passkey again.' });
    let info;
    try {
      const result = await verifyRegistrationResponse({
        response: req.body?.response, expectedChallenge: issued.challenge,
        expectedOrigin: issued.here.origin, expectedRPID: issued.here.rpId, requireUserVerification: true,
      });
      if (!result.verified) throw new Error('not verified');
      info = result.registrationInfo;
    } catch {
      return res.status(400).json({ error: "The passkey couldn't be added. Try again." });
    }
    const name = String(req.body?.name || '').trim().slice(0, 60) || 'Passkey';
    db.prepare('INSERT OR REPLACE INTO passkeys (id, public_key, counter, transports, name, created_at) VALUES (?,?,?,?,?,?)')
      .run(info.credential.id, Buffer.from(info.credential.publicKey), info.credential.counter, JSON.stringify(info.credential.transports || []), name, Date.now());
    const all = places();
    if (!all.some((p) => p.origin === issued.here.origin)) setSetting('passkey_origins', JSON.stringify([...all, issued.here]));
    res.json({ passkeys: list() });
  });

  app.delete('/api/passkeys/:id', (req, res) => {
    db.prepare('DELETE FROM passkeys WHERE id = ?').run(String(req.params.id));
    res.json({ passkeys: list() });
  });
}
