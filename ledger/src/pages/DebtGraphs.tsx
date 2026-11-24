import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, money, monthLong, monthsFromNow, useData } from '../lib';
import { Modal, reducedMotion } from '../ui';

// Graphs for the Debt page (server/debtgraph.js). Kept out of the way until asked for: each debt has "Show
// graph", which opens `DebtGraph` in a pop-up, and `DebtsTogether` sits in a fold at the top of the page.
const axis = { tickLine: false, tick: { fill: 'var(--ink3)', fontSize: 12 } };
const yearOf = (m: string) => m.slice(0, 4);
const COLORS = ['#4a93ea', '#e0703f', '#3fbf7f', '#b78be8', '#e0a13a', '#5ac8c8', '#ef6b6b', '#8d99ae', '#c9a227', '#6f8fcf'];

/** One debt: where its balance has been and is going, and what each year's payments go to. */
export function DebtGraph({ id, onClose, onUpload }: { id: number; onClose: () => void; onUpload?: () => void }) {
  const { data: g } = useData<any>(`/api/debts/${id}/graph`);
  if (!g) return <Modal title="Loading the graph…" onClose={onClose}><p className="sub">One moment.</p></Modal>;
  // One row per month: what has happened, what is ahead, and the regular payment alone where there is an extra.
  const rows = new Map<string, any>();
  const row = (m: string) => rows.get(m) || rows.set(m, { month: m }).get(m);
  for (const p of g.past) row(p.month).past = p.balance;
  const now = g.past.length ? g.past[g.past.length - 1].month : '';
  if (now && g.future.length) { row(now).future = g.balance; if (g.regular) row(now).regular = g.balance; }
  for (const p of g.future) row(p.month).future = p.balance;
  for (const p of g.regular || []) row(p.month).regular = p.balance;
  // Months are placed by their real distance apart (a number: year times twelve plus month), so the past, kept
  // month by month, and the years ahead, kept more thinly, share one honest timeline.
  const at = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
  const line = [...rows.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).map((r) => ({ ...r, t: at(r.month) }));
  const span = line.length ? [line[0].t, line[line.length - 1].t] : [0, 0];
  const everyYears = Math.max(1, Math.ceil((span[1] - span[0]) / 12 / 8));
  const ticks: number[] = [];
  for (let y = Math.ceil(span[0] / 12); y * 12 <= span[1]; y++) if (y % everyYears === 0) ticks.push(y * 12);
  const thisYear = new Date().getFullYear();
  const card = g.type === 'credit';
  const anim = !reducedMotion();
  // The question is written into the CFO's box for the person to read and send; nothing is asked by itself.
  const askCfo = () => {
    const q = `Talk me through my ${g.name}: how it has gone lately and what the figures on its graph mean. Ledger noted: ${(g.notes || []).join(' ')}`;
    try { sessionStorage.setItem('ledger-cfo-draft', q); } catch { /* private window */ }
    onClose();
    dispatchEvent(new Event('ledger-cfo'));
    setTimeout(() => dispatchEvent(new Event('ledger-cfo-ask')), 60);
  };
  return (
    <Modal title={g.name} onClose={onClose}>
      <div className="debt-graph">
        <div className="graph-figs">
          <div><span>Owed today</span><b>{money(g.balance)}</b></div>
          {g.paid && <div><span>Principal paid since {yearOf(g.paid.since)}</span><b>{money(g.paid.principal)}</b></div>}
          {g.paid && <div><span>Interest paid since {yearOf(g.paid.since)}</span><b>{money(g.paid.interest)}</b></div>}
          {g.toCome && <div><span>Interest still to come</span><b>{money(g.toCome.interest)}</b></div>}
          {g.toCome && <div><span>Paid off</span><b>{monthLong(g.toCome.payoff)}</b></div>}
        </div>

        {g.notes?.length > 0 && (
          <div className="graph-notes">
            <h3>What stands out</h3>
            <ul>{g.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
            <button type="button" className="link" onClick={askCfo}>Ask your CFO about this debt</button>
          </div>
        )}

        {!g.ready && <p className="sub">Add this debt's rate and monthly payment on the Debt page and Ledger can draw where it is heading.</p>}
        {g.never && <p className="sub bad">At this payment the balance never falls: the payment doesn't cover the interest.</p>}

        <h3>Balance over time</h3>
        <div className="chart" style={{ height: 240 }}>
          <ResponsiveContainer>
            <ComposedChart data={line} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="t" type="number" domain={span} ticks={ticks} {...axis} axisLine={{ stroke: 'var(--axis)' }} tickFormatter={(t: number) => String(Math.floor(t / 12))} />
              <YAxis width={52} {...axis} axisLine={false} tickFormatter={compact} tickCount={5} />
              <Tooltip cursor={{ stroke: 'var(--axis)' }} content={({ active, payload }: any) => (active && payload?.length ? (
                <div className="tip">
                  <div className="tip-title">{monthLong(payload[0].payload.month)}</div>
                  {payload[0].payload.past != null && <div className="tip-row"><span>Owed</span><b>{money(payload[0].payload.past)}</b></div>}
                  {payload[0].payload.future != null && payload[0].payload.past == null && <div className="tip-row"><span>Expected</span><b>{money(payload[0].payload.future)}</b></div>}
                  {payload[0].payload.regular != null && payload[0].payload.past == null && <div className="tip-row"><span>Regular payment only</span><b>{money(payload[0].payload.regular)}</b></div>}
                </div>
              ) : null)} />
              <Area dataKey="past" stroke="var(--accent)" strokeWidth={2.5} fill="var(--accent)" fillOpacity={0.12} dot={g.past.length < 3} isAnimationActive={anim} connectNulls />
              {g.regular && <Line dataKey="regular" stroke="var(--ink3)" strokeWidth={1.5} strokeDasharray="3 5" dot={false} isAnimationActive={anim} connectNulls />}
              <Line dataKey="future" stroke="var(--accent)" strokeWidth={2.5} strokeDasharray="6 5" dot={false} isAnimationActive={anim} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="graph-key">
          <span><i className="k solid" />What you've owed</span>
          {g.future.length > 0 && <span><i className="k dash" />Where it's heading at {money(g.payment + g.extra)} a month</span>}
          {g.regular && <span><i className="k faint" />With the regular {money(g.payment)} only</span>}
        </p>
        {g.regularToCome && g.toCome && <p className="sub">Your extra {money(g.extra)} a month ends it {g.regularToCome.months - g.toCome.months} months sooner and saves about {money(g.regularToCome.interest - g.toCome.interest)} in interest.</p>}
        {g.toCome && g.planMonths != null && g.planMonths < g.toCome.months && <p className="sub">That line is this debt at its own payment. Under your payoff plan, with the extra money and finished payments rolling into it, it is gone sooner: <b>{monthsFromNow(g.planMonths)}</b>.</p>}
        {g.past.length < 3 && <p className="sub">Ledger has only known this balance for a short while, so the past is brief. It fills in as time goes on.</p>}

        {!card && g.years.length > 0 && (
          <>
            <h3>Where each year's payments go</h3>
            <div className="chart" style={{ height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={g.years} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="year" {...axis} axisLine={{ stroke: 'var(--axis)' }} minTickGap={18} />
                  <YAxis width={52} {...axis} axisLine={false} tickFormatter={compact} tickCount={5} />
                  <Tooltip cursor={{ fill: 'var(--hover)' }} content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const y = payload[0].payload, p = y.principal + y.projPrincipal, i = y.interest + y.projInterest;
                    return (
                      <div className="tip">
                        <div className="tip-title">{y.year}{y.projPrincipal + y.projInterest > 0 ? (y.principal + y.interest > 0 ? ' (part still to come)' : ' (expected)') : ''}</div>
                        <div className="tip-row"><span>To principal</span><b>{money(p)}</b></div>
                        <div className="tip-row"><span>To interest</span><b>{money(i)}</b></div>
                      </div>
                    );
                  }} />
                  <Bar dataKey="principal" stackId="a" fill="var(--accent)" isAnimationActive={anim} />
                  <Bar dataKey="projPrincipal" stackId="a" fill="var(--accent)" fillOpacity={0.4} isAnimationActive={anim} />
                  <Bar dataKey="interest" stackId="a" fill="var(--series2)" isAnimationActive={anim} />
                  <Bar dataKey="projInterest" stackId="a" fill="var(--series2)" fillOpacity={0.4} isAnimationActive={anim} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="graph-key">
              <span><i className="k box" style={{ background: 'var(--accent)' }} />Principal (comes off what you owe)</span>
              <span><i className="k box" style={{ background: 'var(--series2)' }} />Interest (the lender's charge)</span>
              <span><i className="k box pale" style={{ background: 'var(--ink3)' }} />Paler: still to come</span>
            </p>
            {!g.paid && <p className="sub">The years ahead are worked out from the balance, rate and payment. Past years appear when a lender's payment history has been loaded for this debt{g.years[0]?.year === thisYear ? '' : ''}.</p>}
          </>
        )}
        {card && <p className="sub">A card's balance moves with what you spend, so only the balance is drawn. The dashed line is where it goes at the payment above with no new spending.</p>}
        {onUpload && (
          <div className="graph-upload">
            <button type="button" onClick={onUpload}>Upload past statements</button>
            <small>Earlier statements make this graph more accurate: each one adds the real balance for its month{card ? '' : ', and the principal and interest you paid'}, so the past is drawn from your lender's own figures. Choose as many as you like at once.</small>
          </div>
        )}
        <p className="fine">Estimates: a fixed rate, the same payment every month, and no new charges.</p>
      </div>
    </Modal>
  );
}

/** Every debt stacked, from today to the month the last one is paid under the payoff plan. */
export function DebtsTogether() {
  const { data: g } = useData<any>('/api/debts/graph');
  if (!g) return null;
  if (!g.series.length) return <p className="sub">Add a rate and a monthly payment to your debts and Ledger will draw them all heading to zero.</p>;
  const at = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
  const rows = g.months.map((m: string, i: number) => Object.fromEntries([['month', m], ['t', at(m)], ...g.series.map((s: any) => [`d${s.id}`, s.values[i]])]));
  const span = [rows[0].t, rows[rows.length - 1].t];
  const everyYears = Math.max(1, Math.ceil((span[1] - span[0]) / 12 / 8));
  const ticks: number[] = [];
  for (let y = Math.ceil(span[0] / 12); y * 12 <= span[1]; y++) if (y % everyYears === 0) ticks.push(y * 12);
  const anim = !reducedMotion();
  return (
    <div className="debt-graph">
      <p className="sub first">Everything you owe, stacked, from today to {g.debtFree ? <b>{monthLong(g.debtFree)}</b> : 'the years ahead'}{g.debtFree ? ', when the last of it is paid under your plan' : ''}: smallest balance first, each finished payment rolling on to the next, the mortgage last.</p>
      <div className="chart" style={{ height: 280 }}>
        <ResponsiveContainer>
          <AreaChart data={rows} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="t" type="number" domain={span} ticks={ticks} {...axis} axisLine={{ stroke: 'var(--axis)' }} tickFormatter={(t: number) => String(Math.floor(t / 12))} />
            <YAxis width={52} {...axis} axisLine={false} tickFormatter={compact} tickCount={5} />
            <Tooltip cursor={{ stroke: 'var(--axis)' }} content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload, owed = g.series.filter((s: any) => r[`d${s.id}`] > 0);
              return (
                <div className="tip">
                  <div className="tip-title">{monthLong(r.month)}</div>
                  {owed.map((s: any) => <div className="tip-row" key={s.id}><span>{s.name}</span><b>{money(r[`d${s.id}`])}</b></div>)}
                  <div className="tip-row"><span>Together</span><b>{money(owed.reduce((a: number, s: any) => a + r[`d${s.id}`], 0))}</b></div>
                </div>
              );
            }} />
            {[...g.series].reverse().map((s: any) => { const c = COLORS[g.series.indexOf(s) % COLORS.length]; return <Area key={s.id} dataKey={`d${s.id}`} stackId="all" stroke={c} strokeWidth={1.5} fill={c} fillOpacity={0.55} isAnimationActive={anim} />; })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="graph-key">{g.series.map((s: any, i: number) => <span key={s.id}><i className="k box" style={{ background: COLORS[i % COLORS.length] }} />{s.name}</span>)}</p>
      {g.waiting.length > 0 && <p className="sub">Not drawn, because the rate or payment is missing: {g.waiting.join(', ')}.</p>}
    </div>
  );
}
