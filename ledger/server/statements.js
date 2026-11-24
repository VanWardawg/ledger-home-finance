// Reading statements (The owner, 2026-11-23: "does the app allow mass uploads like this", after sending nine
// credit card statements): several PDF statements, or photos of them, are read one at a time by Claude,
// shown for checking, and only then saved.
//
// What one statement gives: the closing balance and date, what was paid, the interest and fees charged, the
// minimum payment and the rate (with any promotional rate and the day it ends), and, when the statement
// lists them, its transactions. What is saved, each only if the person leaves it ticked:
//   * a point in that debt's history (table debt_history), which is what its graph draws the past from;
//   * the rate and minimum payment, taken from the newest statement for each account;
//   * the listed transactions, through the same importer as "Import a file", so anything the bank feed or an
//     earlier file already brought in is skipped. Off unless ticked: a misread row is worse than a missing one.
// The file is sent to Claude to be read and is not kept. Same key and model as the other readers; each call
// is logged under "Statements read". The tool is not forced with tool_choice (see server/logofinder.js).
import Anthropic from '@anthropic-ai/sdk';
import { db, iso } from './db.js';
import { apiKey, model, readableError } from './recap.js';
import { noteUsage, aiSource, limitMessage } from './ai.js';
import { importFile } from './importer.js';
import './debtgraph.js';

const money = (description) => ({ type: 'number', description: `${description}. Dollars, always positive. Use -1 if the statement doesn't show it.` });
const TOOL = {
  name: 'record_statement',
  description: 'Record what is printed on one account statement.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      institution: { type: 'string', description: 'The bank, card issuer or lender as printed' },
      account_name: { type: 'string', description: 'The product or account name as printed, such as "Simplicity Card" or "Auto Loan"; empty if not shown' },
      last4: { type: 'string', description: 'The last four digits of the account number if shown, otherwise empty. Never more than four digits.' },
      kind: { type: 'string', enum: ['credit_card', 'mortgage', 'auto_loan', 'student_loan', 'other_loan', 'bank_account', 'unknown'] },
      period_start: { type: 'string', description: 'First day of the statement period as YYYY-MM-DD; empty if not shown' },
      period_end: { type: 'string', description: 'Last day of the statement period (the statement or closing date) as YYYY-MM-DD; empty if not shown' },
      previous_balance: money('Balance at the start of the period'),
      new_balance: money('Balance at the end of the period: the new balance on a card, the principal balance on a loan'),
      payments: money('Total payments made in the period'),
      purchases: money('Total purchases and other new charges in the period, balance transfers included'),
      fees: money('Total fees charged in the period'),
      interest_charged: money('Interest charged in the period'),
      principal_paid: money('On a loan: how much of the payments went to principal'),
      minimum_payment: money('Minimum payment due, or the regular monthly payment on a loan'),
      apr: { type: 'number', description: 'The standard annual percentage rate that applies to purchases (a card) or the loan\'s interest rate, as a percentage such as 28.49. Use -1 if not shown.' },
      promo_apr: { type: 'number', description: 'A promotional or introductory rate now applied to the balance, as a percentage (0 for a 0% offer). Use -1 if there is none.' },
      promo_expires: { type: 'string', description: 'The day the promotional rate ends as YYYY-MM-DD; empty if there is none or it is not shown' },
      transactions: {
        type: 'array', description: 'Each transaction listed, in the order printed, at most 150. Leave out summary lines and totals.',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD (the year comes from the statement period)' },
            description: { type: 'string' },
            amount: { type: 'number', description: 'Always positive' },
            direction: { type: 'string', enum: ['out', 'in'], description: '"out" for a purchase, fee, interest charge or withdrawal; "in" for a payment received, refund or deposit' },
          },
          required: ['date', 'description', 'amount', 'direction'], additionalProperties: false,
        },
      },
      unsure: { type: 'string', description: 'Anything a person should double-check, in one or two short sentences; empty if nothing' },
    },
    required: ['institution', 'account_name', 'last4', 'kind', 'period_start', 'period_end', 'previous_balance', 'new_balance', 'payments', 'purchases', 'fees', 'interest_charged', 'principal_paid', 'minimum_payment', 'apr', 'promo_apr', 'promo_expires', 'transactions', 'unsure'],
    additionalProperties: false,
  },
};
const SYSTEM = `You read one account statement (a PDF, photo or screenshot: a credit card, loan, mortgage or bank statement) and record what is printed on it. Record only what is printed; never work a figure out or guess one: use -1 or an empty string when it isn't shown. The standard rate is the ongoing APR for purchases on a card, or the loan's rate. If a promotional or introductory rate currently applies to the balance (for example a 0% balance transfer), record it separately with the day it ends, and still record the standard rate. Do not record or repeat full account numbers, Social Security numbers or addresses: at most the last four digits of the account.`;

async function readStatement(mediaType, data) {
  const client = new Anthropic({ apiKey: apiKey(), timeout: 180_000, maxRetries: 1 });
  const source = aiSource();
  const file = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  let response;
  try {
    response = await client.messages.create({
      model: model(), max_tokens: 12000, system: SYSTEM, tools: [TOOL],
      messages: [{ role: 'user', content: [file, { type: 'text', text: `Today is ${iso(new Date())}. Record this statement.` }] }],
    });
  } catch (e) { throw readableError(e); }
  noteUsage('statements', response, source, 'a statement you uploaded');
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read that file.');
  const call = response.content.find((b) => b.type === 'tool_use' && b.name === TOOL.name);
  if (!call || typeof call.input?.new_balance !== 'number') throw new Error(response.stop_reason === 'max_tokens' ? 'That statement is too long to read in one go. Try it a page or two at a time.' : "Claude couldn't find statement figures in that file.");
  return call.input;
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const shown = (n) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null);
const DEBTS = ['credit', 'auto', 'mortgage', 'loan'];
const accountsList = () => db.prepare("SELECT id, name, institution, type FROM accounts WHERE type != 'cash' ORDER BY type, name").all();
const words = (t) => String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !['card', 'bank', 'loan', 'account', 'credit', 'visa', 'mastercard'].includes(w));

/** The account a statement most likely belongs to: its last four digits in the account's name, else shared words and a fitting type. */
function matchAccount(r, accounts) {
  if (/^\d{4}$/.test(r.last4)) { const hit = accounts.filter((a) => `${a.name} ${a.institution}`.includes(r.last4)); if (hit.length === 1) return hit[0].id; }
  const fits = { credit_card: ['credit'], mortgage: ['mortgage'], auto_loan: ['auto'], student_loan: ['loan'], other_loan: ['loan', 'auto'], bank_account: ['checking', 'savings'] }[r.kind];
  const mine = new Set([...words(r.institution), ...words(r.account_name)]);
  const scored = accounts.map((a) => ({ id: a.id, score: words(`${a.name} ${a.institution}`).filter((w) => mine.has(w)).length + (fits?.includes(a.type) ? 0.5 : 0) })).sort((x, y) => y.score - x.score);
  return scored[0] && scored[0].score >= 1 && (!scored[1] || scored[1].score < scored[0].score) ? scored[0].id : null;
}

export function installStatements(app) {
  // Reads one statement and returns its figures for checking. Saves nothing.
  app.post('/api/statements/read', async (req, res) => {
    if (!apiKey()) return res.status(400).json({ error: limitMessage() || 'Reading a statement needs the AI features switched on in Settings.' });
    const m = /^data:(image\/(?:png|jpeg|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.file || ''));
    if (!m) return res.status(400).json({ error: "That file isn't one the app can read. Use a PDF, or a PNG or JPEG picture." });
    if (m[2].length > 7_500_000) return res.status(400).json({ error: 'That file is too large (over about 5 MB).' });
    try {
      const r = await readStatement(m[1], m[2]);
      const accounts = accountsList();
      const clean = {
        institution: String(r.institution || '').slice(0, 80), account_name: String(r.account_name || '').slice(0, 80), last4: /^\d{4}$/.test(r.last4) ? r.last4 : '', kind: r.kind,
        period_start: isDate(r.period_start) ? r.period_start : '', period_end: isDate(r.period_end) ? r.period_end : '',
        previous_balance: shown(r.previous_balance), new_balance: shown(r.new_balance), payments: shown(r.payments), purchases: shown(r.purchases), fees: shown(r.fees),
        interest: shown(r.interest_charged), principal: shown(r.principal_paid), minimum: shown(r.minimum_payment),
        apr: shown(r.apr), promo_apr: shown(r.promo_apr), promo_expires: isDate(r.promo_expires) ? r.promo_expires : '',
        transactions: (Array.isArray(r.transactions) ? r.transactions : []).filter((t) => isDate(t.date) && t.amount > 0).slice(0, 150).map((t) => ({ date: t.date, description: String(t.description || '').replace(/\s+/g, ' ').trim().slice(0, 120), amount: Math.round(t.amount * 100) / 100, direction: t.direction === 'in' ? 'in' : 'out' })),
        unsure: String(r.unsure || '').slice(0, 300),
      };
      res.json({ ...clean, account_id: matchAccount(clean, accounts), accounts });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
  app.get('/api/statements/accounts', (_req, res) => res.json({ accounts: accountsList(), canRead: !!apiKey(), why: apiKey() ? '' : (limitMessage() || 'Reading statements needs the AI features switched on in Settings.') }));

  // Saves what was checked. Each statement names its account and says which of its three parts to keep.
  app.post('/api/statements/apply', (req, res) => {
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 60);
    if (!items.length) return res.status(400).json({ error: 'There is nothing to save.' });
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
    const out = { history: 0, rates: 0, added: 0, skipped: 0, problems: [] };
    const newest = new Map();   // account -> its newest statement, for the rate and minimum
    const point = db.prepare('INSERT INTO debt_history (account_id, date, extra, principal, interest, balance) VALUES (?,?,0,?,?,?) ON CONFLICT(account_id, date, extra) DO UPDATE SET principal = excluded.principal, interest = excluded.interest, balance = excluded.balance');
    for (const it of items) {
      const acc = db.prepare('SELECT id, name, type FROM accounts WHERE id = ?').get(Number(it?.account_id));
      if (!acc) { out.problems.push('A statement had no account chosen and was left out.'); continue; }
      const debt = DEBTS.includes(acc.type), end = isDate(it.period_end) ? it.period_end : '';
      if (it.keep?.history && debt && end && num(it.new_balance) != null) {
        const interest = num(it.interest) ?? 0, paid = num(it.payments) ?? 0;
        // On a loan the statement says what went to principal; on a card, the payment is what came off the balance.
        point.run(acc.id, end, num(it.principal) ?? (acc.type === 'credit' ? paid : Math.max(0, Math.round((paid - interest) * 100) / 100)), interest, num(it.new_balance));
        out.history++;
      }
      if (it.keep?.rate && debt && end && (!newest.has(acc.id) || newest.get(acc.id).period_end < end)) newest.set(acc.id, { ...it, period_end: end });
      const tx = Array.isArray(it.transactions) ? it.transactions.filter((t) => isDate(t?.date) && t.amount > 0).slice(0, 150) : [];
      if (it.keep?.transactions && tx.length) {
        const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
        const csv = ['Date,Description,Amount', ...tx.map((t) => [t.date, cell(String(t.description || 'Unknown').slice(0, 120)), (t.direction === 'in' ? 1 : -1) * Math.round(t.amount * 100) / 100].join(','))].join('\n');
        try { const r = importFile(csv, false, acc.id); out.added += r.added || 0; out.skipped += r.skipped || 0; } catch (e) { out.problems.push(`${acc.name}: ${e.message}`); }
      }
    }
    for (const [id, it] of newest) {
      const apr = num(it.apr), min = num(it.minimum);
      if (apr != null && apr <= 100) db.prepare('UPDATE accounts SET apr = ? WHERE id = ?').run(apr, id);
      if (min != null && min > 0) db.prepare('UPDATE accounts SET min_payment = ? WHERE id = ?').run(min, id);
      if (apr != null || min != null) out.rates++;
    }
    res.json(out);
  });
}
