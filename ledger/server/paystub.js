// Fills in the tax page's household figures from a pay stub (Taxes, "Your household").
//
// A photo, screenshot or PDF of a stub is read by Claude, which returns this check's and the
// year-to-date gross pay, pre-tax deductions and tax withheld. The page shows them for checking
// and works out the year: year to date plus this check's figure for each check still to come.
// Nothing is saved until the person presses "Use these figures", and the file itself is never kept.
//
// What is saved (POST /api/paystub/apply): that person's wages and pre-tax deductions for the
// year (settings your_salary / spouse_salary, pretax_you / pretax_spouse) and their withholding
// (setting stub_you / stub_spouse, JSON). The household's withholding totals (withheld_fed,
// withheld_ar) are filled in once every earner has a stub: one for single or head of household,
// both for a joint return.
//
// Each stub that was added is also kept (setting `pay_stubs`, a JSON list: whose, the employer, the pay date,
// the first month that job paid this year, checks still to come, and the stub's this-check and year-to-date
// figures), one per job. A person's yearly figures are the sum over their jobs, so someone who changed jobs
// adds the last stub of each. `payCoverage()` turns that list into the month-by-month picture on the Taxes
// page: which months are on a stub, which are estimated from the last one, and which have nothing entered.
import Anthropic from '@anthropic-ai/sdk';
import { db, iso, getSetting, setSetting } from './db.js';
import { TAX_YEAR, statusOf } from './tax.js';
import { apiKey, model, readableError } from './recap.js';
import { noteUsage, aiSource, limitMessage } from './ai.js';
import { isGigPay } from './gig.js';

const money = (description) => ({ type: 'number', description: `${description}. Dollars, always positive. Use -1 if the stub doesn't show it.` });
const TOOL = {
  name: 'record_pay_stub',
  description: 'Record the figures printed on the pay stub.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      employer: { type: 'string', description: 'The employer as printed; empty if not shown' },
      pay_date: { type: 'string', description: 'The pay date (check date) as YYYY-MM-DD; empty if not shown' },
      frequency: { type: 'string', enum: ['weekly', 'biweekly', 'semimonthly', 'monthly', 'unknown'], description: 'How often this job pays, from the pay period dates or a stated frequency' },
      gross_this: money('Gross pay for this check'),
      gross_ytd: money('Gross pay year to date'),
      pretax_this: money('Total of pre-tax deductions for this check: retirement, health, dental and vision premiums, HSA or FSA, and anything else taken out before federal income tax'),
      pretax_ytd: money('Total of pre-tax deductions year to date'),
      federal_this: money('Federal income tax withheld for this check (not Social Security or Medicare)'),
      federal_ytd: money('Federal income tax withheld year to date'),
      state_this: money('State income tax withheld for this check'),
      state_ytd: money('State income tax withheld year to date'),
      unsure: { type: 'string', description: 'Anything a person should double-check, in one or two short sentences; empty if nothing' },
    },
    required: ['employer', 'pay_date', 'frequency', 'gross_this', 'gross_ytd', 'pretax_this', 'pretax_ytd', 'federal_this', 'federal_ytd', 'state_this', 'state_ytd', 'unsure'],
    additionalProperties: false,
  },
};
const SYSTEM = `You read a pay stub (a photo, screenshot or PDF) and record its figures for a household tax estimate. Record only what is printed. Federal income tax withheld is the line usually labelled Federal Income Tax, Fed Withholding or FIT; it does not include Social Security (OASDI) or Medicare. Pre-tax deductions are amounts taken out before federal income tax: retirement contributions (401(k), 403(b), teacher retirement), medical, dental and vision premiums, HSA and FSA. Leave out after-tax deductions such as Roth contributions, garnishments and union dues unless the stub marks them as pre-tax. If the stub shows federal taxable wages, you can check your pre-tax total against gross pay less taxable wages, and mention any gap in "unsure". Never guess a figure the stub doesn't show: use -1. Do not record or repeat Social Security numbers, bank account numbers or home addresses.`;

async function readStub(mediaType, data) {
  const client = new Anthropic({ apiKey: apiKey(), timeout: 120_000, maxRetries: 1 });
  const source = aiSource();
  const file = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  let response;
  try {
    response = await client.messages.create({
      model: model(), max_tokens: 4000, system: SYSTEM, tools: [TOOL],
      messages: [{ role: 'user', content: [file, { type: 'text', text: `Today is ${iso(new Date())}. Record the figures on this pay stub.` }] }],
    });
  } catch (e) {
    throw readableError(e);
  }
  noteUsage('paystub', response, source, 'a pay stub you uploaded');
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read that file.');
  const call = response.content.find((b) => b.type === 'tool_use' && b.name === TOOL.name);
  if (!call || typeof call.input?.gross_this !== 'number') throw new Error("Claude couldn't find pay stub figures in that file.");
  return call.input;
}

/** How many more checks this job pays in the stub's year after its pay date. */
export function checksLeft(payDate, frequency) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate || '')) return null;
  const d = new Date(`${payDate}T12:00:00`), end = new Date(d.getFullYear(), 11, 31, 12);
  const days = Math.round((end - d) / 86400000);
  if (frequency === 'weekly') return Math.floor(days / 7);
  if (frequency === 'biweekly') return Math.floor(days / 14);
  const monthsAfter = 11 - d.getMonth();
  if (frequency === 'monthly') return monthsAfter;
  // Twice a month: a check in the first half of the month has one more to come that month.
  if (frequency === 'semimonthly') return monthsAfter * 2 + (d.getDate() <= 20 ? 1 : 0);
  return null;
}

const whoOf = (v) => (v === 'spouse' ? 'spouse' : 'you');
const r2 = (v) => Math.round(v * 100) / 100;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const KINDS = ['gross', 'pretax', 'federal', 'state'];
const PERIOD = { weekly: 7, biweekly: 14, semimonthly: 365 / 24, monthly: 365 / 12 };

/**
 * The first month of the year a job paid, guessed from its stub: the year-to-date gross divided by this
 * check's gross is roughly how many checks the year-to-date holds. When that is most of the checks there
 * could have been since January, the job is taken to have run all year (pay changes mid-year and a bonus
 * on this check both throw the count off by a few). Only a clear shortfall, such as seven checks by
 * November, is read as a job that began later. The person can correct it on the form.
 */
export function firstMonth(payDate, frequency, grossYtd, grossThis) {
  if (!isDate(payDate) || !PERIOD[frequency] || !(grossThis > 0) || !(grossYtd > 0)) return 1;
  const d = new Date(`${payDate}T12:00:00`);
  const dayOfYear = Math.round((d - new Date(d.getFullYear(), 0, 1, 12)) / 86400000);
  const held = grossYtd / grossThis, possible = dayOfYear / PERIOD[frequency] + 1;
  if (held >= possible * 0.75) return 1;
  const start = new Date(d.getTime() - Math.max(0, Math.round(held) - 1) * PERIOD[frequency] * 86400000);
  return start.getFullYear() < d.getFullYear() ? 1 : start.getMonth() + 1;
}

const stubsAll = () => { try { const v = JSON.parse(getSetting('pay_stubs') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
/** One stub as sent by the form, cleaned; null when the form sent no parts (an older page). */
function cleanStub(who, b) {
  const p = b?.parts;
  if (!p || typeof p !== 'object') return null;
  const amt = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? r2(n) : 0; };
  const rec = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, who, employer: String(b.employer || '').replace(/\s+/g, ' ').trim().slice(0, 80), pay_date: isDate(b.pay_date) ? b.pay_date : '', frequency: PERIOD[b.frequency] ? b.frequency : 'unknown', left: Math.max(0, Math.min(60, Math.round(Number(b.left) || 0))), saved: iso(new Date()) };
  for (const k of KINDS) rec[k] = { ytd: amt(p[k]?.ytd), this: amt(p[k]?.this) };
  const payMonth = rec.pay_date ? Number(rec.pay_date.slice(5, 7)) : 12;
  const first = Math.round(Number(b.first_month));
  rec.first_month = first >= 1 && first <= 12 ? Math.min(first, payMonth) : firstMonth(rec.pay_date, rec.frequency, rec.gross.ytd, rec.gross.this);
  return rec;
}
// Months someone was not paid at all (between jobs, unpaid leave), marked on the ring so they stop reading as missing.
const skipsAll = () => { try { const v = JSON.parse(getSetting('pay_skips') || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const yearOf = (s, k) => r2(s[k].ytd + s[k].this * s.left);
/** Writes one person's yearly figures from their kept stubs, and the household's withholding once everyone has one. */
function totalUp(who, all, clear = true) {
  const mine = all.filter((s) => s.who === who);
  const joint = ['joint', 'separate'].includes(statusOf(getSetting('filing_status', 'joint')));
  if (mine.length) {
    const sum = (k) => r2(mine.reduce((a, s) => a + yearOf(s, k), 0));
    const newest = mine.reduce((a, s) => ((s.pay_date || s.saved) > (a.pay_date || a.saved) ? s : a));
    setSetting(who === 'you' ? 'your_salary' : 'spouse_salary', sum('gross'));
    setSetting(who === 'you' ? 'pretax_you' : 'pretax_spouse', sum('pretax'));
    setSetting(`stub_${who}`, JSON.stringify({ federal: sum('federal'), state: sum('state'), employer: newest.employer, pay_date: newest.pay_date, saved: iso(new Date()) }));
  } else if (clear) setSetting(`stub_${who}`, '');
  const you = stubOf('you'), spouse = joint ? stubOf('spouse') : { federal: 0, state: 0 };
  const complete = !!you && !!spouse;
  if (complete) {
    setSetting('withheld_fed', r2(you.federal + spouse.federal));
    setSetting('withheld_ar', r2(you.state + spouse.state));
  }
  return { ok: true, complete, waitingOn: complete ? null : you ? 'spouse' : 'you' };
}

/**
 * What pay the tax estimate is built from, laid out by month for each adult (Taxes, "Your household").
 * A month is 'stub' when a kept stub's year-to-date covers it (from the job's first month to the stub's pay
 * date), 'est' when it comes after a stub and that job still has checks to come (this check, repeated), and
 * 'none' when nothing has been entered for it. A yearly figure with no kept stub behind it (typed by hand,
 * or from a stub added before stubs were kept) has no months to show: every month is 'typed'.
 */
export function payCoverage(now = new Date()) {
  const joint = ['joint', 'separate'].includes(statusOf(getSetting('filing_status', 'joint')));
  const names = householdNames();
  let more = {};
  try { more = JSON.parse(getSetting('tax_more') || '{}') || {}; } catch { /* none */ }
  const all = stubsAll();
  const people = [];
  const skips = skipsAll();
  // Where today falls in the tax year: month 1 to 12, 0 before it starts, 13 once it is over.
  const nowMonth = now.getFullYear() === TAX_YEAR ? now.getMonth() + 1 : now.getFullYear() > TAX_YEAR ? 13 : 0;
  for (const who of joint ? ['you', 'spouse'] : ['you']) {
    const wages = Number(getSetting(who === 'you' ? 'your_salary' : 'spouse_salary')) || 0;
    const other = (Array.isArray(more.jobs) ? more.jobs : []).filter((j) => (j?.who === 'spouse' ? 'spouse' : 'you') === who && Number(j?.wages) > 0).map((j) => ({ name: String(j.name || ''), wages: Number(j.wages) }));
    const old = stubOf(who);
    const jobs = all.filter((s) => s.who === who).sort((a, b) => (a.first_month - b.first_month) || (a.pay_date < b.pay_date ? -1 : 1)).map((s) => {
      const year = s.pay_date ? Number(s.pay_date.slice(0, 4)) : TAX_YEAR;
      const to = s.pay_date ? Number(s.pay_date.slice(5, 7)) : 12;
      return {
        id: s.id, employer: s.employer, pay_date: s.pay_date, from: Math.min(s.first_month || 1, to), to, left: s.left, stale: year !== TAX_YEAR,
        soFar: s.gross.ytd, toCome: r2(s.gross.this * s.left), year: yearOf(s, 'gross'),
        federal: yearOf(s, 'federal'), state: yearOf(s, 'state'), pretax: yearOf(s, 'pretax'),
      };
    });
    if (!jobs.length && !(wages > 0) && !other.length) continue;
    const live = jobs.filter((j) => !j.stale);
    const months = [];
    for (let m = 1; m <= 12; m++) {
      if (!jobs.length) months.push(wages > 0 ? 'typed' : 'none');
      else if (live.some((j) => m >= j.from && m <= j.to)) months.push('stub');
      else if (live.some((j) => j.left > 0 && m > j.to)) months.push('est');
      else months.push('none');
    }
    const total = r2(jobs.reduce((a, j) => a + j.year, 0));
    // The day of the month by which this person has usually been paid at least once: the newest stub's
    // day, or the earlier of the two for someone paid more than once a month. The 15th with no stub to go on.
    const newest = live.reduce((a, j) => (!a || j.pay_date > a.pay_date ? j : a), null);
    const day = newest?.pay_date ? Number(newest.pay_date.slice(8, 10)) : 15;
    const many = newest && all.find((s) => s.id === newest.id)?.frequency;
    const dueDay = ['weekly', 'biweekly', 'semimonthly'].includes(many) && day > 15 ? day - 15 : day;
    // Each month for the ring: 'done' (on a stub), 'off' (marked as no pay that month), 'later' (not due
    // yet), 'due' (this month, after the usual pay day, nothing in yet) or 'late' (an earlier month with nothing).
    const status = months.map((m, i) => {
      if (m === 'stub') return 'done';
      if ((skips[who] || []).includes(i + 1)) return 'off';
      if (i + 1 > nowMonth) return 'later';
      if (i + 1 === nowMonth) return now.getDate() >= dueDay ? 'due' : 'later';
      return 'late';
    });
    people.push({
      who, status, dueDay, name: who === 'you' ? names.you : names.spouse, wages, jobs, other, months, total,
      // The salary box was changed by hand after the stubs were added, so the two no longer agree.
      typedOver: jobs.length > 0 && Math.abs(total - wages) >= 1,
      // A yearly figure from a stub added before each stub was kept: no months to show for it.
      earlier: !jobs.length && old ? { employer: old.employer || '', pay_date: old.pay_date || '' } : null,
    });
  }
  // The household's month: 'done' when everyone with pay is in (or had none), 'partial' when only some are,
  // 'late' or 'due' when nobody is, 'later' when it isn't time yet.
  const ring = Array.from({ length: 12 }, (_, i) => {
    const st = people.map((p) => p.status[i]);
    if (!st.length) return 'later';
    const ok = st.filter((x) => x === 'done' || x === 'off').length, wanted = st.filter((x) => x === 'late' || x === 'due').length;
    if (ok === st.length) return st.includes('done') ? 'done' : 'off';
    if (wanted && st.includes('done')) return 'partial';
    return st.includes('late') ? 'late' : st.includes('due') ? 'due' : st.includes('done') ? 'done' : 'later';
  });
  return { year: TAX_YEAR, month: nowMonth > 12 ? 12 : nowMonth, people, ring };
}
// The two adults' first names (Taxes, "Your household"), so a reminder can say whose stub it means whoever
// is reading. The first adult's is the older setting `mail_your_name`, which the summary email already used.
const cleanName = (v) => String(v ?? '').replace(/[^\p{L}\p{M}' .-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30);
export const householdNames = () => ({ you: getSetting('mail_your_name') || '', spouse: getSetting('spouse_name') || '' });
const stubOf = (who) => { try { return JSON.parse(getSetting(`stub_${who}`) || 'null'); } catch { return null; } };

/**
 * Who should be reminded to add a pay stub (the dashboard's notice and, once a month, the summary email).
 * A stub is what gives the tax estimate real wages, pre-tax deductions and tax withheld; without one
 * "Owe or refund at filing" can't be worked out. Someone needs one when they have wages and either no
 * stub for this tax year ('missing') or one more than four months old while the year is still running
 * ('old': a later stub is closer to the year's real totals). Two more, added the same day at his word:
 * 'yearend', from mid-December, when their stub is from before December (the last stubs of the year carry
 * its final totals); and 'changed', when a regular paycheck's deposits have settled at a different amount
 * since the newest stub was added (a raise, a new deduction, a change of hours), which is when a stub goes
 * out of date fastest. A household with no wages (side jobs only, retired) is never reminded. It doesn't
 * look at how often anyone is paid: a stub's year-to-date covers every earlier check, so one recent stub is
 * enough whether pay is monthly or twice a month. Says nothing about any figure, only who and why.
 */
const STUB_OLD_DAYS = 120;
const datedOf = (stub) => (stub && /^\d{4}-\d{2}-\d{2}$/.test(stub.pay_date || stub.saved || '') ? (stub.pay_date || stub.saved) : '');

/** Regular paychecks whose deposits have settled at a new amount since `since` (the newest stub's date). */
function changedPay(since) {
  const out = [];
  let schedules = [];
  try { schedules = db.prepare('SELECT * FROM pay_schedules').all(); } catch { return out; }
  for (const s of schedules) {
    // Side-gig pay and pay that is an average of uneven deposits change all the time; that isn't news.
    if (isGigPay(s) || s.amount_mode === 'average') continue;
    let deposits = [];
    try { deposits = db.prepare('SELECT date, amount FROM transactions WHERE merchant LIKE ? AND amount > 0 AND COALESCE(waiting, 0) = 0 AND COALESCE(pending, 0) = 0 ORDER BY date DESC LIMIT 12').all(s.merchant_like); } catch { continue; }
    const after = deposits.filter((d) => d.date > since), before = deposits.filter((d) => d.date <= since).slice(0, 3);
    if (after.length < 2 || before.length < 2) continue;
    // Two in a row that agree: a single odd check (a bonus, a short week) is not a change.
    if (Math.abs(after[0].amount - after[1].amount) > Math.abs(after[1].amount) * 0.01) continue;
    const was = before.map((d) => d.amount).sort((x, y) => x - y)[Math.floor(before.length / 2)];
    if (Math.abs(after[0].amount - was) > Math.abs(was) * 0.03) out.push({ who: 'pay', why: 'changed', date: after[1].date, name: String(s.name || 'A paycheck').replace(/\s*\(.*\)$/, '') });
  }
  return out;
}
/**
 * Tax withheld so far, apart from what the checks still to come will add (Taxes, "Paid in so far"). The
 * whole-year withholding the estimate uses is each kept stub's year to date plus this check for each one
 * to come; this gives the two halves. `split` is true only when every earner has kept stubs for this tax
 * year and they add up to the whole-year figures in use: if someone typed over the withholding boxes, or
 * a stub predates kept stubs, there is no honest "so far" to show and the page shows the whole year alone.
 */
export function withheldSoFar() {
  const joint = ['joint', 'separate'].includes(statusOf(getSetting('filing_status', 'joint')));
  const all = stubsAll().filter((s) => !s.pay_date || Number(s.pay_date.slice(0, 4)) === TAX_YEAR);
  const sum = (k, part) => r2(all.reduce((a, s) => a + (part === 'ytd' ? s[k].ytd : s[k].this * s.left), 0));
  const out = { federal: sum('federal', 'ytd'), state: sum('state', 'ytd'), federalToCome: sum('federal', 'come'), stateToCome: sum('state', 'come'), asOf: all.reduce((a, s) => (s.pay_date > a ? s.pay_date : a), ''), split: false };
  const everyone = (joint ? ['you', 'spouse'] : ['you']).every((who) => all.some((s) => s.who === who) || !(Number(getSetting(who === 'you' ? 'your_salary' : 'spouse_salary')) > 0));
  const near = (a, b) => Math.abs(a - (Number(b) || 0)) < 1;
  out.split = all.length > 0 && everyone && near(out.federal + out.federalToCome, getSetting('withheld_fed')) && near(out.state + out.stateToCome, getSetting('withheld_ar'));
  return out;
}

/** The household's own switch (Settings, Alerts): off silences the dashboard notice and the email line alike. */
export const stubRemindOn = () => getSetting('stub_remind') !== '0';
export function stubReminder(now = new Date()) {
  const joint = ['joint', 'separate'].includes(statusOf(getSetting('filing_status', 'joint')));
  if (!stubRemindOn()) { const n = householdNames(); return { people: [], joint, name: n.you, spouseName: n.spouse }; }
  const wages = (who) => Number(getSetting(who === 'you' ? 'your_salary' : 'spouse_salary')) > 0;
  // Paychecks set up but no pay typed yet: the estimate has nothing to go on, and a stub is the quickest cure.
  let paydays = 0;
  try { paydays = db.prepare('SELECT COUNT(*) n FROM pay_schedules WHERE CAST(id AS TEXT) != ?').get(getSetting('gig_schedule_id') || '').n; } catch { /* no such table yet */ }
  const people = [];
  let newest = '';
  for (const who of joint ? ['you', 'spouse'] : ['you']) {
    // A retired household's "paydays" are Social Security or a pension, which have no pay stub.
    if (!wages(who) && !(who === 'you' && paydays > 0 && !wages('spouse') && getSetting('retired') !== '1')) continue;
    const stub = stubOf(who);
    const dated = datedOf(stub);
    if (!stub || (dated && Number(dated.slice(0, 4)) !== TAX_YEAR)) { people.push({ who, why: 'missing', date: '' }); continue; }
    if (dated > newest) newest = dated;
    // From mid-December (and into the new year, until the tax year moves on): the year's last stubs.
    const closing = now.getFullYear() > TAX_YEAR || (now.getMonth() === 11 && now.getDate() >= 15);
    if (closing && dated && dated < `${TAX_YEAR}-12-01`) { people.push({ who, why: 'yearend', date: dated }); continue; }
    const age = dated ? (now - new Date(`${dated}T12:00:00`)) / 86400000 : 0;
    if (now.getFullYear() === TAX_YEAR && age > STUB_OLD_DAYS) people.push({ who, why: 'old', date: dated });
  }
  // A paycheck that has changed since the newest stub. Only when nobody is already being asked for one.
  if (!people.length && newest) people.push(...changedPay(newest));
  const names = householdNames();
  return { people, joint, name: names.you, spouseName: names.spouse };
}

/** The reminder as a sentence or two, for the summary email. Empty when nobody needs one. */
export function stubReminderText(r = stubReminder()) {
  if (!r.people.length) return '';
  const whose = (p) => (p.who === 'spouse' ? (r.spouseName ? `${r.spouseName}'s` : "your spouse's") : r.name ? `${r.name}'s` : 'your');
  const missing = r.people.filter((p) => p.why === 'missing'), old = r.people.filter((p) => p.why === 'old');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const out = [];
  if (missing.length === 2) out.push("Neither pay stub has been added to Ledger yet, so the tax estimate can't say what you'll owe or get back.");
  else if (missing.length) out.push(`${cap(whose(missing[0]))} pay stub hasn't been added to Ledger yet, so the tax estimate can't say what you'll owe or get back.`);
  if (old.length) out.push(`${cap(old.map(whose).join(' and '))} pay stub in Ledger is more than four months old. A recent one keeps the tax estimate close.`);
  const yearend = r.people.filter((p) => p.why === 'yearend'), changed = r.people.filter((p) => p.why === 'changed');
  if (yearend.length) out.push(`It's the end of the year: add ${yearend.map(whose).join(' and ')} last pay stub of the year. It carries the year's final totals, which is as close as the estimate gets before you file.`);
  if (changed.length) out.push(`${changed.map((p) => p.name).join(' and ')} ${changed.length === 1 ? 'has' : 'have'} changed in amount since the last pay stub was added. A new stub brings the tax estimate up to date.`);
  out.push('Add one on the Taxes page, under "Your household".');
  return out.join(' ');
}

export function installPaystub(app) {
  // What has been filled in from stubs so far, for the Taxes page.
  app.get('/api/paystub', (_req, res) => res.json({ you: stubOf('you'), spouse: stubOf('spouse'), year: TAX_YEAR, remind: stubReminder(), remindOn: stubRemindOn(), names: householdNames(), coverage: payCoverage(), withheld: withheldSoFar() }));

  // Settings, Alerts: "Remind us to add pay stubs". For the whole household, not one device.
  app.put('/api/paystub/remind', (req, res) => {
    setSetting('stub_remind', req.body?.on === false ? '0' : '1');
    res.json({ remindOn: stubRemindOn(), remind: stubReminder() });
  });

  // The adults' first names. A blank one goes back to "your" and "your spouse's".
  app.put('/api/paystub/names', (req, res) => {
    if ('you' in (req.body || {})) setSetting('mail_your_name', cleanName(req.body.you));
    if ('spouse' in (req.body || {})) setSetting('spouse_name', cleanName(req.body.spouse));
    res.json(householdNames());
  });

  // Reads a stub and returns its figures for checking. Saves nothing.
  app.post('/api/paystub/read', async (req, res) => {
    if (!apiKey()) return res.status(400).json({ error: limitMessage() || 'Reading a pay stub needs the AI features switched on in Settings. You can type the figures instead.' });
    const m = /^data:(image\/(?:png|jpeg|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.file || ''));
    if (!m) return res.status(400).json({ error: "That file isn't one the app can read. Use a PDF, or a PNG or JPEG picture." });
    if (m[2].length > 7_500_000) return res.status(400).json({ error: 'That file is too large. Try a screenshot of the stub.' });
    try {
      const r = await readStub(m[1], m[2]);
      const shown = (n) => (typeof n === 'number' && n >= 0 ? Math.round(n * 100) / 100 : null);
      res.json({
        employer: String(r.employer || '').slice(0, 80), pay_date: /^\d{4}-\d{2}-\d{2}$/.test(r.pay_date) ? r.pay_date : '', frequency: r.frequency,
        gross: { this: shown(r.gross_this), ytd: shown(r.gross_ytd) }, pretax: { this: shown(r.pretax_this), ytd: shown(r.pretax_ytd) },
        federal: { this: shown(r.federal_this), ytd: shown(r.federal_ytd) }, state: { this: shown(r.state_this), ytd: shown(r.state_ytd) },
        checksLeft: checksLeft(r.pay_date, r.frequency), unsure: String(r.unsure || ''), year: TAX_YEAR,
        firstMonth: firstMonth(r.pay_date, r.frequency, r.gross_ytd, r.gross_this),
      });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // Saves one person's yearly figures, as checked on the page.
  app.post('/api/paystub/apply', (req, res) => {
    const who = whoOf(req.body?.who);
    const joint = ['joint', 'separate'].includes(statusOf(getSetting('filing_status', 'joint')));
    if (who === 'spouse' && !joint) return res.status(400).json({ error: 'A spouse only counts on a joint return. Change how you file first.' });
    const n = (k) => Number(req.body?.[k]);
    for (const k of ['wages', 'pretax', 'federal', 'state']) if (!Number.isFinite(n(k)) || n(k) < 0) return res.status(400).json({ error: 'Enter each figure as a number of 0 or more.' });
    const rec = cleanStub(who, req.body);
    if (rec) {
      // One stub per job. `replaces` is the kept stub this one supersedes (a newer stub from the same job),
      // 'all' when it is the person's only job this year, or nothing when it is another job to add.
      const replaces = String(req.body?.replaces || '');
      // An older stub from the same job adds nothing: the newer one's year to date already holds it.
      const older = stubsAll().find((s) => s.who === who && s.id === replaces && s.pay_date && rec.pay_date && rec.pay_date < s.pay_date);
      if (older) return res.status(400).json({ error: `The stub already kept for ${older.employer || 'that job'} is newer (${older.pay_date}), and its year to date already includes this one. Nothing more is needed for that month.` });
      const kept = stubsAll().filter((s) => !(s.who === who && (replaces === 'all' || s.id === replaces)));
      kept.push(rec);
      // A month marked "nothing was paid" that a stub now covers is no longer that.
      const skips = skipsAll();
      if (skips[who]?.length) { const to = rec.pay_date ? Number(rec.pay_date.slice(5, 7)) : 12; skips[who] = skips[who].filter((m) => m < rec.first_month || m > to); setSetting('pay_skips', JSON.stringify(skips)); }
      setSetting('pay_stubs', JSON.stringify(kept));
      return res.json(totalUp(who, kept));
    }
    // A page from before stubs were kept: the yearly figures as sent, and nothing to lay out by month.
    setSetting('pay_stubs', JSON.stringify(stubsAll().filter((s) => s.who !== who)));
    setSetting(who === 'you' ? 'your_salary' : 'spouse_salary', r2(n('wages')));
    setSetting(who === 'you' ? 'pretax_you' : 'pretax_spouse', r2(n('pretax')));
    setSetting(`stub_${who}`, JSON.stringify({
      federal: r2(n('federal')), state: r2(n('state')), employer: String(req.body?.employer || '').slice(0, 80),
      pay_date: /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.pay_date)) ? req.body.pay_date : '', saved: iso(new Date()),
    }));
    res.json(totalUp(who, [], false));
  });

  // Marks a month as one with no pay for that person (or takes the mark off).
  app.put('/api/paystub/skip', (req, res) => {
    const who = whoOf(req.body?.who), month = Math.round(Number(req.body?.month));
    if (!(month >= 1 && month <= 12)) return res.status(400).json({ error: 'Choose a month.' });
    const skips = skipsAll();
    const mine = new Set(Array.isArray(skips[who]) ? skips[who] : []);
    if (req.body?.on === false) mine.delete(month); else mine.add(month);
    skips[who] = [...mine].sort((a, b) => a - b);
    setSetting('pay_skips', JSON.stringify(skips));
    res.json({ ok: true, coverage: payCoverage() });
  });

  // Takes one kept stub away again. The person's yearly figures become the sum of the stubs that remain;
  // with none left, the wages and pre-tax figures stay as they are, as a typed yearly figure.
  app.delete('/api/paystub/:id', (req, res) => {
    const all = stubsAll(), gone = all.find((s) => s.id === req.params.id);
    if (!gone) return res.status(404).json({ error: 'That pay stub is no longer there.' });
    const kept = all.filter((s) => s !== gone);
    setSetting('pay_stubs', JSON.stringify(kept));
    totalUp(gone.who, kept);
    res.json({ ok: true, coverage: payCoverage() });
  });
}
