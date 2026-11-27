// Category groups.
//
// Ledger's categories were one flat list. Coming from an app that sorts them under headings ("Everyday",
// "Bills", "Savings goals"), that list soon reads as a jumble. A group is only a heading with an order:
// a spending category may sit in one group or in none, and nothing about how a transaction is filed, a
// budget is set or a total is worked out depends on it. Taking a group away puts its categories back in
// "Not in a group"; it never removes a category or touches a transaction.
//
// While there are no groups the Budgets page shows what it always did (flexible spending, then fixed bills).
//
//   category_groups   id, name, sort
//   categories        group_id (empty for a category in no group)
import { db } from './db.js';

db.exec('CREATE TABLE IF NOT EXISTS category_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0)');
try { db.exec('ALTER TABLE categories ADD COLUMN group_id INTEGER'); } catch { /* already there */ }

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);

/** Every group in order, each with how many categories it holds. */
export function listGroups() {
  return db.prepare(`SELECT g.id, g.name, g.sort, COUNT(c.id) categories FROM category_groups g
    LEFT JOIN categories c ON c.group_id = g.id GROUP BY g.id ORDER BY g.sort, g.id`).all().map((g) => ({ ...g }));
}

const byName = (name) => db.prepare('SELECT id FROM category_groups WHERE lower(name) = lower(?)').get(name)?.id;

/** Makes a group at the end of the list. A name already in use is refused. */
export function addGroup(name) {
  const n = clean(name);
  if (!n) throw fail('Enter a name for the group.');
  if (byName(n)) throw fail(`You already have a group called ${n}.`);
  const last = db.prepare('SELECT COALESCE(MAX(sort), 0) m FROM category_groups').get().m;
  return Number(db.prepare('INSERT INTO category_groups (name, sort) VALUES (?, ?)').run(n, last + 1).lastInsertRowid);
}

/** The group with this name, made if it isn't there yet. Used when groups arrive from somewhere else. */
export function groupNamed(name) {
  const n = clean(name);
  if (!n) return null;
  return byName(n) ?? addGroup(n);
}

export function renameGroup(id, name) {
  const g = db.prepare('SELECT * FROM category_groups WHERE id = ?').get(Number(id));
  if (!g) throw fail('That group is no longer there.', 404);
  const n = clean(name);
  if (!n) throw fail('Enter a name for the group.');
  const other = byName(n);
  if (other && other !== g.id) throw fail(`You already have a group called ${n}.`);
  db.prepare('UPDATE category_groups SET name = ? WHERE id = ?').run(n, g.id);
}

/** Moves a group one place up (-1) or down (1). At the end of the list it stays where it is. */
export function moveGroup(id, by) {
  const all = listGroups();
  const at = all.findIndex((g) => g.id === Number(id));
  if (at < 0) throw fail('That group is no longer there.', 404);
  const to = at + (by < 0 ? -1 : 1);
  if (to < 0 || to >= all.length) return;
  [all[at], all[to]] = [all[to], all[at]];
  const put = db.prepare('UPDATE category_groups SET sort = ? WHERE id = ?');
  all.forEach((g, i) => put.run(i + 1, g.id));
}

/** Takes a group away. Its categories stay, in no group. */
export function removeGroup(id) {
  const g = db.prepare('SELECT id FROM category_groups WHERE id = ?').get(Number(id));
  if (!g) throw fail('That group is no longer there.', 404);
  const freed = db.prepare('UPDATE categories SET group_id = NULL WHERE group_id = ?').run(g.id).changes;
  db.prepare('DELETE FROM category_groups WHERE id = ?').run(g.id);
  return Number(freed);
}

/** Puts a spending category in a group, or (with nothing given) in none. */
export function setCategoryGroup(categoryId, groupId) {
  const cat = db.prepare('SELECT id, kind FROM categories WHERE id = ?').get(Number(categoryId));
  if (!cat) throw fail('That category is no longer there.', 404);
  if (cat.kind !== 'expense') throw fail('Only spending categories go in groups.');
  const none = groupId === null || groupId === undefined || groupId === '';
  if (!none && !db.prepare('SELECT 1 FROM category_groups WHERE id = ?').get(Number(groupId))) throw fail('That group is no longer there.', 404);
  db.prepare('UPDATE categories SET group_id = ? WHERE id = ?').run(none ? null : Number(groupId), cat.id);
}

export function installGroups(app) {
  const reply = (res, work) => { try { work(); res.json({ groups: listGroups() }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/groups', (_req, res) => res.json({ groups: listGroups() }));
  app.post('/api/groups', (req, res) => reply(res, () => addGroup(req.body?.name)));
  app.patch('/api/groups/:id', (req, res) => reply(res, () => {
    if (req.body?.name !== undefined) renameGroup(req.params.id, req.body.name);
    if (req.body?.move !== undefined) moveGroup(req.params.id, Number(req.body.move));
  }));
  app.delete('/api/groups/:id', (req, res) => reply(res, () => removeGroup(req.params.id)));
  app.put('/api/categories/:id/group', (req, res) => reply(res, () => setCategoryGroup(req.params.id, req.body?.group_id)));
}
