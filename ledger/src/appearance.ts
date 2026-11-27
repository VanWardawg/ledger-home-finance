// How the app looks on this device: the backdrop (a holiday scene, a still
// colourway or your own colours), light or dark, the colour of the text, the
// accent colour and the typeface. All of it is kept in this browser only
// (localStorage), so a phone and a computer can each look different.

import { photoTone, readPhotoMeta, showPhoto } from './photo';

export type Look = {
  /** A backdrop id: 'auto' (holidays only), 'auto-seasons', 'none' (the plain look, shown as Onyx or Ivory), a holiday or season, a colourway, 'custom', or 'photo' (a picture of your own, kept on this device: src/photo.ts). */
  backdrop: string;
  /** For 'custom': one colour is solid, two to four are blended. */
  colors: string[];
  /** For 'custom': the direction of the blend, in degrees. */
  angle: number;
  scheme: 'auto' | 'light' | 'dark';
  /** Text colour as #rrggbb, or '' for the usual one. */
  ink: string;
  /** Accent colour as #rrggbb, or '' to follow the backdrop. */
  accent: string;
  font: string;
  /** The shape of things: 'classic' (serif figures, as upstream), 'modern' or 'sharp'. */
  style: string;
  /** A solid colour theme for the plain look ('' is Onyx or Ivory). Only used while the backdrop is 'none'. */
  palette: string;
};

export const DEFAULT_LOOK: Look = { backdrop: 'auto', colors: ['#1b2450', '#6a4fd8'], angle: 160, scheme: 'auto', ink: '', accent: '', font: 'system', style: 'classic', palette: '' };
// What "Back to the standard look" in Settings returns to on every copy: plain Onyx, with the usual colours and
// typeface (The owner, 2026-11-18: "it's the cleanest look available"). Where a device starts before anyone chooses
// is a separate thing (`ledger-look-default`: Onyx on a family copy, the holiday scenes on his own).
export const STANDARD_LOOK: Look = { ...DEFAULT_LOOK, backdrop: 'none' };

/** The still colourways in public/seasonal-backdrop.js, with the colours shown on their buttons. Keep the ids in step with that file. */
export const COLORWAYS: { id: string; label: string; light: string[]; dark: string[] }[] = [
  { id: 'midnight', label: 'Midnight', light: ['#eef2fb', '#c2cfee'], dark: ['#0f1730', '#3a5fd0'] },
  { id: 'aurora', label: 'Aurora', light: ['#d3f0e8', '#dcd9f5'], dark: ['#0d2a2a', '#7a5fe0'] },
  { id: 'sunset', label: 'Sunset', light: ['#ffd9c2', '#f4c6dc'], dark: ['#3a1730', '#f0784a'] },
  { id: 'ocean', label: 'Ocean', light: ['#cfeaf6', '#bfdcf0'], dark: ['#0a2a44', '#2fa4d8'] },
  { id: 'forest', label: 'Forest', light: ['#d6ecd8', '#c9dcc0'], dark: ['#12281a', '#3fa66b'] },
  { id: 'rose', label: 'Rose', light: ['#f8d8e2', '#ecd0ea'], dark: ['#34162a', '#d8628a'] },
  { id: 'lavender', label: 'Lavender', light: ['#e2dbf8', '#d3dcf5'], dark: ['#1e1a3c', '#8f7ae8'] },
  { id: 'sand', label: 'Sand', light: ['#efe2cc', '#e2ceb0'], dark: ['#2a2016', '#c08a4a'] },
  { id: 'slate', label: 'Slate', light: ['#e1e6ec', '#cfd6df'], dark: ['#181c24', '#6f8fb8'] },
  { id: 'ember', label: 'Ember', light: ['#f6d6c8', '#eec0a8'], dark: ['#34120c', '#e05a3a'] },
];

/** How panels, headings and figures are drawn. The colours are a separate choice. */
export const STYLES: { id: string; label: string; note: string }[] = [
  { id: 'classic', label: 'Classic', note: 'Serif headings and figures' },
  { id: 'modern', label: 'Modern', note: 'Rounded panels, soft shadows, bold sans figures' },
  { id: 'sharp', label: 'Sharp', note: 'Square corners, thin lines, small capitals' },
];

/** Solid colour themes for the plain look (src/styles.css, html[data-palette]). `show` is what the button is painted with. */
export const PALETTES: { id: string; label: string; dark: boolean; show: string[] }[] = [
  { id: 'snow', label: 'Snow', dark: false, show: ['#f4f6fa', '#ffffff', '#4f46e5'] },
  { id: 'mint', label: 'Mint', dark: false, show: ['#f0f5f1', '#ffffff', '#17805a'] },
  { id: 'clay', label: 'Clay', dark: false, show: ['#f7f1ec', '#fffdfb', '#c2532d'] },
  { id: 'graphite', label: 'Graphite', dark: true, show: ['#121315', '#1b1c1f', '#8b9cf9'] },
  { id: 'navy', label: 'Navy', dark: true, show: ['#0a1020', '#111a30', '#38bdf8'] },
  { id: 'plum', label: 'Plum', dark: true, show: ['#130e19', '#1c1526', '#c084fc'] },
];

export const FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'system', label: 'Standard', stack: '' },
  { id: 'rounded', label: 'Rounded', stack: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Nunito', system-ui, sans-serif" },
  { id: 'humanist', label: 'Avenir', stack: "'Avenir Next', Avenir, 'Segoe UI', 'Gill Sans', system-ui, sans-serif" },
  { id: 'serif', label: 'Serif', stack: "ui-serif, 'New York', 'Iowan Old Style', Georgia, serif" },
  { id: 'classic', label: 'Classic (Georgia)', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'Typewriter', stack: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
];

/** Colours offered as quick choices for the accent and the text. */
export const ACCENTS = ['#4a93ea', '#2fbfa5', '#3fa66b', '#e0a13a', '#f0784a', '#e05a5a', '#d8628a', '#8f7ae8'];
export const INKS = ['#ffffff', '#f3ead8', '#cfe3ff', '#d8f3e4', '#17171b', '#2a2233', '#1d2a44', '#2b1d12'];

const HEX = /^#[0-9a-f]{6}$/i;
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window: applies until reload */ } };

export function readLook(): Look {
  let colors = DEFAULT_LOOK.colors;
  try { const c = JSON.parse(get('ledger-custom-colors') || 'null'); if (Array.isArray(c) && c.length && c.every((x) => HEX.test(x))) colors = c.slice(0, 4); } catch { /* keep the default */ }
  const scheme = get('ledger-scheme');
  const hex = (k: string) => { const v = get(k) || ''; return HEX.test(v) ? v : ''; };
  return {
    // Your choice on this device; else this copy's starting look (kept from the server by src/main.tsx); else the holiday scenes.
    backdrop: get('ledger-backdrop') || get('ledger-look-default') || 'auto',
    colors,
    angle: Number(get('ledger-custom-angle')) || 160,
    // Unless light or dark was chosen here, it follows the device (The owner, 2026-11-19: keep it on the phone's preference).
    scheme: scheme === 'light' || scheme === 'dark' ? scheme : 'auto',
    ink: hex('ledger-ink'),
    accent: hex('ledger-accent'),
    font: FONTS.some((f) => f.id === get('ledger-font')) ? (get('ledger-font') as string) : 'system',
    style: STYLES.some((s) => s.id === get('ledger-style')) ? (get('ledger-style') as string) : 'classic',
    palette: PALETTES.some((p) => p.id === get('ledger-palette')) ? (get('ledger-palette') as string) : '',
  };
}

const luminance = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
/** Whether your own backdrop colours are dark enough to need light text. */
export const customIsDark = (colors: string[]) => colors.reduce((a, c) => a + luminance(c), 0) / colors.length < 0.5;

/** Puts a look into effect. */
// ---- Display size ----------------------------------------------------------------------------
// How large the whole app is drawn on this device (localStorage `ledger-size`). "auto" suits the
// screen: standard up to a laptop-sized window, larger on a big desktop monitor, where the standard
// size reads small from a normal sitting distance (The owner, comparing a family copy with his own on a
// 27-inch iMac). It is applied as the CSS variable --zoom, which `.shell` and the sign-in card use.
export const SIZES: [id: string, label: string][] = [['auto', 'Automatic (suits this screen)'], ['1', 'Standard'], ['1.15', 'Large'], ['1.3', 'Larger'], ['1.5', 'Largest']];
export function readSize(): string {
  try { const v = localStorage.getItem('ledger-size') || 'auto'; return SIZES.some(([id]) => id === v) ? v : 'auto'; } catch { return 'auto'; }
}
export function applySize(choice: string = readSize()) {
  let zoom = Number(choice);
  if (choice === 'auto' || !Number.isFinite(zoom)) {
    // The app's layout is at most about 2300 pixels wide. In a window wider than that it is drawn
    // larger until it fills the window, up to one and a half times. Because the window's width is
    // measured in the browser's own (possibly zoomed) pixels, the result looks the same on a given
    // screen whether the browser is zoomed in, out or not at all: a zoomed-in browser gets less from
    // the app, a zoomed-out one more. (The first version stepped at 1800 and 2300 and stood aside for
    // a zoomed browser; the owner's trial copy, whose browser was zoomed out a little, got almost nothing.)
    zoom = Math.min(1.5, Math.max(1, Math.round((innerWidth / 2300) * 100) / 100));
  }
  document.documentElement.style.setProperty('--zoom', String(zoom));
}
export function saveSize(choice: string) {
  try { localStorage.setItem('ledger-size', choice); } catch { /* private window: applies until reload */ }
  applySize(choice);
}
let sizeWatching = false;

export function applyLook(look: Look = readLook()) {
  applySize();
  if (!sizeWatching) { sizeWatching = true; addEventListener('resize', () => applySize()); }
  const root = document.documentElement;
  const el = document.querySelector('seasonal-backdrop');
  // A photo of your own: the backdrop is given colours taken from the picture (they show for the moment
  // before it loads, and tint the glass), and the picture itself is laid over them. With no picture
  // measured on this device (storage cleared, or the choice came from elsewhere) it is the plain look.
  const meta = look.backdrop === 'photo' ? readPhotoMeta() : null;
  const photo = meta ? photoTone(meta, look.scheme) : null;
  if (look.backdrop === 'photo' && !photo) look = { ...look, backdrop: 'none' };
  showPhoto(photo);
  if (el) {
    if (photo) { el.setAttribute('colors', photo.colors.join(',')); el.setAttribute('angle', '180'); }
    if (photo?.accent && !look.accent) el.setAttribute('accent', photo.accent); else el.removeAttribute('accent');
    if (look.backdrop === 'custom') { el.setAttribute('colors', look.colors.join(',')); el.setAttribute('angle', String(look.angle)); }
    el.setAttribute('scheme', look.scheme);
    // "Holidays only" limits the automatic choice to these; "holidays and seasons" lets it pick a season in between.
    if (look.backdrop === 'auto-seasons') el.removeAttribute('only');
    else el.setAttribute('only', 'newyear valentines stpatricks easter july4 halloween thanksgiving christmas');
    el.setAttribute('theme', photo ? 'custom' : look.backdrop === 'auto-seasons' ? 'auto' : look.backdrop);
  }
  // Light or dark: your choice; or, with your own colours, whichever suits them; or else the device's setting.
  const scheme = photo ? (photo.dark ? 'dark' : 'light') : look.backdrop === 'custom' ? (customIsDark(look.colors) ? 'dark' : 'light') : look.scheme;
  // A solid colour theme belongs to the plain look, and brings its own light or dark with it.
  const palette = look.backdrop === 'none' ? PALETTES.find((p) => p.id === look.palette) : undefined;
  if (palette) { root.dataset.palette = palette.id; root.dataset.scheme = palette.dark ? 'dark' : 'light'; }
  else { delete root.dataset.palette; if (scheme === 'auto') delete root.dataset.scheme; else root.dataset.scheme = scheme; }
  if (look.style && look.style !== 'classic') root.dataset.style = look.style; else delete root.dataset.style;
  const set = (name: string, value: string) => (value ? root.style.setProperty(name, value) : root.style.removeProperty(name));
  set('--ink', look.ink);
  set('--ink2', look.ink && `color-mix(in srgb, ${look.ink} 78%, transparent)`);
  set('--ink3', look.ink && `color-mix(in srgb, ${look.ink} 58%, transparent)`);
  set('--accent', look.accent);
  set('--font', FONTS.find((f) => f.id === look.font)?.stack || '');
}

/** Changes part of the look, remembers it on this device and applies it. */
export function saveLook(change: Partial<Look>): Look {
  const look = { ...readLook(), ...change };
  put('ledger-backdrop', look.backdrop);
  put('ledger-custom-colors', JSON.stringify(look.colors));
  put('ledger-custom-angle', String(look.angle));
  put('ledger-scheme', look.scheme);
  put('ledger-ink', look.ink);
  put('ledger-accent', look.accent);
  put('ledger-font', look.font);
  put('ledger-style', look.style);
  put('ledger-palette', look.palette);
  applyLook(look);
  return look;
}
