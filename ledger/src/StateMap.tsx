// A map of the United States to choose a state from (2026-11-24, the owner: "have a map of the united states
// and pick their state from that"). Tap a state, see its name, press the button. The small north-eastern
// states are hard to hit on a map, so they are also offered as buttons beside it.
import { useState } from 'react';
import { US_MAP } from './usmap';

type State = { code: string; name: string; none?: boolean };
const SMALL = ['CT', 'DC', 'DE', 'MA', 'MD', 'NH', 'NJ', 'RI', 'VT'];

export function StateMap({ states, onPick }: { states: State[]; onPick: (code: string) => void }) {
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState(false);
  const by = new Map(states.map((s) => [s.code, s]));
  const chosen = by.get(sel);
  const pick = (code: string) => { if (by.has(code)) setSel(code); };
  return (
    <div className="state-map">
      <svg viewBox="0 0 975 610" role="group" aria-label="Map of the United States. Choose your state.">
        {Object.entries(US_MAP).map(([code, [d, x, y]]) => (
          <g key={code} className={`state ${sel === code ? 'on' : ''}`} role="button" tabIndex={0} aria-label={by.get(code)?.name ?? code} aria-pressed={sel === code}
            onClick={() => pick(code)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(code); } }}>
            <path d={d} />
            {!SMALL.includes(code) && <text x={x} y={y} textAnchor="middle" dominantBaseline="central">{code}</text>}
          </g>
        ))}
      </svg>
      <div className="state-small" aria-label="The smaller states">
        {SMALL.filter((c) => by.has(c)).map((c) => <button key={c} type="button" className={sel === c ? 'on' : ''} onClick={(e) => { pick(c); e.currentTarget.blur(); }}>{by.get(c)!.name}</button>)}
      </div>
      <div className="state-chosen" aria-live="polite">
        {chosen ? (
          <>
            <span><b>{chosen.name}</b>{chosen.none ? <small> has no state income tax, so the estimate will be federal only.</small> : null}</span>
            <button type="button" className="primary" disabled={busy} onClick={() => { setBusy(true); onPick(chosen.code); }}>Use {chosen.name}</button>
          </>
        ) : <span className="sub">Tap your state on the map.</span>}
      </div>
    </div>
  );
}
