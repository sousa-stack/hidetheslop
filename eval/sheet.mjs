// Builds a labelled thumbnail grid: node sheet.mjs out.jpg <dir> <prefix>...
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const [out, dir, ...prefixes] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => prefixes.some((p) => f.startsWith(p)));
const T = 260, cols = 4;
const tiles = await Promise.all(files.map(async (f, i) => ({
  input: await sharp(join(dir, f)).resize(T, T, { fit: 'contain', background: '#222' })
    .composite([{ input: Buffer.from(`<svg width="${T}" height="26"><rect width="100%" height="100%" fill="#000a"/><text x="6" y="18" font-size="15" fill="#fff" font-family="sans-serif">${f.slice(0, 9)}</text></svg>`), top: 0, left: 0 }]).toBuffer(),
  left: (i % cols) * T, top: Math.floor(i / cols) * T,
})));
await sharp({ create: { width: cols * T, height: Math.ceil(files.length / cols) * T, channels: 3, background: '#111' } }).composite(tiles).jpeg({ quality: 80 }).toFile(out);
console.log(files.length, 'images');
