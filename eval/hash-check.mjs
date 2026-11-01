// Checks the perceptual hash in real browsers. It makes the variants of test-images/
// once, here, so every browser gets the same bytes, then serves hash-check.html, which
// hashes everything with the real phash.js and posts the results here. hash-report.mjs
// reads them.
//
//   node hash-check.mjs      then open http://127.0.0.1:8768/ in each browser
//
// Everything it writes is in hash-results/, which stays out of git: hashes of real
// people's posts are as private as the posts. Making the variants needs sharp, from
// npm install here, and the APNG fixture needs ffmpeg. Serving needs neither.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const PORT = 8768;
const HOST = '127.0.0.1'; // these are private pictures and hashes, so never the network
const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = join(HERE, '../test-images');
const PHASH = join(HERE, '../extension/src/phash.js');
const OUT = join(HERE, 'hash-results');
const VARIANTS = join(OUT, 'variants');
const FIXTURES = join(OUT, 'fixtures');
const EXTENSION = join(OUT, 'extension');
const PICTURE = /\.(jpe?g|png|webp|gif|avif)$/i;

// What sites do to a repost: several filters, sizes and encoders. The odd widths are on
// purpose, because round numbers hide box filter mistakes.
const JPEG = (quality, chroma) => ({ format: 'jpeg', ext: 'jpg', options: { quality, chromaSubsampling: chroma } });
const WEBP = (quality) => ({ format: 'webp', ext: 'webp', options: { quality } });
const COPIES = [
  ['w160-lanczos3-jpeg75-420', 160, 'lanczos3', JPEG(75, '4:2:0')],
  ['w241-mitchell-jpeg30-420', 241, 'mitchell', JPEG(30, '4:2:0')],
  ['w320-cubic-webp50', 320, 'cubic', WEBP(50)],
  ['w361-lanczos2-jpeg50-444', 361, 'lanczos2', JPEG(50, '4:4:4')],
  ['w480-lanczos3-webp75', 480, 'lanczos3', WEBP(75)],
  ['w640-linear-jpeg60-420', 640, 'linear', JPEG(60, '4:2:0')],
  ['w720-mks2021-jpeg85-444', 720, 'mks2021', JPEG(85, '4:4:4')],
  ['w961-mitchell-webp30', 961, 'mitchell', WEBP(30)],
  ['w1080-cubic-jpeg90-420', 1080, 'cubic', JPEG(90, '4:2:0')],
  ['w1283-lanczos3-jpeg70-420', 1283, 'lanczos3', JPEG(70, '4:2:0')],
  ['w2048-lanczos3-jpeg90-444', 2048, 'lanczos3', JPEG(90, '4:4:4')],
  ['w2048-mks2013-webp80', 2048, 'mks2013', WEBP(80)],
  ['same-jpeg30-420', 0, 'lanczos3', JPEG(30, '4:2:0')],
  ['same-jpeg90-444', 0, 'lanczos3', JPEG(90, '4:4:4')],
];
// Known misses, measured so the docs can say so. A site's own crop won't match.
const TRIMS = [
  ['trim3', 0.03],
  ['trim8', 0.08],
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const originals = () => walk(IMAGES).filter((path) => PICTURE.test(path)).sort();

async function pool(items, work) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length) await work(queue.shift());
  };
  await Promise.all(Array.from({ length: availableParallelism() }, worker));
}

async function makeVariants(sharp) {
  const encode = (image, { format, options }) => image.toFormat(format, options);
  await pool(originals(), async (path) => {
    const dir = join(VARIANTS, relative(IMAGES, path));
    mkdirSync(dir, { recursive: true });
    const base = () => sharp(path).rotate().flatten({ background: '#fff' });
    for (const [id, width, kernel, encoder] of COPIES) {
      const file = join(dir, `${id}.${encoder.ext}`);
      if (existsSync(file)) continue;
      const image = base();
      await encode(width ? image.resize({ width, kernel }) : image, encoder).toFile(file);
    }
    const { width, height } = await base().png().toBuffer({ resolveWithObject: true }).then((r) => r.info);
    for (const [id, share] of TRIMS) {
      const file = join(dir, `${id}.jpg`);
      if (existsSync(file)) continue;
      const left = Math.round(width * share);
      const top = Math.round(height * share);
      const box = { left, top, width: width - 2 * left, height: height - 2 * top };
      await base().extract(box).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(file);
    }
  });
}

// A deterministic picture with detail at every scale, so nothing from test-images/ is
// involved in checking the decoder's edge cases.
function busy(width, height, channels = 3) {
  const pixels = Buffer.alloc(width * height * channels, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * channels;
      pixels[at] = 128 + 100 * Math.sin(x / 17) * Math.cos(y / 23);
      pixels[at + 1] = 128 + 90 * Math.sin((x + y) / 31);
      pixels[at + 2] = ((x >> 4) ^ (y >> 4)) & 1 ? 200 : 60;
    }
  }
  return pixels;
}

function faint(width, height, seed, reach) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    pixels[i] = 200 + (seed >>> 24) % (2 * reach + 1) - reach;
  }
  return pixels;
}

async function makeFixtures(sharp) {
  if (existsSync(join(FIXTURES, 'expected.json'))) return;
  mkdirSync(FIXTURES, { recursive: true });
  const raw = (pixels, width, height, channels = 3) => sharp(pixels, { raw: { width, height, channels } });
  const path = (name) => join(FIXTURES, name);
  const W = 480;
  const H = 320;

  // EXIF orientation 6: stored on its side, shown upright. sideways.png is the same
  // pixels with the tag ignored, which is what getting it wrong looks like.
  await raw(busy(W, H), W, H).png().toFile(path('sideways.png'));
  await raw(busy(W, H), W, H).withMetadata({ orientation: 6 }).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toFile(path('orient6.jpg'));
  await raw(busy(W, H), W, H).rotate(90).png().toFile(path('upright.png'));

  const clear = busy(W, H, 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) clear[(y * W + x) * 4 + 3] = x < W / 2 ? 255 : 0; // half opaque, half clear
  }
  await raw(clear, W, H, 4).png().toFile(path('half-clear.png'));
  await raw(clear, W, H, 4).flatten({ background: '#fff' }).png().toFile(path('half-clear-on-white.png'));

  await sharp({ create: { width: 200, height: 200, channels: 3, background: '#fff' } }).png().toFile(path('flat-white.png'));
  await sharp({ create: { width: 200, height: 200, channels: 3, background: '#c8c8c8' } }).jpeg({ quality: 75 }).toFile(path('flat-gray.jpg'));
  for (const reach of [1, 3, 8]) {
    await raw(faint(400, 300, 7, reach), 400, 300).png().toFile(path(`faint${reach}.png`));
    await raw(faint(400, 300, 7, reach), 400, 300).jpeg({ quality: 75 }).toFile(path(`faint${reach}.jpg`));
  }
  await raw(busy(31, 100), 31, 100).png().toFile(path('too-narrow.png'));
  await raw(busy(32, 32), 32, 32).png().toFile(path('exactly-32.png'));
  await raw(busy(W, H), W, H).withIccProfile('p3').jpeg({ quality: 90 }).toFile(path('display-p3.jpg'));

  // Big ones. Over 40 MP gets no hash, and just under it has to survive the strips.
  const big = (width, height) => {
    return sharp(busy(200, 150), { raw: { width: 200, height: 150, channels: 3 } }).resize({ width, height, kernel: 'nearest', fit: 'fill' });
  };
  await big(6500, 6500).jpeg({ quality: 60 }).toFile(path('over-40mp.jpg'));
  await big(6200, 6200).jpeg({ quality: 60 }).toFile(path('under-40mp.jpg'));
  await big(20000, 700).jpeg({ quality: 60 }).toFile(path('very-wide.jpg'));

  // Three frames that differ, so a browser's choice of frame would show.
  const frames = Buffer.concat([busy(120, 80), Buffer.alloc(120 * 80 * 3, 40), busy(120, 80).reverse()]);
  const film = () => sharp(frames, { raw: { width: 120, height: 240, channels: 3, pageHeight: 80 } });
  await film().gif().toFile(path('animated.gif'));
  await film().webp({ quality: 80 }).toFile(path('animated.webp'));
  await raw(busy(120, 80), 120, 80).gif().toFile(path('still.gif'));
  await raw(busy(120, 80), 120, 80).webp({ quality: 80 }).toFile(path('still.webp'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path('animated.gif'), '-f', 'apng', '-plays', '0', path('animated-apng.png')]);

  // What the hash has to be when a browser hands back exactly the file's pixels.
  const ctx = {};
  vm.runInNewContext(readFileSync(PHASH, 'utf8'), ctx);
  const SlopHash = vm.runInNewContext('SlopHash', ctx);
  const expected = {};
  for (const name of ['sideways.png', 'upright.png', 'half-clear-on-white.png', 'exactly-32.png', 'faint1.png', 'faint3.png', 'faint8.png']) {
    const { data, info } = await sharp(path(name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expected[`fixtures/${name}`] = SlopHash.fromPixels(new Uint8Array(data), info.width, info.height).phash;
  }
  writeFileSync(join(FIXTURES, 'expected.json'), JSON.stringify(expected, null, 2));
}

function makeExtension() {
  rmSync(EXTENSION, { recursive: true, force: true });
  mkdirSync(EXTENSION, { recursive: true });
  cpSync(join(HERE, 'hash-ext'), EXTENSION, { recursive: true });
  cpSync(join(HERE, 'hash-check.html'), join(EXTENSION, 'check.html'));
  cpSync(PHASH, join(EXTENSION, 'phash.js')); // extension pages can't load files from outside
}

function fileList() {
  const under = (root, label) => walk(root).filter((path) => PICTURE.test(path)).map((path) => join(label, relative(root, path)));
  return [...under(IMAGES, 'originals'), ...under(VARIANTS, 'variants'), ...under(FIXTURES, 'fixtures')].sort();
}

function serve(files) {
  const known = new Set(files);
  const roots = { originals: IMAGES, variants: VARIANTS, fixtures: FIXTURES };
  const runs = new Map();

  const save = (run) => writeFileSync(join(OUT, `results-${run.browser}-${run.context}.json`), JSON.stringify(run));

  function receive(body) {
    const { browser, context, start, ua, total, canvasHonest, results, done, ms, error } = JSON.parse(body);
    if (!/^[a-z]+$/.test(browser) || !/^[a-z]+$/.test(context)) return;
    const key = `${browser}-${context}`;
    if (start) runs.set(key, { browser, context, ua, total, canvasHonest, done: false, results: {} });
    const run = runs.get(key);
    if (!run) return;
    Object.assign(run.results, results);
    if (done) Object.assign(run, { done, ms });
    if (error) run.error = error;
    if (done || error) console.log(`${key}: ${Object.keys(run.results).length} results${error ? `, failed: ${error}` : ''}`);
    save(run);
  }

  const server = createServer((req, res) => {
    const reply = (status, type, body) => {
      const headers = { 'content-type': type, 'cache-control': 'no-store' };
      // The test extension's page, and nobody else. A site in another tab gets nothing.
      if (/^(chrome|moz)-extension:\/\//.test(req.headers.origin ?? '')) headers['access-control-allow-origin'] = req.headers.origin;
      res.writeHead(status, headers).end(body);
    };
    if (req.headers.host !== `${HOST}:${PORT}`) return reply(403, 'text/plain', 'no');
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (req.method === 'POST' && path === '/results') {
      const origin = req.headers.origin ?? '';
      if (origin !== `http://${HOST}:${PORT}` && !/^(chrome|moz)-extension:\/\//.test(origin)) return reply(403, 'text/plain', 'no');
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        receive(Buffer.concat(chunks).toString());
        reply(200, 'text/plain', 'ok');
      });
      return undefined;
    }
    if (path === '/') return reply(200, 'text/html', readFileSync(join(HERE, 'hash-check.html')));
    if (path === '/phash.js') return reply(200, 'text/javascript', readFileSync(PHASH));
    if (path === '/run.js') return reply(200, 'text/javascript', readFileSync(join(HERE, 'hash-ext/run.js')));
    if (path === '/list') return reply(200, 'application/json', JSON.stringify({ files }));
    if (path.startsWith('/file/') && known.has(path.slice(6))) {
      const [root, ...rest] = path.slice(6).split('/');
      return reply(200, 'application/octet-stream', readFileSync(join(roots[root], ...rest)));
    }
    return reply(404, 'text/plain', 'not found');
  });
  server.listen(PORT, HOST, () => console.log(`http://${HOST}:${PORT}/  ${files.length} files. Ctrl-C when the browsers are done.`));
}

mkdirSync(OUT, { recursive: true });
const { default: sharp } = await import('sharp').catch(() => ({}));
if (sharp) {
  await makeFixtures(sharp);
  await makeVariants(sharp);
} else if (!existsSync(FIXTURES)) {
  throw new Error('run npm install in eval/ first, to make the variants');
}
makeExtension();
serve(fileList());
