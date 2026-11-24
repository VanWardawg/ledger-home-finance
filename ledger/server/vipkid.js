// VIPKid classes and pay.
//
// Reads the class schedule from VIPKid's calendar server (CalDAV) and turns it
// into expected pay, using the pay rules the owner described on 2026-11-15:
//   - $7 base per 25-minute class, $14 for a 50-minute class
//   - a monthly "participation incentive" per 25-minute unit that rises with the
//     number of units taught that month (a 50-minute class counts as two units)
//   - base pay arrives weekly on Fridays; a pay week runs Saturday 6 pm to the
//     next Saturday noon, Central time (it follows Beijing time)
//   - the month's incentive arrives in one payment early the next month
// Short-notice and other bonuses aren't on the calendar, so they aren't counted.
import { db, iso, getSetting, setSetting } from './db.js';

db.exec('CREATE TABLE IF NOT EXISTS vk_classes (uid TEXT PRIMARY KEY, start TEXT NOT NULL, minutes INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT \'\')');

const BASE_25 = 7, BASE_50 = 14;
// Incentive per class, by how many classes have been taught so far that month.
export const TIERS = [[20, 0.8], [40, 1.2], [60, 1.7], [90, 1.9], [130, 2.5], [180, 2.9], [Infinity, 3.2]];
const HOME_TZ = 'America/Chicago', VIPKID_TZ = 'Asia/Shanghai';
const DAY = 86400000;
const round = (n) => Math.round(n * 100) / 100;

export function incentiveFor(count) {
  let total = 0, floor = 0;
  for (const [top, rate] of TIERS) {
    if (count > floor) total += (Math.min(count, top) - floor) * rate;
    floor = top;
  }
  return round(total);
}
const baseFor = (minutes) => (minutes >= 40 ? BASE_50 : BASE_25);
// For the incentive, VIPKid counts 25-minute units: a 50-minute class is two.
// (Checked against a year of deposits: counting it as one came out low every month.)
const unitsFor = (minutes) => (minutes >= 40 ? 2 : 1);
const units = (list) => list.reduce((a, c) => a + unitsFor(c.minutes), 0);

// ---- Time zones -------------------------------------------------------------

/** The instant (ms) at which a wall-clock time occurs in a time zone. */
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let p;
  try {
    p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  } catch { return guess; }
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return guess - (shown - guess);
}
const monthIn = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(new Date(ms)).slice(0, 7);

// ---- Reading the calendar ---------------------------------------------------

const unescapeXml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#13;/g, '\r').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');

function parseEvents(ics) {
  const lines = ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      cur[name.toUpperCase()] = { value: line.slice(i + 1), tz: params.find((p) => /^TZID=/i.test(p))?.slice(5).replace(/"/g, ''), dateOnly: params.some((p) => /^VALUE=DATE$/i.test(p)) };
    }
  }
  const when = (p) => {
    const m = p?.value.match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(Z?)$/);
    if (!m || p.dateOnly) return null;
    const [, y, mo, d, h, mi, s, z] = m.map((x, i) => (i && i < 7 ? Number(x) : x));
    // Times with no zone are taken as Beijing time, VIPKid's own clock.
    return z ? Date.UTC(y, mo - 1, d, h, mi, s) : zonedToUtc(y, mo, d, h, mi, s, p.tz || VIPKID_TZ);
  };
  const out = [];
  for (const e of events) {
    if (/CANCEL/i.test(e.STATUS?.value || '')) continue;
    const start = when(e.DTSTART);
    if (start == null) continue;
    let minutes = 25;
    const end = when(e.DTEND);
    if (end != null) minutes = Math.round((end - start) / 60000);
    else {
      const d = e.DURATION?.value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/);
      if (d) minutes = Number(d[1] || 0) * 60 + Number(d[2] || 0);
    }
    if (minutes <= 0 || minutes > 180) continue;
    out.push({ uid: e.UID?.value || `${start}`, start: new Date(start).toISOString(), minutes, summary: (e.SUMMARY?.value || '').slice(0, 120) });
  }
  return out;
}

async function dav(method, url, user, password, depth, body) {
  const res = await fetch(url, {
    method, redirect: 'manual', body,
    headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
  });
  if (res.status === 401 || res.status === 403) throw new Error("VIPKid's calendar didn't accept that account and password. Check them in the Booking Calendar Sync guide.");
  if (res.status >= 400) throw new Error(`VIPKid's calendar returned an error (status ${res.status}).`);
  return res.text();
}

export async function syncClasses() {
  const server = getSetting('vk_server'), user = getSetting('vk_user'), password = getSetting('vk_password');
  if (!server || !user) throw new Error('Connect your VIPKid calendar first.');
  const home = `${server.replace(/\/+$/, '').replace(/\/dav\.php$/, '')}/dav.php/calendars/${encodeURIComponent(user)}/`;
  const origin = new URL(home).origin;
  // 1. Which calendars does this account have?
  const listing = await dav('PROPFIND', home, user, password, 1,
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>');
  const calendars = [...listing.matchAll(/<(?:\w+:)?response[\s>][\s\S]*?<\/(?:\w+:)?response>/g)]
    .filter((m) => /<(?:\w+:)?calendar[\s/>]/.test(m[0]))
    .map((m) => m[0].match(/<(?:\w+:)?href>([^<]+)</)?.[1]).filter(Boolean);
  if (!calendars.length) throw new Error('No calendars were found on that VIPKid account.');
  // 2. Every class from about ten weeks back to seven weeks ahead.
  const from = new Date(Date.now() - 75 * DAY), to = new Date(Date.now() + 50 * DAY);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const query = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(from)}" end="${stamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const classes = new Map();
  for (const href of calendars) {
    const xml = await dav('REPORT', new URL(href, origin).href, user, password, 1, query);
    for (const m of xml.matchAll(/<(?:\w+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:\w+:)?calendar-data>/g)) {
      for (const e of parseEvents(unescapeXml(m[1]))) classes.set(`${e.uid}|${e.start}`, e);
    }
  }
  // Replace what we hold for that window, so cancelled classes disappear.
  db.exec('BEGIN');
  try {
    // VIPKid's calendar only lists upcoming classes, so classes already taught
    // are kept as they are; only the future part is replaced.
    db.prepare('DELETE FROM vk_classes WHERE start >= ? AND start < ?').run(new Date().toISOString(), to.toISOString());
    const ins = db.prepare('INSERT OR REPLACE INTO vk_classes (uid, start, minutes, summary) VALUES (?,?,?,?)');
    for (const [key, e] of classes) if (e.start < to.toISOString()) ins.run(key, e.start, e.minutes, e.summary);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  setSetting('vk_last_sync', Date.now());
  setSetting('vk_last_error', '');
  calibrate();
  return { classes: classes.size, calendars: calendars.length };
}

// ---- Pay --------------------------------------------------------------------

/**
 * Classes taught in a month before the calendar sync began, entered by hand.
 * They count toward that month's goal and incentive.
 */
function taughtBefore(ym) {
  try { const o = JSON.parse(getSetting('vk_taught_before', 'null')); return o && o.month === ym ? Math.max(0, Math.round(o.count) || 0) : 0; } catch { return 0; }
}

const allClasses = () => db.prepare('SELECT start, minutes FROM vk_classes ORDER BY start').all().map((c) => ({ ms: Date.parse(c.start), minutes: c.minutes }));

/** The pay week a Friday's payment covers: Saturday 6 pm to Saturday noon, Central. */
function payWeek(friday, lagWeeks) {
  const [y, m, d] = friday.split('-').map(Number);
  const endDay = new Date(Date.UTC(y, m - 1, d - 6 - 7 * (lagWeeks - 1)));
  const startDay = new Date(endDay.getTime() - 7 * DAY);
  const at = (day, hour) => zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, 0, 0, HOME_TZ);
  return { start: at(startDay, 18), end: at(endDay, 12) };
}

/** The Friday on or after the 5th: when last month's incentive is paid. */
function incentiveFriday(ym) {
  const [y, m] = ym.split('-').map(Number);
  for (let d = 5; d < 12; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 5) return iso(new Date(y, m - 1, d));
  return null;
}
const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return iso(new Date(y, m - 2, 1)).slice(0, 7); };
const lag = () => Number(getSetting('vk_pay_lag_weeks', '1')) || 1;

/** What a given Friday's VIPKid payment should be, from the classes on the calendar. */
export function expectedPayment(friday, classes = allClasses(), lagWeeks = lag()) {
  if (!classes.length) return null;
  const week = payWeek(friday, lagWeeks);
  // Only trust weeks the synced calendar actually covers.
  if (week.end < classes[0].ms) return null;
  const inWeek = classes.filter((c) => c.ms >= week.start && c.ms < week.end);
  const base = inWeek.reduce((a, c) => a + baseFor(c.minutes), 0);
  const ym = friday.slice(0, 7);
  let incentive = 0, incentiveClasses = 0;
  if (incentiveFriday(ym) === friday) {
    incentiveClasses = units(classes.filter((c) => monthIn(c.ms, VIPKID_TZ) === prevMonth(ym))) + taughtBefore(prevMonth(ym));
    incentive = incentiveFor(incentiveClasses);
  }
  return {
    amount: round(base + incentive), base, incentive, incentiveClasses, classes: inWeek.length,
    weekOver: week.end <= Date.now(), weekStarted: week.start <= Date.now(),
  };
}

/** Work out, from past deposits, how many weeks after a pay week its Friday payment arrives. */
function calibrate() {
  const classes = allClasses();
  const deposits = db.prepare("SELECT date, amount FROM transactions WHERE category_id = ? AND amount > 0 AND date >= ? ORDER BY date").all(Number(getSetting('vipkid_category_id')), iso(new Date(Date.now() - 70 * DAY)));
  let best = null;
  for (const l of [1, 2]) {
    let error = 0, n = 0;
    for (const dep of deposits) {
      // Deposits land on Friday, occasionally Thursday.
      const d = new Date(`${dep.date}T12:00:00`);
      const friday = iso(new Date(d.getTime() + ((5 - d.getDay() + 7) % 7) * DAY));
      const e = expectedPayment(friday, classes, l);
      if (!e || !e.weekOver) continue;
      error += Math.abs(e.amount - dep.amount);
      n++;
    }
    if (n >= 3 && (!best || error / n < best.error)) best = { lag: l, error: error / n, n };
  }
  if (best) { setSetting('vk_pay_lag_weeks', best.lag); setSetting('vk_calibration', JSON.stringify(best)); }
}

/** Progress toward the monthly class goal (266 by default, the August total). */
function goalStatus(month, now, ym) {
  const target = Math.max(1, Math.round(Number(getSetting('vk_goal', '266')) || 266));
  const before = taughtBefore(ym);
  const booked = units(month) + before, taught = units(month.filter((c) => c.ms <= now)) + before;
  // Days left in the month on VIPKid's (Beijing) calendar, counting today.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: VIPKID_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).map((x) => [x.type, Number(x.value)]));
  const daysLeft = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate() - parts.day + 1;
  const remaining = Math.max(0, target - booked);
  const first = db.prepare('SELECT MIN(start) s FROM vk_classes').get().s;
  return {
    target, booked, taught, remaining, daysLeft, perDay: daysLeft ? Math.ceil((remaining / daysLeft) * 10) / 10 : 0,
    payAtGoal: round(target * BASE_25 + incentiveFor(target)),
    // Classes entered by hand are valued at the 25-minute rate.
    payBooked: round(month.reduce((a, c) => a + baseFor(c.minutes), 0) + before * BASE_25 + incentiveFor(booked)),
    taughtBefore: before,
    // The calendar has nothing from earlier in this month: offer the hand-entered count.
    trackedFrom: first && monthIn(Date.parse(first), VIPKID_TZ) === ym && new Date(Date.parse(first)).getUTCDate() > 2 ? first.slice(0, 10) : null,
  };
}

export function status() {
  const classes = allClasses();
  const now = Date.now();
  const ym = monthIn(now, VIPKID_TZ);
  const month = classes.filter((c) => monthIn(c.ms, VIPKID_TZ) === ym);
  const taught = units(month.filter((c) => c.ms <= now));
  const base = month.reduce((a, c) => a + baseFor(c.minutes), 0);
  const before = taughtBefore(ym), count = units(month) + before;
  const nextTier = TIERS.find(([top]) => count < top);
  // How many 25-minute classes a month reach $2,000.
  let target = 0;
  while (target < 600 && target * BASE_25 + incentiveFor(target) < 2000) target++;
  let calibration = null;
  try { calibration = JSON.parse(getSetting('vk_calibration', 'null')); } catch { /* none yet */ }
  return {
    connected: getSetting('vk_user') !== '', server: getSetting('vk_server') || 'https://baikal.vipteacher.com',
    lastSync: Number(getSetting('vk_last_sync')) || null, error: getSetting('vk_last_error'),
    totalClasses: classes.length,
    month: { name: ym, booked: count, taught: taught + before, base: round(base + before * BASE_25), incentive: incentiveFor(count), total: round(base + before * BASE_25 + incentiveFor(count)), nextTierAt: nextTier && nextTier[0] !== Infinity ? nextTier[0] + 1 : null },
    goal: goalStatus(month, now, ym),
    classesFor2000: target, lagWeeks: lag(), calibration, tiers: TIERS.map(([top, rate]) => ({ upTo: top === Infinity ? null : top, rate })),
  };
}

export function installVipkid(app) {
  app.get('/api/vipkid', (_req, res) => res.json(status()));
  app.post('/api/vipkid/connect', async (req, res) => {
    const server = String(req.body?.server || '').trim(), user = String(req.body?.user || '').trim(), password = String(req.body?.password || '');
    let url;
    try { url = new URL(server); } catch { return res.status(400).json({ error: 'Enter the server address from the VIPKid sync guide, starting with https://.' }); }
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !local) return res.status(400).json({ error: 'The server address must start with https://.' });
    if (!user || !password) return res.status(400).json({ error: 'Enter the account and password from the VIPKid sync guide.' });
    const previous = { server: getSetting('vk_server'), user: getSetting('vk_user'), password: getSetting('vk_password') };
    setSetting('vk_server', url.origin + url.pathname.replace(/\/+$/, ''));
    setSetting('vk_user', user);
    setSetting('vk_password', password);
    try {
      res.json({ ok: true, ...(await syncClasses()) });
    } catch (e) {
      // Don't keep details that didn't work.
      setSetting('vk_server', previous.server); setSetting('vk_user', previous.user); setSetting('vk_password', previous.password);
      res.status(400).json({ error: e.message });
    }
  });
  app.post('/api/vipkid/sync', async (_req, res) => {
    try { res.json({ ok: true, ...(await syncClasses()) }); } catch (e) { setSetting('vk_last_error', e.message); res.status(400).json({ error: e.message }); }
  });
  app.post('/api/vipkid/goal', (req, res) => {
    const { target, taughtBefore: before } = req.body || {};
    if (target !== undefined) {
      const t = Math.round(Number(target));
      if (!(t >= 1 && t <= 2000)) return res.status(400).json({ error: 'Enter a class goal from 1 to 2,000.' });
      setSetting('vk_goal', t);
    }
    if (before !== undefined) {
      const n = Math.round(Number(before));
      if (!(n >= 0 && n <= 2000)) return res.status(400).json({ error: 'Enter a number of classes, 0 or more.' });
      setSetting('vk_taught_before', JSON.stringify({ month: monthIn(Date.now(), VIPKID_TZ), count: n }));
    }
    res.json({ ok: true });
  });
  app.post('/api/vipkid/disconnect', (_req, res) => {
    for (const k of ['vk_server', 'vk_user', 'vk_password']) setSetting(k, '');
    res.json({ ok: true });
  });
  // Keep the class list fresh: every hour while connected.
  setInterval(async () => {
    if (getSetting('vk_user') === '' || Date.now() - Number(getSetting('vk_last_sync')) < 58 * 60000) return;
    try { await syncClasses(); } catch (e) { setSetting('vk_last_error', e.message); }
  }, 10 * 60000);
}
