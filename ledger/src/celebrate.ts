// A short burst of confetti for good news (a debt paid off, a month under
// budget). Drawn on its own canvas above the page and removed when it ends.
const KEY = 'ledger-celebrated';

/** Runs `fn` once per `id` on this device. The first id ever seen for a `group` is noted silently when `quietFirst` is set, so old news isn't celebrated. */
export function once(id: string, fn: () => void) {
  let seen: string[] = [];
  try { seen = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* start fresh */ }
  if (seen.includes(id)) return;
  try { localStorage.setItem(KEY, JSON.stringify([...seen, id].slice(-200))); } catch { return; }
  fn();
}

/** Remembers ids without celebrating them: used the first time a page loads so things that were already true aren't treated as news. */
export function noteQuietly(group: string, ids: string[]): boolean {
  const flag = `${KEY}-${group}`;
  try {
    if (localStorage.getItem(flag)) return false;
    const seen: string[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    localStorage.setItem(KEY, JSON.stringify([...new Set([...seen, ...ids])].slice(-200)));
    localStorage.setItem(flag, '1');
    return true;
  } catch { return true; }
}

export function celebrate() {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.querySelector('canvas.confetti')) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = innerWidth, h = innerHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  document.body.append(canvas);
  const c = canvas.getContext('2d')!;
  c.scale(dpr, dpr);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a93ea';
  const colours = [accent, '#f5c542', '#3fbf7f', '#ef6b6b', '#ffffff', '#b58cf2'];
  const bits = Array.from({ length: 150 }, (_, i) => {
    const fromLeft = i % 2 === 0;
    const angle = (fromLeft ? -Math.PI / 3 : (-2 * Math.PI) / 3) + (Math.random() - 0.5) * 0.9;
    const speed = 9 + Math.random() * 11;
    return {
      x: fromLeft ? w * 0.08 : w * 0.92, y: h * 0.72, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6, spin: Math.random() * 6, turn: (Math.random() - 0.5) * 0.4, colour: colours[i % colours.length], round: i % 5 === 0,
    };
  });
  const t0 = performance.now();
  const life = 3200;
  const frame = (now: number) => {
    const age = now - t0;
    c.clearRect(0, 0, w, h);
    for (const b of bits) {
      b.vy += 0.32; b.vx *= 0.985; b.vy *= 0.985;
      b.x += b.vx; b.y += b.vy; b.spin += b.turn;
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, (life - age) / 700));
      c.translate(b.x, b.y); c.rotate(b.spin);
      c.fillStyle = b.colour;
      if (b.round) { c.beginPath(); c.arc(0, 0, b.size / 2, 0, Math.PI * 2); c.fill(); }
      else c.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2 * Math.abs(Math.cos(b.spin * 2)) + 1.5);
      c.restore();
    }
    if (age < life) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
  // If frames never run (a hidden tab), don't leave the canvas behind.
  setTimeout(() => canvas.remove(), life + 2000);
}
