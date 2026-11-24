import { at } from '../base';
// Small examples shown above the words in the About pop-up (src/pages/About.tsx): pieces of the app
// itself, drawn with its own components and styles and filled with made-up figures, so a reader
// sees what a paragraph is talking about. ART[topic][page] is the picture for that page; most pages
// have none. Nothing here reads the household's data.
import { CatIcon } from '../icons';
import { Logo, Meter } from '../ui';

const Row = ({ icon, logo, name, small, amount, good, dot }: { icon?: string; logo?: string; name: string; small: string; amount: string; good?: boolean; dot?: boolean }) => (
  <div className="row">
    {logo ? <Logo name={logo} fallback={icon} /> : <CatIcon icon={icon} />}
    <span className="grow">{name}{dot && <span className="art-dot" />}<small>{small}</small></span>
    <span className={`num ${good ? 'good' : ''}`}>{amount}</span>
  </div>
);
const Tile = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <div className="art-tile"><div className="label">{label}</div><div className="value">{value}</div><div className="sub">{sub}</div></div>
);
const Bar = ({ name, have, of, pct }: { name: string; have: string; of: string; pct: number }) => (
  <div>
    <div className="goal-head"><span className="goal-name">{name}</span><span className="num">{have} <small>of {of}</small></span></div>
    <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
  </div>
);
const Chips = ({ items }: { items: string[] }) => <div className="art-chips">{items.map((x) => <span key={x}>{x}</span>)}</div>;
const Flow = ({ steps }: { steps: [string, string][] }) => (
  <div className="art-flow">{steps.map(([a, b], i) => <span key={a} className="art-step">{i > 0 && <i aria-hidden="true">→</i>}<span><b>{a}</b><small>{b}</small></span></span>)}</div>
);

export const ART: Record<string, Record<number, React.ReactNode>> = {
  what: {
    0: <div className="art-tiles"><Tile label="Left before payday" value="$1,742" sub="after the bills due by then" /><Tile label="In checking now" value="$2,166" sub="pending already taken off" /><Tile label="Spent of $3,900" value="$2,714" sub="70% of this month's budget" /></div>,
  },
  around: {
    0: <Chips items={['Dashboard', 'Transactions', 'Budgets']} />,
    1: <Chips items={['Recurring', 'Debt', 'Accounts']} />,
    2: <Chips items={['Reports', 'Taxes', 'Settings']} />,
    3: <div className="art-center"><span className="art-plus">+</span><span className="art-seal">CFO</span></div>,
  },
  'money-in': {
    0: <Chips items={['Bank connection', 'Add it yourself', 'A screenshot', 'A file']} />,
    1: <><Row icon="🍽" name="Breakfast (Square)" small="Today · waiting for the bank" amount="$16.85" dot /><Row logo="Kroger" icon="🛒" name="Kroger" small="Yesterday · Groceries · matched by the bank ✓" amount="$84.20" /></>,
  },
  forecast: {
    0: <div className="art-tiles two"><Tile label="In checking now" value="$2,166" sub="posted, less pending" /><Tile label="Left before payday" value="$1,742" sub="after bills due by Nov 30" /></div>,
    1: <><Row icon="💧" name="Water" small="Nov 19 · Change" amount="−$81.00" /><Row logo="Netflix" icon="🎬" name="Netflix" small="Nov 27 · moved by you from Nov 21" amount="−$9.57" /><Row icon="💵" name="Paycheck" small="Nov 30" amount="+$1,610.31" good /></>,
  },
  budgets: {
    0: <><Meter icon="🛒" name="Groceries" spent={612} budget={800} /><Meter icon="🍽" name="Dining out" spent={236} budget={200} /></>,
    1: <><Row logo="Target" icon="🛍" name="Target" small="One purchase of $84.20, split in two" amount="$60.00" /><Row icon="👕" name="Target" small="Clothing · part of the same purchase" amount="$24.20" /></>,
    2: <div className="art-center"><Logo name="Netflix" fallback="🎬" /><Logo name="Kroger" fallback="🛒" /><Logo name="Amazon" fallback="📦" /><CatIcon icon="💇" /><CatIcon icon="🎁" /></div>,
  },
  bills: {
    0: <><Row icon="⚡" name="Electric" small="Due Dec 4 · estimated from last winter" amount="$142" /><Row logo="Netflix" icon="🎬" name="Netflix" small="Due Dec 21 · every month" amount="$9.57" /></>,
  },
  goals: {
    0: <><Bar name="Emergency fund" have="$3,200" of="$5,000" pct={64} /><Bar name="Summer trip" have="$450" of="$1,800" pct={25} /></>,
  },
  taxes: {
    0: <><Row icon="🏛" name="Federal income tax" small="After credits" amount="$6,262" /><Row icon="🧾" name="Self-employment tax" small="On side income" amount="$3,939" /><Row icon="🏠" name="Arkansas income tax" small="" amount="$3,860" /></>,
    2: <><Row icon="👶" name="Children and other dependents" small="Two children under 17" amount="−$4,400" good /><Row icon="🎓" name="College credit" small="One student" amount="−$2,500" good /></>,
    3: <><Row icon="🧑‍🏫" name="Tutoring" small="Yours · $8,400 received so far" amount="$7,900 profit" /><Row icon="🧰" name="Lawn care" small="Your spouse's · $2,000 in cash" amount="$5,100 profit" /></>,
  },
  cfo: {
    0: <div className="art-chat"><p className="q">What did we spend on eating out last month?</p><p className="a">$236 across nine visits, $36 over your $200 budget. The largest was $48 at La Hacienda.</p></div>,
  },
  phone: {
    0: <div className="art-center"><span className="art-app"><img src={at('/icon-180.png')} alt="" /><small>Ledger</small></span></div>,
  },
  settings: {
    0: <div className="art-center">{['#0e0f13', '#1b2450', '#3a2a55', '#12382f', '#5a2a1c', '#f3efe6'].map((c) => <span key={c} className="art-swatch" style={{ background: c }} />)}</div>,
  },
  privacy: {
    0: <Flow steps={[['Your bank', 'your password stays here'], ['SimpleFIN', 'read-only'], ['Your copy of Ledger', 'yours alone']]} />,
  },
};
