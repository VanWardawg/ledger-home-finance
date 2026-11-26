// "Take me there" (asked for 2026-11-25: a link that says where a setting is should land on the setting
// itself, not on the page it lives on, and should show which thing it means). One helper for every such
// link in the app: it opens the page, unfolds the section, brings the exact control into view and rings
// it for a couple of seconds, the way the guided tour lights its stops.
//
//   page   the page to open (left out: stay here)
//   fold   the section, or sections from the outside in, to unfold
//   at     what to land on: selectors in order of preference, comma separated. The first one that is on
//          screen wins, so a list can say "the link on a computer, else the ⋯ button on a phone".
//   open   'cfo' opens the CFO's panel first
//
// Controls a link lands on carry a `data-go` name. When one is renamed or moved, keep its name, or change
// the entry in GO below.
import type { MouseEvent } from 'react';

export type Go = { page?: string; fold?: string | string[]; at?: string; open?: 'cfo' };

/** The places links elsewhere in the app send people. */
export const GO = {
  ai: { page: 'connections', fold: 'ai', at: '[data-go="ai-route"], [data-go="ai-key"]' },
  bank: { page: 'connections', fold: 'bank', at: '[data-go="bank-token"]' },
  importFile: { page: 'connections', fold: 'import' },
  classCalendar: { page: 'connections', fold: 'vipkid' },
  gig: { page: 'connections', fold: 'gig', at: '[data-go="gig-owed"]' },
  goals: { page: 'accounts', at: '[data-go="goals"]' },
  allowance: { page: 'accounts', at: '[data-news="allowance"]' },
  otherIncome: { page: 'taxes', fold: 'tax-more', at: '[data-go="other-income"]' },
  sideGig: { page: 'connections', fold: 'gig' },
  setBalance: { page: 'accounts', at: '[data-go="set-balance"], [data-go~="by-hand"] .more-btn' },
} satisfies Record<string, Go>;

const onScreen = (el: Element) => el.getClientRects().length > 0;

/** Rings one thing on the page for a moment. */
export function spot(el: Element) {
  el.classList.remove('spot');
  void (el as HTMLElement).offsetWidth; // so the ring plays again if it was only just shown
  el.classList.add('spot');
  setTimeout(() => el.classList.remove('spot'), 2600);
}

export function goTo(go: Go) {
  const folds = go.fold ? (Array.isArray(go.fold) ? go.fold : [go.fold]) : [];
  if (folds.length) {
    try {
      const saved = JSON.parse(localStorage.getItem('ledger-folds') || '{}');
      for (const f of folds) saved[f] = true;
      localStorage.setItem('ledger-folds', JSON.stringify(saved));
    } catch { /* private window: the sections are still asked to open below */ }
  }
  const here = location.hash.slice(1).split('/')[0] || 'dashboard';
  if (go.page && here !== go.page) location.hash = `#${go.page}`;
  if (go.open === 'cfo') dispatchEvent(new Event('ledger-cfo'));
  const unfold = () => folds.forEach((f) => dispatchEvent(new CustomEvent('ledger-fold-open', { detail: f })));
  unfold();

  const wanted = go.at ? go.at.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const section = folds.length ? `[data-fold="${folds[folds.length - 1]}"]` : '';
  if (!wanted.length && !section) return;
  // The page draws, then its data arrives, then a section's contents: look for a few seconds. The section
  // itself is settled for only once the exact control has had time to appear.
  let tries = 0;
  const find = () => {
    for (const sel of wanted) {
      const el = [...document.querySelectorAll(sel)].find(onScreen);
      if (el) return el;
    }
    if (section && (tries >= 8 || !wanted.length)) {
      const fold = document.querySelector(section);
      if (fold && onScreen(fold)) return fold.querySelector('.fold-head') || fold;
    }
    return null;
  };
  const look = () => {
    if (tries === 2) unfold(); // a section inside a section exists only once the outer one has opened
    const el = find();
    if (!el) { if (++tries < 30) setTimeout(look, 170); return; }
    if (el instanceof HTMLDetailsElement) el.open = true;   // a folded part of a page that is landed on opens
    const tall = el.getBoundingClientRect().height > innerHeight * 0.5;
    el.scrollIntoView({ block: tall ? 'start' : 'center' });
    spot(el);
  };
  setTimeout(look, 150);
}

/** For a link: `<a href="#connections" onClick={jump(GO.ai)}>`. The plain address still works without script. */
export const jump = (go: Go) => (e: MouseEvent) => { e.preventDefault(); goTo(go); };
