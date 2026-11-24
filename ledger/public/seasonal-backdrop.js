// <seasonal-backdrop>: an animated background that changes with the seasons and
// holidays. One file, no dependencies, so it can be dropped into any page:
//
//   <script type="module" src="seasonal-backdrop.js"></script>
//   <seasonal-backdrop></seasonal-backdrop>
//
// Attributes (all optional):
//   theme   "auto" (default, picked from today's date), "none", or a theme id below
//   scheme  "auto" (default, follows the device), "light" or "dark"
//   only    with theme="auto", a space-separated list of the themes allowed to appear,
//           for example only="thanksgiving christmas". Other dates show nothing.
//   characters  "on" (default) or "off": the holiday characters (a walking turkey, Santa,
//           a ghost and so on), drawn in front of the page, and the fireworks, drawn behind it
//   colors      for theme="custom": one to four colours as #rrggbb, separated by commas. One
//           is a solid colour; more are blended across the page at `angle` degrees (160)
//   stage       a CSS selector for where the characters should stand, such as a side menu
//           with empty space at its foot; without it they stand at the bottom left
//   motion  "on" (default) or "off". Motion also stops when the device asks for less.
//
// It sits behind everything (position: fixed, z-index: -1) and never takes clicks.
// It also sets data-season on <html> and the CSS variable --season-accent, so a
// page can tint itself to match.

const leafy = ['#c8501e', '#e07a1f', '#f0a830', '#a83a1c', '#8a2f1a', '#d9912a', '#b5651d'];

export const THEMES = {
  thanksgiving: {
    label: 'Thanksgiving', accent: '#c8641e',
    light: ['#fbefd9', '#f3cf9c', '#e0a060'], dark: ['#160e0a', '#2e1a0f', '#4a2410'],
    blobs: ['#f08a24', '#b8321e', '#f2c14e'],
    actors: ['feast'],
    bits: [{ kind: 'maple', n: 22, colors: leafy, size: [18, 40], speed: [18, 46] }, { kind: 'leaf', n: 18, colors: leafy, size: [12, 26], speed: [16, 40] }],
  },
  autumn: {
    label: 'Autumn', accent: '#c06a22',
    light: ['#f8eedd', '#efd3a8', '#dcae74'], dark: ['#14100c', '#261a10', '#3b2413'],
    blobs: ['#e58a2c', '#9c4a1e', '#d8b040'],
    bits: [{ kind: 'leaf', n: 22, colors: leafy, size: [10, 24], speed: [16, 42] }, { kind: 'maple', n: 6, colors: leafy, size: [14, 26], speed: [18, 40] }],
  },
  halloween: {
    label: 'Halloween', accent: '#e8701a',
    light: ['#f6e9dc', '#ecc9a2', '#c9a0c8'], dark: ['#0d0a14', '#1e1230', '#3a1a2c'],
    blobs: ['#f07818', '#6a2c9c', '#2a1a40'],
    actors: ['pumpkin', 'ghost', 'treater'],
    bits: [{ kind: 'leaf', n: 14, colors: ['#e8701a', '#b4480f', '#3a2a4a', '#5a2c7a'], size: [10, 22], speed: [18, 44] }, { kind: 'glow', n: 16, colors: ['#ff9a2e', '#ffc04a'], size: [2, 4], speed: [4, 10] }],
  },
  christmas: {
    label: 'Christmas', accent: '#c0392b',
    light: ['#f4f8f6', '#dcebe4', '#c4dccf'], dark: ['#07120f', '#0f2a22', '#3a1216'],
    blobs: ['#c0392b', '#1f7a4c', '#e8c060'],
    actors: ['santa'],
    bits: [{ kind: 'snow', n: 60, colors: ['#ffffff'], size: [1.5, 5], speed: [14, 44] }, { kind: 'twinkle', n: 26, colors: ['#ffd97a', '#ff6b5e', '#7ee0a8'], size: [1.5, 3.2], speed: [0, 0] }],
  },
  winter: {
    label: 'Winter', accent: '#3d7fc4',
    light: ['#f3f7fb', '#dde9f5', '#c3d8ee'], dark: ['#080d16', '#101d33', '#1a2f4d'],
    blobs: ['#6aa8e8', '#a8c8f0', '#4a6fb0'],
    bits: [{ kind: 'snow', n: 70, colors: ['#ffffff'], size: [1.5, 5.5], speed: [12, 40] }],
  },
  newyear: {
    label: "New Year's", accent: '#c9a227',
    light: ['#faf6ea', '#efe3c0', '#d9cdea'], dark: ['#0a0a12', '#17142a', '#2a2140'],
    blobs: ['#e8c040', '#8a6fd0', '#f0e0a0'],
    actors: ['fireworks'], fire: { dark: ['#ffd65a', '#fff4d0', '#c9a0ff', '#ffffff', '#ff9a5a'], light: ['#c99a18', '#8a5fd0', '#d86a2a', '#b0892a'] },
    bits: [{ kind: 'confetti', n: 22, colors: ['#e8c040', '#f4f0e0', '#c0c4d0', '#b08ae0'], size: [5, 11], speed: [26, 70] }, { kind: 'twinkle', n: 24, colors: ['#fff2c0'], size: [1.2, 3], speed: [0, 0] }],
  },
  valentines: {
    label: "Valentine's Day", accent: '#d6336c',
    light: ['#fdf1f3', '#f9d5dd', '#f0b0c0'], dark: ['#140a0e', '#2c0f1c', '#4a1630'],
    blobs: ['#e8456f', '#f4a0b8', '#b0306a'],
    bits: [{ kind: 'heart', n: 22, colors: ['#e8456f', '#f27a9a', '#c2255c', '#f8b4c8'], size: [9, 22], speed: [16, 40] }, { kind: 'heart', n: 14, colors: ['#e8456f', '#f27a9a', '#f8b4c8'], size: [7, 16], speed: [10, 26], rise: true }],
  },
  stpatricks: {
    label: "St. Patrick's Day", accent: '#2b8a3e',
    light: ['#f2faf0', '#d6efd2', '#b4dfae'], dark: ['#08120a', '#0f2a16', '#1c4424'],
    blobs: ['#2f9e44', '#8ad08a', '#e0c040'],
    actors: ['leprechaun'],
    bits: [{ kind: 'clover', n: 26, colors: ['#2f9e44', '#37b24d', '#1e7a34', '#74c080'], size: [8, 18], speed: [12, 30] }],
  },
  easter: {
    label: 'Easter', accent: '#9c6ade',
    light: ['#fbf6fd', '#e8e0fa', '#d6f0e4'], dark: ['#100c16', '#1e1830', '#16302a'],
    blobs: ['#c8a8f0', '#f8c8d8', '#a8e0c8'],
    actors: ['cross', 'bunny'],
    bits: [{ kind: 'petal', n: 34, colors: ['#f8c8d8', '#e0c8f8', '#c8ecd8', '#fbe8a8', '#ffffff'], size: [7, 15], speed: [14, 34] }],
  },
  spring: {
    label: 'Spring', accent: '#d6608c',
    light: ['#f6fbf2', '#e0f2dc', '#f6d8e2'], dark: ['#0b120c', '#14281a', '#30182a'],
    blobs: ['#f4a8c0', '#9cd89c', '#f8e8a0'],
    bits: [{ kind: 'petal', n: 36, colors: ['#f8b8cc', '#fbd4e0', '#ffffff', '#f49ab8'], size: [7, 15], speed: [14, 36] }],
  },
  july4: {
    label: 'Fourth of July', accent: '#2f5fb8',
    light: ['#f6f8fc', '#dde6f6', '#f4d8d8'], dark: ['#080a14', '#101a38', '#3a1218'],
    blobs: ['#c8303a', '#2f5fb8', '#f0f0f8'],
    actors: ['fireworks'], fire: { dark: ['#ff4d5a', '#ffffff', '#5a8cff', '#ffd0d0'], light: ['#d83a44', '#3a6ad0', '#b02a34', '#2a4fa8'] },
    bits: [{ kind: 'confetti', n: 18, colors: ['#d83a44', '#ffffff', '#3a6ad0'], size: [5, 11], speed: [24, 64] }, { kind: 'twinkle', n: 26, colors: ['#ffffff', '#ffd0d0', '#c8d8ff'], size: [1.2, 3], speed: [0, 0] }],
  },
  summer: {
    label: 'Summer', accent: '#e08a1e',
    light: ['#fdf8e8', '#fbe6b0', '#bfe4ee'], dark: ['#070d14', '#0e2230', '#1c3a2c'],
    blobs: ['#f8c040', '#40b0d0', '#f08a50'],
    bits: [{ kind: 'glow', n: 30, colors: ['#ffe27a', '#d8f08a'], size: [2, 4.5], speed: [4, 12] }],
  },
  // Still colourways: a quiet blend of colours, with nothing moving and no characters.
  midnight: { label: 'Midnight', accent: '#5b8def', flat: true, light: ['#eef2fb', '#d9e3f7', '#c2cfee'], dark: ['#070a14', '#0f1730', '#1b2450'], blobs: ['#3a5fd0', '#6a4fd8', '#1a2a60'], bits: [] },
  aurora: { label: 'Aurora', accent: '#2fbfa5', flat: true, light: ['#eefaf6', '#d3f0e8', '#dcd9f5'], dark: ['#06120f', '#0d2a2a', '#2a1f4a'], blobs: ['#2fbfa5', '#7a5fe0', '#1f6a8a'], bits: [] },
  sunset: { label: 'Sunset', accent: '#f0784a', flat: true, light: ['#fff3ea', '#ffd9c2', '#f4c6dc'], dark: ['#160a12', '#3a1730', '#5a2a1a'], blobs: ['#f0784a', '#c8408a', '#f2b84e'], bits: [] },
  ocean: { label: 'Ocean', accent: '#2fa4d8', flat: true, light: ['#eef8fc', '#cfeaf6', '#bfdcf0'], dark: ['#04101a', '#0a2a44', '#0f4a5a'], blobs: ['#2fa4d8', '#2a6ad0', '#3fd0c0'], bits: [] },
  forest: { label: 'Forest', accent: '#3fa66b', flat: true, light: ['#f1f8f1', '#d6ecd8', '#c9dcc0'], dark: ['#07110a', '#12281a', '#243a1c'], blobs: ['#3fa66b', '#8ab84a', '#1f6a4c'], bits: [] },
  rose: { label: 'Rose', accent: '#d8628a', flat: true, light: ['#fdf1f4', '#f8d8e2', '#ecd0ea'], dark: ['#150a10', '#34162a', '#4a2238'], blobs: ['#d8628a', '#a85ad0', '#f09a8a'], bits: [] },
  lavender: { label: 'Lavender', accent: '#8f7ae8', flat: true, light: ['#f5f2fd', '#e2dbf8', '#d3dcf5'], dark: ['#0c0a18', '#1e1a3c', '#2c2a58'], blobs: ['#8f7ae8', '#5a8ae0', '#c07ae0'], bits: [] },
  sand: { label: 'Sand', accent: '#c08a4a', flat: true, light: ['#faf5ec', '#efe2cc', '#e2ceb0'], dark: ['#120e0a', '#2a2016', '#3e2e1e'], blobs: ['#c08a4a', '#a8683a', '#d8b878'], bits: [] },
  slate: { label: 'Slate', accent: '#6f8fb8', flat: true, light: ['#f3f5f8', '#e1e6ec', '#cfd6df'], dark: ['#0b0d11', '#181c24', '#262c38'], blobs: ['#6f8fb8', '#4a5a78', '#8a94a6'], bits: [] },
  ember: { label: 'Ember', accent: '#e05a3a', flat: true, light: ['#fdf1ec', '#f6d6c8', '#eec0a8'], dark: ['#140806', '#34120c', '#521c10'], blobs: ['#e05a3a', '#b02a2a', '#f09a3a'], bits: [] },
};

/** The still colourways, for building a menu of them. */
export const COLORWAYS = Object.keys(THEMES).filter((id) => THEMES[id].flat);

// Whether a colour is dark enough to need light text on it.
const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
const HEX = /^#[0-9a-f]{6}$/i;

/** Easter Sunday for a year (Gregorian computus). */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

/** Which theme fits a date: a holiday when one is near, otherwise the season. */
export function themeFor(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const day = new Date(y, m - 1, d).getTime(), DAY = 86400000;
  // Thanksgiving is the fourth Thursday of November.
  const nov1 = new Date(y, 10, 1).getDay();
  const thanksgiving = 1 + ((4 - nov1 + 7) % 7) + 21;
  const e = easter(y).getTime();
  if ((m === 12 && d === 31) || (m === 1 && d <= 2)) return 'newyear';
  if (m === 2 && d >= 7 && d <= 14) return 'valentines';
  if (m === 3 && d >= 11 && d <= 17) return 'stpatricks';
  if (day >= e - 7 * DAY && day <= e) return 'easter';
  if (m === 7 && d <= 4) return 'july4';
  if (m === 10 && d >= 18) return 'halloween';
  if (m === 11 && d <= thanksgiving) return 'thanksgiving';
  if ((m === 11 && d > thanksgiving) || (m === 12 && d <= 26)) return 'christmas';
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

const MAPLE = [[0, -1], [0.18, -0.55], [0.5, -0.72], [0.42, -0.3], [0.95, -0.28], [0.62, 0.05], [0.76, 0.4], [0.3, 0.3], [0.1, 0.62], [0, 0.34]];
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const DRAW = {
  leaf(c, p) {
    c.beginPath(); c.moveTo(0, -1); c.bezierCurveTo(0.95, -0.55, 0.8, 0.55, 0, 1); c.bezierCurveTo(-0.8, 0.55, -0.95, -0.55, 0, -1); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 0.07; c.beginPath(); c.moveTo(0, -0.85); c.lineTo(0, 1.25); c.stroke();
  },
  maple(c) {
    c.beginPath(); c.moveTo(MAPLE[0][0], MAPLE[0][1]);
    for (const [x, y] of MAPLE.slice(1)) c.lineTo(x, y);
    for (const [x, y] of [...MAPLE].reverse().slice(1)) c.lineTo(-x, y);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 0.06; c.beginPath(); c.moveTo(0, -0.6); c.lineTo(0, 1.1); c.stroke();
  },
  petal(c) { c.beginPath(); c.moveTo(0, -1); c.bezierCurveTo(0.9, -0.3, 0.6, 0.9, 0, 1); c.bezierCurveTo(-0.6, 0.9, -0.9, -0.3, 0, -1); c.fill(); },
  heart(c) { c.beginPath(); c.moveTo(0, 0.9); c.bezierCurveTo(-1.3, -0.1, -0.7, -1.1, 0, -0.4); c.bezierCurveTo(0.7, -1.1, 1.3, -0.1, 0, 0.9); c.fill(); },
  clover(c) {
    for (const a of [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) { c.beginPath(); c.arc(Math.cos(a) * 0.5, Math.sin(a) * 0.5 - 0.1, 0.5, 0, 6.3); c.fill(); }
    c.strokeStyle = c.fillStyle; c.lineWidth = 0.14; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(0.1, 0.7, 0.35, 1.1); c.stroke();
  },
  confetti(c) { c.fillRect(-0.6, -1, 1.2, 2); },
  snow(c) { c.beginPath(); c.arc(0, 0, 1, 0, 6.3); c.fill(); },
};
// Shapes that tumble as they fall (drawn with a sideways flip).
const TUMBLES = new Set(['leaf', 'maple', 'petal', 'confetti', 'heart']);

// ---- Characters, drawn on a layer in front of the page, and fireworks, drawn behind it ----
// Each figure is drawn around its feet at (0, 0), facing right, about 100 units tall.
const E = (c, x, y, rx, ry, fill, rot = 0) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, 6.3); c.fillStyle = fill; c.fill(); };
const L = (c, x1, y1, x2, y2, width, color) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineWidth = width; c.lineCap = 'round'; c.strokeStyle = color; c.stroke(); };
const P = (c, pts, fill) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) c.lineTo(x, y); c.closePath(); c.fillStyle = fill; c.fill(); };
const R = (c, x, y, w, h, fill) => { c.fillStyle = fill; c.fillRect(x, y, w, h); };
const star = (c, x, y, r, fill) => P(c, Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * 0.45 : r; return [x + Math.cos(a) * q, y + Math.sin(a) * q]; }), fill);

// Where the pointer is and how fast it is moving, on a computer. The falling leaves and snow
// are blown aside as it passes, the whole scene shifts a little with it so near things move
// more than far ones, and the holiday characters hop when it comes close to them.
const POINTER = { x: -9999, y: -9999, vx: 0, vy: 0, at: 0 };
if (typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  addEventListener('pointermove', (e) => {
    const now = performance.now(), dt = Math.max(8, now - POINTER.at);
    if (POINTER.at) { POINTER.vx = ((e.clientX - POINTER.x) / dt) * 1000; POINTER.vy = ((e.clientY - POINTER.y) / dt) * 1000; }
    POINTER.x = e.clientX; POINTER.y = e.clientY; POINTER.at = now;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { POINTER.x = POINTER.y = -9999; POINTER.vx = POINTER.vy = 0; });
}

// ---- The place each scene is set in -------------------------------------------------
// Behind the falling leaves or snow, every holiday and season now has a landscape: a sun or
// moon, stars at night, three ranges of hills fading into the distance, and something of its
// own on them (pines in the snow, a bare tree and bats, a city skyline, a rainbow). It is
// drawn faintly along the bottom of the back layer, so it shows through the glass panels and
// round the edges without competing with the figures on the page.
//   body: 'sun' | 'moon' | null, at: where it sits (fractions of the width and height). Not every scene
//   has one: where fireworks or a rainbow already fill the sky, or there are no figures (Valentine's Day,
//   which also has no hills: hills: false), it is left out so the scenes don't all look alike.
//   tint: the hills' colour, [light look, dark look]; extra: what stands on them
const LAND = {
  thanksgiving: { body: 'sun', at: [0.8, 0.7], glow: '#ffb347', tint: ['#b5651d', '#7a3d16'], extra: 'trees', treeCount: 22, treeSize: 2.1, leaves: ['#d9622b', '#e8a02c', '#b8321e'] },
  autumn: { body: 'sun', at: [0.74, 0.62], glow: '#ffc56b', tint: ['#b5651d', '#6e3a18'], extra: 'trees', treeCount: 22, treeSize: 2.1, leaves: ['#d9622b', '#e8a02c', '#b8321e'] },
  halloween: { body: 'moon', at: [0.8, 0.22], glow: '#ffd98a', tint: ['#5a3d7a', '#1c1028'], extra: 'spooky', house: true, stars: true },
  christmas: { body: 'moon', at: [0.82, 0.18], glow: '#dfeaff', tint: ['#ffffff', '#cfe0f5'], extra: 'pines', stars: true, snowy: true },
  winter: { body: 'moon', at: [0.2, 0.2], glow: '#dfeaff', tint: ['#ffffff', '#c5d6ea'], extra: 'pines', stars: true, snowy: true },
  newyear: { body: 'moon', at: [0.14, 0.16], glow: '#fff3c4', tint: ['#3a3f6a', '#10122a'], extra: 'skyline', stars: true },
  valentines: { body: null, hills: false, at: [0.8, 0.2], glow: '#ffc2d6', tint: ['#d8628a', '#5a1a34'], extra: 'none', stars: true },
  stpatricks: { body: null, at: [0.2, 0.3], glow: '#fff2a8', tint: ['#3fa66b', '#17502c'], extra: 'none' },
  easter: { body: 'sun', at: [0.5, 0.86], glow: '#ffe08a', tint: ['#7cc58a', '#2a5a3a'], extra: 'rays' },
  // Spring is a sunny day whatever the look: a blue sky with drifting clouds, blossom trees and flowers in bloom.
  spring: { body: 'sun', at: [0.85, 0.2], glow: '#fff3a0', sky: ['#2f7fd0', '#6fb4ec', '#c4e6fb'], clouds: true, flowers: true, tint: ['#62c06c', '#3f9f52'], extra: 'trees', treeCount: 13, treeSize: 1.9, leaves: ['#f6a6c6', '#ffd3e2', '#ffffff'] },
  july4: { body: 'moon', at: [0.86, 0.16], glow: '#e6ecff', tint: ['#2f3f7a', '#0d1230'], extra: 'skyline', stars: true },
  summer: { body: 'sun', at: [0.8, 0.22], glow: '#ffe27a', tint: ['#4fae6a', '#1c4a34'], extra: 'trees', leaves: ['#3f9a55', '#57b06a', '#2f7f48'] },
};
// The same "random" number for the same n every time, so stars and trees don't jump about between frames.
const fixed = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

function landscape(view, c) {
  const land = LAND[view.themeId];
  if (!land) return;
  const { w, h } = view, t = view.t || 0, dark = view.isDark, px = view.px || 0, py = view.py || 0;
  const unit = Math.min(w, h);
  c.save();
  // A daytime sky, where the scene has one, painted over the colour wash behind.
  if (land.sky) {
    const blue = c.createLinearGradient(0, 0, 0, h);
    land.sky.forEach((col, i) => blue.addColorStop(i / (land.sky.length - 1), col));
    c.globalAlpha = 1; c.fillStyle = blue; c.fillRect(0, 0, w, h);
  }
  // Stars, at night only.
  if (land.stars && dark) {
    for (let i = 0; i < 90; i++) {
      const x = fixed(i) * w - px * 8, y = fixed(i + 200) * h * 0.66 - py * 5, r = 0.5 + fixed(i + 400) * 1.3;
      c.globalAlpha = 0.25 + 0.6 * Math.abs(Math.sin(t * (0.4 + fixed(i + 600)) + i));
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r, 0, 6.3); c.fill();
    }
  }
  // The sun or moon, with its glow. It moves least of all as the scene shifts, being furthest away.
  const bx = land.at[0] * w - px * 6, by = land.at[1] * h - py * 4, br = unit * (land.body === 'sun' ? 0.07 : 0.05);
  const halo = c.createRadialGradient(bx, by, br * 0.4, bx, by, br * (land.body === 'sun' ? 6 : 4.5));
  halo.addColorStop(0, land.glow); halo.addColorStop(1, 'transparent');
  if (land.body) {
    c.globalAlpha = (land.sky ? 0.85 : dark ? 0.34 : 0.5) * (0.92 + 0.08 * Math.sin(t * 0.7));
    c.fillStyle = halo; c.beginPath(); c.arc(bx, by, br * 6, 0, 6.3); c.fill();
  }
  if (land.extra === 'rays') {
    // Sunrise: slow beams turning behind the hills.
    c.globalAlpha = dark ? 0.07 : 0.16; c.fillStyle = land.glow;
    for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283 + t * 0.03; c.beginPath(); c.moveTo(bx, by); c.arc(bx, by, unit * 1.2, a, a + 0.13); c.closePath(); c.fill(); }
  }
  c.globalAlpha = land.sky ? 1 : land.body === 'sun' ? (dark ? 0.6 : 0.7) : dark ? 0.85 : 0.75;
  c.fillStyle = land.body === 'sun' ? land.glow : dark ? '#f4f1e4' : '#ffffff';
  if (land.body) { c.beginPath(); c.arc(bx, by, br, 0, 6.3); c.fill(); }
  if (land.body === 'moon') {
    c.globalAlpha = dark ? 0.16 : 0.1; c.fillStyle = '#8a8fa8';
    for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.3], [-0.1, 0.4, 0.16], [0.35, -0.4, 0.12]]) { c.beginPath(); c.arc(bx + dx * br, by + dy * br, r * br, 0, 6.3); c.fill(); }
  }
  if (land.clouds) {
    // Fair-weather clouds, sailing across the whole sky from left to right and coming round again.
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 7; i++) {
      const span = w + 320, k = unit * (0.045 + 0.05 * fixed(i + 73));
      const x = ((fixed(i + 70) * span + t * (15 + 9 * fixed(i + 71))) % span) - 160 - px * (10 + 10 * fixed(i + 74));
      const y = h * (0.07 + 0.34 * fixed(i + 72)) - py * 6;
      c.globalAlpha = 0.8 + 0.18 * fixed(i + 75);
      for (const [dx, dy, r] of [[-1.5, 0.15, 0.7], [-0.7, -0.3, 0.95], [0.3, -0.45, 1.1], [1.2, -0.1, 0.85], [1.9, 0.2, 0.6], [0.2, 0.25, 1]]) { c.beginPath(); c.arc(x + dx * k, y + dy * k, r * k, 0, 6.3); c.fill(); }
    }
  }
  if (land.extra === 'rainbow') {
    const cx = w * 0.62 - px * 10, cy = h * 0.98, R0 = unit * 0.62;
    c.lineWidth = unit * 0.014; c.globalAlpha = dark ? 0.2 : 0.34;
    ['#e8554e', '#f0913a', '#f2c94c', '#4fb06a', '#4a93ea', '#8f7ae8'].forEach((col, i) => { c.strokeStyle = col; c.beginPath(); c.arc(cx, cy, R0 - i * unit * 0.014, Math.PI, 0); c.stroke(); });
  }
  if (land.extra === 'spooky' ) {
    // Bats crossing the moon.
    c.globalAlpha = dark ? 0.7 : 0.4; c.fillStyle = dark ? '#0a0610' : '#3a2a4a';
    for (let i = 0; i < 5; i++) {
      const x = ((fixed(i + 40) * w + t * (22 + i * 9)) % (w + 80)) - 40, y = h * (0.14 + 0.2 * fixed(i + 50)) + Math.sin(t * 1.6 + i) * 10, k = 5 + fixed(i + 60) * 5, flap = Math.sin(t * 11 + i * 2) * 0.55;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - k, y - k * (0.8 + flap), x - k * 2.2, y - k * 0.1 * flap); c.quadraticCurveTo(x - k, y + k * 0.2, x, y + k * 0.5);
      c.quadraticCurveTo(x + k, y + k * 0.2, x + k * 2.2, y - k * 0.1 * flap); c.quadraticCurveTo(x + k, y - k * (0.8 + flap), x, y); c.fill();
    }
  }
  if (land.hills === false) { c.restore(); return; }
  // Three ranges of hills. The nearest is the most solid and shifts the most with the pointer.
  const tint = land.tint[dark ? 1 : 0];
  const wash = view.theme && (dark ? view.theme.dark : view.theme.light);
  const ground = land.sky ? land.sky[land.sky.length - 1] : wash && wash.length ? wash[wash.length - 1] : null;
  const ridge = (i, x) => h * (0.8 + 0.055 * i) + Math.sin(x * 0.0042 * (1 + i * 0.35) + i * 2.1) * h * 0.034 + Math.sin(x * 0.011 + i * 5.3) * h * 0.012;
  for (let i = 0; i < 3; i++) {
    const shift = px * (12 + 16 * i);
    c.globalAlpha = (land.sky ? [0.78, 0.9, 1] : dark ? [0.3, 0.46, 0.66] : [0.22, 0.34, 0.5])[i];
    c.fillStyle = tint;
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w + 16; x += 16) c.lineTo(x, ridge(i, x + shift) - py * (4 + 5 * i));
    c.lineTo(w, h); c.closePath();
    // The farthest range is first filled solid in the sky's own lowest colour, so the ground hides
    // whatever is behind it: a sun on the horizon sinks behind the hills instead of showing through.
    if (i === 0 && ground) { const keep = c.globalAlpha; c.globalAlpha = 1; c.fillStyle = ground; c.fill(); c.globalAlpha = keep; c.fillStyle = tint; }
    c.fill();
    if (i === 2 && land.flowers) {
      // Flowers in bloom across the nearest hill, nodding a little.
      const colours = ['#ff6fa3', '#ffd84a', '#ffffff', '#c58bff', '#ff8a4a'];
      for (let n = 0; n < 34; n++) {
        const span = w + 60, x = ((fixed(n + 90) * span - shift) % span + span) % span - 30;
        const y = ridge(2, x + shift) - py * 14 + unit * (0.014 + 0.05 * fixed(n + 91)), k = unit * (0.009 + 0.006 * fixed(n + 92));
        const fx = x + Math.sin(t * 1.2 + n) * k * 0.3, fy = y - k * 2.6;
        c.globalAlpha = 1; c.strokeStyle = '#2f8a45'; c.lineWidth = k * 0.35; c.beginPath(); c.moveTo(x, y); c.lineTo(fx, fy); c.stroke();
        c.fillStyle = colours[n % colours.length];
        for (let q = 0; q < 5; q++) { c.beginPath(); c.arc(fx + Math.cos(q * 1.257) * k * 0.75, fy + Math.sin(q * 1.257) * k * 0.75, k * 0.62, 0, 6.3); c.fill(); }
        c.fillStyle = '#ffcc33'; c.beginPath(); c.arc(fx, fy, k * 0.5, 0, 6.3); c.fill();
      }
    }
    if (i !== 1) continue;
    // What stands on the middle range.
    const groundAt = (x) => ridge(1, x + shift) - py * 9;
    if (land.extra === 'pines') {
      for (let n = 0; n < 16; n++) {
        const x = ((fixed(n + 10) * (w + 120) - shift) % (w + 120) + (w + 120)) % (w + 120) - 60, y = groundAt(x) + 3, k = unit * (0.028 + 0.03 * fixed(n + 20));
        c.globalAlpha = dark ? 0.6 : 0.42; c.fillStyle = dark ? '#16382c' : '#2f6b4f';
        for (let tier = 0; tier < 3; tier++) { const ty = y - k * (0.5 + tier * 0.62), half = k * (0.62 - tier * 0.15); c.beginPath(); c.moveTo(x - half, ty); c.lineTo(x + half, ty); c.lineTo(x, ty - k * 0.9); c.closePath(); c.fill(); }
        c.fillStyle = '#ffffff'; c.globalAlpha = dark ? 0.5 : 0.75;
        for (let tier = 0; tier < 3; tier++) { const ty = y - k * (0.5 + tier * 0.62), half = k * (0.62 - tier * 0.15); c.beginPath(); c.moveTo(x - half * 0.5, ty - k * 0.45); c.lineTo(x + half * 0.5, ty - k * 0.45); c.lineTo(x, ty - k * 0.9); c.closePath(); c.fill(); }
      }
    } else if (land.extra === 'trees') {
      const bold = land.sky ? 1 : land.treeSize ? 0.88 : 0;
      for (let n = 0; n < (land.treeCount || 12); n++) {
        const x = ((fixed(n + 10) * (w + 120) - shift) % (w + 120) + (w + 120)) % (w + 120) - 60, y = groundAt(x) + 3, k = unit * (0.022 + 0.024 * fixed(n + 20)) * (land.treeSize || 1);
        c.globalAlpha = bold || (dark ? 0.5 : 0.45); c.fillStyle = dark ? '#2a1a10' : '#6b4526'; c.fillRect(x - k * 0.09, y - k * 0.9, k * 0.18, k * 0.9);
        c.globalAlpha = bold || (dark ? 0.55 : 0.6);
        for (const [dx, dy, r, ci] of [[0, -1.25, 0.62, 0], [-0.42, -0.95, 0.46, 1], [0.44, -1, 0.48, 2]]) { c.fillStyle = land.leaves[(ci + n) % land.leaves.length]; c.beginPath(); c.arc(x + dx * k + Math.sin(t * 0.8 + n) * k * 0.02, y + dy * k, r * k, 0, 6.3); c.fill(); }
      }
    } else if (land.extra === 'spooky') {
      // One bare tree, leaning.
      const x = w * 0.4 - shift * 0.5, y = groundAt(x) + 4, k = unit * 0.2;
      c.globalAlpha = dark ? 0.8 : 0.5; c.strokeStyle = dark ? '#0a0610' : '#3a2a4a'; c.lineCap = 'round';
      const branch = (x0, y0, a, len, wide, depth) => {
        const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
        c.lineWidth = wide; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        if (depth > 0) { branch(x1, y1, a - 0.5 - 0.1 * depth, len * 0.68, wide * 0.62, depth - 1); branch(x1, y1, a + 0.42, len * 0.72, wide * 0.62, depth - 1); }
      };
      branch(x, y, -1.45, k * 0.5, k * 0.07, 4);
      if (land.house) {
        // A haunted house on the hill: a crooked tower, a chimney, and lights flickering in the windows.
        const hx = w * 0.69 - shift * 0.5, hy = groundAt(hx) + 6, u = unit * 0.21;
        c.globalAlpha = dark ? 0.94 : 0.6; c.fillStyle = dark ? '#0a0610' : '#3a2a4a';
        c.beginPath();
        c.moveTo(hx - u * 0.55, hy); c.lineTo(hx - u * 0.55, hy - u * 0.62); c.lineTo(hx - u * 0.68, hy - u * 0.62); c.lineTo(hx - u * 0.2, hy - u * 1.02); c.lineTo(hx + u * 0.1, hy - u * 0.76);
        c.lineTo(hx + u * 0.1, hy - u * 1.18); c.lineTo(hx + u * 0.02, hy - u * 1.18); c.lineTo(hx + u * 0.27, hy - u * 1.62); c.lineTo(hx + u * 0.52, hy - u * 1.18); c.lineTo(hx + u * 0.44, hy - u * 1.18);
        c.lineTo(hx + u * 0.44, hy - u * 0.5); c.lineTo(hx + u * 0.72, hy - u * 0.5); c.lineTo(hx + u * 0.72, hy); c.closePath(); c.fill();
        c.fillRect(hx - u * 0.46, hy - u * 1.02, u * 0.09, u * 0.32);
        [[-0.42, -0.46, 0.14, 0.2], [-0.15, -0.46, 0.14, 0.2], [0.2, -1.06, 0.13, 0.2], [0.2, -0.7, 0.13, 0.18], [0.52, -0.36, 0.12, 0.16]].forEach(([dx, dy, ww, wh], n) => {
          c.globalAlpha = (dark ? 0.8 : 0.5) * (0.68 + 0.32 * Math.sin(t * (2 + n * 0.7) + n * 3)); c.fillStyle = '#ffb347'; c.fillRect(hx + dx * u, hy + dy * u, ww * u, wh * u);
        });
        c.globalAlpha = dark ? 0.5 : 0.35; c.fillStyle = '#ffb347'; c.fillRect(hx - u * 0.02, hy - u * 0.26, u * 0.12, u * 0.26);
      }
    } else if (land.extra === 'skyline') {
      // A city along the horizon, with lights in the windows after dark.
      let x = -shift % 40 - 40;
      for (let n = 0; x < w + 40; n++) {
        const bw = unit * (0.03 + 0.035 * fixed(n + 5)), bh = unit * (0.05 + 0.2 * fixed(n + 9) * fixed(n + 13)), top = h * 0.86 - bh - py * 9;
        c.globalAlpha = dark ? 0.72 : 0.4; c.fillStyle = dark ? '#090b1c' : '#2f3f7a'; c.fillRect(x, top, bw, h - top);
        if (dark) {
          c.fillStyle = '#ffd98a';
          for (let wy = top + 6; wy < h * 0.86 - 6; wy += 9) for (let wx = x + 4; wx < x + bw - 5; wx += 8) {
            const id = n * 131 + Math.round(wy) * 7 + Math.round(wx - x);
            if (fixed(id) > 0.58) { c.globalAlpha = 0.25 + 0.4 * Math.abs(Math.sin(t * 0.25 * (0.5 + fixed(id + 1)) + id)); c.fillRect(wx, wy, 3, 4); }
          }
        }
        x += bw + 2;
      }
    }
  }
  c.restore();
}

const FIGURES = {
  turkey(c, t) {
    const step = Math.sin(t * 7) * 8;
    for (const [hip, swing] of [[-5, step], [6, -step]]) { L(c, hip, -18, hip + swing, -1, 3, '#e08a1e'); L(c, hip + swing, -1, hip + swing + 6, -1, 3, '#e08a1e'); }
    c.translate(0, -Math.abs(Math.sin(t * 7)) * 2);
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI * 0.96 + (i * Math.PI * 0.62) / 6 + Math.sin(t * 2) * 0.03;
      E(c, -8 + Math.cos(a) * 30, -38 + Math.sin(a) * 30, 22, 7.5, leafy[i % leafy.length], a);
      E(c, -8 + Math.cos(a) * 46, -38 + Math.sin(a) * 46, 5, 5, '#f6d78a');
    }
    E(c, 0, -34, 24, 20, '#7a4a2a'); E(c, -3, -33, 14, 11, '#5e3620', -0.3);
    L(c, 16, -42, 24, -60, 9, '#7a4a2a'); E(c, 26, -64, 8.5, 8.5, '#8a5632');
    P(c, [[33, -67], [43, -63], [33, -60]], '#f0a830'); E(c, 31, -55, 3, 6, '#d0342c');
    E(c, 28.5, -66, 2.6, 2.6, '#fff'); E(c, 29.2, -66, 1.4, 1.4, '#111');
  },
  // A wooden cross on a small hill at sunrise, draped with a white cloth, with words arched behind it.
  cross(c, t, dark) {
    const glow = c.createRadialGradient(0, -58, 6, 0, -58, 96);
    glow.addColorStop(0, `rgba(255,236,170,${0.55 + 0.08 * Math.sin(t * 1.3)})`); glow.addColorStop(1, 'rgba(255,236,170,0)');
    c.fillStyle = glow; c.beginPath(); c.arc(0, -58, 96, 0, 6.3); c.fill();
    // Rays of light fanning out behind.
    c.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI + (i + 0.5) * (Math.PI / 9);
      c.globalAlpha = 0.16 + 0.1 * Math.sin(t * 1.6 + i);
      L(c, Math.cos(a) * 30, -58 + Math.sin(a) * 30, Math.cos(a) * 62, -58 + Math.sin(a) * 62, 3, '#ffe9a8');
    }
    c.globalAlpha = 1;
    // The words, one letter at a time along an arc over the cross.
    const words = 'He has risen', span = 2.05, r = 84;
    c.font = "italic 600 17px Georgia, 'Times New Roman', serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = dark ? '#fbe6ae' : '#7a4f14';
    if (dark) { c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 4; }
    [...words].forEach((ch, i) => {
      const a = -Math.PI / 2 - span / 2 + (i / (words.length - 1)) * span;
      c.save(); c.translate(Math.cos(a) * r, -52 + Math.sin(a) * r); c.rotate(a + Math.PI / 2); c.fillText(ch, 0, 0); c.restore();
    });
    c.shadowBlur = 0;
    // The hill, then the cross standing on it.
    E(c, 0, 2, 58, 14, '#4f9a4a'); E(c, -18, 0, 26, 9, '#62ad56');
    R(c, -5, -100, 10, 100, '#7a4a2a'); R(c, -26, -78, 52, 10, '#7a4a2a');
    R(c, -5, -100, 3, 100, '#8f5a36'); R(c, -26, -78, 52, 3, '#8f5a36');
    // The cloth, hung over the arms and swaying a little.
    const sway = Math.sin(t * 1.4) * 2;
    c.beginPath(); c.moveTo(-24, -76); c.quadraticCurveTo(-12, -52 + sway, 0, -70); c.quadraticCurveTo(12, -52 - sway, 24, -76);
    c.lineWidth = 6; c.strokeStyle = '#ffffff'; c.stroke();
    L(c, -24, -76, -26 + sway * 0.4, -52, 5, '#ffffff'); L(c, 24, -76, 26 + sway * 0.4, -50, 5, '#ffffff');
  },
  // A table laid with a roast turkey, steam rising from it.
  feast(c, t) {
    R(c, -31, -30, 6, 30, '#6b4526'); R(c, 25, -30, 6, 30, '#6b4526');
    R(c, -36, -36, 72, 7, '#8a5a32');
    P(c, [[-33, -36], [33, -36], [33, -24], [22, -19], [11, -24], [0, -19], [-11, -24], [-22, -19], [-33, -24]], '#f3e6cf');
    L(c, -33, -35, 33, -35, 2, '#c8501e');
    // A white platter with a scalloped rim.
    E(c, 0, -39, 28, 4.8, '#dcdce4'); for (let x = -26; x <= 26; x += 4.3) E(c, x, -38.2 + Math.abs(x) * 0.012, 2.3, 1.6, '#ececf2');
    E(c, 0, -40, 24, 3.4, '#fafafc');
    // Greens and fruit tucked round the bird.
    E(c, -21, -42, 5, 2, '#3f8f4f', -0.5); E(c, -18, -41, 4.5, 1.8, '#5aa860', 0.3); E(c, 21, -42, 5, 2, '#3f8f4f', 0.5); E(c, 18, -40.6, 4.2, 1.7, '#5aa860', -0.3);
    E(c, -23, -40.4, 2.6, 2.2, '#f2c94c'); E(c, 23.5, -40.4, 2.4, 2, '#e8743a'); E(c, 14, -39.6, 2, 1.8, '#c0392b'); E(c, -13, -39.4, 2, 1.7, '#c0392b');
    // The roast turkey, as it comes to the table: a plump, glossy breast, the wing folded against
    // its side and both drumsticks tucked up in front, each ending in a small rounded knuckle.
    const bird = (draw, fill) => { c.beginPath(); draw(); c.closePath(); c.fillStyle = fill; c.fill(); };
    const body = () => { c.moveTo(-15, -41); c.bezierCurveTo(-21, -47, -15, -62, 1, -65); c.bezierCurveTo(14, -66, 23, -56, 21, -46); c.bezierCurveTo(20.5, -42.5, 17, -40.6, 12, -40.4); c.lineTo(-10, -40.4); c.bezierCurveTo(-12, -40.4, -14, -40.6, -15, -41); };
    const roast = c.createLinearGradient(0, -66, 0, -40);
    roast.addColorStop(0, '#e2a04a'); roast.addColorStop(0.45, '#c97a2a'); roast.addColorStop(1, '#98501a');
    bird(body, roast);
    c.save(); c.beginPath(); body(); c.clip();
    E(c, 4, -59.5, 10, 3.6, 'rgba(255,225,160,0.5)', -0.18); E(c, 15, -47, 9, 9, 'rgba(90,40,10,0.22)');
    for (const [x, y] of [[-6, -55], [2, -52], [9, -56], [13, -51], [-2, -60], [6, -47], [-9, -49]]) E(c, x, y, 0.7, 0.5, 'rgba(110,55,18,0.5)');
    c.restore();
    // The folded wing.
    bird(() => { c.moveTo(8, -52); c.bezierCurveTo(14, -55, 20, -52, 19.5, -47.5); c.bezierCurveTo(16, -45, 10, -46, 8, -52); }, '#b0651f'); E(c, 14, -51, 3.6, 1.2, 'rgba(255,215,150,0.4)', 0.15);
    // The far drumstick, then the near one in front of it.
    const leg = (dx, dy, fill, tip) => {
      bird(() => { c.moveTo(-16 + dx, -60 + dy); c.bezierCurveTo(-11 + dx, -60 + dy, -1 + dx, -55 + dy, 0 + dx, -47 + dy); c.bezierCurveTo(0 + dx, -42 + dy, -10 + dx, -40.5 + dy, -14 + dx, -45 + dy); c.bezierCurveTo(-17 + dx, -49 + dy, -19 + dx, -55 + dy, -16 + dx, -60 + dy); }, fill);
      E(c, -16.6 + dx, -60.6 + dy, 2.5, 2.1, tip, -0.5); E(c, -7 + dx, -51 + dy, 4.5, 1.6, 'rgba(255,220,155,0.42)', 0.75);
    };
    leg(-5, 3.6, '#a55a1c', '#c98d4e'); leg(0, 0, '#c4762a', '#dfa862');
    c.lineCap = 'round'; c.lineWidth = 2; c.strokeStyle = '#ffffff';
    for (let i = 0; i < 3; i++) {
      const rise = (t * 0.5 + i / 3) % 1, x = -9 + i * 9;
      c.globalAlpha = 0.5 * Math.sin(rise * Math.PI);
      c.beginPath(); c.moveTo(x, -62 - rise * 18); c.quadraticCurveTo(x + 5, -68 - rise * 18, x, -74 - rise * 18); c.stroke();
    }
    c.globalAlpha = 1;
  },
  // A horn of plenty on its side, spilling fruit and small pumpkins.
  cornucopia(c) {
    c.beginPath(); c.moveTo(4, -2); c.quadraticCurveTo(-26, -2, -40, -26); c.quadraticCurveTo(-42, -34, -36, -36); c.quadraticCurveTo(-20, -28, 2, -30); c.closePath(); c.fillStyle = '#b9824a'; c.fill();
    c.lineWidth = 2; c.strokeStyle = '#8a5a32'; c.lineCap = 'round';
    for (const [x1, y1, x2, y2] of [[-8, -4, -10, -29], [-18, -8, -22, -29], [-27, -15, -31, -31]]) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
    E(c, 2, -16, 7, 14.5, '#5e3620');
    E(c, 6, -24, 6, 8, '#e8c040', 0.3); E(c, 4, -31, 2, 3, '#e8c040', 0.3);
    for (const [x, y] of [[20, -20], [25, -22], [22.5, -16], [27.5, -17], [25, -12]]) E(c, x, y, 3.2, 3.2, '#6a3a8a');
    E(c, 13, -9, 10, 8, '#f08024'); E(c, 9, -9, 5, 7.5, '#d9641a'); E(c, 17, -9, 5, 7.5, '#d9641a'); R(c, 12, -19, 2.5, 4, '#4a7a2a');
    E(c, 30, -6, 6.5, 6.5, '#d0342c'); L(c, 30, -12, 31, -15, 1.6, '#6b4526'); E(c, 33.5, -14.5, 3, 1.6, '#3a9a4a', -0.5);
    E(c, 41, -5, 7, 5.5, '#f0a830'); E(c, 41, -5, 3, 5, '#e08a1e'); R(c, 40, -12, 2, 3, '#4a7a2a');
    E(c, 3, -5, 6, 3, '#3a9a4a', -0.4);
  },
  // A person, drawn with a person's proportions: a head about a seventh of the height, a neck,
  // shoulders, a coat that tapers to the waist and flares at the hem, arms that bend at the
  // elbow, trousers and shoes. Santa, the leprechaun and the two at the Thanksgiving table share
  // it and differ in colours, hat, hair, beard and girth (`wide`). Feet stand at y = 0.
  person(c, t, o) {
    const wd = o.wide || 1, skin = o.skin || '#f0c8a0', dark = '#1c1c20';
    const path = (draw, fill) => { c.beginPath(); draw(); c.closePath(); c.fillStyle = fill; c.fill(); };
    // Hair that falls behind the shoulders is drawn first.
    if (o.hair && o.long) path(() => { c.moveTo(-8, -66); c.bezierCurveTo(-12, -58, -11, -46, -9.5, -40); c.lineTo(9.5, -40); c.bezierCurveTo(11, -46, 12, -58, 8, -66); }, o.hair);
    // Legs and shoes.
    for (const side of [-1, 1]) {
      path(() => { c.moveTo(side * 0.6, -27); c.lineTo(side * 8.6 * wd, -27); c.lineTo(side * 7.4, -4); c.lineTo(side * 2, -4); }, o.pants);
      path(() => { c.moveTo(side * 0.8, 0); c.lineTo(side * 11.5, 0); c.quadraticCurveTo(side * 12.5, -4, side * 8, -5.2); c.quadraticCurveTo(side * 4, -6.4, side * 1.4, -4.6); }, dark);
      E(c, side * 8.6, -3.4, 2.2, 0.9, 'rgba(255,255,255,0.22)');
    }
    // The coat: shoulders, a waist, and a hem that flares.
    const coat = () => {
      c.moveTo(-10.5 * wd, -50.5); c.quadraticCurveTo(0, -55, 10.5 * wd, -50.5);
      c.bezierCurveTo(11.5 * wd, -44, 9.6 * wd, -38, 9.4 * wd, -33); c.bezierCurveTo(10 * wd, -28, 12.4 * wd, -24, 13.4 * wd, -19.5);
      c.quadraticCurveTo(0, -16, -13.4 * wd, -19.5); c.bezierCurveTo(-12.4 * wd, -24, -10 * wd, -28, -9.4 * wd, -33); c.bezierCurveTo(-9.6 * wd, -38, -11.5 * wd, -44, -10.5 * wd, -50.5);
    };
    path(coat, o.coat);
    // Light from the upper left: one side of the coat is lit and the other in shade.
    c.save(); c.beginPath(); coat(); c.clip();
    const shade = c.createLinearGradient(-13 * wd, -52, 13 * wd, -18);
    shade.addColorStop(0, 'rgba(255,255,255,0.2)'); shade.addColorStop(0.45, 'rgba(255,255,255,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.28)');
    c.fillStyle = shade; c.fillRect(-20 * wd, -58, 40 * wd, 44);
    L(c, 0, -49, 0, -20, 0.8, 'rgba(0,0,0,0.22)');
    c.restore();
    if (o.trim) { L(c, 0, -49, 0, -21, 3, o.trim); c.beginPath(); c.moveTo(-13 * wd, -20.5); c.quadraticCurveTo(0, -17, 13 * wd, -20.5); c.lineWidth = 4; c.lineCap = 'round'; c.strokeStyle = o.trim; c.stroke(); }
    if (o.fringe) for (let x = -11; x <= 11; x += 2.8) L(c, x * wd, -19.5 + Math.abs(x) * 0.08, x * wd, -15.5, 1.2, o.fringe);
    if (o.belt !== false) { R(c, -9.8 * wd, -35, 19.6 * wd, 4.2, dark); c.strokeStyle = '#f0c030'; c.lineWidth = 1.4; c.strokeRect(-3, -36, 6, 6.2); }
    // The arm at rest hangs with a slight bend; the other waves from the elbow.
    const arm = (sx, sy, ex, ey, hx, hy) => {
      c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = o.coat; c.lineWidth = 5.4;
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.lineTo(hx, hy); c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = 1; c.beginPath(); c.moveTo(sx + 1.6, sy + 1); c.lineTo(ex + 1.6, ey); c.stroke();
      if (o.trim) L(c, hx - (hx - ex) * 0.22, hy - (hy - ey) * 0.22, hx - (hx - ex) * 0.1, hy - (hy - ey) * 0.1, 6.4, o.trim);
      if (o.fringe) for (let i = 0.2; i < 1; i += 0.2) L(c, ex + (hx - ex) * i, ey + (hy - ey) * i, ex + (hx - ex) * i + 0.5, ey + (hy - ey) * i + 3.4, 1, o.fringe);
      const ang = Math.atan2(hy - ey, hx - ex);
      E(c, hx + Math.cos(ang) * 2.4, hy + Math.sin(ang) * 2.4, 3.3, 2.6, o.mitt, ang);
      L(c, hx + Math.cos(ang) * 1.6, hy + Math.sin(ang) * 1.6, hx + Math.cos(ang - 1.1) * 3.6 + Math.cos(ang) * 1.6, hy + Math.sin(ang - 1.1) * 3.6 + Math.sin(ang) * 1.6, 1.5, o.mitt);
    };
    arm(-10 * wd, -49, -13 * wd, -38, -11.5 * wd, -27.5);
    if (o.bag) {
      // A pumpkin pail of sweets, hanging from the hand at rest.
      c.beginPath(); c.arc(-12 * wd, -22.5, 5, Math.PI, 0); c.lineWidth = 1; c.strokeStyle = '#3a2a1a'; c.stroke();
      E(c, -12 * wd, -18, 6.4, 5.4, '#e8701a'); E(c, -14.4 * wd, -18, 2.2, 5, 'rgba(0,0,0,0.12)');
      P(c, [[-14.4, -19.5], [-12.9, -19.5], [-13.6, -17.8]], '#3a1a0a'); P(c, [[-11.1, -19.5], [-9.6, -19.5], [-10.3, -17.8]], '#3a1a0a'); L(c, -14, -15.6, -10, -15.6, 1, '#3a1a0a');
      E(c, -13.5 * wd, -23.6, 1.6, 1.3, '#ff5a8a'); E(c, -10.6 * wd, -23.9, 1.6, 1.3, '#5ab4ff'); E(c, -12 * wd, -24.6, 1.5, 1.3, '#ffd84a');
    }
    const swing = -1.5 + Math.sin(t * 6 + (o.phase || 0)) * 0.42, ex = 10 * wd + 8.5, ey = -53;
    arm(10 * wd, -49, ex, ey, ex + Math.cos(swing) * 11, ey + Math.sin(swing) * 11);
    // Neck, then a wide white collar if they wear one.
    R(c, -2.6, -56.5, 5.2, 6, skin); E(c, 0, -52.4, 2.6, 1.2, 'rgba(0,0,0,0.14)');
    if (o.collar) path(() => { c.moveTo(-10 * wd, -51.5); c.quadraticCurveTo(0, -55.5, 10 * wd, -51.5); c.lineTo(5, -45.5); c.lineTo(0, -50); c.lineTo(-5, -45.5); }, o.collar);
    // The head: ears, a face that narrows to the chin, and a little shade down one side.
    E(c, -7.2, -62.5, 1.6, 2.3, skin); E(c, 7.2, -62.5, 1.6, 2.3, skin);
    const face = () => { c.moveTo(-7, -65); c.bezierCurveTo(-7.4, -72.5, 7.4, -72.5, 7, -65); c.bezierCurveTo(7, -59, 4.2, -54.6, 0, -54.4); c.bezierCurveTo(-4.2, -54.6, -7, -59, -7, -65); };
    path(face, skin);
    c.save(); c.beginPath(); face(); c.clip(); E(c, 6, -61, 5, 9, 'rgba(0,0,0,0.09)'); c.restore();
    if (o.hair) path(() => { c.moveTo(-7.6, -63.5); c.bezierCurveTo(-9, -74.5, 9, -74.5, 7.6, -63.5); c.bezierCurveTo(6.8, -67.5, 3.5, -69.4, 0, -69.2); c.bezierCurveTo(-3.5, -69.4, -6.8, -67.5, -7.6, -63.5); }, o.hair);
    if (o.beard) {
      path(() => { c.moveTo(-7.2, -63); c.bezierCurveTo(-9.5, -54, -5.5, -45.5, 0, -44.5); c.bezierCurveTo(5.5, -45.5, 9.5, -54, 7.2, -63); c.bezierCurveTo(5, -59.4, -5, -59.4, -7.2, -63); }, o.beard);
      path(() => { c.moveTo(0, -60.4); c.bezierCurveTo(-2.4, -62, -6, -60.8, -6.4, -58.6); c.bezierCurveTo(-4, -57.8, -1.4, -58.4, 0, -59.4); c.bezierCurveTo(1.4, -58.4, 4, -57.8, 6.4, -58.6); c.bezierCurveTo(6, -60.8, 2.4, -62, 0, -60.4); }, o.beard);
    } else { c.beginPath(); c.arc(0, -60.2, 2.9, 0.18 * Math.PI, 0.82 * Math.PI); c.lineWidth = 1.1; c.lineCap = 'round'; c.strokeStyle = '#8a4636'; c.stroke(); }
    // Eyes that blink every few seconds, each in their own time; brows, nose and a little colour in the cheeks.
    if ((t + (o.phase || 0) * 1.7) % 4.3 < 0.13) { L(c, -4, -64.2, -2, -64.2, 0.9, '#222'); L(c, 2, -64.2, 4, -64.2, 0.9, '#222'); }
    else { E(c, -3, -64.4, 1, 1.25, '#fff'); E(c, 3, -64.4, 1, 1.25, '#fff'); E(c, -2.9, -64.3, 0.72, 0.95, '#2a2018'); E(c, 3.1, -64.3, 0.72, 0.95, '#2a2018'); }
    L(c, -4.3, -66.5, -1.8, -66.9, 0.7, o.hair || o.beard === '#fff' ? (o.hair || '#d8d8d8') : '#6a4a32'); L(c, 1.8, -66.9, 4.3, -66.5, 0.7, o.hair || o.beard === '#fff' ? (o.hair || '#d8d8d8') : '#6a4a32');
    c.beginPath(); c.moveTo(0.2, -63.6); c.quadraticCurveTo(1.6, -61.4, 0, -61); c.lineWidth = 0.8; c.strokeStyle = 'rgba(120,70,50,0.7)'; c.stroke();
    E(c, -4.6, -61.2, 1.7, 1.1, 'rgba(232,120,120,0.4)'); E(c, 4.6, -61.2, 1.7, 1.1, 'rgba(232,120,120,0.4)');
    // Hats.
    if (o.hat === 'santa') {
      path(() => { c.moveTo(-7.6, -68.5); c.bezierCurveTo(-6, -79, 3, -82, 9, -77); c.bezierCurveTo(13, -74, 14.5, -68, 13.5, -63.5); c.bezierCurveTo(11, -69, 9, -70, 7.6, -68.5); }, o.coat);
      L(c, -7.4, -68.6, 7.4, -68.6, 4.2, '#fff'); E(c, 13.6, -62.6, 3, 3, '#fff');
    } else if (o.hat === 'pilgrim') {
      // A tall black hat with a wide brim and a buckle.
      E(c, 0, -69.4, 12.5, 2.2, '#23232b'); path(() => { c.moveTo(-6.6, -70); c.lineTo(6.6, -70); c.lineTo(5.2, -84); c.lineTo(-5.2, -84); }, '#23232b');
      R(c, -6.4, -74.4, 12.8, 3.4, '#4a4a56'); c.strokeStyle = '#f0c030'; c.lineWidth = 1.2; c.strokeRect(-2.4, -75.4, 4.8, 5.4);
      E(c, -3, -78, 1.2, 5, 'rgba(255,255,255,0.1)');
    } else if (o.hat === 'feather') {
      // A beaded headband with two feathers standing behind it.
      for (const [x, lean, tip] of [[3.4, 0.16, '#c8501e'], [-2.4, -0.1, '#2a7a8a']]) {
        L(c, x, -69, x + lean * 34, -86, 0.8, '#b9a98a'); E(c, x + lean * 24, -79, 2.5, 8, '#fbf6ea', lean); E(c, x + lean * 36, -85.5, 1.9, 3.4, tip, lean);
      }
      L(c, -7.3, -68.2, 7.3, -68.2, 3, '#c8501e'); for (let x = -6; x <= 6; x += 3) E(c, x, -68.2, 0.8, 0.8, x % 6 ? '#f6d78a' : '#2a7a8a');
    } else if (o.hat === 'witch') {
      // A pointed hat with a crooked tip and an orange band.
      E(c, 0, -69.2, 13, 2.4, '#2a1a3a'); path(() => { c.moveTo(-7, -69.6); c.lineTo(7, -69.6); c.quadraticCurveTo(2.5, -80, 7, -92); c.quadraticCurveTo(-3, -82, -7, -69.6); }, '#2a1a3a');
      R(c, -6.6, -73.2, 13.2, 2.8, '#e8701a');
    } else if (o.hat === 'none') { /* bare-headed */ }
    else {
      // The leprechaun's green top hat, with a band and a gold buckle.
      E(c, 0, -69.4, 11.5, 2.2, '#1b6a30'); path(() => { c.moveTo(-6.2, -70); c.lineTo(6.2, -70); c.lineTo(6.8, -84.5); c.lineTo(-6.8, -84.5); }, o.coat);
      R(c, -6.4, -75, 12.8, 3.6, dark); c.strokeStyle = '#f0c030'; c.lineWidth = 1.2; c.strokeRect(-2.4, -76, 4.8, 5.6);
    }
  },
  tree(c, t) {
    R(c, -6, -14, 12, 14, '#6b4526');
    P(c, [[-40, -12], [40, -12], [0, -64]], '#1f7a4c'); P(c, [[-31, -44], [31, -44], [0, -94]], '#248a56'); P(c, [[-22, -76], [22, -76], [0, -120]], '#2a9a60');
    const lights = ['#ffd65a', '#ff5a5a', '#5ab4ff', '#ffffff', '#ff8ad0'];
    [[-22, -20], [-6, -26], [12, -20], [26, -18], [-14, -52], [4, -58], [16, -50], [-8, -84], [7, -88], [0, -40], [-2, -70]].forEach(([x, y], i) => {
      c.globalAlpha = 0.55 + 0.45 * Math.sin(t * 3 + i * 1.7); E(c, x, y, 3.2, 3.2, lights[i % lights.length]);
    });
    c.globalAlpha = 1;
    star(c, 0, -122, 9 + Math.sin(t * 4) * 1.2, '#ffd65a');
  },
  pumpkin(c, t) {
    const flicker = 0.72 + 0.2 * Math.sin(t * 9) + 0.08 * Math.sin(t * 23);
    const glow = c.createRadialGradient(0, -20, 4, 0, -20, 70);
    glow.addColorStop(0, `rgba(255,170,50,${0.42 * flicker})`); glow.addColorStop(1, 'rgba(255,170,50,0)');
    c.fillStyle = glow; c.beginPath(); c.arc(0, -20, 70, 0, 6.3); c.fill();
    R(c, -3, -47, 6, 9, '#4a7a2a');
    E(c, -15, -20, 14, 19, '#d9641a'); E(c, 15, -20, 14, 19, '#d9641a'); E(c, 0, -20, 17, 21, '#f08024');
    const fire = `rgba(255,${Math.round(200 + 30 * flicker)},90,${0.75 + 0.25 * flicker})`;
    P(c, [[-13, -25], [-4, -25], [-8.5, -34]], fire); P(c, [[13, -25], [4, -25], [8.5, -34]], fire); P(c, [[-2.5, -19], [2.5, -19], [0, -23.5]], fire);
    P(c, [[-14, -16], [-9, -12], [-4.5, -16], [0, -12], [4.5, -16], [9, -12], [14, -16], [9, -6], [0, -8.5], [-9, -6]], fire);
  },
  ghost(c, t) {
    c.shadowColor = 'rgba(190,215,255,0.9)'; c.shadowBlur = 16;
    c.beginPath(); c.moveTo(-17, 16); c.lineTo(-17, -6); c.arc(0, -6, 17, Math.PI, 0); c.lineTo(17, 16);
    for (let i = 0; i < 4; i++) { const x = 17 - (i + 1) * 8.5; c.quadraticCurveTo(x + 4.25, 16 + 7 + Math.sin(t * 6 + i) * 3, x, 16); }
    c.closePath(); c.fillStyle = 'rgba(255,255,255,0.92)'; c.fill();
    c.shadowBlur = 0;
    E(c, -6, -7, 3.2, 4.8, '#23232b'); E(c, 6, -7, 3.2, 4.8, '#23232b'); E(c, 0, 3, 3.4, 4.6 + Math.sin(t * 3) * 0.8, '#23232b');
  },
  bunny(c, t, waving) {
    const fur = '#f6f0e6', shade = '#e6dccb';
    E(c, -17, -15, 6.5, 6.5, '#fff'); E(c, -3, -3, 12, 5.5, shade); E(c, 0, -21, 17, 19, fur);
    E(c, 8, -67, 4.2, 14, fur, -0.16); E(c, 8, -66, 2, 9.5, '#f4a8ba', -0.16); E(c, 17, -66, 4.2, 14, fur, 0.22); E(c, 17, -65, 2, 9.5, '#f4a8ba', 0.22);
    E(c, 12, -44, 12.5, 11.5, fur);
    E(c, 16.5, -46.5, 1.9, 2.4, '#23232b'); E(c, 23.5, -42, 2.2, 1.6, '#f29ab0'); E(c, 16, -39.5, 3, 2, 'rgba(244,150,170,0.5)');
    if (waving) { const a = -1.05 + Math.sin(t * 8) * 0.5; L(c, 9, -28, 9 + Math.cos(a) * 15, -28 + Math.sin(a) * 15, 5.5, fur); E(c, 9 + Math.cos(a) * 15, -28 + Math.sin(a) * 15, 3.6, 3.6, fur); }
    else L(c, 9, -26, 17, -20, 5.5, fur);
  },
  pot(c, t) {
    ['#e8483e', '#f0962e', '#f0d040', '#48b060', '#4a8ae0'].forEach((color, i) => {
      c.beginPath(); c.arc(-104, -24, 104 - i * 6, Math.PI, Math.PI * 1.93); c.lineWidth = 6; c.lineCap = 'butt'; c.strokeStyle = color; c.globalAlpha = 0.5; c.stroke();
    });
    c.globalAlpha = 1;
    E(c, -12, -2, 5, 4, '#1c1c20'); E(c, 12, -2, 5, 4, '#1c1c20'); E(c, 0, -19, 25, 18, '#23232b');
    [[-12, -38], [0, -41], [12, -38], [-6, -44], [7, -45], [0, -48]].forEach(([x, y]) => { E(c, x, y, 7, 3.6, '#f0c030'); E(c, x, y - 0.8, 5, 2.2, '#f8e070'); });
    E(c, 0, -35, 26, 5.5, '#34343e');
    [[-10, -50], [9, -53], [1, -58]].forEach(([x, y], i) => { c.globalAlpha = Math.max(0, Math.sin(t * 3.4 + i * 2.1)); star(c, x, y, 4.5, '#fff8d0'); });
    c.globalAlpha = 1;
  },
};

function fireworks(view, c, dt) {
  const st = view.stage, { w, h } = view, k = Math.max(0.6, Math.min(1.25, Math.min(w, h) / 800));
  const colors = view.theme.fire[view.isDark ? 'dark' : 'light'];
  st.next -= dt;
  if (st.next <= 0 && dt > 0) {
    st.next = rand(0.9, 2.2); // a calmer show: about one rocket every second and a half
    // Each rocket goes up in a different third of the sky from the one before (left, right, middle, and
    // round again), so the show always spreads across the screen instead of bunching up by chance.
    st.zone = ((st.zone ?? -1) + 1) % 3;
    const third = [0, 2, 1][st.zone];
    st.rockets.push({ x: rand(w * (0.07 + 0.3 * third), w * (0.33 + 0.3 * third)), y: h, top: rand(h * 0.12, h * 0.52), color: pick(colors) });
  }
  c.globalCompositeOperation = view.isDark ? 'lighter' : 'source-over';
  c.lineCap = 'round';
  st.rockets = st.rockets.filter((r) => {
    r.y -= 560 * k * dt;
    c.globalAlpha = 0.8; c.strokeStyle = r.color; c.lineWidth = 2;
    c.beginPath(); c.moveTo(r.x, r.y + 14); c.lineTo(r.x, r.y); c.stroke();
    if (r.y > r.top) return true;
    const n = Math.round(rand(70, 110)), ring = Math.random() < 0.3, second = pick(colors);
    st.flashes = [...(st.flashes || []), { x: r.x, y: r.y, color: r.color, left: 0.22 }];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rand(-0.05, 0.05), v = (ring ? 250 : rand(70, 310)) * k, life = rand(1.3, 2.1);
      st.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, left: life, color: i % 3 ? r.color : second });
    }
    return false;
  });
  st.sparks = st.sparks.filter((p) => {
    p.left -= dt;
    if (p.left <= 0) return false;
    const drag = Math.pow(0.42, dt);
    p.vx *= drag; p.vy = p.vy * drag + 70 * k * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const fade = p.left / p.life;
    c.globalAlpha = Math.min(1, Math.sqrt(fade) * 1.2) * (view.isDark ? 1 : 0.9);
    c.strokeStyle = p.color; c.lineWidth = 3 * k;
    c.beginPath(); c.moveTo(p.x - p.vx * 0.13, p.y - p.vy * 0.13); c.lineTo(p.x, p.y); c.stroke();
    // A bright head on each spark, which twinkles as it burns out.
    c.globalAlpha *= fade < 0.35 ? 0.4 + 0.6 * Math.abs(Math.sin(p.left * 40 + p.x)) : 1;
    c.fillStyle = view.isDark ? '#fffbe8' : p.color; c.beginPath(); c.arc(p.x, p.y, 1.9 * k, 0, 6.3); c.fill();
    return true;
  });
  st.flashes = (st.flashes || []).filter((f) => {
    f.left -= dt;
    if (f.left <= 0) return false;
    const r = 150 * k * (1.2 - f.left / 0.22), glow = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
    glow.addColorStop(0, f.color); glow.addColorStop(1, 'transparent');
    c.globalAlpha = (f.left / 0.22) * (view.isDark ? 0.55 : 0.3); c.fillStyle = glow; c.beginPath(); c.arc(f.x, f.y, r, 0, 6.3); c.fill();
    return true;
  });
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
}

/**
 * Where the characters stand. With a `stage` attribute (a CSS selector, such as a
 * side menu with empty space at the bottom) they stand at the foot of that
 * element and are drawn larger to suit it. Otherwise they stand at the bottom
 * left of the screen, clear of a round button in the bottom right corner.
 */
function castPlace(view) {
  const { w, h } = view, small = innerWidth < 760;
  const sel = view.getAttribute('stage');
  const el = sel ? document.querySelector(sel) : null;
  const box = el?.getBoundingClientRect();
  if (box && box.width > 120 && box.height > 200) {
    const ground = Math.min(box.bottom, h) - 16;
    // The space under the last thing in the stage (its menu items) is what's free.
    const used = el.lastElementChild ? el.lastElementChild.getBoundingClientRect().bottom : box.top;
    const room = ground - used - 8;
    const s = Math.min(1.35, Math.max(0.9, box.width / 180), room / 118);
    return { s, ground, mid: box.left + box.width / 2, left: box.left + 46 * s, right: box.right - 46 * s, top: used + 20, fits: s >= 0.5, staged: true };
  }
  // character-scale makes the figures bigger or smaller where they stand on their own (the
  // kitchen display uses it; in the Ledger app they are sized by the side menu instead).
  const z = Math.max(0.5, Math.min(3, Number(view.getAttribute('character-scale')) || 1));
  const s = (small ? 0.62 : 0.92) * z;
  return { s, ground: h - (small ? 92 : 12), mid: (small ? 96 : 150) * z, left: 50, right: w - 50, top: h * 0.15, fits: true, staged: false };
}

/** Draw this theme's characters for one frame. */
function drawCast(view, dt) {
  const c = view.fctx, { w, h } = view, st = view.stage, t = view.t;
  c.clearRect(0, 0, w, h);
  if (!view.cast?.length) return;
  const { s, ground, mid, left, right, top, fits, staged } = castPlace(view);
  const at = (x, y, scale, flip, draw) => { c.save(); c.translate(x, y); c.scale(scale * (flip ? -1 : 1), scale); draw(); c.restore(); };
  // A walker turns round at the edges of its space, and is brought back if the space moved.
  // They hop for joy while the pointer is beside them, and settle when it leaves.
  const near = fits && POINTER.x > -999 && Math.abs(POINTER.x - mid) < 110 * s + 50 && POINTER.y > ground - 150 * s - 30 && POINTER.y < ground + 40;
  st.excite = view.still ? 0 : Math.max(near ? 1 : 0, (st.excite || 0) - dt * 1.4);
  const hop = (lag = 0) => Math.abs(Math.sin(t * 8 + lag)) * 10 * s * st.excite;
  // A soft shadow where each one stands, so they sit on the ground instead of floating on the page.
  const shadow = (x, wide, lift = 0) => {
    c.save(); c.globalAlpha = (view.isDark ? 0.36 : 0.2) / (1 + lift / (14 * s)); c.fillStyle = '#000';
    c.beginPath(); c.ellipse(x, ground + 1.5 * s, wide * s * (1 - Math.min(0.35, lift / (60 * s))), 4.5 * s, 0, 0, 6.3); c.fill(); c.restore();
  };
  const pace = (speed) => {
    st.x += st.dir * speed * s * dt;
    if (st.x >= right) { st.x = right; st.dir = -1; } else if (st.x <= left) { st.x = left; st.dir = 1; }
  };
  for (const who of view.cast) {
    // Fireworks go on the layer behind the page, so they never cover what you're reading.
    if (who === 'fireworks') { if (!view.still) fireworks(view, view.ctx, dt); continue; }
    if (!fits) continue;
    if (who === 'feast') {
      // A Pilgrim and a Native American guest wave from either side of the table.
      const k = s * 0.92;
      shadow(mid, 44); shadow(mid - 56 * k, 15, hop()); shadow(mid + 56 * k, 15, hop(1.4));
      at(mid - 56 * k, ground - hop(), k, true, () => FIGURES.person(c, t, { coat: '#2f3038', pants: '#2f3038', mitt: '#f2c9a0', collar: '#ffffff', hat: 'pilgrim', hair: '#5a3a22' }));
      at(mid + 56 * k, ground - hop(1.4), k, false, () => FIGURES.person(c, t, { coat: '#b9824a', pants: '#8a5a32', mitt: '#c68a5a', skin: '#c68a5a', hair: '#2a1c14', long: true, fringe: '#8a5a32', belt: false, hat: 'feather', phase: 1.7 }));
      at(mid, ground, k, false, () => FIGURES.feast(c, t));
      at(mid - 2 * k, ground + 2, k * 0.66, false, () => FIGURES.cornucopia(c));
    } else if (who === 'turkey') {
      pace(30);
      at(st.x, ground, s, st.dir < 0, () => FIGURES.turkey(c, t));
    } else if (who === 'cross') {
      // Standing on its own (the kitchen display) the cross and its message go at the far left, full size,
      // in the clear space beside the clock and date (The owner's choice after trying it smaller under the date).
      at(staged ? mid : 61, ground - 4, s * (staged ? 0.9 : 0.76), false, () => FIGURES.cross(c, t, view.isDark));
    } else if (who === 'bunny') {
      st.clock += dt;
      let lift = 0;
      if (st.mode === 'hop') {
        const phase = Math.min(1, st.clock / 0.55);
        lift = Math.sin(phase * Math.PI) * 26;
        pace(74);
        if (phase >= 1) { st.clock = 0; if (++st.hops >= 5) { st.hops = 0; st.mode = 'wave'; } }
      } else if (st.clock > 2.4) { st.clock = 0; st.mode = 'hop'; }
      // Beside the cross the bunny is drawn at about a third of the cross's height, so it looks rabbit-sized.
      const b = view.cast.includes('cross') ? s * 0.36 : s;
      shadow(Math.min(right, Math.max(left, st.x)), 15 * (b / s), lift * b + hop());
      at(Math.min(right, Math.max(left, st.x)), ground - lift * b - hop(), b, st.dir < 0, () => FIGURES.bunny(c, t, st.mode === 'wave' || view.still));
    } else if (who === 'santa') {
      shadow(mid + 30 * s, 30); shadow(mid - 34 * s, 19, hop());
      // The tree is the tallest thing in any scene; on its own it is drawn smaller to stay under the date.
      at(mid + (staged ? 30 : 26) * s, ground, s * (staged ? 1 : 0.74), false, () => FIGURES.tree(c, t));
      at(mid - 34 * s, ground - hop(), s, false, () => FIGURES.person(c, t, { coat: '#d0342c', trim: '#fff', pants: '#d0342c', mitt: '#2a8a50', beard: '#fff', hat: 'santa', wide: 1.34 }));
    } else if (who === 'leprechaun') {
      shadow(mid + 24 * s, 22); shadow(mid - 36 * s, 16, hop());
      at(mid + 24 * s, ground, s, false, () => FIGURES.pot(c, t));
      at(mid - 36 * s, ground - hop(), s * 0.88, false, () => FIGURES.person(c, t, { coat: '#2a9a48', pants: '#1b6a30', mitt: '#f2c9a0', beard: '#e8701a', hat: 'lep' }));
    } else if (who === 'pumpkin') {
      shadow(mid + (staged ? 26 * s : 0), 30, hop());
      at(mid + (staged ? 26 * s : 0), ground - hop(), s * 1.15, false, () => FIGURES.pumpkin(c, t));
    } else if (who === 'treater') {
      // A trick-or-treater in a witch's hat, waving, with a pumpkin pail of sweets.
      const tx = mid + (staged ? -32 : 74) * s;
      shadow(tx, 13, hop(0.8));
      at(tx, ground - hop(0.8), s * 0.76, false, () => FIGURES.person(c, t, { coat: '#6a2c9c', pants: '#2a1a3a', mitt: '#f0c8a0', hair: '#5a3a22', long: true, hat: 'witch', belt: false, bag: true, phase: 0.6 }));
    } else if (who === 'ghost') {
      // On a stage the ghost bobs beside the pumpkin; otherwise it drifts about the left of the screen.
      // On its own (no side menu to stand in) the ghost flies right across the screen and back again,
      // rising and dipping as it goes and turning to face the way it is heading.
      const sweep = w + 180, along = (t * 46) % (2 * sweep), outward = along < sweep;
      const gx = staged ? mid - 38 * s + Math.sin(t * 0.5) * 10 * s : (outward ? along : 2 * sweep - along) - 90;
      const gy = staged ? Math.max(top + 70 * s, ground - (60 + 26 * Math.sin(t * 0.8)) * s) : h * (0.36 + 0.14 * Math.sin(t * 0.6 + 1)) + Math.sin(t * 2) * 6;
      c.globalAlpha = 0.82;
      at(gx, gy, s * (staged ? 0.95 : 1.2), staged ? Math.cos(t * 0.5) < 0 : !outward, () => { c.rotate(Math.cos(t * 0.23) * 0.12); FIGURES.ghost(c, t); });
      c.globalAlpha = 1;
    }
  }
}

class SeasonalBackdrop extends HTMLElement {
  static get observedAttributes() { return ['theme', 'scheme', 'motion', 'only', 'characters', 'character-scale', 'zoom', 'stage', 'colors', 'angle', 'accent', 'fps', 'lite']; }

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' }).innerHTML = `
        <style>
          :host { display: block; height: 0; }
          .back { position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
          .sky, canvas, .blob { position: absolute; }
          .sky { inset: 0; transition: background 1.2s ease; }
          .blob { width: 60vmax; height: 60vmax; border-radius: 50%; filter: blur(90px); opacity: 0.5; will-change: transform; animation: drift 46s ease-in-out infinite alternate; }
          /* lite: for a screen drawn without a graphics card (the kitchen display is drawn on the NAS and
             streamed). The big blurred glows are the costliest thing here, so they are left out. */
          :host([lite]) .blob { display: none; animation: none; }
          .blob:nth-child(2) { left: -18vmax; top: -22vmax; }
          .blob:nth-child(3) { right: -22vmax; top: 18vh; animation-duration: 58s; animation-direction: alternate-reverse; }
          .blob:nth-child(4) { left: 22vw; bottom: -34vmax; animation-duration: 70s; }
          canvas { inset: 0; width: 100%; height: 100%; }
          .front { position: fixed; z-index: 5; pointer-events: none; }
          :host([data-still]) .blob { animation: none; }
          @keyframes drift { from { transform: translate3d(0, 0, 0) scale(1); } to { transform: translate3d(7vmax, 5vmax, 0) scale(1.18); } }
        </style>
        <div class="back"><div class="sky"></div><div class="blob"></div><div class="blob"></div><div class="blob"></div><canvas class="bits"></canvas></div><canvas class="front"></canvas>`;
      this.canvas = this.shadowRoot.querySelector('.bits');
      this.ctx = this.canvas.getContext('2d');
      this.front = this.shadowRoot.querySelector('.front');
      this.fctx = this.front.getContext('2d');
    }
    this.dark = matchMedia('(prefers-color-scheme: dark)');
    this.calm = matchMedia('(prefers-reduced-motion: reduce)');
    this.onChange = () => this.apply();
    this.onResize = () => { this.size(); this.seed(); this.frame(0); };
    this.onVisible = () => (document.hidden ? this.stop() : this.start());
    this.dark.addEventListener('change', this.onChange);
    this.calm.addEventListener('change', this.onChange);
    addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisible);
    // Re-check the date now and then, so the theme changes over without a reload.
    this.clock = setInterval(() => { if ((this.getAttribute('theme') || 'auto') === 'auto' && themeFor() !== this.auto) this.apply(); }, 30 * 60000);
    this.apply();
  }

  disconnectedCallback() {
    this.stop();
    clearInterval(this.clock);
    this.dark.removeEventListener('change', this.onChange);
    this.calm.removeEventListener('change', this.onChange);
    removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  attributeChangedCallback() { if (this.ctx) this.apply(); }

  apply() {
    const asked = this.getAttribute('theme') || 'auto';
    const only = (this.getAttribute('only') || '').split(/\s+/).filter(Boolean);
    let id = asked === 'auto' ? themeFor() : asked;
    if (asked === 'auto' && only.length && !only.includes(id)) id = 'none';
    let t = THEMES[id];
    // "custom": your own colours, given as colors="#112233,#445566". One is a solid colour; two or three blend.
    if (id === 'custom') {
      const colors = (this.getAttribute('colors') || '').split(',').map((c) => c.trim()).filter((c) => HEX.test(c)).slice(0, 4);
      // The accent has to stand out from your colours, so it isn't taken from them.
      if (colors.length) t = { label: 'Custom', accent: this.getAttribute('accent') || (colors.reduce((a, c) => a + luminance(c), 0) / colors.length < 0.5 ? '#4a93ea' : '#2a66c0'), flat: true, own: colors, blobs: [], bits: [] };
    }
    const root = document.documentElement;
    this.current = id;
    this.auto = themeFor();
    this.stop();
    if (!t) {
      this.style.display = 'none';
      delete root.dataset.season;
      delete root.dataset.backdropTone;
      root.style.removeProperty('--season-accent');
      return;
    }
    this.style.display = '';
    const scheme = this.getAttribute('scheme') || 'auto';
    // Your own colours decide for themselves whether the page on top should be light or dark.
    this.isDark = t.own ? t.own.reduce((a, c) => a + luminance(c), 0) / t.own.length < 0.5 : scheme === 'dark' || (scheme !== 'light' && this.dark.matches);
    const g = t.own || (this.isDark ? t.dark : t.light);
    const angle = Number(this.getAttribute('angle')) || 160;
    this.shadowRoot.querySelector('.sky').style.background = g.length === 1 ? g[0] : `linear-gradient(${angle}deg, ${g.map((c, i) => `${c} ${Math.round((i / (g.length - 1)) * 100)}%`).join(', ')})`;
    this.shadowRoot.querySelectorAll('.blob').forEach((b, i) => { b.style.display = t.blobs[i] ? '' : 'none'; b.style.background = t.blobs[i] || 'none'; b.style.opacity = this.isDark ? 0.34 : 0.5; });
    root.dataset.season = id;
    // Lets the page know whether what's behind it is dark or light.
    root.dataset.backdropTone = this.isDark ? 'dark' : 'light';
    root.style.setProperty('--season-accent', t.accent);
    this.theme = t;
    this.themeId = t.flat || t.own ? null : id;
    // "fireworks" keeps the fireworks, which are behind the page, and leaves the figures out.
    const who = this.getAttribute('characters');
    this.cast = who === 'off' ? [] : (t.actors || []).filter((a) => who !== 'fireworks' || a === 'fireworks');
    this.stage = { x: innerWidth * 0.3, dir: 1, mode: 'hop', clock: 0, hops: 0, rockets: [], sparks: [], next: 0.4 };
    this.still = !!t.flat || this.getAttribute('motion') === 'off' || this.calm.matches;
    this.toggleAttribute('data-still', this.still);
    this.size();
    this.seed();
    this.frame(0);
    this.start();
    // When nothing is moving, only that one frame is drawn. Draw it again shortly, in case the
    // place the characters stand (the `stage`) wasn't on the page yet.
    if (this.still && this.cast.length) for (const ms of [300, 1200, 3000]) setTimeout(() => { if (this.theme === t && this.still) this.frame(0); }, ms);
  }

  size() {
    const ratio = Math.min(2, devicePixelRatio || 1);
    // zoom draws the whole scene larger: everything is laid out for a screen that much smaller
    // and then magnified, so leaves, landscape and characters grow together. For small, sharp
    // screens such as the kitchen display, where the usual sizes look tiny.
    const z = Math.max(0.5, Math.min(3, Number(this.getAttribute('zoom')) || 1));
    this.w = innerWidth / z; this.h = innerHeight / z;
    this.canvas.width = Math.round(innerWidth * ratio); this.canvas.height = Math.round(innerHeight * ratio);
    this.ctx.setTransform(ratio * z, 0, 0, ratio * z, 0, 0);
    this.front.width = this.canvas.width; this.front.height = this.canvas.height;
    this.fctx.setTransform(ratio * z, 0, 0, ratio * z, 0, 0);
  }

  seed() {
    const scale = Math.max(0.45, Math.min(1.6, (this.w * this.h) / (1280 * 800)));
    this.bits = [];
    for (const b of this.theme?.bits || []) {
      for (let i = 0; i < Math.round(b.n * scale); i++) {
        const depth = rand(0.45, 1);
        this.bits.push({
          kind: b.kind, color: pick(b.colors), rise: !!b.rise, depth,
          x: rand(0, this.w), y: rand(0, this.h), size: rand(b.size[0], b.size[1]) * depth,
          vy: rand(b.speed[0], b.speed[1]) * depth, sway: rand(8, 34), swayRate: rand(0.3, 1.1), phase: rand(0, 6.3),
          rot: rand(0, 6.3), spin: rand(-1.2, 1.2), flip: rand(0, 6.3), flipRate: rand(0.6, 2.4),
        });
      }
    }
    this.bits.sort((a, b) => a.depth - b.depth);
  }

  start() {
    if (this.still || this.raf || document.hidden || !this.theme) return;
    let last = performance.now();
    // Up to a tenth of a second a frame, so a screen that draws slowly (the kitchen display's stream) still runs at close to real speed.
    // fps="12" draws only that many frames a second, for a screen where every frame costs the machine drawing it.
    const fps = Math.max(0, Number(this.getAttribute('fps')) || 0), every = fps ? 1000 / fps : 0;
    const loop = (now) => {
      if (!every || now - last >= every - 2) { this.frame(Math.min(fps ? 0.3 : 0.1, (now - last) / 1000)); last = now; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  frame(dt) {
    const c = this.ctx, { w, h } = this;
    c.clearRect(0, 0, w, h);
    this.t = (this.t || 0) + dt;
    landscape(this, c);
    c.globalAlpha = 1;
    // The scene leans a little away from the pointer, eased so it glides.
    const here = POINTER.x > -999;
    const ease = Math.min(1, dt * 2.5);
    this.px = (this.px || 0) + ((here ? POINTER.x / w - 0.5 : 0) - (this.px || 0)) * ease;
    this.py = (this.py || 0) + ((here ? POINTER.y / h - 0.5 : 0) - (this.py || 0)) * ease;
    // A moving pointer is a gust of wind; a still one is not.
    const gust = here && performance.now() - POINTER.at < 140 ? Math.min(1, Math.hypot(POINTER.vx, POINTER.vy) / 900) : 0;
    const settle = Math.min(1, dt * 1.6);
    for (const p of this.bits || []) {
      p.phase += p.swayRate * dt; p.rot += p.spin * dt; p.flip += p.flipRate * dt;
      const pad = p.size * 2 + 20;
      if (p.kind !== 'twinkle') {
        p.y += (p.rise ? -1 : 1) * p.vy * dt;
        if (p.kind === 'glow') { p.x += Math.cos(p.phase * 0.7) * p.vy * dt * 1.6; p.y += Math.sin(p.phase) * p.vy * dt * 1.6 - p.vy * dt; }
        if (p.y > h + pad) { p.y = -pad; p.x = rand(0, w); }
        if (p.y < -pad) { p.y = h + pad; p.x = rand(0, w); }
        if (p.x > w + pad) p.x = -pad;
        if (p.x < -pad) p.x = w + pad;
      }
      // Blown aside by the pointer, then drifting back to its own path.
      p.ox = (p.ox || 0) * (1 - settle); p.oy = (p.oy || 0) * (1 - settle);
      if (gust > 0.04 && p.kind !== 'twinkle') {
        const dx = p.x + p.ox - POINTER.x, dy = p.y + p.oy - POINTER.y, d = Math.hypot(dx, dy);
        if (d < 170 && d > 1) {
          const f = (1 - d / 170) * gust * 900 * dt * p.depth;
          p.ox += (dx / d) * f + POINTER.vx * 0.0007 * f; p.oy += (dy / d) * f + POINTER.vy * 0.0007 * f; p.rot += f * 0.03;
        }
      }
      const x = p.x + Math.sin(p.phase) * p.sway * (p.kind === 'twinkle' || p.kind === 'glow' ? 0 : 1) + p.ox - this.px * 44 * p.depth;
      const y = p.y + p.oy - this.py * 26 * p.depth;
      const alpha = (this.isDark ? 0.8 : 0.9) * (0.35 + 0.65 * p.depth);
      if (p.kind === 'glow' || p.kind === 'twinkle') {
        const pulse = 0.35 + 0.65 * Math.abs(Math.sin(p.phase * (p.kind === 'glow' ? 1.3 : 0.9)));
        const r = p.size * (p.kind === 'glow' ? 5 : 3);
        const glow = c.createRadialGradient(x, y, 0, x, y, r);
        glow.addColorStop(0, p.color); glow.addColorStop(1, 'transparent');
        c.globalAlpha = alpha * pulse * (this.isDark ? 1 : 0.7);
        c.fillStyle = glow; c.beginPath(); c.arc(x, y, r, 0, 6.3); c.fill();
        continue;
      }
      c.save();
      c.translate(x, y); c.rotate(p.kind === 'snow' ? 0 : p.rot);
      c.scale(p.size * (TUMBLES.has(p.kind) ? Math.cos(p.flip) * 0.75 + 0.25 * Math.sign(Math.cos(p.flip) || 1) : 1), p.size);
      c.globalAlpha = p.kind === 'snow' ? alpha * (this.isDark ? 0.85 : 1) : alpha;
      c.fillStyle = p.color;
      if (p.kind === 'snow' && !this.isDark) { c.shadowColor = 'rgba(60,90,130,0.35)'; c.shadowBlur = 4; }
      DRAW[p.kind](c, p);
      c.restore();
    }
    c.globalAlpha = 1;
    drawCast(this, dt);
  }
}

if (!customElements.get('seasonal-backdrop')) customElements.define('seasonal-backdrop', SeasonalBackdrop);
