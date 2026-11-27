// Category groups, against a fresh empty database.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.LEDGER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
process.env.LEDGER_FRESH = '1';
const { db } = await import('../server/db.js');
const { listGroups, addGroup, groupNamed, renameGroup, moveGroup, removeGroup, setCategoryGroup } = await import('../server/groups.js');

const cat = (name) => db.prepare('SELECT id, group_id FROM categories WHERE name = ?').get(name);
const names = () => listGroups().map((g) => g.name);

test('groups are made in order and a name is used once', () => {
  addGroup('  Everyday  ');
  addGroup('Bills');
  addGroup('Kids');
  assert.deepEqual(names(), ['Everyday', 'Bills', 'Kids']);
  assert.throws(() => addGroup('everyday'), /already have a group/);
  assert.throws(() => addGroup('   '), /Enter a name/);
  assert.equal(groupNamed('BILLS'), listGroups()[1].id);
  assert.equal(groupNamed(''), null);
});

test('a group moves up and down and stops at the ends', () => {
  const kids = listGroups()[2].id;
  moveGroup(kids, -1);
  assert.deepEqual(names(), ['Everyday', 'Kids', 'Bills']);
  moveGroup(kids, -1);
  moveGroup(kids, -1);
  assert.deepEqual(names(), ['Kids', 'Everyday', 'Bills']);
  moveGroup(kids, 1);
  assert.deepEqual(names(), ['Everyday', 'Kids', 'Bills']);
});

test('renaming keeps names apart', () => {
  const kids = listGroups()[1].id;
  renameGroup(kids, 'Children');
  assert.deepEqual(names(), ['Everyday', 'Children', 'Bills']);
  assert.throws(() => renameGroup(kids, 'bills'), /already have a group/);
  renameGroup(kids, 'children');   // its own name in another case is allowed
  assert.throws(() => renameGroup(9999, 'x'), /no longer there/);
});

test('a spending category sits in one group or none; others are refused', () => {
  const everyday = listGroups()[0].id;
  setCategoryGroup(cat('Groceries').id, everyday);
  setCategoryGroup(cat('Dining out').id, everyday);
  assert.equal(cat('Groceries').group_id, everyday);
  assert.equal(listGroups()[0].categories, 2);
  setCategoryGroup(cat('Dining out').id, null);
  assert.equal(cat('Dining out').group_id, null);
  assert.throws(() => setCategoryGroup(cat('Income').id, everyday), /Only spending categories/);
  assert.throws(() => setCategoryGroup(cat('Groceries').id, 9999), /no longer there/);
  assert.equal(cat('Groceries').group_id, everyday);
});

test('removing a group frees its categories and removes nothing else', () => {
  const before = db.prepare('SELECT COUNT(*) n FROM categories').get().n;
  const everyday = listGroups()[0].id;
  assert.equal(removeGroup(everyday), 1);
  assert.equal(cat('Groceries').group_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM categories').get().n, before);
  assert.deepEqual(names(), ['children', 'Bills']);
});
