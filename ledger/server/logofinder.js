// Finds logos for merchants that don't have one. The app's built-in list covers
// well-known names; for the rest, Claude is asked which company a bank
// description refers to and what its website is, and the logo is then fetched
// for that site in the usual way (server/logos.js). Each merchant is asked about
// once and the answer, including "no logo", is remembered.
//
// Privacy: only merchant names are sent to Anthropic, with your own key. No
// amounts, dates or account details. Payments to people (Venmo, Cash App,
// Zelle, "You paid ...") are never sent.
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { db, getSetting, setSetting } from './db.js';
import { apiKey, model, readableError } from './recap.js';
import { noteUsage, aiSource, limitMessage, privateCats, homeState } from './ai.js';
import { fetchLogo, saveLogo } from './logos.js';

db.exec('CREATE TABLE IF NOT EXISTS merchant_logos (merchant TEXT PRIMARY KEY, domain TEXT NOT NULL, checked INTEGER NOT NULL, manual INTEGER NOT NULL DEFAULT 0)');

const BATCH = 40;
/** At most this many merchants are looked up in one run, so a first run on a year of history is spread out. */
const PER_RUN = 160;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
// Money moved between people or accounts has no company logo to find.
const PERSONAL = /venmo|cash ?app|zelle|you paid|paid you|transfer|xfer|\batm\b|withdraw|deposit|payroll|check #|^check\b|interest (charge|paid)|payment thank you/i;

const TOOL = {
  name: 'record_websites',
  description: 'Record the website for each merchant, in the order given.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      merchants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'integer', description: 'The number of the merchant in the list' },
            domain: { type: ['string', 'null'], description: "The company's main website domain, like kroger.com, or null if unsure" },
          },
          required: ['number', 'domain'],
          additionalProperties: false,
        },
      },
    },
    required: ['merchants'],
    additionalProperties: false,
  },
};

const SYSTEM = `You identify companies from the short descriptions banks print on statements, for a household in {WHERE}. For each numbered description, give the main website domain of the company or brand it refers to, so its logo can be shown.

Descriptions are often abbreviated, run together, or carry a store number, city and state, or words like "Debit", "POS" and "SQ *". Read through those: "Tst* Big Orange Midtown Little Rock Ar" is the restaurant Big Orange.

Give a domain only when you are confident which business it is and that it has its own website. Give null when the description is a person, a generic word, a government office or bank transfer you can't tie to one organisation, a small local business whose website you don't actually know, or anything ambiguous. A wrong logo is worse than no logo, so when in doubt give null. Give the bare domain only: no "www.", no "https://", no path.`;

export const finderOn = () => getSetting('logo_finder', '1') === '1' && !!apiKey();

/** Merchant names (lower case) that haven't been looked up yet, most used first. */
function waiting(limit) {
  return db.prepare(`
    SELECT lower(t.merchant) merchant, COUNT(*) n FROM transactions t
    WHERE t.merchant != '' AND lower(t.merchant) NOT IN (SELECT merchant FROM merchant_logos)${privateCats().length ? ` AND lower(t.merchant) NOT IN (SELECT lower(merchant) FROM transactions WHERE category_id IN (${privateCats().join(',')}))` : ''}
    GROUP BY lower(t.merchant) ORDER BY MAX(t.date) >= date('now', '-60 days') DESC, n DESC LIMIT ?`).all(limit * 3)
    .map((r) => r.merchant);
}

async function ask(names) {
  const client = new Anthropic({ apiKey: apiKey(), timeout: 120_000, maxRetries: 1 });
  const source = aiSource();
  let response;
  try {
    response = await client.messages.create({
      model: model(),
      max_tokens: 8000,
      system: SYSTEM.replace('{WHERE}', homeState()),
      tools: [TOOL],
      messages: [{ role: 'user', content: `Record the website for each of these ${names.length} merchants with the record_websites tool.\n\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}` }],
    });
  } catch (e) {
    throw readableError(e);
  }
  noteUsage('logos', response, source, `${names.length} shop names, to find their websites`);
  const call = response.content.find((b) => b.type === 'tool_use' && b.name === TOOL.name);
  if (!call || !Array.isArray(call.input?.merchants)) throw new Error("Claude didn't return a list of websites.");
  const out = new Map();
  for (const m of call.input.merchants) {
    const name = names[Number(m.number) - 1];
    const domain = String(m.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (name) out.set(name, DOMAIN.test(domain) && domain.length <= 80 ? domain : '');
  }
  return out;
}

let running = null;
/** Looks up merchants that haven't been checked. Returns how many were checked and how many got a logo. */
export function findLogos() {
  if (running) return running;
  running = (async () => {
    const remember = db.prepare('INSERT INTO merchant_logos (merchant, domain, checked) VALUES (?,?,?) ON CONFLICT(merchant) DO UPDATE SET domain = excluded.domain, checked = excluded.checked');
    let checked = 0, found = 0;
    const todo = waiting(PER_RUN);
    // Payments to people are marked as having no logo without being sent anywhere.
    const send = [];
    for (const name of todo) {
      if (PERSONAL.test(name)) remember.run(name, '', Date.now());
      else if (send.length < PER_RUN) send.push(name);
    }
    for (let i = 0; i < send.length; i += BATCH) {
      const names = send.slice(i, i + BATCH);
      const answers = await ask(names);
      for (const name of names) {
        let domain = answers.get(name) || '';
        // Keep the website only if a real logo can be fetched for it.
        if (domain) {
          const have = db.prepare('SELECT image FROM logos WHERE domain = ?').get(domain);
          if (!have) saveLogo(domain, await fetchLogo(domain).catch(() => null));
          if (!db.prepare('SELECT image FROM logos WHERE domain = ?').get(domain)?.image) domain = '';
        }
        remember.run(name, domain, Date.now());
        checked++;
        if (domain) found++;
      }
    }
    const left = waiting(1).length > 0;
    setSetting('logo_finder_last', JSON.stringify({ at: Date.now(), checked, found, more: left }));
    setSetting('logo_finder_error', '');
    return { checked, found, more: left };
  })().catch((e) => { setSetting('logo_finder_error', e.message); throw e; }).finally(() => { running = null; });
  return running;
}

// Logos you chose yourself come first in the app, ahead of the built-in list; ones Claude found come after it.
const mapOf = (manual) => Object.fromEntries(db.prepare("SELECT merchant, domain FROM merchant_logos WHERE domain != '' AND manual = ?").all(manual).map((r) => [r.merchant, r.domain]));

// ---- Icons drawn on request ----
const DRAW_TOOL = {
  name: 'record_icon',
  description: 'Record the finished icon as SVG.',
  strict: true,
  input_schema: { type: 'object', properties: { svg: { type: 'string', description: 'The whole icon as one <svg> element' } }, required: ['svg'], additionalProperties: false },
};
const DRAW_SYSTEM = `You draw small icons for a personal finance app. Each one sits beside a transaction at about 32 pixels, so it must read at a glance. Return one SVG element with viewBox="0 0 64 64": a rounded square background (rx about 14) in a pleasant solid colour that suits the subject, and on it a simple, bold, flat illustration of what was asked for, centred, with a few shapes and two to four colours. No fine detail, no gradients needed, no text unless the request asks for letters. Draw your own simple picture of the thing (a car, a house, a scissors) rather than copying a company's trademarked logo. Use only shapes: path, rect, circle, ellipse, line, polygon, polyline, g. No scripts, images, links, fonts or anything fetched from elsewhere.`;
// Only a plain drawing gets through: shapes and nothing that can run, link or load.
const SVG_OK = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'title']);
function cleanSvg(text) {
  let svg = String(text || '').trim();
  const start = svg.indexOf('<svg'), end = svg.lastIndexOf('</svg>');
  if (start < 0 || end < 0) return null;
  svg = svg.slice(start, end + 6);
  if (svg.length > 20000) return null;
  if (/<!|<\?|\bon[a-z]+\s*=|javascript:|data:|https?:|\bhref\b|url\(\s*[^#)\s]/i.test(svg.replace(/xmlns(:\w+)?="[^"]*"/g, ''))) return null;
  for (const m of svg.matchAll(/<\/?\s*([a-zA-Z][\w:-]*)/g)) if (!SVG_OK.has(m[1].toLowerCase())) return null;
  // A fixed size, so it can be turned into a picture reliably.
  return svg.replace(/^<svg\b([^>]*)>/, (_all, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '').replace(/\sxmlns="[^"]*"/, '')} xmlns="http://www.w3.org/2000/svg" width="128" height="128">`);
}

export function installLogoFinder(app) {
  // Which website's logo to show for each merchant Claude has identified.
  app.get('/api/logos/found', (_req, res) => res.json({ found: mapOf(0), chosen: mapOf(1) }));

  const state = () => {
    let last = null;
    try { last = JSON.parse(getSetting('logo_finder_last') || 'null'); } catch { /* not run yet */ }
    return {
      on: getSetting('logo_finder', '1') === '1', hasKey: !!apiKey(), last, error: getSetting('logo_finder_error') || '',
      found: db.prepare("SELECT COUNT(*) n FROM merchant_logos WHERE domain != ''").get().n,
      waiting: waiting(PER_RUN).filter((n) => !PERSONAL.test(n)).length,
    };
  };
  app.get('/api/logos/finder', (_req, res) => res.json(state()));
  app.put('/api/logos/finder', (req, res) => { setSetting('logo_finder', req.body?.on ? '1' : '0'); res.json(state()); });
  app.post('/api/logos/finder/run', async (_req, res) => {
    if (!apiKey()) return res.status(400).json({ error: limitMessage() || 'Save an Anthropic API key first.' });
    try { const r = await findLogos(); res.json({ ...state(), ran: r }); } catch (e) { res.status(502).json({ error: e.message }); }
  });
  // Ask Claude to draw an icon for a merchant from a description ("a silver Toyota RAV4"). Claude can't
  // make pictures as such, but it can write a small drawing (SVG). The drawing is checked, sent to the
  // page to preview, and only if kept is it turned into a picture there and saved like any chosen picture.
  app.post('/api/logos/draw', async (req, res) => {
    if (!apiKey()) return res.status(400).json({ error: limitMessage() || 'Drawing an icon needs the AI features switched on in Settings.' });
    const merchant = String(req.body?.merchant || '').trim().slice(0, 80);
    const want = String(req.body?.request || '').trim().slice(0, 200) || merchant;
    if (!want) return res.status(400).json({ error: 'Say what the icon should show.' });
    const source = aiSource();
    let response;
    try {
      response = await new Anthropic({ apiKey: apiKey(), timeout: 90_000, maxRetries: 1 }).messages.create({
        model: model(), max_tokens: 6000, system: DRAW_SYSTEM, tools: [DRAW_TOOL],
        messages: [{ role: 'user', content: `The transaction is named: ${merchant || '(not given)'}\nWhat the icon should show: ${want}\nDraw the icon.` }],
      });
    } catch (e) {
      return res.status(502).json({ error: readableError(e).message });
    }
    noteUsage('icon', response, source, "a transaction's name and your description of the icon");
    const svg = cleanSvg(response.content.find((b) => b.type === 'tool_use' && b.name === DRAW_TOOL.name)?.input?.svg);
    if (!svg) return res.status(502).json({ error: "Claude didn't come back with a drawing that can be used. Try again, or describe it differently." });
    res.json({ svg });
  });

  // Choose a merchant's logo yourself: a website to take it from, a picture, or none.
  app.put('/api/logos/merchant', async (req, res) => {
    const merchant = String(req.body?.merchant || '').trim().toLowerCase();
    if (!merchant) return res.status(400).json({ error: 'Nothing to set a logo for.' });
    const set = (domain) => db.prepare('INSERT INTO merchant_logos (merchant, domain, checked, manual) VALUES (?,?,?,1) ON CONFLICT(merchant) DO UPDATE SET domain = excluded.domain, checked = excluded.checked, manual = 1').run(merchant, domain, Date.now());
    if (req.body?.clear) {
      // Back to the app's own choice. Claude isn't asked again about a name it has already checked.
      db.prepare("UPDATE merchant_logos SET domain = '', manual = 0 WHERE merchant = ?").run(merchant);
      return res.json({ ok: true });
    }
    if (req.body?.image) {
      const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image));
      if (!m) return res.status(400).json({ error: 'Choose a PNG or JPEG picture.' });
      const image = Buffer.from(m[2], 'base64');
      if (image.length > 400_000) return res.status(400).json({ error: 'That picture is too large.' });
      // Stored beside fetched logos under a made-up name; a new name each time so the old picture isn't shown from the browser's memory.
      const key = `u-${crypto.createHash('sha1').update(merchant).digest('hex').slice(0, 10)}-${Date.now().toString(36)}.upload`;
      saveLogo(key, { image, type: m[1] });
      set(key);
      return res.json({ ok: true });
    }
    const domain = String(req.body?.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
    if (!DOMAIN.test(domain) || domain.length > 80) return res.status(400).json({ error: 'Enter a website like kroger.com.' });
    if (!db.prepare('SELECT image FROM logos WHERE domain = ?').get(domain)?.image) saveLogo(domain, await fetchLogo(domain).catch(() => null));
    if (!db.prepare('SELECT image FROM logos WHERE domain = ?').get(domain)?.image) return res.status(404).json({ error: `No logo was found for ${domain}. Check the address, or choose a picture instead.` });
    set(domain);
    res.json({ ok: true });
  });

  // New merchants are picked up shortly after start-up and every few hours after that.
  const tick = () => { if (finderOn()) findLogos().catch(() => {}); };
  setTimeout(tick, 90_000).unref();
  setInterval(tick, 3 * 3600_000).unref();
}
