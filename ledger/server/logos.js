// Merchant logos. The app asks for a logo by website domain (netflix.com); this
// fetches it once, keeps it in the database, and serves it from there afterwards.
// Three sources, in order: Logo.dev, a logo database with proper company logos, when a key for it is
// saved (setting `logodev_key`, or LEDGER_LOGODEV_KEY for a family copy; a free account's
// publishable key, never printed); then Google's public icon service, then DuckDuckGo's; neither of those needs a key. Your browser never contacts the icon
// service itself, and only the domain name is ever sent, never a transaction.
import { db, getSetting } from './db.js';

db.exec('CREATE TABLE IF NOT EXISTS logos (domain TEXT PRIMARY KEY, image BLOB, type TEXT, fetched INTEGER NOT NULL)');

const DAY = 86400000;
const inFlight = new Map();

const logoDevKey = () => getSetting('logodev_key') || process.env.LEDGER_LOGODEV_KEY || '';

/** A company's logo from Logo.dev, or null when it has none (fallback=404 stops it sending a placeholder). */
async function fromLogoDev(domain) {
  const key = logoDevKey();
  if (!key) return null;
  try {
    const res = await fetch(`https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(key)}&size=128&format=png&fallback=404`, { signal: AbortSignal.timeout(8000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const image = Buffer.from(await res.arrayBuffer());
    return image.length > 600 ? { image, type } : null;
  } catch { return null; }
}

/** Fetches every known site's logo again from Logo.dev, replacing what was kept. Pictures chosen by hand are left alone. */
export async function refreshFromLogoDev() {
  let better = 0, tried = 0;
  for (const { domain } of db.prepare("SELECT domain FROM logos WHERE domain NOT LIKE '%.upload'").all()) {
    tried++;
    const logo = await fromLogoDev(domain);
    if (logo) { saveLogo(domain, logo); better++; }
    // Logo.dev turns away bursts (it answered "too many requests" after about ninety in a row), so go gently.
    await new Promise((r) => setTimeout(r, 700));
  }
  return { tried, better };
}

export async function fetchLogo(domain) {
  const first = await fromLogoDev(domain);
  if (first) return first;
  const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, { signal: AbortSignal.timeout(8000) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) return null;
  const image = Buffer.from(await res.arrayBuffer());
  // The service answers unknown sites with a tiny placeholder globe.
  if (image.length > 600) return { image, type };
  return fromDuckDuckGo(domain);
}

/** The last resort: DuckDuckGo's icon service. Its icons are small, but it knows some sites the others don't, and it says plainly (404) when it has nothing. */
async function fromDuckDuckGo(domain) {
  try {
    const res = await fetch(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`, { signal: AbortSignal.timeout(8000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const image = Buffer.from(await res.arrayBuffer());
    return image.length > 300 ? { image, type } : null;
  } catch { return null; }
}

/** Remembers a fetched logo, or that there wasn't one. */
export function saveLogo(domain, logo) {
  db.prepare('INSERT INTO logos (domain, image, type, fetched) VALUES (?,?,?,?) ON CONFLICT(domain) DO UPDATE SET image = excluded.image, type = excluded.type, fetched = excluded.fetched')
    .run(domain, logo?.image ?? null, logo?.type ?? null, Date.now());
}

export function installLogos(app) {
  app.get('/api/logo/:domain', async (req, res) => {
    const domain = String(req.params.domain).toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain) || domain.length > 80) return res.status(400).end();
    let row = db.prepare('SELECT image, type, fetched FROM logos WHERE domain = ?').get(domain);
    // Found logos are kept for good; a miss is retried after a month.
    if (!row || (!row.image && Date.now() - row.fetched > 30 * DAY)) {
      if (!inFlight.has(domain)) {
        inFlight.set(domain, fetchLogo(domain).catch(() => null).then((logo) => {
          db.prepare('INSERT INTO logos (domain, image, type, fetched) VALUES (?,?,?,?) ON CONFLICT(domain) DO UPDATE SET image = excluded.image, type = excluded.type, fetched = excluded.fetched')
            .run(domain, logo?.image ?? null, logo?.type ?? null, Date.now());
          inFlight.delete(domain);
        }));
      }
      await inFlight.get(domain);
      row = db.prepare('SELECT image, type FROM logos WHERE domain = ?').get(domain);
    }
    if (!row?.image) return res.status(404).end();
    res.setHeader('Content-Type', row.type);
    res.setHeader('Cache-Control', 'private, max-age=2592000');
    res.end(Buffer.from(row.image));
  });
}
