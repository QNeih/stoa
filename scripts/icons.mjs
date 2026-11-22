// Draws the app icons (a stoa: pediment, four columns, base) as PNGs into public/.
// Run with `npm run icons`; the output is committed.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x24, 0x31, 0x3f];
const STONE = [0xd9, 0xc9, 0xa3];

/** True when the point (0..1 coordinates) is on the drawing. */
function inside(x, y) {
  const rect = (x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  // Pediment: triangle with its apex at the top.
  if (y >= 0.2 && y <= 0.36) {
    const half = ((y - 0.2) / 0.16) * 0.31;
    if (Math.abs(x - 0.5) <= half) return true;
  }
  if (rect(0.17, 0.38, 0.83, 0.43)) return true;
  for (const cx of [0.27, 0.42, 0.58, 0.73]) if (rect(cx - 0.04, 0.45, cx + 0.04, 0.73)) return true;
  return rect(0.15, 0.75, 0.85, 0.8);
}

function png(size, scale) {
  const ss = 4; // supersampling per axis for smooth edges
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size - 0.5) / scale + 0.5;
          const y = ((py + (sy + 0.5) / ss) / size - 0.5) / scale + 0.5;
          if (inside(x, y)) hits++;
        }
      const a = hits / (ss * ss);
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - a) + STONE[c] * a);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

writeFileSync("public/icon-192.png", png(192, 1));
writeFileSync("public/icon-512.png", png(512, 1));
// Maskable icons are cropped to a circle; keep the drawing inside the safe zone.
writeFileSync("public/icon-maskable-512.png", png(512, 0.72));
console.log("icons written to public/");
