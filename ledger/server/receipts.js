// A receipt's picture, kept with the purchase it was read from (2026-11-18), so it can be looked
// at later for a return, a warranty or tax time. Only receipts are kept: a screenshot of a bank's
// list is still thrown away after reading. The picture is the shrunk JPEG the browser sent for
// reading (longest side 2,000 pixels), stored in the household's own database and served only to
// someone signed in. A purchase waiting for the bank keeps its row when the bank's entry takes it
// over, so the picture stays attached. Removing the purchase removes the picture.
import { db } from './db.js';

db.exec('CREATE TABLE IF NOT EXISTS receipts (transaction_id INTEGER PRIMARY KEY, image BLOB NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL)');

/** Called when a transaction is removed. */
export const dropReceipt = (id) => db.prepare('DELETE FROM receipts WHERE transaction_id = ?').run(Number(id));

export function installReceipts(app) {
  app.post('/api/transactions/:id/receipt', (req, res) => {
    let t = db.prepare('SELECT id, split_of FROM transactions WHERE id = ?').get(Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'That transaction is no longer there.' });
    // A split purchase keeps one picture, on the original.
    const id = t.split_of || t.id;
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
    if (!m) return res.status(400).json({ error: "That isn't a picture the app can keep." });
    const image = Buffer.from(m[2], 'base64');
    if (image.length > 5_000_000) return res.status(400).json({ error: 'That picture is too large to keep.' });
    db.prepare('INSERT INTO receipts (transaction_id, image, type, at) VALUES (?,?,?,?) ON CONFLICT(transaction_id) DO UPDATE SET image = excluded.image, type = excluded.type, at = excluded.at').run(id, image, m[1], Date.now());
    res.json({ ok: true });
  });
  app.get('/api/transactions/:id/receipt', (req, res) => {
    const t = db.prepare('SELECT id, split_of FROM transactions WHERE id = ?').get(Number(req.params.id));
    const r = t && db.prepare('SELECT image, type FROM receipts WHERE transaction_id = ?').get(t.split_of || t.id);
    if (!r) return res.status(404).json({ error: 'No receipt is kept for that purchase.' });
    res.setHeader('Content-Type', r.type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(r.image));
  });
  app.delete('/api/transactions/:id/receipt', (req, res) => {
    const t = db.prepare('SELECT id, split_of FROM transactions WHERE id = ?').get(Number(req.params.id));
    res.json({ removed: t ? dropReceipt(t.split_of || t.id).changes : 0 });
  });
}
