// A household's side gig: self-employment income with no tax taken out (tutoring, deliveries,
// VIPKid teaching and the like). It is off unless the household switches it on in Settings.
//
// When it is on, the gig has its own income category (so the tax page can total it), counts as
// self-employment in the tax estimate, purchases can be claimed against it, and its pay can be
// kept out of the checking forecast while a tax savings account is being filled.
//
// Settings: gig_on ('1' or '0'), gig_name (what the household calls it), gig_match (words that
// mark a deposit as gig pay, separated by commas), gig_classes ('1' when the pay comes from classes
// booked on a calendar, which is how VIPKid works: that switches on server/vipkid.js's class
// calendar and monthly goal). The category's id is still kept in the setting vipkid_category_id and
// claims are still stored as deduct_kind 'vipkid': both names date from when the app was built
// for one household whose gig was VIPKid, and are not shown anywhere.
import { db, getSetting, setSetting } from './db.js';

const words = () => getSetting('gig_match').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);

// More side gigs (added 2026-11-18): a household can have several, one per row here, each with its
// own name, income category, the words that mark its deposits, and whose it is ('you' or 'spouse',
// which matters for self-employment tax). The first gig stays in the settings above, with its owner
// in gig_who. `cash` is yearly income that never reaches the bank (cash, tips); `costs` is a typed
// yearly figure for an extra gig's expenses. Purchases claimed as business expenses on the
// Transactions page are not tied to one gig: they come off the first gig's profit.
db.exec(`CREATE TABLE IF NOT EXISTS extra_gigs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, match TEXT NOT NULL DEFAULT '',
  who TEXT NOT NULL DEFAULT 'you', category_id INTEGER, cash REAL NOT NULL DEFAULT 0, costs REAL NOT NULL DEFAULT 0)`);
const split = (text) => String(text || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
/** The other gigs, only while the side gig as a whole is switched on. */
export function extraGigs() {
  if (getSetting('gig_on') !== '1') return [];
  return db.prepare('SELECT * FROM extra_gigs ORDER BY id').all().map((g) => ({ id: g.id, name: g.name, match: g.match, who: g.who === 'spouse' ? 'spouse' : 'you', categoryId: g.category_id || 0, cash: g.cash || 0, costs: g.costs || 0 }));
}
/** Every gig's name, for telling gig pay from salary in the forecast. */
export const gigNames = () => (getSetting('gig_on') === '1' ? [getSetting('gig_name') || 'Side gig', ...extraGigs().map((g) => g.name)] : []);

/** The side gig as the rest of the app needs it. */
export function gig() {
  const on = getSetting('gig_on') === '1';
  return {
    on,
    name: getSetting('gig_name') || 'Side gig',
    match: getSetting('gig_match'),
    classes: on && getSetting('gig_classes') === '1',
    categoryId: on ? Number(getSetting('vipkid_category_id')) || 0 : 0,
    who: getSetting('gig_who') === 'spouse' ? 'spouse' : 'you', cash: Math.max(0, Number(getSetting('gig_cash', '0')) || 0),
    // K-12 teachers in the household (0, 1 or 2): switches on classroom-expense claims.
    teachers: Math.min(2, Math.max(0, Math.round(Number(getSetting('educators', '0')) || 0))),
    // Whether there is a spouse (married, filing either way), so a gig can be said to be theirs.
    two: ['joint', 'separate'].includes(getSetting('filing_status', 'joint')),
  };
}

/** The gig's category id when this deposit's name carries one of the gig's words, otherwise null. */
export function gigCategoryFor(merchant, amount) {
  const g = gig();
  if (!g.on || !g.categoryId || amount <= 0) return null;
  const m = String(merchant || '').toLowerCase();
  if (words().some((w) => m.includes(w))) return g.categoryId;
  for (const x of extraGigs()) if (x.categoryId && split(x.match).some((w) => m.includes(w))) return x.categoryId;
  return null;
}

/** Whether a row of pay_schedules is the gig's pay (it is forecast apart from the salaries). */
export function isGigPay(schedule) {
  const g = gig();
  if (!g.on) return false;
  return String(schedule.id) === getSetting('gig_schedule_id') || gigNames().includes(schedule.name);
}

export function installGig(app) {
  const answer = () => { const { categoryId, ...g } = gig(); return { ...g, extras: extraGigs().map(({ categoryId: _c, ...x }) => x) }; };
  const amount = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n * 100) / 100 : 0; };
  // Deposits already in the app that carry a gig's words move to its category.
  const sweep = () => {
    let moved = 0;
    for (const t of db.prepare("SELECT t.id, t.merchant, t.amount, t.category_id FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.amount > 0 AND c.kind = 'income'").all()) {
      const to = gigCategoryFor(t.merchant, t.amount);
      if (to && to !== t.category_id) { db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(to, t.id); moved++; }
    }
    return moved;
  };
  // Whose the first gig is, and its income that never reaches the bank.
  app.put('/api/gig/more', (req, res) => {
    if (req.body?.who != null) setSetting('gig_who', req.body.who === 'spouse' ? 'spouse' : 'you');
    if (req.body?.cash != null) setSetting('gig_cash', String(amount(req.body.cash)));
    res.json(answer());
  });
  // Another side gig: add, change, remove.
  const clean = (b, id) => {
    const name = String(b?.name || '').trim().slice(0, 40);
    if (!name) return { error: 'Give the side gig a name, such as Tutoring.' };
    const own = id ? db.prepare('SELECT category_id FROM extra_gigs WHERE id = ?').get(id)?.category_id : 0;
    const taken = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(name);
    if (taken && taken.id !== own) return { error: `There is already a category called ${name}. Choose another name.` };
    return { name, own, match: split(b.match).join(', ').slice(0, 200), who: b.who === 'spouse' ? 'spouse' : 'you', cash: amount(b.cash), costs: amount(b.costs) };
  };
  app.post('/api/gigs', (req, res) => {
    if (getSetting('gig_on') !== '1') return res.status(400).json({ error: 'Switch on the first side gig before adding another.' });
    if (db.prepare('SELECT COUNT(*) n FROM extra_gigs').get().n >= 6) return res.status(400).json({ error: 'That is as many side gigs as Ledger keeps apart. Put the rest under one of them.' });
    const g = clean(req.body, 0);
    if (g.error) return res.status(400).json({ error: g.error });
    const cat = Number(db.prepare("INSERT INTO categories (name, icon, color, kind, fixed, budget, sort) VALUES (?, '🧰', '#6250d6', 'income', 0, 0, 12.6)").run(g.name).lastInsertRowid);
    db.prepare('INSERT INTO extra_gigs (name, match, who, category_id, cash, costs) VALUES (?,?,?,?,?,?)').run(g.name, g.match, g.who, cat, g.cash, g.costs);
    res.json({ ...answer(), moved: sweep() });
  });
  app.patch('/api/gigs/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM extra_gigs WHERE id = ?').get(id)) return res.status(404).json({ error: 'That side gig is gone.' });
    const g = clean(req.body, id);
    if (g.error) return res.status(400).json({ error: g.error });
    if (g.own) db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(g.name, g.own);
    const old = db.prepare('SELECT name FROM extra_gigs WHERE id = ?').get(id).name;
    try { db.prepare('UPDATE pay_schedules SET name = ? WHERE name = ?').run(g.name, old); } catch { /* no paydays table yet */ }
    db.prepare('UPDATE extra_gigs SET name = ?, match = ?, who = ?, cash = ?, costs = ? WHERE id = ?').run(g.name, g.match, g.who, g.cash, g.costs, id);
    res.json({ ...answer(), moved: sweep() });
  });
  // Removing a gig keeps its past deposits: they go back to plain Income.
  app.delete('/api/gigs/:id', (req, res) => {
    const g = db.prepare('SELECT * FROM extra_gigs WHERE id = ?').get(Number(req.params.id));
    if (g) {
      const income = db.prepare("SELECT id FROM categories WHERE name = 'Income'").get()?.id;
      if (g.category_id && income) { db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?').run(income, g.category_id); db.prepare('DELETE FROM categories WHERE id = ?').run(g.category_id); }
      db.prepare('DELETE FROM extra_gigs WHERE id = ?').run(g.id);
    }
    res.json(answer());
  });
  app.get('/api/gig', (_req, res) => res.json(answer()));

  // Switch the gig on or off, name it, and say which deposits are its pay.
  app.put('/api/gig', (req, res) => {
    const b = req.body || {};
    if (b.on === false) { setSetting('gig_on', '0'); return res.json(answer()); }
    const name = String(b.name ?? getSetting('gig_name')).trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Give the side gig a name, such as Tutoring.' });
    const taken = db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE").get(name);
    let catId = Number(getSetting('vipkid_category_id')) || 0;
    if (catId && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(catId)) catId = 0;
    if (taken && taken.id !== catId) return res.status(400).json({ error: `There is already a category called ${name}. Choose another name.` });
    if (catId) db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, catId);
    else {
      catId = Number(db.prepare("INSERT INTO categories (name, icon, color, kind, fixed, budget, sort) VALUES (?, '🧑‍🏫', '#6250d6', 'income', 0, 0, 12.5)").run(name).lastInsertRowid);
      setSetting('vipkid_category_id', catId);
    }
    setSetting('gig_name', name);
    // Its row in the pay forecast, if it has one, takes the new name too.
    try { db.prepare('UPDATE pay_schedules SET name = ? WHERE id = ?').run(name, Number(getSetting('gig_schedule_id')) || -1); } catch { /* no paydays table yet */ }
    if (b.match != null) setSetting('gig_match', String(b.match).split(',').map((w) => w.trim()).filter(Boolean).join(', ').slice(0, 200));
    if (b.classes != null) setSetting('gig_classes', b.classes ? '1' : '0');
    setSetting('gig_on', '1');
    // Deposits already in the app that carry the gig's words move to its category.
    const g = gig();
    let moved = 0;
    if (b.match != null) {
      for (const t of db.prepare("SELECT t.id, t.merchant, t.amount FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.amount > 0 AND c.kind = 'income' AND t.category_id != ?").all(g.categoryId)) {
        if (gigCategoryFor(t.merchant, t.amount)) { db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(g.categoryId, t.id); moved++; }
      }
    }
    res.json({ ...answer(), moved });
  });
}
