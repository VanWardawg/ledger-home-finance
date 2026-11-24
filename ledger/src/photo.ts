// A photo of your own as the backdrop (added 2026-11-19, the owner's idea).
//
// The picture never leaves the device: it is shrunk to screen size in the browser and kept in this
// browser's own storage (IndexedDB, database `ledger-look`), not on the server, so a family photo is
// never in anyone's copy of Ledger or its backups. Each device chooses its own.
//
// The app adjusts itself to the picture. When one is chosen it is measured once (how bright it is,
// its colours top and bottom, its most vivid colour) and those few numbers are kept beside it
// (localStorage `ledger-photo`). From them: light or dark text, a veil over the picture so words on
// it stay readable, the tint of the glass cards, and an accent colour taken from the picture.

export type PhotoMeta = {
  /** Average brightness of the picture, 0 (black) to 1 (white). */
  lum: number;
  /** Average colour of its top and bottom halves, as #rrggbb. */
  top: string;
  bottom: string;
  /** Hue (0 to 360) of its most vivid colour, or null when it has none to speak of. */
  hue: number | null;
  /** How strongly the picture is veiled, 0 to 80 (percent), and how far it is blurred, 0 to 24 (pixels). */
  dim: number;
  blur: number;
  /**
   * How the picture is framed on this device (added 2026-11-23): the point of the picture kept in view, as a
   * percentage across and down (50, 50 is the middle), and how far it is zoomed in, 1 (the whole picture
   * that fits) to 3. A picture never has gaps at its edges: it always covers the screen.
   */
  x?: number;
  y?: number;
  zoom?: number;
};
/** The framing with its defaults filled in. */
export const framing = (m: { x?: number; y?: number; zoom?: number }) => ({ x: clamp(m.x ?? 50, 0, 100), y: clamp(m.y ?? 50, 0, 100), zoom: clamp(m.zoom ?? 1, 1, 3) });

const KEY = 'ledger-photo';
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const rgbOf = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lumOf = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mix = (hex: string, toward: number, by: number) => { const [r, g, b] = rgbOf(hex); return toHex(r + (toward - r) * by, g + (toward - g) * by, b + (toward - b) * by); };

function hsl(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return toHex(f(0), f(8), f(4));
}

export function readPhotoMeta(): PhotoMeta | null {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!m || typeof m.lum !== 'number' || !/^#[0-9a-f]{6}$/i.test(m.top) || !/^#[0-9a-f]{6}$/i.test(m.bottom)) return null;
    return { lum: clamp(m.lum, 0, 1), top: m.top, bottom: m.bottom, hue: typeof m.hue === 'number' ? m.hue : null, dim: clamp(Number(m.dim) || 0, 0, 80), blur: clamp(Number(m.blur) || 0, 0, 24), ...framing({ x: typeof m.x === 'number' ? m.x : undefined, y: typeof m.y === 'number' ? m.y : undefined, zoom: typeof m.zoom === 'number' ? m.zoom : undefined }) };
  } catch { return null; }
}
export function savePhotoMeta(m: PhotoMeta) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private window */ } }

/**
 * What the app does to suit the picture. `scheme` is the person's own choice of light or dark, which
 * wins when they have made one; left on automatic, a bright picture gets dark text and a white veil,
 * any other gets light text and a dark veil.
 */
export function photoTone(m: PhotoMeta, scheme: 'auto' | 'light' | 'dark') {
  const dark = scheme === 'dark' || (scheme !== 'light' && m.lum < 0.62);
  const toward = dark ? 0 : 255;
  // The colours behind the picture: shown for the moment before it loads, and they tint the glass.
  // They must land on the right side of mid-grey, because the backdrop decides light or dark from them.
  let by = m.dim / 100, colors = [mix(m.top, toward, by), mix(m.bottom, toward, by)];
  const avg = () => colors.reduce((a, c) => { const [r, g, b] = rgbOf(c); return a + lumOf(r, g, b); }, 0) / colors.length;
  for (let i = 0; i < 12 && (dark ? avg() >= 0.42 : avg() <= 0.58); i++) { by = Math.min(1, by + 0.1); colors = [mix(m.top, toward, by), mix(m.bottom, toward, by)]; }
  return {
    dark,
    colors,
    veil: dark ? `rgba(6, 8, 12, ${(m.dim / 100).toFixed(2)})` : `rgba(255, 255, 255, ${(m.dim / 100).toFixed(2)})`,
    blur: m.blur,
    ...framing(m),
    // The picture's own most vivid colour, made bright enough to read on a dark page or deep enough on a light one.
    accent: m.hue === null ? '' : hsl(m.hue, dark ? 0.72 : 0.6, dark ? 0.64 : 0.4),
  };
}

// ---- Where the picture is kept ----------------------------------------------------------------
function store(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const open = indexedDB.open('ledger-look', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('photo');
    open.onsuccess = () => ok(open.result);
    open.onerror = () => no(open.error);
  });
}
async function act<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await store();
  try {
    return await new Promise<T>((ok, no) => {
      const tx = db.transaction('photo', mode);
      const req = run(tx.objectStore('photo'));
      tx.oncomplete = () => ok(req.result);
      tx.onerror = () => no(tx.error);
      tx.onabort = () => no(tx.error);
    });
  } finally { db.close(); }
}

let shown: { url: string } | null = null;
const forget = () => { if (shown) { URL.revokeObjectURL(shown.url); shown = null; } };

/** The picture's address for this page, or '' when this device has none. */
export async function photoUrl(): Promise<string> {
  if (shown) return shown.url;
  try {
    const blob = await act<Blob | undefined>('readonly', (s) => s.get('backdrop'));
    if (!(blob instanceof Blob)) return '';
    shown = { url: URL.createObjectURL(blob) };
    return shown.url;
  } catch { return ''; }
}

export async function removePhoto() {
  forget();
  try { localStorage.removeItem(KEY); } catch { /* private window */ }
  try { await act('readwrite', (s) => s.delete('backdrop')); } catch { /* nothing kept */ }
}

/** Takes a picture chosen from the device: shrinks it, measures it, keeps it here. */
export async function choosePhoto(file: Blob): Promise<PhotoMeta> {
  const from = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That file could not be opened as a picture.')); i.src = from; });
    // No larger than the screen needs: a phone gets a smaller copy than a big monitor.
    const most = clamp(Math.max(screen.width, screen.height) * Math.min(devicePixelRatio || 1, 2), 1400, 2560);
    const scale = Math.min(1, most / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.86));
    if (!blob) throw new Error('That picture could not be prepared.');

    // Measured from a tiny copy: brightness, colour top and bottom, and the most vivid hue.
    const N = 24, small = document.createElement('canvas');
    small.width = N; small.height = N;
    const ctx = small.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, N, N);
    const px = ctx.getImageData(0, 0, N, N).data;
    const sum = [[0, 0, 0], [0, 0, 0]];
    const hues = new Array(12).fill(0), hueAt = new Array(12).fill(0);
    let lum = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      lum += lumOf(r, g, b);
      const half = sum[y < N / 2 ? 0 : 1]; half[0] += r; half[1] += g; half[2] += b;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d < 40 || max < 60) continue;   // greys and near-black have no hue worth taking
      let hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh = (hh * 60 + 360) % 360;
      const bucket = Math.floor(hh / 30) % 12, weight = (d / 255) * (max / 255);
      hues[bucket] += weight; hueAt[bucket] += hh * weight;
    }
    const half = (N * N) / 2;
    const best = hues.indexOf(Math.max(...hues));
    const meta: PhotoMeta = {
      lum: lum / (N * N),
      top: toHex(sum[0][0] / half, sum[0][1] / half, sum[0][2] / half),
      bottom: toHex(sum[1][0] / half, sum[1][1] / half, sum[1][2] / half),
      hue: hues[best] > N * N * 0.012 ? Math.round(hueAt[best] / hues[best]) : null,
      dim: 35,
      blur: 0,
    };
    forget();
    await act('readwrite', (s) => s.put(blob, 'backdrop'));
    savePhotoMeta(meta);
    return meta;
  } finally { URL.revokeObjectURL(from); }
}

/** Draws the picture behind the page (or takes it away). Called from applyLook. */
export function showPhoto(tone: ReturnType<typeof photoTone> | null) {
  let box = document.getElementById('ledger-photo');
  if (!tone) { box?.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'ledger-photo';
    box.setAttribute('aria-hidden', 'true');
    box.append(document.createElement('i'));
    // Straight after the backdrop, so it lies over the backdrop's colours and under the page.
    const back = document.querySelector('seasonal-backdrop');
    if (back) back.after(box); else document.body.prepend(box);
  }
  box.style.setProperty('--photo-veil', tone.veil);
  box.style.setProperty('--photo-blur', `${tone.blur}px`);
  box.style.setProperty('--photo-x', `${tone.x}%`);
  box.style.setProperty('--photo-y', `${tone.y}%`);
  box.style.setProperty('--photo-zoom', String(tone.zoom));
  const pic = box.firstElementChild as HTMLElement, at = box;
  photoUrl().then((url) => {
    if (!at.isConnected) return;
    if (url) pic.style.backgroundImage = `url("${url}")`;
    at.classList.toggle('on', !!url);
  });
}
