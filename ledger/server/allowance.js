// Allowances (2026-11-24, the owner's go-ahead after seeing a sketch: "Build it").
//
// A notebook of what the household holds for each child: a weekly allowance that adds itself on its day,
// money added for chores or gifts, and what the child has spent. Off until switched on in Settings.
//
// It is only a record. No account is involved and no total anywhere else in Ledger counts it: the money
// stays wherever the parents keep it. If wanted, each allowance is shared out between three jars (spend,
// save, give) by percentages, and the child can have something they are saving for.
//
//   setting   allowance_on ('1')
//   tables    kids (name, weekly, pay_day 0 = Sunday, pct_save, pct_give, goal_name, goal_amount, paid_through)
//             kid_entries (kid_id, date, amount, jar, note, auto)
//
// Children's names stay in this copy. Nothing here is sent to Claude, and the host of a family copy is
// told none of it (server/activity.js).
import { db, iso, getSetting, setSetting } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS kids (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, weekly REAL NOT NULL DEFAULT 0, pay_day INTEGER NOT NULL DEFAULT 6,
  pct_save INTEGER NOT NULL DEFAULT 0, pct_give INTEGER NOT NULL DEFAULT 0, goal_name TEXT, goal_amount REAL,
  paid_through TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kid_entries (
  id INTEGER PRIMARY KEY, kid_id INTEGER NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL,
  jar TEXT NOT NULL DEFAULT 'spend', note TEXT NOT NULL DEFAULT '', auto INTEGER NOT NULL DEFAULT 0)`);

const round = (n) => Math.round(n * 100) / 100;
const JARS = ['spend', 'save', 'give'];
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00`));
const at = (d) => new Date(`${d}T12:00:00`);
const addDays = (d, n) => { const x = at(d); x.setDate(x.getDate() + n); return iso(x); };
export const allowanceOn = () => getSetting('allowance_on') === '1';

/** The first pay day strictly after `after`. */
function nextPayDay(after, day) {
  let d = addDays(after, 1);
  while (at(d).getDay() !== day) d = addDays(d, 1);
  return d;
}

/** One week's allowance shared between the jars; spend takes whatever the other two leave. */
function shares(k) {
  const save = round((k.weekly * k.pct_save) / 100), give = round((k.weekly * k.pct_give) / 100);
  return { spend: round(k.weekly - save - give), save, give };
}

/** Adds every allowance that has come due since the last time anyone looked. At most half a year back. */
function catchUp(today = iso(new Date())) {
  const add = db.prepare("INSERT INTO kid_entries (kid_id, date, amount, jar, note, auto) VALUES (?,?,?,?,'Allowance',1)");
  for (const k of db.prepare('SELECT * FROM kids').all()) {
    if (k.paid_through >= today) continue;
    if (k.weekly > 0) {
      const part = shares(k);
      let d = nextPayDay(k.paid_through < addDays(today, -182) ? addDays(today, -182) : k.paid_through, k.pay_day);
      for (; d <= today; d = addDays(d, 7)) for (const jar of JARS) if (part[jar] > 0) add.run(k.id, d, part[jar], jar);
    }
    db.prepare('UPDATE kids SET paid_through = ? WHERE id = ?').run(today, k.id);
  }
}

function view() {
  const today = iso(new Date());
  if (!allowanceOn()) return { on: false, kids: [] };
  catchUp(today);
  const kids = db.prepare('SELECT * FROM kids ORDER BY id').all().map((k) => {
    const jars = { spend: 0, save: 0, give: 0 };
    for (const r of db.prepare('SELECT jar, SUM(amount) s FROM kid_entries WHERE kid_id = ? GROUP BY jar').all(k.id)) if (r.jar in jars) jars[r.jar] = round(r.s);
    const balance = round(jars.spend + jars.save + jars.give);
    const split = k.pct_save + k.pct_give > 0 || Math.abs(jars.save) > 0.004 || Math.abs(jars.give) > 0.004;
    // What counts toward the thing they're saving for: the save jar when the allowance is split, else all of it.
    const toward = split ? jars.save : balance;
    const goal = k.goal_name && k.goal_amount > 0
      ? { name: k.goal_name, amount: k.goal_amount, saved: round(Math.max(0, toward)), pct: Math.max(0, Math.min(100, Math.round((toward / k.goal_amount) * 100))), done: toward >= k.goal_amount }
      : null;
    return {
      id: k.id, name: k.name, weekly: k.weekly, pay_day: k.pay_day, pct_save: k.pct_save, pct_give: k.pct_give,
      goal_name: k.goal_name || '', goal_amount: k.goal_amount || null,
      jars, balance, split, goal, next: k.weekly > 0 ? nextPayDay(today, k.pay_day) : null,
      // A week's allowance is one line, however many jars it was shared between.
      entries: db.prepare(`SELECT MIN(id) id, date, SUM(amount) amount, MIN(jar) jar, note, auto FROM kid_entries WHERE kid_id = ?
        GROUP BY CASE WHEN auto = 1 THEN 'a' || date ELSE 'e' || id END ORDER BY date DESC, id DESC LIMIT 15`).all(k.id).map((e) => ({ ...e, amount: round(e.amount) })),
      count: db.prepare('SELECT COUNT(*) n FROM kid_entries WHERE kid_id = ?').get(k.id).n,
    };
  });
  return { on: true, kids, total: round(kids.reduce((a, k) => a + k.balance, 0)) };
}

function readKid(body, was) {
  const name = String(body?.name ?? was?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!name) return { error: "Enter the child's first name." };
  const weekly = body?.weekly === undefined ? was?.weekly ?? 0 : body.weekly === '' || body.weekly == null ? 0 : Number(body.weekly);
  if (!Number.isFinite(weekly) || weekly < 0 || weekly > 1000) return { error: 'Enter the weekly allowance, or leave it empty for none.' };
  const day = body?.pay_day === undefined ? was?.pay_day ?? 6 : Math.round(Number(body.pay_day));
  if (!(day >= 0 && day <= 6)) return { error: 'Choose the day the allowance is paid.' };
  const pct = (v, old) => (v === undefined ? old ?? 0 : v === '' || v == null ? 0 : Math.round(Number(v)));
  const save = pct(body?.pct_save, was?.pct_save), give = pct(body?.pct_give, was?.pct_give);
  if (!(save >= 0 && give >= 0 && save + give <= 100)) return { error: 'The save and give shares are percentages, and together they can be 100 at most.' };
  const goalName = body?.goal_name === undefined ? was?.goal_name || '' : String(body.goal_name || '').trim().slice(0, 40);
  const goalAmount = body?.goal_amount === undefined ? was?.goal_amount ?? null : body.goal_amount === '' || body.goal_amount == null ? null : Number(body.goal_amount);
  if (goalAmount != null && !(goalAmount > 0)) return { error: 'Enter what the thing they are saving for costs, or leave it empty.' };
  if (goalName && goalAmount == null) return { error: 'Enter what it costs, so Ledger can show how far along they are.' };
  return { name, weekly: round(weekly), day, save, give, goalName: goalAmount == null ? null : goalName || 'Saving', goalAmount };
}

export function installAllowance(app) {
  app.get('/api/allowance', (_req, res) => res.json(view()));

  app.put('/api/allowance', (req, res) => {
    setSetting('allowance_on', req.body?.on ? '1' : '0');
    // Switched on again after a while: nothing is paid for the time it was off.
    if (req.body?.on) db.prepare('UPDATE kids SET paid_through = ?').run(iso(new Date()));
    res.json(view());
  });

  app.post('/api/allowance/kids', (req, res) => {
    if (!allowanceOn()) return res.status(400).json({ error: 'Switch allowances on in Settings first.' });
    const k = readKid(req.body);
    if (k.error) return res.status(400).json({ error: k.error });
    if (db.prepare('SELECT COUNT(*) n FROM kids').get().n >= 12) return res.status(400).json({ error: 'That is as many children as Ledger keeps allowances for.' });
    if (db.prepare('SELECT 1 FROM kids WHERE lower(name) = lower(?)').get(k.name)) return res.status(400).json({ error: `${k.name} is already here.` });
    const today = iso(new Date());
    const id = Number(db.prepare('INSERT INTO kids (name, weekly, pay_day, pct_save, pct_give, goal_name, goal_amount, paid_through, created) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(k.name, k.weekly, k.day, k.save, k.give, k.goalName, k.goalAmount, today, today).lastInsertRowid);
    // What they already have, if anything, as a first entry.
    const start = Number(req.body?.start);
    if (start > 0 && start <= 100000) db.prepare("INSERT INTO kid_entries (kid_id, date, amount, jar, note) VALUES (?,?,?,'spend','Starting amount')").run(id, today, round(start));
    res.json(view());
  });

  app.patch('/api/allowance/kids/:id', (req, res) => {
    const was = db.prepare('SELECT * FROM kids WHERE id = ?').get(Number(req.params.id));
    if (!was) return res.status(404).json({ error: "That child isn't here any more." });
    const k = readKid(req.body, was);
    if (k.error) return res.status(400).json({ error: k.error });
    if (db.prepare('SELECT 1 FROM kids WHERE lower(name) = lower(?) AND id != ?').get(k.name, was.id)) return res.status(400).json({ error: `${k.name} is already here.` });
    catchUp();   // what was due under the old amount is paid at the old amount
    db.prepare('UPDATE kids SET name = ?, weekly = ?, pay_day = ?, pct_save = ?, pct_give = ?, goal_name = ?, goal_amount = ? WHERE id = ?')
      .run(k.name, k.weekly, k.day, k.save, k.give, k.goalName, k.goalAmount, was.id);
    res.json(view());
  });

  app.delete('/api/allowance/kids/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM kid_entries WHERE kid_id = ?').run(id);
    db.prepare('DELETE FROM kids WHERE id = ?').run(id);
    res.json(view());
  });

  // Money added (a chore, a gift) or spent. `kind` is 'add' or 'spend'; the amount is always typed as a positive number.
  app.post('/api/allowance/kids/:id/entries', (req, res) => {
    const k = db.prepare('SELECT * FROM kids WHERE id = ?').get(Number(req.params.id));
    if (!k) return res.status(404).json({ error: "That child isn't here any more." });
    const amount = round(Number(req.body?.amount));
    if (!(amount > 0) || amount > 100000) return res.status(400).json({ error: 'Enter an amount.' });
    const spend = req.body?.kind === 'spend';
    const jar = JARS.includes(req.body?.jar) ? req.body.jar : 'spend';
    const note = String(req.body?.note || '').trim().slice(0, 60) || (spend ? 'Spent' : 'Added');
    const today = iso(new Date());
    const date = req.body?.date ? String(req.body.date) : today;
    if (!isDate(date) || date > today) return res.status(400).json({ error: "That date isn't one the app can use. Choose today or earlier." });
    if (spend) {
      const has = round(db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM kid_entries WHERE kid_id = ? AND jar = ?').get(k.id, jar).s);
      if (amount > has + 0.004) return res.status(400).json({ error: `${k.name} only has $${has.toFixed(2)} ${jar === 'spend' ? 'to spend' : `in ${jar}`}.` });
    }
    db.prepare('INSERT INTO kid_entries (kid_id, date, amount, jar, note) VALUES (?,?,?,?,?)').run(k.id, date, spend ? -amount : amount, jar, note);
    res.json(view());
  });

  app.delete('/api/allowance/entries/:id', (req, res) => {
    const e = db.prepare('SELECT * FROM kid_entries WHERE id = ?').get(Number(req.params.id));
    // A week's allowance goes as a whole, every jar's share of it.
    if (e?.auto) db.prepare('DELETE FROM kid_entries WHERE kid_id = ? AND date = ? AND auto = 1').run(e.kid_id, e.date);
    else if (e) db.prepare('DELETE FROM kid_entries WHERE id = ?').run(e.id);
    res.json(view());
  });
}
