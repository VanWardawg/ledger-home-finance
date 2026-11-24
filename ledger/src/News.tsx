import { useEffect, useState, type ReactNode } from 'react';
import { JUST_ADDED, type NewsGo } from './updates';

// Telling people about something new (The owner, 2026-11-23). After an update, the dashboard shows one quiet
// line naming the new features from "Just added" (src/updates.ts) that this device hasn't seen, each a link
// to the feature itself where there is somewhere to go, and the About entry in the menu carries a dot.
// Fixes and small changes never appear: only what is put in JUST_ADDED with a date.
//
// A feature stops being announced when the person follows its link, presses "Got it", or opens About,
// "What's new"; and by itself NEWS_DAYS after its date, so nobody is told about something old.
// What a device has seen is kept on that device (localStorage `ledger-news-seen`, a list of titles).
// A household that has just finished the setup guide is told nothing: everything is new to them, and the
// tour covers it (`allNewsSeen()` is called then).
export const NEWS_DAYS = 14;
// Nothing dated before the notice existed is announced.
const NEWS_FROM = '2026-11-23';
const KEY = 'ledger-news-seen';

const seen = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const save = (titles: string[]) => {
  // Only titles still in the list are kept, so the record never grows.
  const live = new Set(JUST_ADDED.map(([t]) => t));
  try { localStorage.setItem(KEY, JSON.stringify([...new Set(titles)].filter((t) => live.has(t)))); } catch { /* private window */ }
  dispatchEvent(new Event('ledger-news'));
};

/** The features this device should still be told about, newest first. */
export function unseenNews(now = Date.now()) {
  const done = new Set(seen());
  return JUST_ADDED.filter(([title, , more]) => {
    if (!more?.date || more.date < NEWS_FROM || done.has(title)) return false;
    const age = (now - new Date(`${more.date}T00:00:00`).getTime()) / 86400000;
    return age >= 0 && age < NEWS_DAYS;
  });
}
export const newsSeen = (title: string) => save([...seen(), title]);
export const allNewsSeen = () => save(JUST_ADDED.map(([t]) => t));

/** Goes to where a feature lives: its page, with its section unfolded (on a phone) and brought into view. */
export function goToNews(go: NewsGo) {
  if (go.fold) { try { localStorage.setItem('ledger-folds', JSON.stringify({ ...JSON.parse(localStorage.getItem('ledger-folds') || '{}'), [go.fold]: true })); } catch { /* private window */ } }
  location.hash = `#${go.page}`;
  if (go.fold) dispatchEvent(new CustomEvent('ledger-fold-open', { detail: go.fold }));
  if (!go.at) return;
  // The page draws, then its data arrives: look for the section for a few seconds.
  let tries = 0;
  const look = () => {
    const el = document.querySelector(go.at!);
    if (el) el.scrollIntoView({ block: 'start' });
    else if (++tries < 25) setTimeout(look, 200);
  };
  setTimeout(look, 350);
}

/** Redraws whenever what has been seen changes. */
export function useUnseenNews() {
  const [, redraw] = useState(0);
  useEffect(() => {
    const on = () => redraw((n) => n + 1);
    addEventListener('ledger-news', on);
    return () => removeEventListener('ledger-news', on);
  }, []);
  return unseenNews();
}

/** The line on the dashboard. */
export function NewsNotice({ mark }: { mark?: ReactNode }) {
  const news = useUnseenNews();
  if (!news.length) return null;
  const shown = news.slice(0, 3);
  return (
    <div className="bank-attention news-notice" role="status">
      <span className="grow">
        <b className="news-lead">New in {mark || 'Ledger'}:</b>{' '}
        {shown.map(([title, text, more], i) => (
          <span key={title}>
            {i > 0 && (i === shown.length - 1 && news.length <= 3 ? ' and ' : ', ')}
            {more?.go ? <button type="button" className="link" title={text} onClick={() => { newsSeen(title); goToNews(more.go!); }}>{title}</button> : <span title={text}>{title}</span>}
          </span>
        ))}
        {news.length > 3 && ` and ${news.length - 3} more`}.
      </span>
      <a href="#about/updates">See what's new</a>
      <button type="button" className="link" onClick={allNewsSeen}>Got it</button>
    </div>
  );
}
