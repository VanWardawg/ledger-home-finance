// Prices for holdings (The owner, 2026-11-23: one of the gaps against the big budget apps; he and his wife
// hold no investments, so this is for other households).
//
// OFF until a household switches it on (setting `prices_on`), because it is the one place Ledger asks an
// outside service about something of theirs: the ticker symbols of what they hold. Only the symbols are
// sent, never share counts, values or anything that says whose they are. The source is Yahoo Finance's
// public chart address, which needs no key and covers shares, funds and mutual funds. It is not an
// official service: if it stops answering, holdings simply keep their last figures.
//
// What a price does: every holding with that symbol gets `price` and `price_at`. A holding TYPED BY HAND
// with a share count has its value set to shares times price, and an account kept by hand then follows
// the total of its holdings. A holding the bank reported keeps the bank's own value.
import { db, getSetting, setSetting } from './db.js';
import { setStart } from './tap.js';
import './holdings.js';

for (const [col, type] of [['price', 'REAL'], ['price_at', 'INTEGER']]) {
  if (!db.prepare('PRAGMA table_info(holdings)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE holdings ADD COLUMN ${col} ${type}`);
}

const SYMBOL = /^[A-Z0-9][A-Z0-9.\-]{0,9}$/;
const EVERY = 6 * 3600 * 1000;
const round = (n) => Math.round(n * 100) / 100;
const base = () => process.env.LEDGER_PRICES_URL || 'https://query1.finance.yahoo.com/v8/finance/chart';

export const pricesOn = () => getSetting('prices_on', '0') === '1';

/** The latest price for one symbol, or null when the source has none. */
export async function fetchPrice(symbol) {
  if (!SYMBOL.test(symbol)) return null;
  try {
    const r = await fetch(`${base()}/${encodeURIComponent(symbol)}?range=1d&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const meta = (await r.json())?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0 || price > 1e7) return null;
    if (meta.currency && meta.currency !== 'USD') return null; // values in Ledger are dollars
    return { price, at: Number(meta.regularMarketTime) ? Number(meta.regularMarketTime) * 1000 : Date.now() };
  } catch {
    return null;
  }
}

let running = null;
/** Looks up every symbol held and applies the prices. Returns how many symbols were asked about and how many answered. */
export function refreshPrices() {
  if (running) return running;
  running = (async () => {
    const symbols = db.prepare("SELECT DISTINCT upper(symbol) s FROM holdings WHERE symbol != ''").all().map((r) => r.s).filter((s) => SYMBOL.test(s));
    let found = 0;
    const touched = new Set();
    for (const s of symbols) {
      const p = await fetchPrice(s);
      if (p) {
        found++;
        db.prepare('UPDATE holdings SET price = ?, price_at = ? WHERE upper(symbol) = ?').run(p.price, p.at, s);
        for (const h of db.prepare('SELECT id, account_id, shares FROM holdings WHERE upper(symbol) = ? AND manual = 1 AND shares > 0').all(s)) {
          db.prepare('UPDATE holdings SET value = ?, updated = ? WHERE id = ?').run(round(h.shares * p.price), Date.now(), h.id);
          touched.add(h.account_id);
        }
      }
      await new Promise((ok) => setTimeout(ok, 400)); // one at a time, unhurried
    }
    // An account kept by hand is worth what its holdings are worth.
    for (const id of touched) {
      const a = db.prepare('SELECT id, sfin_id, manual FROM accounts WHERE id = ?').get(id);
      if (a && !a.sfin_id && a.manual) setStart(a.id, round(db.prepare('SELECT COALESCE(SUM(value), 0) s FROM holdings WHERE account_id = ?').get(a.id).s));
    }
    setSetting('prices_last', JSON.stringify({ at: Date.now(), asked: symbols.length, found }));
    return { asked: symbols.length, found };
  })().finally(() => { running = null; });
  return running;
}

const status = () => {
  let last = null;
  try { last = JSON.parse(getSetting('prices_last', 'null')); } catch { /* none yet */ }
  const symbols = db.prepare("SELECT COUNT(DISTINCT upper(symbol)) c FROM holdings WHERE symbol != ''").get().c;
  return { on: pricesOn(), symbols, last };
};

export function installPrices(app) {
  app.get('/api/prices', (_req, res) => res.json(status()));
  app.put('/api/prices', async (req, res) => {
    setSetting('prices_on', req.body?.on ? '1' : '0');
    if (pricesOn()) await refreshPrices().catch(() => null);
    res.json(status());
  });
  app.post('/api/prices/refresh', async (_req, res) => {
    if (!pricesOn()) return res.status(400).json({ error: 'Switch price look-ups on first.' });
    await refreshPrices().catch(() => null);
    res.json(status());
  });
  const tick = () => {
    if (!pricesOn()) return;
    let last = 0;
    try { last = JSON.parse(getSetting('prices_last', 'null'))?.at || 0; } catch { /* none yet */ }
    if (Date.now() - last >= EVERY) refreshPrices().catch(() => null);
  };
  setTimeout(tick, 120000).unref?.();
  setInterval(tick, 30 * 60000).unref?.();
}
