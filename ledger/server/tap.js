// Apple Pay purchases sent in by a phone. An automation in the iPhone's
// Shortcuts app runs whenever a card in Wallet is used and posts the merchant
// and amount here, so the purchase is in Ledger within seconds. This matters
// most for Apple Card, which has no bank feed.
//
// Each phone gets its own key (Settings, "Apple Pay purchases"). A key can only
// add a purchase: it can't read anything or sign in. Only a hash of each key is
// kept, so a key is shown once, when it is made.
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';
import { makeCategorizer } from './simplefin.js';

db.exec(`CREATE TABLE IF NOT EXISTS tap_keys (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, account_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL, last_used INTEGER, uses INTEGER NOT NULL DEFAULT 0)`);

// A card added by hand has no bank to report its balance. With a starting
// balance and date, Ledger keeps the balance itself: the start plus everything
// recorded on the account since.
const cols = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
if (!cols.includes('base_balance')) db.exec('ALTER TABLE accounts ADD COLUMN base_balance REAL; ALTER TABLE accounts ADD COLUMN base_date TEXT;');
const round = (n) => Math.round(n * 100) / 100;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hashOf = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

// An account kept by hand (made in the setup guide or on the Accounts page) starts from the balance
// typed for it and then follows what is entered: purchases, deposits and transfers. `base_id` is the
// newest transaction that existed when that balance was typed, so only entries made after it count
// (found missing on 2026-11-18: these balances never moved, so a household without a bank connection
// saw the same checking figure and forecast however much it entered). History brought in later by
// file, dated before the starting day, is left out; anything typed in by hand counts whatever its date. Apple Card, set up earlier, has no base_id and
// keeps its rule of everything dated after its statement.
if (!cols.includes('base_id')) db.exec('ALTER TABLE accounts ADD COLUMN base_id INTEGER');
// "Entered after the balance was typed" can't be judged by a transaction's id: SQLite gives the id of
// a removed newest row to the next one added, so a corrected entry could take an old id and never be
// counted (pointed out by the NAS session's review, 2026-11-18). Every transaction therefore gets
// `seq`, a number that only ever goes up, from a one-row counter and a trigger, so no insert in the
// app has to remember it. `accounts.base_id` holds the counter's value at the starting point.
const txCols = db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name);
if (!txCols.includes('seq')) db.exec('ALTER TABLE transactions ADD COLUMN seq INTEGER');
// The two halves of a transfer recorded by hand share `pair`, so removing one removes the other.
if (!txCols.includes('pair')) db.exec('ALTER TABLE transactions ADD COLUMN pair INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS tx_seq (n INTEGER NOT NULL);
  INSERT INTO tx_seq (n) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM tx_seq);
  UPDATE transactions SET seq = id WHERE seq IS NULL;
  UPDATE tx_seq SET n = MAX(n, (SELECT COALESCE(MAX(seq), 0) FROM transactions), (SELECT COALESCE(MAX(base_id), 0) FROM accounts));
  CREATE TRIGGER IF NOT EXISTS tx_seq_ai AFTER INSERT ON transactions BEGIN
    UPDATE tx_seq SET n = n + 1;
    UPDATE transactions SET seq = (SELECT n FROM tx_seq) WHERE id = NEW.id;
  END;`);
/** Makes the balance typed for a hand-kept account its new starting point. */
export function setStart(accountId, balance) {
  const newest = db.prepare('SELECT n FROM tx_seq').get().n;
  db.prepare('UPDATE accounts SET balance = ?, base_balance = ?, base_date = ?, base_id = ? WHERE id = ? AND manual = 1').run(balance, balance, today(), newest, accountId);
  db.prepare('INSERT INTO balance_history (account_id, date, balance) VALUES (?, ?, ?) ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance').run(accountId, today(), balance);
}


// Accounts made in the setup guide before 2026-11-18 had no starting point: give them one, at today's figure.
// Done once per database (setting `hand_start_v1`), and only for the kinds the setup guide makes: a loan
// added on the Debt page keeps its typed balance, because a payment doesn't bring a loan down by its full amount.
if (getSetting('hand_start_v1') !== '1') {
  for (const a of db.prepare("SELECT id, balance FROM accounts WHERE manual = 1 AND institution = 'Added by you' AND type IN ('checking', 'savings', 'credit') AND base_date IS NULL").all()) setStart(a.id, a.balance);
  setSetting('hand_start_v1', '1');
}

/** Brings the balance of each self-tracked account up to date. */
export function refreshBalances() {
  for (const a of db.prepare('SELECT id, base_balance, base_date, base_id FROM accounts WHERE manual = 1 AND base_date IS NOT NULL').all()) {
    const since = a.base_id != null
      // A split's parts are judged by the purchase they came from (its number and whether it was typed
      // in), or splitting would move the balance. Typed entries count whatever their date; rows from a
      // file count only when dated after the starting day, the same rule Apple Card has, since a
      // balance typed from the bank's site already includes that day's posted items.
      ? db.prepare(`SELECT COALESCE(SUM(r.amount), 0) s FROM transactions r JOIN transactions p ON p.id = COALESCE(r.split_of, r.id)
          WHERE r.account_id = ? AND p.seq > ? AND (p.manual = 1 OR p.date > ?)`).get(a.id, a.base_id, a.base_date).s
      : db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM transactions WHERE account_id = ? AND date > ?').get(a.id, a.base_date).s;
    const now = round(a.base_balance + since);
    if (db.prepare('UPDATE accounts SET balance = ? WHERE id = ? AND balance != ?').run(now, a.id, now).changes) {
      db.prepare('INSERT INTO balance_history (account_id, date, balance) VALUES (?, ?, ?) ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance').run(a.id, today(), now);
    }
  }
}

/** "$1,234.56", "12,34 €" or 12.34, as a positive number of dollars. */
function toAmount(v) {
  if (typeof v === 'number') return Math.abs(v);
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.'); else s = s.replace(/,/g, '');
  const n = Math.abs(Number(s));
  return Number.isFinite(n) ? n : NaN;
}

const FILLER = new Set(['card', 'debit', 'credit', 'visa', 'mastercard', 'the', 'bank', 'account', 'and']);
const words = (s) => (String(s || '').toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !FILLER.has(w));

/** The account a Wallet card belongs to: the one whose name shares the most words with the card's, else the key's own account. */
function accountFor(card, fallbackId) {
  const theirs = new Set(words(card));
  let best = null;
  if (theirs.size) {
    for (const a of db.prepare("SELECT id, name, bank_name, institution, type, manual FROM accounts WHERE type IN ('credit', 'checking', 'savings')").all()) {
      const score = new Set(words(`${a.name} ${a.bank_name || ''} ${a.institution}`).filter((w) => theirs.has(w))).size;
      if (score > (best?.score ?? 0)) best = { ...a, score };
    }
  }
  return best ?? db.prepare('SELECT id, name, type, manual FROM accounts WHERE id = ?').get(fallbackId);
}

let wrong = [];
// Every report a phone sends is noted with what became of it (added 2026-11-18, after a PetSmart
// purchase never showed up and nothing on the server could say whether the phone had even tried).
// A wrong key's report keeps no merchant or amount. The last 200 are kept.
db.exec('CREATE TABLE IF NOT EXISTS tap_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, outcome TEXT NOT NULL, phone TEXT, merchant TEXT, amount REAL, detail TEXT)');
function noteTap(outcome, { phone = null, merchant = null, amount = null, detail = null } = {}) {
  try {
    db.prepare('INSERT INTO tap_log (at, outcome, phone, merchant, amount, detail) VALUES (?,?,?,?,?,?)').run(Date.now(), outcome, phone, merchant, amount, detail);
    db.prepare('DELETE FROM tap_log WHERE id <= (SELECT MAX(id) FROM tap_log) - 200').run();
  } catch { /* a note must never get in the way of the purchase */ }
}

/** The address a phone posts to. Registered before the sign-in gate: the key is the only way in. */
export function installTapEndpoint(app) {
  app.post('/api/tap', (req, res) => {
    wrong = wrong.filter((t) => t > Date.now() - 15 * 60000);
    if (wrong.length >= 10) return res.status(429).json({ error: 'Too many wrong keys. Try again in 15 minutes.' });
    const b = req.body || {};
    const key = db.prepare('SELECT * FROM tap_keys WHERE hash = ?').get(hashOf(b.key || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')));
    if (!key) { wrong.push(Date.now()); noteTap('wrong key'); return res.status(401).json({ error: "That key isn't recognised." }); }
    const amount = round(toAmount(b.amount));
    const merchant = String(b.merchant || b.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!merchant) { noteTap('nothing to record', { phone: key.name, detail: 'The phone sent no merchant name.' }); return res.status(400).json({ error: 'No merchant was sent.' }); }
    if (!(amount > 0) || amount > 20000) { noteTap('nothing to record', { phone: key.name, merchant, detail: `The phone sent no usable amount (${String(b.amount ?? '').slice(0, 30) || 'blank'}).` }); return res.status(400).json({ error: 'No amount was sent.' }); }
    const account = accountFor(b.card, key.account_id);
    if (!account) { noteTap('nothing to record', { phone: key.name, merchant, amount, detail: "The key's account no longer exists." }); return res.status(400).json({ error: "This key's account no longer exists. Make a new key in Settings." }); }
    const date = today();
    // A phone can send the same payment twice; the second one within ten minutes is ignored.
    const twin = db.prepare("SELECT 1 FROM transactions WHERE account_id = ? AND date = ? AND abs(amount + ?) < 0.005 AND lower(merchant) = lower(?) AND notes LIKE 'Apple Pay%' AND id > (SELECT COALESCE(MAX(id), 0) - 40 FROM transactions)").get(account.id, date, amount, merchant);
    db.prepare('UPDATE tap_keys SET last_used = ?, uses = uses + 1 WHERE id = ?').run(Date.now(), key.id);
    if (twin) { noteTap('already recorded', { phone: key.name, merchant, amount, detail: account.name }); return res.json({ ok: true, added: false, message: 'Already recorded.' }); }
    // On a bank-fed account it waits for the bank's own entry, like a purchase typed in; on Apple Card it simply stays.
    const waiting = account.type !== 'cash' && !account.manual ? 1 : 0;
    db.prepare('INSERT INTO transactions (account_id, date, merchant, amount, category_id, notes, manual, waiting) VALUES (?,?,?,?,?,?,1,?)')
      .run(account.id, date, merchant, -amount, makeCategorizer()(merchant, -amount, account.type), `Apple Pay, ${key.name}`, waiting);
    refreshBalances();
    noteTap('recorded', { phone: key.name, merchant, amount, detail: account.name });
    res.json({ ok: true, added: true, message: `${merchant} $${amount.toFixed(2)} recorded on ${account.name}.` });
  });
}

const STARTED = Date.now();   // a report sent while the app was restarting never arrives, so Settings shows when it last started

/** Making, listing and removing keys. Behind the sign-in gate. */
export function installTap(app) {
  // Balances that Ledger keeps itself are brought up to date after anything that could change them.
  app.use((req, res, next) => {
    // Done just before the answer goes out, so a page that asks again straight away sees the new figure.
    if (req.method !== 'GET' && /^\/api\/(transactions|transfers|import|accounts|setup\/account|cashflow|undo)/.test(req.path)) {
      const send = res.json.bind(res);
      res.json = (body) => { try { refreshBalances(); } catch (e) { console.warn('Balances kept by hand could not be brought up to date:', e.message); } return send(body); };
    }
    next();
  });
  const list = () => ({
    keys: db.prepare('SELECT k.id, k.name, k.account_id, a.name account, k.created_at, k.last_used, k.uses FROM tap_keys k LEFT JOIN accounts a ON a.id = k.account_id ORDER BY k.created_at').all(),
    accounts: db.prepare("SELECT id, name FROM accounts WHERE type IN ('credit', 'checking') ORDER BY (name LIKE '%Apple%') DESC, type DESC, name").all(),
    // What phones have sent lately and what became of each, newest first.
    recent: db.prepare('SELECT at, outcome, phone, merchant, amount, detail FROM tap_log ORDER BY id DESC LIMIT 12').all(),
    startedAt: STARTED,
  });
  app.get('/api/taps', (_req, res) => res.json(list()));
  app.post('/api/taps', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: "Give the phone a name, such as Sam's iPhone." });
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ? AND type IN ('credit', 'checking')").get(Number(req.body?.account_id))) return res.status(400).json({ error: 'Choose the account its purchases usually belong to.' });
    const key = crypto.randomBytes(18).toString('base64url');
    db.prepare('INSERT INTO tap_keys (name, hash, account_id, created_at) VALUES (?,?,?,?)').run(name, hashOf(key), Number(req.body.account_id), Date.now());
    res.json({ ...list(), key });
  });
  app.delete('/api/taps/:id', (req, res) => { db.prepare('DELETE FROM tap_keys WHERE id = ?').run(Number(req.params.id)); res.json(list()); });
}
