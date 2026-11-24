// How a side gig's pay is forecast, for work that isn't a steady paycheck (2026-11-24, the owner: a tutor, a
// handyman, "ability to set in pay like mine at whatever time and rate", or "a general contractor doing odd
// jobs, ability to plug in general amounts they earn").
//
// A side gig's coming pay can be worked out three ways (setting `gig_pay_by`):
//   ''          the average of its recent deposits, on the rhythm set under Paydays (as before)
//   'sessions'  booked sessions read from a calendar, at a rate the household sets: by the hour or by the
//               session, paid the same day, weekly on a chosen weekday, or monthly on a chosen day
//   'jobs'      jobs typed in one at a time: who, how much, and when the money is expected
// (A gig named VIPKid has its own fourth way, the class calendar in server/vipkid.js, with VIPKid's rules.)
//
// The calendar is any calendar that offers a private iCal address (an address ending in .ics, sometimes
// starting webcal://): Google Calendar, Apple's iCloud, Outlook, and most booking tools have one. Ledger
// reads it; it never writes to it. Only the times and lengths of events are kept, and their titles for the
// optional "only events that mention…" filter.
//
// The address is a secret (anyone holding it can read that calendar), so it is never sent back to the page.
//
//   settings  gig_pay_by, gig_ics, gig_ics_match, gig_rate_kind ('hour' | 'session'), gig_rate,
//             gig_paid ('same' | 'weekly:0-6' | 'monthly:1-28'), gig_ics_at, gig_ics_error
//   tables    gig_sessions (uid, start, minutes, summary), gig_jobs (name, amount, date, done)
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { db, iso, getSetting, setSetting } from './db.js';
import { gig, extraGigs, gigCategoryFor } from './gig.js';
import { haOffered, haCalendars, haCalendarEvents } from './haai.js';

db.exec(`CREATE TABLE IF NOT EXISTS gig_sessions (uid TEXT PRIMARY KEY, start TEXT NOT NULL, minutes INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS gig_jobs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gig_pay (gig INTEGER PRIMARY KEY, mode TEXT, rough REAL, rough_every TEXT, rough_day INTEGER, rate_kind TEXT, rate REAL, paid TEXT,
  cal TEXT, ics TEXT, ha_entity TEXT, match TEXT, cal_at INTEGER, cal_error TEXT);
CREATE TABLE IF NOT EXISTS gig_seen (tx_id INTEGER PRIMARY KEY, job INTEGER)`);
// Every gig has its own settings since the second day of this feature; `gig` is 0 for the first.
const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!has('gig_sessions', 'gig')) db.exec('ALTER TABLE gig_sessions ADD COLUMN gig INTEGER NOT NULL DEFAULT 0');
if (!has('gig_jobs', 'gig')) db.exec('ALTER TABLE gig_jobs ADD COLUMN gig INTEGER NOT NULL DEFAULT 0; ALTER TABLE gig_jobs ADD COLUMN off INTEGER NOT NULL DEFAULT 0; ALTER TABLE gig_jobs ADD COLUMN paid_tx INTEGER');
// The first version kept one gig's settings among the app's settings: carried over once.
if (getSetting('gig_pay_by') !== '' && !db.prepare('SELECT 1 FROM gig_pay WHERE gig = 0').get()) {
  db.prepare('INSERT INTO gig_pay (gig, mode, rate_kind, rate, paid, cal, ics, match, cal_at) VALUES (0,?,?,?,?,?,?,?,?)')
    .run(getSetting('gig_pay_by'), getSetting('gig_rate_kind'), Number(getSetting('gig_rate')) || 0, getSetting('gig_paid'), getSetting('gig_ics') ? 'ics' : '', getSetting('gig_ics'), getSetting('gig_ics_match'), Number(getSetting('gig_ics_at')) || null);
  setSetting('gig_pay_by', '');
}

const DAY = 86400000;
const round = (n) => Math.round(n * 100) / 100;
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00`));
const addDays = (d, n) => iso(new Date(new Date(`${d}T12:00:00`).getTime() + n * DAY));

// ---- Reading a calendar ------------------------------------------------------

/** The instant (ms) at which a wall-clock time occurs in a time zone; the server's own zone when none is given. */
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  if (!tz) return new Date(y, mo - 1, d, h, mi, s).getTime();
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return guess - (shown - guess);
  } catch { return new Date(y, mo - 1, d, h, mi, s).getTime(); }
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Events in a calendar file between two instants, repeats included. Only what a booking calendar uses is
 * understood: timed events (all-day ones are left out), daily, weekly and monthly repeats with an interval,
 * a count or an end date, chosen weekdays, and single occurrences taken out. Anything stranger is read as
 * its first occurrence alone.
 */
export function eventsIn(ics, from, to) {
  const lines = String(ics).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = { EXDATE: [] };
    else if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      const prop = { value: line.slice(i + 1), tz: params.find((p) => /^TZID=/i.test(p))?.slice(5).replace(/"/g, ''), dateOnly: params.some((p) => /^VALUE=DATE$/i.test(p)) };
      if (name.toUpperCase() === 'EXDATE') cur.EXDATE.push(prop); else cur[name.toUpperCase()] = prop;
    }
  }
  const parts = (v) => { const m = String(v).match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(Z?)$/); return m ? { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6], z: !!m[7] } : null; };
  const instant = (p, tz) => (p.z ? Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) : zonedToUtc(p.y, p.mo, p.d, p.h, p.mi, p.s, tz));
  const out = [];
  for (const e of events) {
    if (/CANCEL/i.test(e.STATUS?.value || '') || !e.DTSTART || e.DTSTART.dateOnly) continue;
    const first = parts(e.DTSTART.value);
    if (!first) continue;
    const tz = e.DTSTART.tz;
    const startMs = instant(first, tz);
    let minutes = 60;
    const end = e.DTEND && parts(e.DTEND.value);
    if (end) minutes = Math.round((instant(end, e.DTEND.tz || tz) - startMs) / 60000);
    else { const d = e.DURATION?.value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/); if (d) minutes = Number(d[1] || 0) * 60 + Number(d[2] || 0); }
    if (!(minutes > 0) || minutes > 16 * 60) continue;
    const uid = e.UID?.value || String(startMs), summary = (e.SUMMARY?.value || '').replace(/\\([,;])/g, '$1').slice(0, 120);
    // An occurrence that was moved or edited on its own carries RECURRENCE-ID: it stands for that one date.
    const single = !!e['RECURRENCE-ID'];
    const push = (ms) => { if (ms >= from && ms < to) out.push({ uid: `${uid}|${ms}`, ms, minutes, summary, replaces: single ? instant(parts(e['RECURRENCE-ID'].value) || first, e['RECURRENCE-ID'].tz || tz) : null, base: uid }); };
    const rule = !single && e.RRULE ? Object.fromEntries(e.RRULE.value.split(';').map((kv) => kv.split('=').map((x) => x.toUpperCase()))) : null;
    if (!rule || !['DAILY', 'WEEKLY', 'MONTHLY'].includes(rule.FREQ)) { push(startMs); continue; }
    const every = Math.max(1, Number(rule.INTERVAL) || 1), count = Number(rule.COUNT) || Infinity;
    const untilP = rule.UNTIL ? parts(rule.UNTIL.length === 8 ? `${rule.UNTIL}T235959Z` : rule.UNTIL) : null;
    const until = untilP ? instant(untilP, tz) : Infinity;
    const skip = new Set(e.EXDATE.flatMap((x) => x.value.split(',').map((v) => { const p = parts(v); return p ? instant(p, x.tz || tz) : null; })));
    const days = rule.FREQ === 'WEEKLY' && rule.BYDAY ? rule.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))).filter((n) => n >= 0) : null;
    // Walked in the event's own wall-clock dates, so a 4 pm lesson stays at 4 pm across a clock change.
    const day0 = new Date(Date.UTC(first.y, first.mo - 1, first.d));
    let made = 0;
    for (let step = 0; step < 3700 && made < count; step++) {
      let dates;
      if (rule.FREQ === 'DAILY') dates = [new Date(day0.getTime() + step * every * DAY)];
      else if (rule.FREQ === 'MONTHLY') { const d = new Date(Date.UTC(first.y, first.mo - 1 + step * every, first.d)); dates = d.getUTCDate() === first.d ? [d] : []; }
      else {
        const weekStart = new Date(day0.getTime() - day0.getUTCDay() * DAY + step * every * 7 * DAY);
        dates = (days || [day0.getUTCDay()]).sort((a, b) => a - b).map((n) => new Date(weekStart.getTime() + n * DAY)).filter((d) => d >= day0);
      }
      let past = false;
      for (const d of dates) {
        if (made >= count) break;
        const ms = instant({ y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: first.h, mi: first.mi, s: first.s, z: first.z }, tz);
        if (ms > until) { past = true; break; }
        made++;
        if (!skip.has(ms)) push(ms);
        if (ms >= to) past = true;
      }
      if (past) break;
    }
  }
  // An edited occurrence takes the place of the one the repeat would have made.
  const moved = new Set(out.filter((o) => o.replaces != null).map((o) => `${o.base}|${o.replaces}`));
  return out.filter((o) => o.replaces != null || !moved.has(`${o.base}|${o.ms}`)).map(({ uid, ms, minutes, summary }) => ({ uid, start: new Date(ms).toISOString(), minutes, summary }));
}

// Fetching an address the household supplies. Where Ledger runs decides what it may reach:
//   - a copy someone else hosts (a setup code): https only, and never an address inside a private network,
//     or a household could aim "its calendar" at a machine in the host's own house;
//   - the Home Assistant add-on: the household's own network is fine (a calendar server at home is the
//     point), but never Home Assistant's inner network or the add-on itself;
//   - anywhere else (your own Docker or computer): anything.
// The check is made on the address actually connected to, at the moment of connecting, and again for every
// redirect, so neither a redirect nor a name that changes its answer between the check and the fetch gets
// round it (the NAS session's review, 2026-11-24). No sign-in of any kind is sent: this code has no way to
// reach the Supervisor's token.
const HOSTED = () => !!process.env.LEDGER_SETUP_CODE;
const ADDON = () => process.env.LEDGER_INGRESS === '1';
// An IPv4 address, however it is written: plainly, or wrapped inside an IPv6 one (after ::ffff:), in either
// the dotted form or the hexadecimal one.
function v4(ip) {
  const t = String(ip).replace(/^\[|\]$/g, '');
  const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.exec(t);
  if (m) return m.slice(1).map(Number);
  const h = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(t);
  if (!h) return null;
  const hi = parseInt(h[1], 16), lo = parseInt(h[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}
function refused(ip) {
  const a = v4(ip), six = String(ip).toLowerCase();
  const inner = a ? (a[0] === 172 && a[1] === 30 && (a[2] === 32 || a[2] === 33)) || a[0] === 127 || a[0] === 0 : six === '::1' || six === '::';
  if (ADDON() && inner) return true;
  if (!HOSTED()) return false;
  if (a) return a[0] === 10 || a[0] === 127 || a[0] === 0 || (a[0] === 169 && a[1] === 254) || (a[0] === 192 && a[1] === 168) || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 100 && a[1] >= 64 && a[1] <= 127)
    || (a[0] === 198 && (a[1] === 18 || a[1] === 19)) || (a[0] === 192 && a[1] === 0 && a[2] === 0) || a[0] >= 224;
  // (64:ff9b::/96 carries an IPv4 address inside it, which could be a private one.)
  return six === '::1' || six === '::' || /^f[cd]/.test(six) || /^fe[89ab]/.test(six) || /^64:ff9b:/.test(six);
}
const NOT_ALLOWED = "That address isn't one Ledger can read from here. Use the calendar's own iCal address on the internet.";

/** The text at an address, fetched under the rules above. At most 8 MB, 25 seconds, five redirects. */
async function fetchText(start) {
  let url = start;
  for (let hop = 0; hop < 6; hop++) {
    if (HOSTED() && url.protocol !== 'https:') throw new Error('Use an address that starts with https://.');
    if (HOSTED() && url.port && url.port !== '443') throw new Error(NOT_ALLOWED);
    if (ADDON() && /^(supervisor|hassio|homeassistant|localhost)$/i.test(url.hostname)) throw new Error(NOT_ALLOWED);
    const here = url;
    const res = await new Promise((resolve, reject) => {
      const lib = here.protocol === 'https:' ? https : http;
      // Every address the name resolves to is looked at as the connection is made.
      const lookup = (host, opts, cb) => dns.lookup(host, { ...opts, all: true }).then((list) => {
        const bad = list.find((x) => refused(x.address));
        if (bad || !list.length) return cb(Object.assign(new Error(NOT_ALLOWED), { refused: true }));
        return opts.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
      }, cb);
      if (net.isIP(here.hostname.replace(/^\[|\]$/g, '')) && refused(here.hostname.replace(/^\[|\]$/g, ''))) return reject(Object.assign(new Error(NOT_ALLOWED), { refused: true }));
      const req = lib.get(here, { lookup, timeout: 25000, headers: { Accept: 'text/calendar, text/plain, */*', 'User-Agent': 'Ledger calendar reader' } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return resolve({ redirect: r.headers.location }); }
        if (r.statusCode !== 200) { r.resume(); return resolve({ status: r.statusCode }); }
        const chunks = []; let size = 0;
        r.on('data', (c) => { size += c.length; if (size > 8_000_000) { req.destroy(new Error('That calendar is too large to read.')); } else chunks.push(c); });
        r.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
        r.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('The calendar took too long to answer.')));
      req.on('error', reject);
    }).catch((e) => { throw e.refused || /too large|too long/.test(e.message) ? e : new Error("Ledger couldn't reach that calendar address."); });
    if (res.text != null) return res.text;
    if (res.status) throw new Error(`The calendar answered with an error (${res.status}). Check the address is the private iCal one, and that it still works.`);
    let next; try { next = new URL(res.redirect, here); } catch { throw new Error("Ledger couldn't follow where that calendar address led."); }
    if (!['http:', 'https:'].includes(next.protocol)) throw new Error(NOT_ALLOWED);
    url = next;
  }
  throw new Error('That calendar address redirected too many times.');
}

const cleanUrl = (text) => { const t = String(text || '').trim().replace(/^webcal:\/\//i, 'https://'); try { const u = new URL(t); return ['http:', 'https:'].includes(u.protocol) ? u : null; } catch { return null; } };

// ---- Each gig's own settings -------------------------------------------------

/** Every side gig: the first (id 0), then the others by their own id. */
export function gigs() {
  const g = gig();
  if (!g.on) return [];
  return [{ id: 0, name: g.name, categoryId: g.categoryId, vipkid: !!g.classes }, ...extraGigs().map((x) => ({ id: x.id, name: x.name, categoryId: x.categoryId, vipkid: false }))];
}
const MODES = ['', 'rough', 'sessions', 'jobs'];
function cfg(id) {
  const r = db.prepare('SELECT * FROM gig_pay WHERE gig = ?').get(id) || {};
  const paid = /^weekly:[0-6]$/.test(r.paid) || /^monthly:([1-9]|1\d|2[0-8])$/.test(r.paid) ? r.paid : 'same';
  return {
    mode: MODES.includes(r.mode) ? r.mode : '', rough: Math.max(0, Number(r.rough) || 0), roughEvery: r.rough_every === 'month' ? 'month' : 'week',
    roughDay: Number.isInteger(r.rough_day) ? r.rough_day : null,
    rateKind: r.rate_kind === 'session' ? 'session' : 'hour', rate: Math.max(0, Number(r.rate) || 0), paid,
    cal: r.cal === 'ha' ? 'ha' : r.cal === 'ics' ? 'ics' : '', ics: r.ics || '', haEntity: r.ha_entity || '', match: r.match || '', calAt: Number(r.cal_at) || null, calError: r.cal_error || '',
  };
}
const COLS = { mode: 'mode', rough: 'rough', roughEvery: 'rough_every', roughDay: 'rough_day', rateKind: 'rate_kind', rate: 'rate', paid: 'paid', cal: 'cal', ics: 'ics', haEntity: 'ha_entity', match: 'match', calAt: 'cal_at', calError: 'cal_error' };
function save(id, change) {
  db.prepare('INSERT OR IGNORE INTO gig_pay (gig) VALUES (?)').run(id);
  for (const [k, v] of Object.entries(change)) if (COLS[k]) db.prepare(`UPDATE gig_pay SET ${COLS[k]} = ? WHERE gig = ?`).run(v, id);
}
/** How a gig's pay is forecast: '' (the average under Paydays), 'rough', 'sessions' or 'jobs'. A gig on VIPKid's own calendar is always ''. */
export function gigPayMode(id = 0) {
  const g = gigs().find((x) => x.id === id);
  return !g || g.vipkid ? '' : cfg(id).mode;
}
/** The names of gigs whose pay this file forecasts, so their averaged paycheck isn't counted as well. */
export const gigsWithOwnPay = () => new Set(gigs().filter((g) => gigPayMode(g.id) !== '').map((g) => g.name));

// ---- Reading the sessions ------------------------------------------------------

/** Reads a gig's calendar: its own iCal address, or one of Home Assistant's calendars. Sessions already in the past are kept as they were. */
export async function syncSessions(id = 0) {
  const c = cfg(id), now = Date.now();
  let all;
  if (c.cal === 'ha') {
    const found = await haCalendarEvents(c.haEntity, new Date(now - 45 * DAY), new Date(now + 120 * DAY));
    all = found.filter((e) => e.start?.dateTime && e.end?.dateTime).map((e) => {
      const ms = Date.parse(e.start.dateTime), minutes = Math.round((Date.parse(e.end.dateTime) - ms) / 60000);
      return { uid: `${ms}|${String(e.summary || '').slice(0, 60)}`, start: new Date(ms).toISOString(), minutes, summary: String(e.summary || '').slice(0, 120) };
    }).filter((e) => e.minutes > 0 && e.minutes <= 16 * 60);
  } else {
    const url = cleanUrl(c.ics);
    if (!url) throw new Error("Paste your calendar's iCal address first.");
    const text = await fetchText(url);
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That address didn't give a calendar. It should be the iCal address, which usually ends in .ics.");
    all = eventsIn(text, now - 45 * DAY, now + 120 * DAY);
  }
  const words = c.match.toLowerCase().split(',').map((w) => w.trim()).filter(Boolean);
  const mine = (words.length ? all.filter((e) => words.some((w) => e.summary.toLowerCase().includes(w))) : all).slice(0, 3000);
  const nowIso = new Date(now).toISOString();
  db.exec('BEGIN');
  try {
    // What is still to come is replaced by what the calendar says now. What has already happened stays: a
    // session that was held is still owed, even if the event is later deleted from the calendar.
    db.prepare('DELETE FROM gig_sessions WHERE gig = ? AND start >= ?').run(id, nowIso);
    const add = db.prepare('INSERT OR IGNORE INTO gig_sessions (uid, gig, start, minutes, summary) VALUES (?,?,?,?,?)');
    // A title is kept only when there is a word filter that needs it. Without one, a family calendar's
    // every event title would sit in this copy's database (and its backups) for no purpose.
    for (const e of mine) add.run(`${id}:${e.uid}`, id, e.start, e.minutes, words.length ? e.summary : '');
    if (!words.length) db.prepare("UPDATE gig_sessions SET summary = '' WHERE gig = ?").run(id);
    db.prepare('DELETE FROM gig_sessions WHERE gig = ? AND start < ?').run(id, new Date(now - 100 * DAY).toISOString());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  save(id, { calAt: Date.now(), calError: '' });
  return { sessions: mine.length, inCalendar: all.length };
}

// ---- What to expect ---------------------------------------------------------------

const worth = (minutes, c) => (c.rateKind === 'session' ? c.rate : (c.rate * minutes) / 60);

/** The day a session's pay arrives. Weekly: the next such weekday after the session's own day. Monthly: that day of the month after. */
function payDay(sessionDay, rule) {
  if (rule === 'same') return sessionDay;
  const [kind, n] = rule.split(':'); const want = Number(n);
  if (kind === 'weekly') { let d = addDays(sessionDay, 1); while (new Date(`${d}T12:00:00`).getDay() !== want) d = addDays(d, 1); return d; }
  const [y, m] = sessionDay.split('-').map(Number);
  return iso(new Date(y, m, want));
}

function sessionPay(g, c, from, to) {
  if (!(c.rate > 0)) return [];
  const byDay = new Map();
  for (const s of db.prepare('SELECT start, minutes FROM gig_sessions WHERE gig = ? ORDER BY start').all(g.id)) {
    const day = payDay(iso(new Date(s.start)), c.paid);
    if (day < from || day > to) continue;
    const row = byDay.get(day) || { amount: 0, count: 0 };
    row.amount += worth(s.minutes, c); row.count++;
    byDay.set(day, row);
  }
  return [...byDay].sort().map(([date, v]) => ({ date, amount: round(v.amount), note: `${v.count} booked session${v.count === 1 ? '' : 's'} at ${c.rateKind === 'hour' ? `$${c.rate} an hour` : `$${c.rate} each`}` }));
}

const openJobs = (id) => db.prepare('SELECT * FROM gig_jobs WHERE gig = ? AND done = 0 AND off = 0 ORDER BY date, id').all(id);

/** Jobs not yet paid, for the forecast. One whose day has gone by shows as due today for two weeks; after that it leaves the forecast, and stays under "Owed to you" until someone says otherwise. */
function jobPay(g, from, to) {
  const byDay = new Map();
  for (const j of openJobs(g.id)) {
    if (j.date > to || j.date < addDays(from, -14)) continue;
    const date = j.date < from ? from : j.date;
    const d = byDay.get(date) || { amount: 0, notes: [] };
    d.amount = round(d.amount + j.amount); d.notes.push(j.date < from ? `${j.name} (expected ${j.date}, not seen yet)` : j.name);
    byDay.set(date, d);
  }
  return [...byDay].sort().map(([date, d]) => ({ date, amount: d.amount, note: d.notes.length > 3 ? `${d.notes.slice(0, 3).join(', ')} and ${d.notes.length - 3} more` : d.notes.join(', ') }));
}

/**
 * What to expect when nothing is booked or typed: the rough figure the household gave, or failing that the
 * weekly average of the gig's deposits over the last eight weeks. Null when there is nothing to go on.
 */
function estimateFor(g, c) {
  if (c.rough > 0) return { amount: c.rough, every: c.roughEvery, day: c.roughDay ?? (c.roughEvery === 'month' ? 1 : 5), typed: true };
  if (!g.categoryId) return null;
  const sum = db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM transactions WHERE category_id = ? AND amount > 0 AND waiting = 0 AND date >= ?').get(g.categoryId, addDays(iso(new Date()), -56)).s;
  return sum / 8 >= 1 ? { amount: round(sum / 8), every: 'week', day: 5, typed: false } : null;
}
/** The pay days of an estimate between two dates: each week on its weekday, or each month on its day. */
function estimateDays(e, from, to) {
  const out = [];
  if (e.every === 'week') { let d = from; while (new Date(`${d}T12:00:00`).getDay() !== e.day) d = addDays(d, 1); for (; d <= to; d = addDays(d, 7)) out.push(d); }
  else { const [y, m] = from.split('-').map(Number); for (let k = 0; k < 14; k++) { const d = iso(new Date(y, m - 1 + k, Math.min(28, Math.max(1, e.day)))); if (d > to) break; if (d >= from) out.push(d); } }
  return out;
}
const prevDay = (e, d) => (e.every === 'week' ? addDays(d, -7) : (() => { const [y, m, day] = d.split('-').map(Number); return iso(new Date(y, m - 2, day)); })());

/** One gig's pay still to come between two dates, by its own way of being paid, with estimates where nothing is known. */
function expectedFor(g, from, to) {
  const c = cfg(g.id), mode = gigPayMode(g.id);
  if (!mode) return [];
  const real = mode === 'sessions' ? sessionPay(g, c, from, to) : mode === 'jobs' ? jobPay(g, from, to) : [];
  const e = estimateFor(g, c);
  const rows = real.map((r) => ({ ...r, firm: true }));
  if (e) {
    const label = e.typed ? `an estimate: about $${e.amount} a ${e.every}` : `an estimate: about $${e.amount} a week, from recent deposits`;
    // Sessions: the calendar only knows a few weeks ahead, so estimates begin after the last booked pay day.
    // Jobs: any week or month with no job typed for it. A rough figure by itself: every one.
    const lastReal = real.length ? real[real.length - 1].date : null;
    for (const d of estimateDays(e, from, to)) {
      if (mode === 'sessions' && lastReal && d <= lastReal) continue;
      if (mode === 'sessions' && !lastReal && !db.prepare('SELECT 1 FROM gig_sessions WHERE gig = ? LIMIT 1').get(g.id) && c.cal) { /* a calendar with nothing on it yet: estimate as usual */ }
      const since = prevDay(e, d);
      if (mode === 'jobs' && real.some((r) => r.date > since && r.date <= d)) continue;
      rows.push({ date: d, amount: e.amount, note: label, firm: false });
    }
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Rows for the forecast: every such gig's pay still to come. */
export function expectedGigPay(today, limit) {
  const out = [];
  for (const g of gigs()) {
    if (gigPayMode(g.id) === 'jobs') settleJobs(g);
    // Same-day rows of one gig share a line (a job and nothing else can land on one day; kept simple).
    const byDay = new Map();
    for (const r of expectedFor(g, today, limit)) { const d = byDay.get(r.date); if (d) { d.amount = round(d.amount + r.amount); d.note = `${d.note}; ${r.note}`; } else byDay.set(r.date, { ...r }); }
    for (const r of byDay.values()) out.push({ date: r.date, key: r.date, name: g.name, amount: r.amount, kind: 'pay', estimate: true, salary: false, note: r.note, gig: true });
  }
  return out;
}

// ---- Matching deposits to jobs -----------------------------------------------------

const near = (job, amount) => Math.abs(job.amount - amount) <= Math.max(3, job.amount * 0.05);
const inWindow = (job, date) => date >= addDays(job.date, -10) && date <= addDays(job.date, 45);
// Which deposits could be a gig's pay: anything filed under the gig, and also money in that carries the gig's
// words but was typed in under plain Income or "Other deposits" (cash in hand, or a household with no bank
// connection picks a category by hand, and without this their jobs never matched: found by the NAS
// session's test, 2026-11-24). Entries still waiting for the bank are left until the bank's own arrives.
const unseenDeposits = (g) => (g.categoryId ? db.prepare(`SELECT t.id, t.date, t.merchant, t.amount, t.category_id FROM transactions t JOIN categories c ON c.id = t.category_id
  WHERE t.amount > 0 AND t.waiting = 0 AND t.date >= ? AND t.split_of IS NULL AND (t.category_id = ? OR c.kind = 'income' OR COALESCE(c.key, c.name) = 'Deposit')
  AND t.id NOT IN (SELECT tx_id FROM gig_seen) ORDER BY t.date, t.id`).all(addDays(iso(new Date()), -75), g.categoryId)
  .filter((t) => t.category_id === g.categoryId || gigCategoryFor(t.merchant, t.amount) === g.categoryId) : []);
/** A deposit that turns out to be a job's pay is the gig's income, whatever it was first filed as. */
const fileUnderGig = (txId, jobId) => {
  const cat = db.prepare('SELECT g.gig FROM gig_jobs g WHERE g.id = ?').get(jobId);
  const g = cat && gigs().find((x) => x.id === cat.gig);
  if (g?.categoryId) db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(g.categoryId, txId);
};

/**
 * Ticks a job off when one deposit, and only one, could be its pay, and that deposit could be for no other
 * job: within $3 or 5% of what was expected (a rounded figure, a tip, a payment service's cut), from ten
 * days before its date to 45 after. Anything less clear-cut is left for the household to say (`asksFor`).
 */
function settleJobs(g) {
  const jobs = openJobs(g.id), deps = unseenDeposits(g);
  const fits = (j, t) => near(j, t.amount) && inWindow(j, t.date);
  for (const t of deps) {
    const cand = jobs.filter((j) => !j.settled && fits(j, t));
    if (cand.length !== 1) continue;
    if (deps.filter((x) => !x.used && fits(cand[0], x)).length !== 1) continue;
    cand[0].settled = true; t.used = true;
    db.prepare('UPDATE gig_jobs SET done = 1, paid_tx = ? WHERE id = ?').run(t.id, cand[0].id);
    db.prepare('INSERT OR IGNORE INTO gig_seen (tx_id, job) VALUES (?, ?)').run(t.id, cand[0].id);
    fileUnderGig(t.id, cand[0].id);
  }
}
/** Deposits that might be a job's pay but where Ledger can't be sure which: for the household to answer. */
function asksFor(g) {
  const jobs = openJobs(g.id);
  return unseenDeposits(g).map((t) => ({ tx: t, jobs: jobs.filter((j) => near(j, t.amount) && inWindow(j, t.date)).map((j) => ({ id: j.id, name: j.name, amount: j.amount, date: j.date })) })).filter((a) => a.jobs.length > 0).slice(0, 6);
}

// ---- What the page shows -----------------------------------------------------------

async function view() {
  const today = iso(new Date());
  const list = gigs();
  // Home Assistant is only asked for its calendars once there is a gig that could use one.
  const ha = haOffered() && list.some((g) => !g.vipkid && gigPayMode(g.id) === 'sessions') ? await haCalendars().catch(() => []) : [];
  const out = list.map((g) => {
    const c = cfg(g.id), mode = gigPayMode(g.id);
    if (mode === 'jobs') settleJobs(g);
    const url = cleanUrl(c.ics);
    const coming = mode ? expectedFor(g, today, addDays(today, 60)) : [];
    const overdue = openJobs(g.id).filter((j) => j.date < today);
    const e = mode ? estimateFor(g, c) : null;
    return {
      id: g.id, name: g.name, vipkid: g.vipkid, mode,
      rough: c.rough || '', roughEvery: c.roughEvery, roughDay: c.roughDay,
      rateKind: c.rateKind, rate: c.rate || '', paid: c.paid,
      calendar: { kind: c.cal, set: c.cal === 'ha' ? !!c.haEntity : !!url, host: url ? url.hostname : '', entity: c.haEntity, match: c.match, at: c.calAt, error: c.calError,
        sessions: db.prepare('SELECT COUNT(*) n FROM gig_sessions WHERE gig = ? AND start >= ?').get(g.id, new Date().toISOString()).n },
      jobs: db.prepare('SELECT id, name, amount, date, done, off FROM gig_jobs WHERE gig = ? AND (done = 0 AND off = 0 OR date >= ?) ORDER BY done + off, date, id').all(g.id, addDays(today, -45)),
      owed: { total: round(overdue.reduce((a, j) => a + j.amount, 0)), count: overdue.length },
      asks: mode === 'jobs' ? asksFor(g) : [],
      estimate: e ? { amount: e.amount, every: e.every, typed: e.typed } : null,
      coming: coming.slice(0, 12).map((r) => ({ date: r.date, amount: r.amount, note: r.note, firm: r.firm })),
      comingTotal: round(coming.reduce((a, r) => a + r.amount, 0)), comingFirm: round(coming.filter((r) => r.firm).reduce((a, r) => a + r.amount, 0)),
    };
  });
  return { on: list.length > 0, gigs: out, haCalendars: ha, owed: { total: round(out.reduce((a, g) => a + g.owed.total, 0)), count: out.reduce((a, g) => a + g.owed.count, 0) } };
}

export function installGigPay(app) {
  app.get('/api/gig/pay', async (_req, res) => res.json(await view()));
  // Just the overdue total, for the dashboard's line; nothing is fetched from anywhere for it.
  app.get('/api/gig/owed', (_req, res) => {
    const today = iso(new Date());
    const rows = gigs().filter((g) => gigPayMode(g.id) === 'jobs').flatMap((g) => { settleJobs(g); return openJobs(g.id).filter((j) => j.date < today); });
    res.json({ total: round(rows.reduce((a, j) => a + j.amount, 0)), count: rows.length, oldest: rows.map((j) => j.date).sort()[0] || null });
  });

  const which = (req, res) => {
    const id = Number(req.body?.gig ?? 0);
    const g = gigs().find((x) => x.id === id);
    if (!g) { res.status(400).json({ error: gigs().length ? "That side gig isn't here any more." : 'Switch the side gig on first.' }); return null; }
    if (g.vipkid) { res.status(400).json({ error: `${g.name} is forecast from its class calendar.` }); return null; }
    return g;
  };

  app.put('/api/gig/pay', async (req, res) => {
    const g = which(req, res); if (!g) return;
    const b = req.body || {}, id = g.id, was = cfg(id);
    const number = (v) => (v === '' || v == null ? 0 : Number(String(v).replace(/,/g, '')));
    if (b.mode !== undefined) { if (!MODES.includes(b.mode)) return res.status(400).json({ error: 'Choose how this work pays.' }); save(id, { mode: b.mode }); }
    if (b.rough !== undefined) { const n = number(b.rough); if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return res.status(400).json({ error: 'Enter the rough amount as a number.' }); save(id, { rough: n }); }
    if (b.roughEvery !== undefined) save(id, { roughEvery: b.roughEvery === 'month' ? 'month' : 'week', roughDay: null });
    if (b.roughDay !== undefined) { const n = Math.round(Number(b.roughDay)); if (!(n >= 0 && n <= 28)) return res.status(400).json({ error: 'Choose the day it usually arrives.' }); save(id, { roughDay: n }); }
    if (b.rateKind !== undefined) save(id, { rateKind: b.rateKind === 'session' ? 'session' : 'hour' });
    if (b.rate !== undefined) { const n = number(b.rate); if (!Number.isFinite(n) || n < 0 || n > 100000) return res.status(400).json({ error: 'Enter your rate as a number.' }); save(id, { rate: n }); }
    if (b.paid !== undefined) {
      if (!(b.paid === 'same' || /^weekly:[0-6]$/.test(b.paid) || /^monthly:([1-9]|1\d|2[0-8])$/.test(b.paid))) return res.status(400).json({ error: 'Choose when you are paid.' });
      save(id, { paid: b.paid });
    }
    if (b.match !== undefined) save(id, { match: String(b.match || '').slice(0, 120) });
    const forget = () => { save(id, { cal: '', ics: '', haEntity: '', calAt: null, calError: '' }); db.prepare('DELETE FROM gig_sessions WHERE gig = ? AND start >= ?').run(id, new Date().toISOString()); };
    if (b.calendar === '' || b.haCalendar === '') forget();
    else if (b.calendar !== undefined) {
      const url = cleanUrl(b.calendar);
      if (!url) return res.status(400).json({ error: "That doesn't look like a calendar address. It should start with https:// or webcal:// and usually ends in .ics." });
      save(id, { cal: 'ics', ics: url.href, haEntity: '' });
      try { await syncSessions(id); } catch (e) { save(id, { cal: was.cal, ics: was.ics, haEntity: was.haEntity }); return res.status(400).json({ error: e.message }); }
    } else if (b.haCalendar !== undefined) {
      if (!haOffered()) return res.status(400).json({ error: "This copy of Ledger isn't running inside Home Assistant." });
      save(id, { cal: 'ha', haEntity: String(b.haCalendar), ics: '' });
      try { await syncSessions(id); } catch (e) { save(id, { cal: was.cal, ics: was.ics, haEntity: was.haEntity }); return res.status(400).json({ error: e.message }); }
    } else if (b.match !== undefined && cfg(id).cal) { try { await syncSessions(id); } catch (e) { save(id, { calError: e.message }); } }
    res.json(await view());
  });

  app.post('/api/gig/pay/sync', async (req, res) => {
    const g = which(req, res); if (!g) return;
    try { await syncSessions(g.id); res.json(await view()); } catch (e) { save(g.id, { calError: e.message }); res.status(400).json({ error: e.message }); }
  });

  app.post('/api/gig/jobs', async (req, res) => {
    const g = which(req, res); if (!g) return;
    const name = String(req.body?.name || '').trim().slice(0, 80), amount = round(Number(String(req.body?.amount ?? '').replace(/,/g, ''))), date = String(req.body?.date || '');
    if (!name) return res.status(400).json({ error: 'Say what the job is, or who it is for.' });
    if (!(amount > 0) || amount > 10_000_000) return res.status(400).json({ error: 'Enter what you expect to be paid.' });
    if (!isDate(date)) return res.status(400).json({ error: 'Choose the day you expect the money.' });
    db.prepare('INSERT INTO gig_jobs (gig, name, amount, date, created) VALUES (?,?,?,?,?)').run(g.id, name, amount, date, iso(new Date()));
    res.json(await view());
  });
  app.patch('/api/gig/jobs/:id', async (req, res) => {
    const j = db.prepare('SELECT * FROM gig_jobs WHERE id = ?').get(Number(req.params.id));
    if (!j) return res.status(404).json({ error: "That job isn't here any more." });
    const b = req.body || {};
    const name = b.name === undefined ? j.name : String(b.name || '').trim().slice(0, 80);
    const amount = b.amount === undefined ? j.amount : round(Number(String(b.amount).replace(/,/g, '')));
    const date = b.date === undefined ? j.date : String(b.date);
    if (!name || !(amount > 0) || !isDate(date)) return res.status(400).json({ error: 'A job needs a name, an amount above 0 and a date.' });
    db.prepare('UPDATE gig_jobs SET name = ?, amount = ?, date = ?, done = ?, off = ? WHERE id = ?').run(name, amount, date, b.done === undefined ? j.done : b.done ? 1 : 0, b.off === undefined ? j.off : b.off ? 1 : 0, j.id);
    res.json(await view());
  });
  app.delete('/api/gig/jobs/:id', async (req, res) => { db.prepare('DELETE FROM gig_jobs WHERE id = ?').run(Number(req.params.id)); res.json(await view()); });
  // "Is this deposit that job?": yes for one of them, or none of them. Either way the deposit isn't asked about again.
  app.post('/api/gig/jobs/match', async (req, res) => {
    const tx = db.prepare('SELECT id FROM transactions WHERE id = ?').get(Number(req.body?.tx));
    if (!tx) return res.status(404).json({ error: "That deposit isn't here any more." });
    const job = req.body?.job == null ? null : db.prepare('SELECT * FROM gig_jobs WHERE id = ? AND done = 0').get(Number(req.body.job));
    if (req.body?.job != null && !job) return res.status(404).json({ error: "That job isn't waiting to be paid any more." });
    db.prepare('INSERT OR REPLACE INTO gig_seen (tx_id, job) VALUES (?, ?)').run(tx.id, job ? job.id : null);
    if (job) { db.prepare('UPDATE gig_jobs SET done = 1, paid_tx = ? WHERE id = ?').run(tx.id, job.id); fileUnderGig(tx.id, job.id); }
    res.json(await view());
  });

  // Calendars are read again every three hours while they are in use. A failed reading keeps what was read before.
  setInterval(async () => {
    for (const g of gigs()) {
      const c = cfg(g.id);
      if (gigPayMode(g.id) !== 'sessions' || !c.cal || Date.now() - (c.calAt || 0) < 3 * 3600 * 1000) continue;
      try { await syncSessions(g.id); } catch (e) { save(g.id, { calError: e.message, calAt: Date.now() }); }
    }
  }, 10 * 60000).unref?.();
}
