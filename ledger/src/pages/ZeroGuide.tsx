import { useState } from 'react';
import { money } from '../lib';
import { Modal } from '../ui';

// "How this works" for the zero-based way of budgeting (server/zero.js): four steps with one made-up
// paycheck, shown from the Budgets page's top card, from the switch, and from the setup guide's budgets
// step. The owner asked for something that explains it, 2026-11-23. The figures are invented; keep them adding up.
type Row = { name: string; icon: string; given: number; spent?: number; note?: string; tone?: 'good' | 'bad' };
const STEPS: { title: string; text: string; left: number; rows: Row[] }[] = [
  {
    title: 'Pay arrives and waits',
    text: 'A $2,000 paycheck lands. Nothing has been decided about it yet, so all of it shows as "To be assigned".',
    left: 2000,
    rows: [{ name: 'Groceries', icon: '🛒', given: 0 }, { name: 'Gas and car', icon: '⛽', given: 0 }, { name: 'Dining out', icon: '🍽️', given: 0 }, { name: 'Card payoff', icon: '💳', given: 0 }, { name: 'Christmas', icon: '🎄', given: 0 }],
  },
  {
    title: 'You give every dollar a job',
    text: 'Type an amount beside each category until "To be assigned" reads $0. You are deciding what this paycheck is for before it is spent, and you cannot hand out money you do not have.',
    left: 0,
    rows: [{ name: 'Groceries', icon: '🛒', given: 600 }, { name: 'Gas and car', icon: '⛽', given: 300 }, { name: 'Dining out', icon: '🍽️', given: 200 }, { name: 'Card payoff', icon: '💳', given: 700 }, { name: 'Christmas', icon: '🎄', given: 200 }],
  },
  {
    title: 'Something runs over',
    text: 'Groceries comes to $640, $40 more than it was given. Ledger points to a category with room, and "Move it" takes $40 from Dining out. The trade is visible: more groceries meant less eating out.',
    left: 0,
    rows: [{ name: 'Groceries', icon: '🛒', given: 640, spent: 640, note: 'was $40 over, now covered', tone: 'good' }, { name: 'Gas and car', icon: '⛽', given: 300, spent: 240 }, { name: 'Dining out', icon: '🍽️', given: 160, spent: 120, note: 'gave $40', tone: 'bad' }, { name: 'Card payoff', icon: '💳', given: 700, spent: 700 }, { name: 'Christmas', icon: '🎄', given: 200, spent: 0 }],
  },
  {
    title: 'What is left stays put',
    text: 'At the end of the month the $60 not spent on gas, the $40 left in Dining out and the $200 for Christmas are still in their categories next month. That is how a once-a-year bill gets saved for a little at a time.',
    left: 0,
    rows: [{ name: 'Groceries', icon: '🛒', given: 0, note: 'starts next month at $0' }, { name: 'Gas and car', icon: '⛽', given: 60, note: 'carried over', tone: 'good' }, { name: 'Dining out', icon: '🍽️', given: 40, note: 'carried over', tone: 'good' }, { name: 'Card payoff', icon: '💳', given: 0, note: 'paid' }, { name: 'Christmas', icon: '🎄', given: 200, note: 'growing each month', tone: 'good' }],
  },
];

export function ZeroGuide({ onClose }: { onClose: () => void }) {
  const [n, setN] = useState(0);
  const s = STEPS[n];
  return (
    <Modal title="Give every dollar a job" onClose={onClose}>
      <div className="zero-guide">
        <p className="zero-guide-count">Step {n + 1} of {STEPS.length}</p>
        <h3>{s.title}</h3>
        <p>{s.text}</p>
        <div className="zero-guide-art" aria-hidden="true">
          <div className={`zero-guide-left ${s.left > 0 ? 'some' : 'done'}`}><span>To be assigned</span><b>{money(s.left)}</b></div>
          {s.rows.map((r) => (
            <div key={r.name} className="zero-guide-row">
              <span className="zero-guide-icon">{r.icon}</span>
              <span className="grow">{r.name}{r.note && <small className={r.tone || ''}>{r.note}</small>}</span>
              <span className="num">{r.spent != null ? `${money(r.spent)} of ${money(r.given)}` : money(r.given)}</span>
            </div>
          ))}
        </div>
        <p className="fine">Made-up figures. You can switch back to a set amount for each category at any time, at the foot of the Budgets page, and nothing is lost.</p>
        <div className="add-actions">
          {n > 0 && <button type="button" onClick={() => setN(n - 1)}>Back</button>}
          {n < STEPS.length - 1 ? <button type="button" className="primary" onClick={() => setN(n + 1)}>Next</button> : <button type="button" className="primary" onClick={onClose}>Got it</button>}
        </div>
      </div>
    </Modal>
  );
}
