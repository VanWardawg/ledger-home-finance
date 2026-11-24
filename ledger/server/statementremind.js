// A reminder to upload statements (The owner, 2026-11-23: "so I can remember to add the statements going
// forward ... you can get a rough idea of when statements have been posted from all of that data").
//
// Each debt's graph draws its past from `debt_history`, which only grows when someone uploads a statement.
// From the dates already there Ledger learns the day of the month a debt's statement usually closes, and a
// few days after the next one should be out, with nothing loaded for it, that debt is "due". The dashboard
// shows one quiet line naming them and the summary email carries a line about once a month.
//
// It is deliberately easy to satisfy and easy to silence:
//   * a debt with fewer than three loaded statements is never mentioned (there is no pattern to go on);
//   * a debt whose newest statement is more than 75 days old is left alone, so a household that stops
//     uploading is asked about two missed statements and then no more;
//   * a debt that is paid off is skipped;
//   * setting `stmt_remind` = '0' switches it off for the whole household (Settings, Alerts).
import { db, iso, getSetting, setSetting } from './db.js';
import './debtgraph.js';

const DEBTS = ['credit', 'auto', 'mortgage', 'loan'];
const WAIT_DAYS = 4;      // statements take a few days to appear online
const NEAR_DAYS = 8;      // a loaded point this close to the expected day counts as that statement
const GIVE_UP_DAYS = 75;

const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const day = (d) => new Date(`${d}T12:00:00`);
const between = (a, b) => Math.round((b - a) / 86400000);

/** The usual closing day from a debt's recent statement dates: a day of the month, or 'end' for the last few days. */
function usualDay(dates) {
  const recent = dates.slice(-6).map(day);
  const late = recent.filter((d) => daysIn(d.getFullYear(), d.getMonth()) - d.getDate() <= 2).length;
  if (late > recent.length / 2) return 'end';
  const days = recent.map((d) => d.getDate()).sort((a, b) => a - b);
  return days[Math.floor(days.length / 2)];
}

/** The most recent day, not after `now`, on which a statement would have closed. */
function lastExpected(usual, now) {
  for (let back = 0; back < 3; back++) {
    const y = now.getFullYear(), m = now.getMonth() - back;
    const first = new Date(y, m, 1, 12);
    const dim = daysIn(first.getFullYear(), first.getMonth());
    const d = new Date(first.getFullYear(), first.getMonth(), usual === 'end' ? dim : Math.min(usual, dim), 12);
    if (d <= now) return d;
  }
  return null;
}

export const stmtRemindOn = () => getSetting('stmt_remind', '1') !== '0';

/** Debts whose latest statement should be out by now and hasn't been uploaded. */
export function statementsDue(now = new Date()) {
  if (!stmtRemindOn()) return [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const accounts = db.prepare(`SELECT id, name, balance FROM accounts WHERE type IN (${DEBTS.map(() => '?').join(',')}) ORDER BY name`).all(...DEBTS);
  const out = [];
  for (const a of accounts) {
    if (!(a.balance < -0.005)) continue; // nothing owed
    const dates = db.prepare('SELECT date FROM debt_history WHERE account_id = ? AND extra = 0 ORDER BY date').all(a.id).map((r) => r.date);
    if (dates.length < 3) continue;
    const newest = day(dates[dates.length - 1]);
    if (between(newest, today) > GIVE_UP_DAYS) continue;
    const expected = lastExpected(usualDay(dates), today);
    if (!expected) continue;
    if (between(expected, today) < WAIT_DAYS) continue;          // too soon: it may not be online yet
    if (between(newest, expected) <= NEAR_DAYS) continue;        // that statement is already in
    out.push({ id: a.id, name: a.name, expected: iso(expected), last: dates[dates.length - 1] });
  }
  return out;
}

/** One plain sentence for the summary email, or '' when nothing is due. */
export function statementReminderText() {
  const due = statementsDue();
  if (!due.length) return '';
  const names = due.map((d) => d.name);
  const list = names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  return `New statements are likely out for ${list}. Uploading them on the Debt page ("Upload debt") keeps the debt graphs exact.`;
}

export function installStatementRemind(app) {
  app.get('/api/statements/remind', (_req, res) => res.json({ on: stmtRemindOn(), due: statementsDue() }));
  app.put('/api/statements/remind', (req, res) => {
    setSetting('stmt_remind', req.body?.on === false ? '0' : '1');
    res.json({ on: stmtRemindOn(), due: statementsDue() });
  });
}
