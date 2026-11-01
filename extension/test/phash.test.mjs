// node --test test/phash.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/phash.js', import.meta.url), 'utf8');

// The browser parts, faked just enough to see what phash.js asks for.
class FakeCanvas {
  static made = [];
  constructor(width, height) {
    Object.assign(this, { width, height, peak: width * height });
    FakeCanvas.made.push(this);
  }
  getContext(type, options) {
    this.options = options;
    const canvas = this;
    const page = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    return {
      fillRect: () => page.fill(255),
      drawImage(bitmap, x, y) {
        assert.equal(x, 0);
        const from = -y * bitmap.width * 4;
        if (bitmap.rgba) page.set(bitmap.rgba.subarray(from, from + page.length));
      },
      getImageData: (x, y, width, height) => ({ data: page.subarray(0, width * height * 4) }),
    };
  }
}

const decoded = [];
let nextBitmap = null;
const ctx = {
  OffscreenCanvas: FakeCanvas,
  async createImageBitmap(blob, options) {
    decoded.push(options);
    if (!nextBitmap) throw new Error('not a picture');
    return nextBitmap;
  },
};
vm.runInNewContext(source, ctx);
const { fromPixels, fromBitmap, fromBlob, isAnimated } = vm.runInNewContext('SlopHash', ctx);

function picture(width, height, fn) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba.set([...fn(x, y).slice(0, 3), fn(x, y)[3] ?? 255], (y * width + x) * 4);
  }
  return rgba;
}

const random = (seed) => () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24;
const hash = (rgba, width, height) => fromPixels(rgba, width, height).phash;
const popcount = (hex) => [...BigInt(`0x${hex}`).toString(2)].filter((b) => b === '1').length;
const bitSet = (hex, bit) => ((BigInt(`0x${hex}`) >> BigInt(bit)) & 1n) === 1n;

function noise(width, height, seed) {
  const next = random(seed);
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([next(), next(), next()], i);
  return rgba;
}

// Big enough blocks to survive the shrink, with noise on top. Plain noise averages out
// to flat on a large picture.
function blocks(width, height, seed) {
  const next = random(seed);
  const grid = Array.from({ length: 16 * 16 }, () => next());
  const rgba = noise(width, height, seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gray = grid[Math.floor((y * 16) / height) * 16 + Math.floor((x * 16) / width)];
      const i = (y * width + x) * 4;
      rgba.set([(gray * 3 + rgba[i]) / 4, (gray * 3 + rgba[i + 1]) / 4, (gray * 3 + rgba[i + 2]) / 4], i);
    }
  }
  return rgba;
}

// One DCT term and nothing else, up to 8-bit rounding.
const wave = (v, u, amplitude) =>
  picture(32, 32, (x, y) => {
    const gray = 128 + amplitude * Math.cos(((2 * y + 1) * v * Math.PI) / 64) * Math.cos(((2 * x + 1) * u * Math.PI) / 64);
    return [gray, gray, gray];
  });

// Checked once against a separate numpy version of the spec. If one of these changes,
// every vote already stored belongs to the old hash, so that's a new hashVersion, not a
// new number here.
test('fixed pictures keep their hashes', () => {
  const odd = picture(101, 77, (x, y) => [(x * 5 + y * 3) % 256, (x * x + y) % 256, (x ^ y) & 255]);
  const rings = picture(256, 256, (x, y) => {
    const v = Math.floor(127.5 + 127.5 * Math.sin(Math.hypot(x - 100, y - 140) / 9));
    return [v, v, v];
  });
  assert.equal(hash(noise(32, 32, 12345), 32, 32), '48597439d27c15e9');
  assert.equal(hash(odd, 101, 77), '00248dba0a7beedd');
  assert.equal(hash(rings, 256, 256), '50cbfb89aa8181cf');
  const weave = picture(300, 200, (x, y) => [(x * y) % 251, (x + 2 * y) % 253, (3 * x ^ y) & 255]);
  assert.equal(hash(weave, 300, 200), '42104a1fb7fa16e5');
});

test('the top bit is 0 and half the rest are set', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const hex = hash(noise(64, 40, seed), 64, 40);
    assert.ok(!bitSet(hex, 63), hex);
    assert.equal(popcount(hex), 31, hex); // why two different pictures are always an even distance apart
  }
});

test('bit order: the first value is bit 62, the last is bit 0, and rows are vertical', () => {
  const cases = [
    [0, 1, 62], // left to right, once
    [0, 7, 56],
    [1, 0, 55], // top to bottom, once
    [1, 1, 54],
    [7, 7, 0],
  ];
  for (const [v, u, bit] of cases) {
    assert.ok(bitSet(hash(wave(v, u, 100), 32, 32), bit), `v${v} u${u} on`);
    assert.ok(!bitSet(hash(wave(v, u, -100), 32, 32), bit), `v${v} u${u} off`);
  }
});

test('the box filter weights partly covered pixels', () => {
  // 33 wide: pixel 1 sits 31/33 in cell 0, and so on. Doubling each pixel gives the
  // same averages, so the two must hash the same if the weights are exact.
  const base = noise(33, 35, 9);
  const doubled = new Uint8ClampedArray(66 * 70 * 4);
  for (let y = 0; y < 70; y++) {
    for (let x = 0; x < 66; x++) {
      const from = ((y >> 1) * 33 + (x >> 1)) * 4;
      doubled.set(base.subarray(from, from + 4), (y * 66 + x) * 4);
    }
  }
  assert.equal(hash(doubled, 66, 70), hash(base, 33, 35));
});

test('the aspect ratio is ignored', () => {
  const square = noise(40, 40, 8);
  const tall = new Uint8ClampedArray(40 * 400 * 4);
  for (let y = 0; y < 400; y++) tall.set(square.subarray(Math.floor(y / 10) * 160, (Math.floor(y / 10) + 1) * 160), y * 160);
  assert.equal(hash(tall, 40, 400), hash(square, 40, 40));
});

test('size limits', () => {
  const small = noise(32, 32, 3);
  assert.match(hash(small, 32, 32), /^[0-9a-f]{16}$/);
  assert.deepEqual([fromPixels(small, 31, 32).why, fromPixels(small, 32, 31).why], ['small', 'small']);
  assert.equal(fromBitmap({ width: 31, height: 900 }).why, 'small');
  assert.equal(fromBitmap({ width: 6325, height: 6325 }).why, 'large'); // 40.0056 MP
});

test('transparency lands on white', () => {
  const painted = noise(50, 50, 4);
  const cut = painted.slice();
  const white = painted.slice();
  for (let i = 0; i < cut.length / 2; i += 4) {
    cut.set([17, 200, 9, 0], i); // whatever color a fully clear pixel claims to be
    white.set([255, 255, 255, 255], i);
  }
  assert.equal(hash(cut, 50, 50), hash(white, 50, 50));
});

test('flat pictures get no hash', () => {
  const gray = new Uint8ClampedArray(64 * 64 * 4).fill(200);
  const result = fromPixels(gray, 64, 64);
  assert.deepEqual([result.phash, result.why, result.spread], [null, 'flat', 0]);
  // Noise of one gray level: something to read, but nothing that survives a repost.
  const next = random(11);
  const faint = new Uint8ClampedArray(400 * 300 * 4).fill(255);
  for (let i = 0; i < faint.length; i += 4) faint.fill(199 + next() % 3, i, i + 3);
  assert.equal(fromPixels(faint, 400, 300).why, 'flat');
  // The limit is met by a real if quiet picture: a pale logo on white.
  const logo = picture(400, 300, (x, y) => (Math.hypot(x - 200, y - 150) < 40 ? [235, 235, 235] : [255, 255, 255]));
  assert.ok(fromPixels(logo, 400, 300).phash);
});

test('the hash fits the API', () => {
  const votes = readFileSync(new URL('../../api/src/routes/votes.ts', import.meta.url), 'utf8');
  const [, pattern] = votes.match(/phashSchema = z\.string\(\)\.regex\(\/(.+?)\/\)/);
  for (let seed = 1; seed <= 20; seed++) assert.match(hash(noise(40, 40, seed), 40, 40), new RegExp(pattern));
});

test('strips give the same hash as all the pixels at once', () => {
  for (const [width, height] of [
    [1500, 1000], // 666 rows a strip, so a filter cell crosses a strip boundary
    [100, 40],
    [33, 90000], // one strip that's nearly the size of the limit
  ]) {
    const rgba = blocks(width, height, 5);
    FakeCanvas.made.length = 0;
    const result = fromBitmap({ width, height, rgba });
    assert.match(result.phash, /^[0-9a-f]{16}$/);
    assert.equal(result.phash, hash(rgba, width, height), `${width}x${height}`);
    assert.ok(FakeCanvas.made[0].peak <= 1e6);
    assert.equal(FakeCanvas.made[0].width, 0, 'the canvas is released');
  }
});

test('a canvas that came out blank is flat, not a hash', () => {
  assert.equal(fromBitmap({ width: 60, height: 60 }).why, 'flat');
});

test('the pixels are asked for explicitly', async () => {
  let closed = 0;
  nextBitmap = { width: 40, height: 40, rgba: noise(40, 40, 6), close: () => closed++ };
  const result = await fromBlob(new Blob([new Uint8Array(100)]));
  assert.match(result.phash, /^[0-9a-f]{16}$/);
  assert.equal(closed, 1);
  assert.deepEqual({ ...decoded.at(-1) }, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  assert.deepEqual({ ...FakeCanvas.made.at(-1).options }, { colorSpace: 'srgb', willReadFrequently: true });
  nextBitmap = null;
  assert.equal((await fromBlob(new Blob(['not a picture']))).why, 'undecodable');
});

const ascii = (s) => [...Buffer.from(s, 'latin1')];
const le32 = (n) => [n & 255, n >> 8, 0, 0];
const be32 = (n) => [0, 0, n >> 8, n & 255];
const bytes = (...parts) => new Uint8Array(parts.flat());

function gif(frames, extras = []) {
  const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x80, 0, 0, 0, 255, 255, 255, 2, 2, 0x44, 1, 0];
  return bytes(ascii('GIF89a'), [1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255], extras, ...Array(frames).fill(frame), [0x3b]);
}

function webp(...chunks) {
  const body = chunks.flatMap(([id, n]) => [...ascii(id), ...le32(n), ...Array(n + (n & 1)).fill(0)]);
  return bytes(ascii('RIFF'), le32(body.length + 4), ascii('WEBP'), body);
}

function png(...chunks) {
  const body = chunks.flatMap(([id, n]) => [...be32(n), ...ascii(id), ...Array(n + 4).fill(0)]);
  return bytes([0x89], ascii('PNG\r\n\x1a\n'), body);
}

test('animations are found from the bytes', () => {
  const comment = [0x21, 0xfe, 3, 1, 0x2c, 3, 0]; // says "new frame" inside a comment
  assert.equal(isAnimated(gif(1)), false);
  assert.equal(isAnimated(gif(1, comment)), false);
  assert.equal(isAnimated(gif(2)), true);
  assert.equal(isAnimated(gif(2, comment)), true);
  assert.equal(isAnimated(webp(['VP8 ', 31])), false);
  assert.equal(isAnimated(webp(['VP8X', 10], ['ICCP', 501], ['ANIM', 6], ['ANMF', 40])), true);
  assert.equal(isAnimated(png(['IHDR', 13], ['IDAT', 20], ['IEND', 0])), false);
  assert.equal(isAnimated(png(['IHDR', 13], ['tEXt', 300], ['acTL', 8], ['IDAT', 20], ['IEND', 0])), true);
  assert.equal(isAnimated(png(['IHDR', 13], ['IDAT', 20], ['acTL', 8])), false);
  assert.equal(isAnimated(new Uint8Array(2000)), false);
  assert.equal(isAnimated(bytes([0xff, 0xd8, 0xff], ascii('acTL ANIM'))), false);
});

test('a broken file does not hang or throw', () => {
  assert.equal(isAnimated(gif(2).subarray(0, 20)), false);
  assert.equal(isAnimated(webp(['VP8X', 10]).subarray(0, 25)), false);
  assert.equal(isAnimated(png(['IHDR', 13]).subarray(0, 12)), false);
  assert.equal(isAnimated(new Uint8Array(0)), false);
});

test('the cosine table is the one the spec says', () => {
  const start = source.indexOf('const COS = [') + 'const COS = '.length;
  const table = JSON.parse(source.slice(start, source.indexOf('];', start) + 1).replace(/,\s*\]/, ']'));
  assert.equal(table.length, 8 * 32);
  table.forEach((value, i) => {
    const u = Math.floor(i / 32);
    const x = i % 32;
    assert.ok(Math.abs(value - Math.cos(((2 * x + 1) * u * Math.PI) / 64)) < 3e-15, `u${u} x${x}`);
  });
});
