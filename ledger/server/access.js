// Signing in to a family copy with Cloudflare's check alone (added 2026-11-18, the owner's request after
// trying Google sign-in: "just get the Google sign in established, if they wanted, at the beginning").
//
// A family copy's web address sits behind Cloudflare Access. Whoever reaches it has already proved,
// with Google or a code sent to their email, that they hold an email address the host approved for
// that copy. Cloudflare says so in a signed note it adds to every request (the header
// Cf-Access-Jwt-Assertion). If the household chooses, that note is enough to sign in, with no Ledger
// password to remember.
//
// The note is never taken on trust. A copy can also be reached straight on the home network, where
// anyone could type such a header, so each note is checked here: its signature against Cloudflare's
// published keys for the team, that it was issued for THIS copy's address (its audience tag), that it
// hasn't run out, and that it carries an email. Only then does it count.
//
// The copy learns its team and audience tag from the host's Ledger (settings `access_team` and
// `access_aud`, sent with the copy's setup code; server/family.js). Until then none of this is offered.
// Setting `access_login` = '1' means the household chose to sign in this way.
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

const team = () => (/^[a-z0-9-]{1,60}$/.test(getSetting('access_team')) ? getSetting('access_team') : '');
const aud = () => (/^[a-f0-9]{32,128}$/.test(getSetting('access_aud')) ? getSetting('access_aud') : '');
export const accessConfigured = () => team() !== '' && aud() !== '';
export const accessLogin = () => getSetting('access_login') === '1';

/** Told by the host's Ledger which Cloudflare team and application this copy sits behind. */
// The emails the host approved for this copy (added 2026-11-18 after the NAS session's review). Cloudflare
// already lets only those through, but a note it issued stays good for up to a day after an email is taken
// off its list, and a copy that is freed and given to someone else keeps the same address. So the copy
// checks the email for itself: a valid note for the right address but the wrong person counts for nothing.
// An empty list lets nobody in this way.
const allowed = () => { try { const l = JSON.parse(getSetting('access_emails') || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };
export function setAccess({ team: t, aud: a, emails }) {
  if (Array.isArray(emails)) setSetting('access_emails', JSON.stringify(emails.map((e) => String(e || '').trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)).slice(0, 50)));
  const cleanTeam = String(t || '').trim().toLowerCase(), cleanAud = String(a || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,60}$/.test(cleanTeam) || !/^[a-f0-9]{32,128}$/.test(cleanAud)) return false;
  setSetting('access_team', cleanTeam);
  setSetting('access_aud', cleanAud);
  return true;
}

// Cloudflare's signing keys for the team, kept for an hour. A test may point this elsewhere, but never in the container.
let keys = { at: 0, byId: new Map(), team: '' };
let lastFetch = 0;
const certsUrl = () => (process.env.NODE_ENV !== 'production' && process.env.LEDGER_ACCESS_CERTS_URL) || `https://${team()}.cloudflareaccess.com/cdn-cgi/access/certs`;
async function keyFor(kid) {
  const fresh = keys.team === team() && Date.now() - keys.at < 3600_000;
  if (fresh && keys.byId.has(kid)) return keys.byId.get(kid);
  // An unknown key id may mean Cloudflare has rotated its keys: look again, but at most once every half minute.
  if (Date.now() - lastFetch < 30_000 && keys.team === team()) return keys.byId.get(kid) || null;
  lastFetch = Date.now();
  try {
    const r = await fetch(certsUrl(), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const byId = new Map();
    for (const jwk of (await r.json()).keys || []) { try { if (jwk.kid && jwk.kty === 'RSA') byId.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })); } catch { /* skip a key that can't be read */ } }
    keys = { at: Date.now(), byId, team: team() };
  } catch { return null; }
  return keys.byId.get(kid) || null;
}
const b64 = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** The email Cloudflare vouches for on this request, or null when there is no note or it doesn't check out. */
export async function accessIdentity(req) {
  if (!accessConfigured()) return null;
  const token = String(req.headers['cf-access-jwt-assertion'] || '');
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 4096) return null;
  let head, body;
  try { head = JSON.parse(b64(parts[0]).toString('utf8')); body = JSON.parse(b64(parts[1]).toString('utf8')); } catch { return null; }
  if (head.alg !== 'RS256' || typeof head.kid !== 'string') return null;
  const key = await keyFor(head.kid);
  if (!key) return null;
  let good = false;
  try { good = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2])); } catch { return null; }
  if (!good) return null;
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (!audiences.includes(aud())) return null;                                  // issued for another address
  if (body.iss !== `https://${team()}.cloudflareaccess.com`) return null;       // issued by another team
  if (!(Number(body.exp) > now) || (body.nbf && Number(body.nbf) > now + 60)) return null;
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  if (!allowed().includes(email)) return null;                                  // not someone the host approved for this copy
  return { email };
}
