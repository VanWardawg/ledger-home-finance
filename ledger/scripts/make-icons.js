// Draws the home-screen icon (three rising bars) and writes it as PNG files.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function icon(size) {
  const bg = [14, 15, 19];
  const bars = [
    { x: 0.24, h: 0.26, c: [74, 147, 234] },
    { x: 0.42, h: 0.4, c: [74, 147, 234] },
    { x: 0.6, h: 0.56, c: [242, 242, 245] },
  ];
  const w = 0.16 * size;
  const base = 0.76 * size;
  const r = w * 0.3;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let c = bg;
      for (const b of bars) {
        const x0 = b.x * size, x1 = x0 + w, y0 = base - b.h * size;
        if (x < x0 || x >= x1 || y < y0 || y >= base) continue;
        // Round the top two corners of each bar.
        const dx = x < x0 + r ? x0 + r - x : x > x1 - r ? x - (x1 - r) : 0;
        const dy = y < y0 + r ? y0 + r - y : 0;
        if (dx && dy && dx * dx + dy * dy > r * r) continue;
        c = b.c;
      }
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(out, { recursive: true });
for (const s of [180, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), icon(s));
console.log('Icons written to public/');
