import './base';
import { useCallback, useEffect, useState } from 'react';

export async function api<T = any>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  // A 401 means the session ended: tell the app to show the sign-in screen.
  if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('ledger-signed-out'));
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Couldn't reach the app's server.");
  return res.json();
}

// The last answer for each address, kept while the app is open. Going back to a
// page shows what it had straight away (no loading placeholder, no jump when the
// figures arrive) and then quietly brings it up to date.
// Nothing about signing in is kept, and everything is dropped on signing out.
const seen = new Map<string, unknown>();
const keep = (url: string) => !url.startsWith('/api/auth/');
export const forgetLoaded = () => seen.clear();
/** For the few places that load data themselves: the last answer for an address, and a way to note a new one. */
export const lastLoaded = <T = any>(url: string) => seen.get(url) as T | undefined;
export const noteLoaded = (url: string, data: unknown) => { seen.set(url, data); };
addEventListener('ledger-signed-out', forgetLoaded);

/** Loads a URL and reloads when it changes or when reload() is called. */
export function useData<T = any>(url: string) {
  const [data, setData] = useState<T | null>(() => (keep(url) ? (seen.get(url) as T) ?? null : null));
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    // A different address (another month, say) that has been seen before shows at once too.
    if (keep(url) && seen.has(url)) setData(seen.get(url) as T);
    api<T>(url).then((d) => { if (keep(url)) seen.set(url, d); if (live) { setData(d); setError(''); } }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // Something shown on many pages changed (a category's icon): every page asks again.
  useEffect(() => { addEventListener('ledger-refresh', reload); return () => removeEventListener('ledger-refresh', reload); }, [reload]);
  return { data, error, reload };
}

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (n: number) => usd0.format(Math.round(n));
export const cents = (n: number) => usd2.format(n);
export const signed = (n: number) => (n > 0 ? '+' : '') + usd2.format(n);
export const compact = (n: number) =>
  Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`;

const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
export const monthLong = (m: string) => parse(m).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
export const monthShort = (m: string) => parse(m).toLocaleDateString('en-US', { month: 'short' });
export const dayShort = (d: string) => parse(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const dayLong = (d: string) => parse(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
/** "Mar 2028" for a date that many months from now. */
export const monthsFromNow = (n: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
export const duration = (n: number) =>
  n < 12 ? `${n} month${n === 1 ? '' : 's'}` : `${Math.floor(n / 12)} yr${n % 12 ? ` ${n % 12} mo` : ''}`;
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
export const daysUntil =(d: string) => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((parse(d).getTime() - now.getTime()) / 86400000);
};

// A photo taken from the "+" menu's "Take a photo", on its way to the reader on the Transactions page.
export const handoff: { photo: Blob | null } = { photo: null };

/**
 * "In the middle of something" for a while: the camera or a file picker is up, or a picture is on its
 * way to the reader. The auto-update holds off reloading until it passes (src/main.tsx), and if the
 * phone reloads the page by itself in that time (iPhones drop a page to make room for the camera)
 * the opening logo is not played over what you were doing. Kept in sessionStorage as well, because
 * a reload forgets everything else.
 */
export function busyFor(ms: number) {
  const until = Math.max(Date.now() + ms, (window as any).ledgerBusyUntil || 0);
  (window as any).ledgerBusyUntil = until;
  try { sessionStorage.setItem('ledger-busy-until', String(until)); } catch { /* private window */ }
}

/**
 * True when this page load is a reload in the middle of use, not Ledger being opened: something was
 * under way (busyFor), or the screen was touched in the last twenty seconds. A fresh open from the
 * home screen starts with an empty sessionStorage, so it is never one.
 */
export function midSession() {
  try {
    const now = Date.now();
    return now < Number(sessionStorage.getItem('ledger-busy-until') || 0) || now - Number(sessionStorage.getItem('ledger-touched-at') || 0) < 20_000;
  } catch { return false; }
}

/**
 * The household's side gig (self-employment income such as tutoring or VIPKid), from Settings.
 * `on` is false until the answer arrives, so gig-only parts of a page don't flash for a household without one.
 */
/** Whose account is whose (server/owners.js): the adults' names and what to call each group. */
export function useOwners() {
  const { data, reload } = useData<any>('/api/owners');
  const label = (who: string) => (who === 'you' ? (data?.names?.you || 'Mine') : who === 'spouse' ? (data?.names?.spouse || "My spouse's") : 'Shared');
  const possessive = (who: string) => (who === 'you' ? (data?.names?.you ? `${data.names.you}'s` : 'Mine') : who === 'spouse' ? (data?.names?.spouse ? `${data.names.spouse}'s` : "My spouse's") : 'Shared');
  const list: string[] = data ? Object.keys(data.groups) : [];
  return { data, reload, label, possessive, list, marked: !!data?.marked };
}

/** Whether the tax section is in use. A household outside the United States can switch it off in Settings. */
export function useTaxes() {
  const { data, reload } = useData<{ on: boolean }>('/api/tax/on');
  useEffect(() => { addEventListener('ledger-taxes', reload); return () => removeEventListener('ledger-taxes', reload); }, [reload]);
  return data ? data.on : true;
}
export async function setTaxes(on: boolean) {
  await api('/api/tax/on', { method: 'PUT', body: { on } });
  forgetLoaded();
  dispatchEvent(new Event('ledger-taxes')); dispatchEvent(new Event('ledger-refresh'));
}

/**
 * How the AI features are reached here. `claude` is false only where the household uses the AI set up in
 * its Home Assistant and that AI isn't Claude: the app then drops Claude's name, and the CFO is the
 * "Chief Financial Officer". `plain` means the CFO answers through Home Assistant's AI, the basic way.
 */
export function useAi() {
  const { data } = useData<{ ready: boolean; plain?: boolean; claude?: boolean; aiName?: string }>('/api/cfo');
  return { claude: data ? data.claude !== false : true, plain: !!data?.plain, name: data?.aiName || 'Claude' };
}

export function useGig() {
  const { data, reload } = useData<{ on: boolean; name: string; match: string; classes: boolean; teachers: number; two: boolean; who: string; cash: number; extras: { id: number; name: string; match: string; who: string; cash: number; costs: number }[] }>('/api/gig');
  // Every part of the app that shows the gig hears when Settings changes it.
  useEffect(() => { addEventListener('ledger-gig', reload); return () => removeEventListener('ledger-gig', reload); }, [reload]);
  return { on: !!data?.on, name: data?.name || 'Side gig', match: data?.match || '', classes: !!data?.classes, teachers: data?.teachers || 0, two: !!data?.two, who: data?.who || 'you', cash: data?.cash || 0, extras: data?.extras || [], loaded: !!data, reload };
}
