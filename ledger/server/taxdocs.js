// Documents for the tax preparer (2026-11-23): the forms and statements a household wants printed with its
// tax pack, such as a W-2, a Form 1098, or a lender's year-end statement.
//
// The owner asked for it so his whole hand-over could be one printout, and agreed the catch: these papers carry
// Social Security and account numbers, which nothing else in Ledger holds. So:
//
//   * It is OFF until a household switches it on (setting `taxdocs_on`), on every copy, and the switch says
//     plainly what it means. Switching it off deletes every stored document.
//   * Documents live in this copy's own database (table `tax_docs`) and so in its backups. They are served
//     only to someone signed in, are never sent to Claude or anywhere else, and are never emailed: they go
//     only into the PDF the person downloads with "…with the receipts and documents".
//   * A photo or screenshot is printed on a page of its own. A PDF is added page for page at the end
//     (pdf-lib copies its pages). One that can't be opened, a password-protected one for instance, is
//     listed as left out, so nobody assumes it is in there.
import { PDFDocument } from 'pdf-lib';
import { db, getSetting, setSetting } from './db.js';

db.exec('CREATE TABLE IF NOT EXISTS tax_docs (id INTEGER PRIMARY KEY, year INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL, size INTEGER NOT NULL, at INTEGER NOT NULL)');

const MAX_BYTES = 5_500_000;   // the largest a request can carry here once encoded
const MAX_DOCS = 25;

export const docsOn = () => getSetting('taxdocs_on') === '1';
/** What is kept for a year, without the files themselves. */
export const docList = (year) => (docsOn() ? db.prepare('SELECT id, name, type, size, at FROM tax_docs WHERE year = ? ORDER BY id').all(year) : []);
/** The files, for building the pack. Each PDF is tried first, so the pack can say which could not be added. */
export async function docsForPack(year) {
  if (!docsOn()) return [];
  const docs = db.prepare('SELECT id, name, type, data FROM tax_docs WHERE year = ? ORDER BY id').all(year).map((d) => ({ ...d, data: Buffer.from(d.data), ok: true, pages: 1 }));
  for (const d of docs) {
    if (d.type !== 'application/pdf') continue;
    try { d.pages = (await PDFDocument.load(d.data)).getPageCount(); } catch { d.ok = false; d.pages = 0; }
  }
  return docs;
}
/** Adds the PDF documents' pages to the end of the finished pack. */
export async function appendPdfs(pack, docs) {
  const pdfs = docs.filter((d) => d.type === 'application/pdf' && d.ok);
  if (!pdfs.length) return pack;
  const out = await PDFDocument.load(pack);
  for (const d of pdfs) {
    try { const src = await PDFDocument.load(d.data); for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page); } catch { /* it opened a moment ago; leave it out rather than fail the pack */ }
  }
  return Buffer.from(await out.save());
}

export function installTaxDocs(app, { year }) {
  // The household's own switch. Off removes what was kept.
  app.put('/api/tax/docs/on', (req, res) => {
    const on = req.body?.on === true;
    if (!on) db.prepare('DELETE FROM tax_docs').run();
    setSetting('taxdocs_on', on ? '1' : '0');
    res.json({ on: docsOn(), list: docList(year()) });
  });
  app.post('/api/tax/docs', (req, res) => {
    if (!docsOn()) return res.status(400).json({ error: 'Keeping tax documents is switched off.' });
    const m = /^data:(image\/(?:png|jpeg)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.file || ''));
    if (!m) return res.status(400).json({ error: "That file isn't one Ledger can keep. Use a PDF, or a photo or screenshot." });
    const data = Buffer.from(m[2], 'base64');
    if (data.length > MAX_BYTES) return res.status(400).json({ error: 'That file is too large (over about 5 MB). A photo of each page, or a smaller PDF, will work.' });
    if (db.prepare('SELECT COUNT(*) n FROM tax_docs WHERE year = ?').get(year()).n >= MAX_DOCS) return res.status(400).json({ error: `That's ${MAX_DOCS} documents already. Remove one you no longer need first.` });
    const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Document';
    db.prepare('INSERT INTO tax_docs (year, name, type, data, size, at) VALUES (?,?,?,?,?,?)').run(year(), name, m[1], data, data.length, Date.now());
    res.json({ on: true, list: docList(year()) });
  });
  app.get('/api/tax/docs/:id', (req, res) => {
    // Only a document's number opens one; anything else here is simply not an address.
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Ledger has nothing at that address.' });
    const d = docsOn() && db.prepare('SELECT name, type, data FROM tax_docs WHERE id = ?').get(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'That document is no longer kept.' });
    res.setHeader('Content-Type', d.type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${d.name.replace(/[^\w .-]/g, '_')}${d.type === 'application/pdf' ? '.pdf' : d.type === 'image/png' ? '.png' : '.jpg'}"`);
    res.send(Buffer.from(d.data));
  });
  app.delete('/api/tax/docs/:id', (req, res) => {
    db.prepare('DELETE FROM tax_docs WHERE id = ?').run(Number(req.params.id));
    res.json({ on: docsOn(), list: docList(year()) });
  });
}
