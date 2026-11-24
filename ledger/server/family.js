// Family requests, on the host's own copy of Ledger (Settings, "Family requests").
//
// A family member asks for their own copy on the public request page (server/join.js, a separate
// small service). This file is the host's side of that: it lists the requests, opens and closes the
// request page, emails the host when someone asks, and on approval hands the person one of the
// copies that are kept waiting.
//
// It is only active on a copy that has been told where the request service is: settings `join_url`
// (the server's own address and port 4319) and `join_key` (the service's JOIN_KEY; never print it).
// Other households' copies have neither, so they show none of this.
//
// The waiting copies ("the pool") are made ahead of time on the NAS, because a web page should not
// be able to start containers. They are listed in pool.json in this copy's data folder:
//   [{ "name": "h1", "port": 4321, "code": "<that copy's one-time setup code>" }, ...]
// Table `family` records which copy went to whom. Approving a request takes the first free copy.
//
// Web addresses: each waiting copy has an address (ledger1.example.com and so on) behind Cloudflare
// Access, whose policy lets in only the email addresses listed for that copy. Settings `cf_token`
// (a Cloudflare key limited to the tunnel, DNS and Access; never print it) and `cf_config` (JSON:
// the account id, the request page's address, and each copy's host and policy id) are written by
// scripts/household/cf-push.sh. Approving a request puts the person's email on their copy's policy
// and emails them their link and one-time setup code; more emails (a spouse) can be added and removed
// later. A copy with nobody listed keeps a placeholder address that cannot exist, because Cloudflare
// does not enforce a policy-less application at all (found the hard way on 2026-11-17).
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, setSetting } from './db.js';
import { canSendMail, letterHtml, sendNote } from './mail.js';
import { buildId } from './activity.js';

db.exec(`CREATE TABLE IF NOT EXISTS family (
  slot TEXT PRIMARY KEY, request_id INTEGER, name TEXT NOT NULL, email TEXT NOT NULL, approved_at INTEGER NOT NULL)`);

const configured = () => getSetting('join_url') !== '' && getSetting('join_key') !== '';
async function service(route, init = {}) {
  const r = await fetch(getSetting('join_url').replace(/\/+$/, '') + route, {
    method: init.method || 'GET', signal: AbortSignal.timeout(8000),
    headers: { 'x-join-key': getSetting('join_key'), ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!r.ok) throw new Error(`The request page's service answered ${r.status}.`);
  return r.json();
}

function pool() {
  const dir = process.env.LEDGER_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
  try {
    const list = JSON.parse(fs.readFileSync(path.join(dir, 'pool.json'), 'utf8'));
    return Array.isArray(list) ? list.filter((s) => s && s.name && s.port && s.code) : [];
  } catch { return []; }
}
// ---- Cloudflare: who may reach each copy's web address ----
db.exec('CREATE TABLE IF NOT EXISTS family_emails (slot TEXT NOT NULL, email TEXT NOT NULL, PRIMARY KEY (slot, email))');
const NOBODY = 'nobody@ledger.invalid';
const cloud = () => { try { const c = JSON.parse(getSetting('cf_config') || 'null'); return c && getSetting('cf_token') ? c : null; } catch { return null; } };
const emailsFor = (slot) => db.prepare('SELECT email FROM family_emails WHERE slot = ? ORDER BY rowid').all(slot).map((r) => r.email);
const goodEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;

/** Sets a copy's allowed emails at Cloudflare to exactly what the app has listed for it. */
async function pushEmails(slotName) {
  const c = cloud(), copy = c?.copies?.[slotName];
  if (!copy) throw new Error("This copy has no web address set up, so there's nothing to update at Cloudflare.");
  const emails = emailsFor(slotName);
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.account}/access/policies/${copy.policy}`, {
    method: 'PUT', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${getSetting('cf_token')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Ledger ${slotName} household`, decision: 'allow', include: (emails.length ? emails : [NOBODY]).map((email) => ({ email: { email } })) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.success) throw new Error(`Cloudflare didn't accept the change (${r.status}).`);
  // The copy keeps the same list and checks it for itself (server/access.js).
  const slot = pool().find((s) => s.name === slotName);
  if (slot) { try { await pushAccess(slot); } catch { /* it is told again at the next start-up */ } }
  // An email taken off the list: end the sign-ins Cloudflare has already given out for this address, so
  // the change takes effect now and not when they run out.
  if (copy.app) { try { await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.account}/access/apps/${copy.app}/revoke_tokens`, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${getSetting('cf_token')}` } }); } catch { /* the copy's own check still holds */ } }
}

// Where a copy is reached: its web address when it has one, otherwise the home network and Tailscale.
const addressesFor = (slot) => (cloud()?.copies?.[slot.name] ? [`https://${cloud().copies[slot.name].host}`] : (process.env.LEDGER_COPY_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean).map((h) => `http://${h}:${slot.port}`));

// ---- AI: on the host's key, or the household brings its own ----
// Each copy is started with the host's Anthropic key (capped a month). The host can keep it out of a
// copy, when approving or later; that household then adds a key of its own in Settings or goes without
// the AI features. The choice lives on the copy (setting `ai_host_off` there); this asks the copy
// directly, with its setup code, and also reads back what it has used of the host's key this month.
const copyHost = () => new URL(getSetting('join_url')).hostname;   // the copies listen on the NAS's own address
async function copyAi(slot, change) {
  const r = await fetch(`http://${copyHost()}:${slot.port}/api/auth/host-ai`, {
    method: 'POST', signal: AbortSignal.timeout(4000),
    headers: { 'x-setup-code': slot.code, 'content-type': 'application/json' }, body: JSON.stringify(change || {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `The copy answered ${r.status}.`);
  return d;
}

// Signing in with Cloudflare's check alone (server/access.js): a copy can only offer it once it knows which
// Cloudflare team and application it sits behind, so that it can check Cloudflare's note for itself. The
// audience tag is in `cf_config` beside each copy's address. Sent at start-up and on approval; harmless to repeat.
const TEAM = () => cloud()?.team || process.env.LEDGER_ACCESS_TEAM || '';
async function pushAccess(slot) {
  const copy = cloud()?.copies?.[slot.name];
  if (!copy?.aud) return false;
  const r = await fetch(`http://${copyHost()}:${slot.port}/api/auth/host-access`, {
    method: 'POST', signal: AbortSignal.timeout(4000),
    headers: { 'x-setup-code': slot.code, 'content-type': 'application/json' }, body: JSON.stringify({ team: TEAM(), aud: copy.aud, emails: emailsFor(slot.name) }),
  });
  return r.ok;
}
async function pushAccessAll() {
  if (!configured() || !cloud()) return;
  for (const slot of pool()) { try { await pushAccess(slot); } catch { /* that copy is down; it is told next time */ } }
}

/** The same welcome as welcomeText, laid out like the summary email. */
export function welcomeHtml(name, email, link, code, ownAi = false) {
  const from = getSetting('mail_your_name');
  return letterHtml({
    title: 'Your Ledger is ready', greeting: `Hi ${name.split(' ')[0]},`,
    parts: [
      { p: 'Your own copy of Ledger is ready. It is yours alone: nobody else can see what you put in it.' },
      { button: { label: 'Open your Ledger', url: link } },
      { heading: 'Signing in' },
      { p: `It asks you to sign in. There are two ways, and either one works. Both must use this email address: ${email}` },
      { option: { title: 'Sign In Option 1:', logo: 'google', tag: 'Fastest', intro: `Use this if ${email} is a Google account, such as Gmail. There is no code to wait for.`, steps: [
        'Press "Google".',
        `If it shows a list of accounts, choose ${email}.`,
      ] } },
      { or: true },
      { option: { title: 'Sign In Option 2: A code by email', intro: "Use this for any other email address, or if you'd rather not use Google.", steps: [
        `Under "Email", type ${email}`,
        'Press "Send login code".',
        'A six-digit code arrives at that address within a minute. Type it in. A new one is sent each time.',
      ] } },
      { heading: 'After you sign in' },
      { option: { title: 'Then, whichever way you signed in', intro: 'Ledger opens and asks two things, the first time only.', steps: [
        { text: 'Choose how to open Ledger from now on: with that same sign-in and nothing more, or with a Ledger password of your own as well.', code, codeLabel: 'Only if you add a password, it asks for this one-time setup code. Otherwise you never need it.' },
        'A short guide then walks you through setting it up. It takes about five minutes and every step can be skipped.',
      ] } },
      { note: 'The sign-in check comes round again about once a month on each device.' },
      { p: 'Inside, "About" in the menu explains how everything works, including how to put Ledger on your phone\'s home screen.' },
      ...(ownAi ? [{ p: 'One optional extra. A few features use Claude, an AI made by Anthropic: Ask your CFO, reading receipts and pay stubs, and the written recap. Everything else works without them. To switch them on you add your own Anthropic key, paid to Anthropic directly (usually well under a dollar a month; the least you can put on the account is $5). Settings, "AI recap and logos" walks you through it.' }] : []),
      { p: `If anything doesn't work, just reply to this email.${from ? `\n\n${from}` : ''}` },
    ],
    foot: 'You are receiving this because you asked for a copy of Ledger and it was approved.',
  });
}

/** The email that tells an approved person how to get in. */
export function welcomeText(name, email, link, code, ownAi = false) {
  const from = getSetting('mail_your_name');
  return `Hi ${name.split(' ')[0]},

Your own copy of Ledger is ready. It is yours alone: nobody else can see what you put in it.

Open ${link}

It asks you to sign in. There are two ways, and either one works. Both must use this email address: ${email}


SIGN IN OPTION 1: GOOGLE (the fastest)
Use this if ${email} is a Google account, such as Gmail.

  1. Press "Google".
  2. If it shows a list of accounts, choose ${email}.

  That's it. There is no code to wait for.


          OR


SIGN IN OPTION 2: A CODE BY EMAIL
Use this for any other email address, or if you'd rather not use Google.

  1. Under "Email", type ${email}
  2. Press "Send login code".
  3. A six-digit code arrives at that address within a minute. Type it in. A new one is sent each time.


AFTER YOU SIGN IN (whichever way you used)

1. Ledger asks how you'd like to open it from now on: with that same sign-in and nothing more, or with a Ledger password of your own as well.

   Only if you add a password, it asks for this one-time setup code. Otherwise you never need it:

   ${code}

2. A short guide then walks you through setting it up. It takes about five minutes and every step can be skipped.

The sign-in check comes round again about once a month on each device.

Inside, "About" in the menu explains how everything works, including how to put Ledger on your phone's home screen.
${ownAi ? `
One optional extra. A few features use Claude, an AI made by Anthropic: Ask your CFO, reading receipts and pay stubs, and the written recap. Everything else works without them. To switch them on you add your own Anthropic key, which you pay Anthropic for directly; for a household it usually comes to well under a dollar a month, and the least you can put on the account is $5. Settings, "AI recap and logos" walks you through it in about five minutes.
` : ''}
If anything doesn't work, just reply to this email.
${from ? `
${from}
` : ''}`;
}

async function state() {
  const taken = new Map(db.prepare('SELECT * FROM family').all().map((f) => [f.slot, f]));
  // For copies that have been given out: whose key their AI runs on and what it has cost this month.
  const ai = new Map(await Promise.all(pool().filter((s) => taken.has(s.name)).map(async (s) => { try { return [s.name, await copyAi(s)]; } catch { return [s.name, null]; } })));
  const copies = pool().map((s) => ({ name: s.name, port: s.port, address: addressesFor(s)[0], emails: emailsFor(s.name), ai: ai.get(s.name) || null, to: taken.get(s.name) ? { name: taken.get(s.name).name, email: taken.get(s.name).email, at: taken.get(s.name).approved_at } : null }));
  let open = false, requests = [], reports = [], error = '';
  // A report's source is the copy's name; show whose copy that is.
  const whose = (source) => (source === 'host' ? 'You' : taken.get(source)?.name || (source === 'trial' ? 'The trial copy' : source));
  try { const r = await service('/admin/requests'); open = r.open; requests = r.requests; reports = (await service('/admin/feedback')).map((f) => ({ id: f.id, at: f.at, from: whose(f.source), kind: f.kind, text: f.text, status: f.status })); } catch (e) { error = `Couldn't reach the request page's service. ${e.message}`; }
  return {
    configured: true, open, error, canEmail: canSendMail(), web: !!cloud(), requestPage: cloud()?.join || `${getSetting('join_url')}`,
    requests: requests.map((r) => ({ id: r.id, at: r.at, name: r.name, email: r.email, relation: r.relation, note: r.note, status: r.status })),
    copies, free: copies.filter((c) => !c.to).length, reports,
  };
}

/** Emails the host about requests that have arrived since the last look. */
/** Emails the host about ideas and problems reported since the last look (their own are left out). */
async function notifyReports() {
  let list;
  try { list = await service('/admin/feedback'); } catch { return; }
  const last = Number(getSetting('feedback_notified', '0')) || 0;
  const fresh = list.filter((f) => f.id > last).sort((a, b) => a.id - b.id);
  if (!fresh.length) return;
  const others = fresh.filter((f) => f.source !== 'host');
  const names = new Map(db.prepare('SELECT slot, name FROM family').all().map((f) => [f.slot, f.name]));
  try {
    if (others.length) {
      await sendNote('', `Ledger: ${others.length === 1 ? 'a note' : `${others.length} notes`} from family`,
        `${others.map((f) => `${names.get(f.source) || f.source} (${f.kind}):\n${f.text}`).join('\n\n')}\n\nThey are listed in Ledger under Settings, Family requests.`);
    }
    setSetting('feedback_notified', fresh[fresh.length - 1].id);
  } catch (e) {
    console.warn('Family requests: the note about reports could not be sent.', e.message);
  }
}

async function notify() {
  if (!configured() || !canSendMail()) return;
  await notifyReports();
  let list;
  try { list = (await service('/admin/requests')).requests; } catch { return; }
  const last = Number(getSetting('join_notified', '0')) || 0;
  const fresh = list.filter((r) => r.status === 'pending' && r.id > last).sort((a, b) => a.id - b.id);
  if (!fresh.length) return;
  const lines = fresh.map((r) => `${r.name} <${r.email}>${r.relation ? `\n  How they know you: ${r.relation}` : ''}${r.note ? `\n  Their note: ${r.note}` : ''}`);
  try {
    await sendNote('', fresh.length === 1 ? `Ledger: ${fresh[0].name} asked for a copy` : `Ledger: ${fresh.length} people asked for a copy`,
      `${fresh.length === 1 ? 'Someone has' : 'Some people have'} asked for their own copy of Ledger:\n\n${lines.join('\n\n')}\n\nTo approve or decline, open Ledger and go to Settings, Family requests.\nOnly approve an email address you recognise: their link and sign-in codes will go to it.`);
    setSetting('join_notified', fresh[fresh.length - 1].id);
  } catch (e) {
    console.warn('Family requests: the notification could not be sent.', e.message);
  }
}

/**
 * Opens a password reset on a family copy and emails its one-time code: to the person the copy was
 * given to, and to any other email allowed to reach it (a spouse). Used by the host's button, and
 * by itself when a family member chooses "Email me a reset code" on their own sign-in screen.
 */
async function openReset(slot, to) {
  let opened;
  try {
    // The copies listen on the NAS's own address, the same one the request service is reached on.
    const host = new URL(getSetting('join_url')).hostname;
    const r = await fetch(`http://${host}:${slot.port}/api/auth/reset-open`, { method: 'POST', headers: { 'x-setup-code': slot.code }, signal: AbortSignal.timeout(8000) });
    opened = await r.json();
    if (!r.ok) throw new Error(opened.error || 'The copy refused.');
  } catch (e) { throw new Error(`Couldn't open a reset on ${to.name}'s copy: ${e.message}`); }
  const link = addressesFor(slot)[0];
  const emails = [...new Set([to.email, ...emailsFor(slot.name)].filter((e) => e && e !== NOBODY))];
  let emailed = false, problem = '';
  if (canSendMail()) {
    try {
      await sendNote(emails.join(', '), 'Reset your Ledger password', `Hi ${to.name},\n\nHere is a code to set a new password for your Ledger.\n\n1. Open ${link}\n2. On the sign-in screen choose "Forgot your password?"\n3. Enter this reset code: ${opened.code}\n4. Choose a new password.\n\nThe code works once and runs out in ${opened.hours} hours. Setting a new password signs out every device, so you'll sign in again with the new one.\n\nIf nobody in your household asked for this, ignore it; your password stays as it is.`, letterHtml({ title: 'Reset your password', greeting: `Hi ${to.name.split(' ')[0]},`, parts: [
        { p: 'Here is a code to set a new password for your Ledger.' },
        { button: { label: 'Open your Ledger', url: link } },
        { steps: ['On the sign-in screen choose "Forgot your password?"', 'Enter the reset code below.', 'Choose a new password.'] },
        { code: opened.code, label: `Your reset code. It works once and runs out in ${opened.hours} hours.` },
        { note: "Setting a new password signs out every device, so you'll sign in again with the new one." },
        { p: 'If nobody in your household asked for this, ignore it; your password stays as it is.' },
      ] }));
      emailed = true;
    } catch (e) { problem = e.message; }
  } else problem = 'The summary email is not set up, so nothing could be sent.';
  return { name: to.name, email: emails.join(', '), code: opened.code, hours: opened.hours, emailed, problem };
}

/**
 * Reset requests family members made themselves. Their copy can't send email, so it leaves the
 * request with the request service (which it can already reach, to pass on About-page notes), and
 * this picks them up once a minute, sends the code, and marks each as dealt with. Nobody has to
 * press anything.
 */
async function answerResets() {
  if (!configured()) return;
  let waiting = [];
  try { waiting = await service('/admin/resets'); } catch { return; }
  for (const r of Array.isArray(waiting) ? waiting : []) {
    const slot = pool().find((s) => s.name === r.source);
    const to = slot && db.prepare('SELECT * FROM family WHERE slot = ?').get(slot.name);
    let status = 'refused';
    if (slot && to) { try { status = (await openReset(slot, to)).emailed ? 'sent' : 'failed'; } catch { status = 'failed'; } }
    try { await service(`/admin/resets/${r.id}`, { method: 'POST', body: { status } }); } catch { /* it will be seen again next time */ }
  }
}

export function installFamily(app) {
  app.get('/api/family', async (_req, res) => res.json(configured() ? await state() : { configured: false }));

  app.put('/api/family/open', async (req, res) => {
    if (!configured()) return res.status(400).json({ error: 'The request page is not set up on this copy.' });
    try { await service('/admin/open', { method: 'PUT', body: { open: !!req.body?.open } }); res.json(await state()); } catch (e) { res.status(502).json({ error: e.message }); }
  });

  app.post('/api/family/requests/:id/:answer', async (req, res) => {
    if (!configured()) return res.status(400).json({ error: 'The request page is not set up on this copy.' });
    const id = Number(req.params.id), answer = req.params.answer;
    if (!['approve', 'decline'].includes(answer)) return res.status(400).json({ error: 'Unknown answer.' });
    try {
      const request = (await service('/admin/requests')).requests.find((r) => r.id === id);
      if (!request || request.status !== 'pending') return res.status(400).json({ error: 'That request has already been answered.' });
      if (answer === 'decline') { await service(`/admin/requests/${id}`, { method: 'POST', body: { status: 'declined' } }); return res.json(await state()); }
      const taken = new Set(db.prepare('SELECT slot FROM family').all().map((f) => f.slot));
      const slot = pool().find((s) => !taken.has(s.name));
      if (!slot) return res.status(409).json({ error: 'No copies are waiting. More need to be made on the NAS before this can be approved.' });
      db.prepare('INSERT INTO family (slot, request_id, name, email, approved_at) VALUES (?,?,?,?,?)').run(slot.name, id, request.name, request.email, Date.now());
      await service(`/admin/requests/${id}`, { method: 'POST', body: { status: 'approved' } });
      // Let their email through Cloudflare's check, then send them their link and setup code. If either
      // step fails the approval still stands, and the host is shown what to pass on and what went wrong.
      const handOver = { name: request.name, email: request.email, addresses: addressesFor(slot), code: slot.code, allowed: false, emailed: false, problem: '', ownAi: false };
      // "They bring their own AI": keep the host's key out of this copy before they are told about it.
      if (req.body?.ai === 'own') { try { await copyAi(slot, { included: false }); handOver.ownAi = true; } catch (e) { handOver.problem = `Their copy still has your AI switched on, because it couldn't be reached: ${e.message} You can switch it off under the copy below.`; } }
      if (cloud()) {
        try { await pushAccess(slot); } catch { /* it is told again at the next start-up */ }
        db.prepare('INSERT OR IGNORE INTO family_emails (slot, email) VALUES (?, ?)').run(slot.name, request.email);
        try { await pushEmails(slot.name); handOver.allowed = true; } catch (e) { handOver.problem = e.message; }
        if (handOver.allowed && canSendMail()) {
          try { await sendNote(request.email, 'Your Ledger is ready', welcomeText(request.name, request.email, handOver.addresses[0], slot.code, handOver.ownAi), welcomeHtml(request.name, request.email, handOver.addresses[0], slot.code, handOver.ownAi)); handOver.emailed = true; } catch (e) { handOver.problem = e.message; }
        }
      }
      res.json({ ...(await state()), handOver });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // Mark an idea or problem as dealt with (or not).
  app.post('/api/family/reports/:id', async (req, res) => {
    if (!configured()) return res.status(400).json({ error: 'Not set up on this copy.' });
    try { await service(`/admin/feedback/${Number(req.params.id)}`, { method: 'POST', body: { status: req.body?.done === false ? 'new' : 'done' } }); res.json(await state()); } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // Add or remove an email that may reach a copy's web address (a spouse, or a changed address).
  app.post('/api/family/copies/:name/emails', async (req, res) => {
    const slot = req.params.name, email = String(req.body?.email || '').trim().toLowerCase();
    if (!db.prepare('SELECT 1 FROM family WHERE slot = ?').get(slot)) return res.status(404).json({ error: 'That copy has not been given to anyone.' });
    if (!goodEmail(email)) return res.status(400).json({ error: "That email address doesn't look right." });
    const remove = req.body?.remove === true;
    if (remove) db.prepare('DELETE FROM family_emails WHERE slot = ? AND email = ?').run(slot, email);
    else db.prepare('INSERT OR IGNORE INTO family_emails (slot, email) VALUES (?, ?)').run(slot, email);
    try { await pushEmails(slot); res.json(await state()); } catch (e) {
      // Keep the app's list in step with what Cloudflare really holds.
      if (remove) db.prepare('INSERT OR IGNORE INTO family_emails (slot, email) VALUES (?, ?)').run(slot, email); else db.prepare('DELETE FROM family_emails WHERE slot = ? AND email = ?').run(slot, email);
      res.status(502).json({ error: e.message });
    }
  });

  // Switch the host's AI key on or off for a copy that has been given out.
  app.post('/api/family/copies/:name/ai', async (req, res) => {
    const slot = pool().find((s) => s.name === req.params.name);
    if (!slot || !db.prepare('SELECT 1 FROM family WHERE slot = ?').get(req.params.name)) return res.status(404).json({ error: 'That copy has not been given to anyone.' });
    if (typeof req.body?.included !== 'boolean') return res.status(400).json({ error: 'Say whether your AI is on or off for this copy.' });
    try { await copyAi(slot, { included: req.body.included }); res.json(await state()); } catch (e) { res.status(502).json({ error: `Couldn't reach that copy: ${e.message}` }); }
  });

  // How much a given-out copy is used (a click on the household's name). The copy reports a few counts
  // about itself; nothing of what is in it is asked for or sent. See server/activity.js.
  app.get('/api/family/copies/:name/activity', async (req, res) => {
    const slot = pool().find((s) => s.name === req.params.name);
    const to = db.prepare('SELECT * FROM family WHERE slot = ?').get(req.params.name);
    if (!slot || !to) return res.status(404).json({ error: 'That copy has not been given to anyone.' });
    try {
      const r = await fetch(`http://${copyHost()}:${slot.port}/api/auth/host-activity`, { method: 'POST', headers: { 'x-setup-code': slot.code }, signal: AbortSignal.timeout(5000) });
      const a = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(a.error || `The copy answered ${r.status}.`);
      res.json({ name: to.name, email: to.email, address: addressesFor(slot)[0], approvedAt: to.approved_at, emails: emailsFor(slot.name), current: !buildId() || !a.build || a.build === buildId(), ...a });
    } catch (e) { res.status(502).json({ error: `Couldn't reach that copy: ${e.message}` }); }
  });

  // What to pass on for a copy already given out (the host may need it again).
  // A family member forgot their password: open a reset on their copy and email them the one-time code.
  app.post('/api/family/copies/:name/reset', async (req, res) => {
    const slot = pool().find((s) => s.name === req.params.name);
    const to = db.prepare('SELECT * FROM family WHERE slot = ?').get(req.params.name);
    if (!slot || !to) return res.status(404).json({ error: 'That copy has not been given to anyone.' });
    try { res.json({ reset: await openReset(slot, to) }); } catch (e) { res.status(502).json({ error: e.message }); }
  });

  app.get('/api/family/copies/:name', (req, res) => {
    const slot = pool().find((s) => s.name === req.params.name);
    const to = db.prepare('SELECT * FROM family WHERE slot = ?').get(req.params.name);
    if (!slot || !to) return res.status(404).json({ error: 'That copy has not been given to anyone.' });
    res.json({ name: to.name, email: to.email, addresses: addressesFor(slot), code: slot.code });
  });

  // Look for new requests every five minutes, and shortly after start-up.
  setTimeout(() => pushAccessAll().catch(() => {}), 20000);
  setTimeout(notify, 30000);
  setInterval(notify, 5 * 60000);
  // Password resets asked for from a family copy's own sign-in screen are answered within a minute.
  setInterval(() => answerResets().catch(() => {}), 60000);
}
