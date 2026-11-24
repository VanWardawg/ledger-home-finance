// What Ledger has learned, in one place, and a way to take the household's data out (2026-11-18).
//
// Rules are made as the app is used: "every purchase from this merchant goes in that category"
// (table `rules`), "always claim this merchant for tax" (`deduct_rules`, matched as LIKE patterns)
// and friendly names for bills (`bill_names`). Until now they could only be seen one at a time, and
// a pattern rule could not be taken off from the app at all. Settings, "What Ledger has learned"
// lists them with Remove. Taking a rule off changes nothing already filed; it only stops the rule
// applying to what comes next.
import { db } from './db.js';

const csv = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function installRules(app) {
  app.get('/api/rules', (_req, res) => {
    let names = [];
    try { names = db.prepare('SELECT id, bank, min, max, name FROM bill_names ORDER BY name').all(); } catch { /* no renamed bills yet */ }
    res.json({
      filing: db.prepare('SELECT r.merchant, c.name category, c.icon FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.merchant COLLATE NOCASE').all(),
      claims: db.prepare('SELECT merchant, pct, kind FROM deduct_rules ORDER BY merchant COLLATE NOCASE').all(),
      names,
    });
  });
  app.post('/api/rules/forget', (req, res) => {
    const merchant = String(req.body?.merchant || '');
    const table = req.body?.kind === 'claims' ? 'deduct_rules' : 'rules';
    res.json({ removed: db.prepare(`DELETE FROM ${table} WHERE merchant = ?`).run(merchant).changes });
  });

  // Every transaction as a spreadsheet file. Amounts are negative for money out, as in the app.
  app.get('/api/export/transactions.csv', (_req, res) => {
    const rows = db.prepare(`SELECT t.date, a.name account, t.merchant, t.amount, c.name category, t.notes,
        CASE WHEN t.waiting = 1 THEN 'waiting for the bank' WHEN t.pending = 1 THEN 'pending' ELSE 'posted' END status,
        CASE WHEN t.deduct_pct > 0 THEN t.deduct_pct ELSE '' END claimed_pct,
        CASE WHEN t.deduct_pct > 0 THEN (CASE t.deduct_kind WHEN 'teaching' THEN 'teaching' ELSE 'business' END) ELSE '' END claimed_for
      FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN categories c ON c.id = t.category_id ORDER BY t.date DESC, t.id DESC`).all();
    const head = ['Date', 'Account', 'Description', 'Amount', 'Category', 'Note', 'Status', 'Tax claim %', 'Claimed for'];
    const body = rows.map((r) => [r.date, r.account, r.merchant, r.amount.toFixed(2), r.category, r.notes, r.status, r.claimed_pct, r.claimed_for].map(csv).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ledger-transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
    // The leading mark makes spreadsheet programs read accented letters correctly.
    res.send('﻿' + [head.join(','), ...body].join('\r\n'));
  });
}
