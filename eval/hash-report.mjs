// Reads what hash-check.mjs collected and says whether the hash holds up. Prints to the
// terminal only: file names are fine here, but they don't go in the docs, and hashes of
// test-images/ never leave hash-results/.
//
// The numbers read differently from plain bit counts. Each hash has 31 ones, so two
// hashes are nearly always an even distance apart: one value crossing the median
// pushes another back over, which flips 2 bits. "Within 3" really means one swap.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'hash-results');
const LIMIT = 3;

const pop32 = (n) => {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (Math.imul((n + (n >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) | 0;
};
const distance = (a, b) => {
  const hi = parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16);
  const lo = parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16);
  return pop32(hi) + pop32(lo);
};
const median = (sorted) => sorted[Math.floor(sorted.length / 2)];
const line = (title) => console.log(`\n== ${title}`);
const histogram = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join(' ');
};
const range = (values) => {
  if (!values.length) return 'none';
  const sorted = [...values].sort((a, b) => a - b);
  return `${sorted[0]}–${sorted.at(-1)}, median ${median(sorted)} (${sorted.length})`;
};

const runs = readdirSync(OUT)
  .filter((name) => /^results-.*\.json$/.test(name))
  .map((name) => JSON.parse(readFileSync(join(OUT, name), 'utf8')))
  .sort((a, b) => `${a.context}${a.browser}`.localeCompare(`${b.context}${b.browser}`));
if (!runs.length) throw new Error('no results yet: run hash-check.mjs and open the page');
const names = (run) => `${run.browser} ${run.context}`;
const complete = runs.filter((run) => run.done && !run.error);

line('Runs');
for (const run of runs) {
  const results = Object.values(run.results);
  const missing = {};
  for (const r of results) if (!r.phash) missing[r.why] = (missing[r.why] ?? 0) + 1;
  console.log(`${names(run)}: ${results.length}/${run.total} files${run.done ? '' : ', NOT FINISHED'}${run.error ? `, failed: ${run.error}` : ''}, ${Math.round((run.ms ?? 0) / 1000)} s, canvas ${run.canvasHonest ? 'gives back what went in' : 'DOES NOT give back what went in'}`);
  console.log(`  no hash: ${JSON.stringify(missing)}`);
  console.log(`  ${run.ua}`);
}
for (const browser of ['chrome', 'firefox']) {
  if (!complete.some((run) => run.browser === browser && run.context === 'extension')) console.log(`NOT RUN: ${browser} on an extension page`);
}
console.log('A web page is not an extension: canvas noise can differ on an extension page, and the background and offscreen documents still need checking when the hash is wired in.');

// Files, grouped by the picture they came from.
const sample = complete[0] ?? runs[0];
const pictures = new Map();
for (const file of Object.keys(sample.results)) {
  const [, kind, rest] = file.match(/^([^/]+)\/(.*)$/);
  if (kind === 'originals') (pictures.get(rest) ?? pictures.set(rest, { copies: [], trims: {} }).get(rest)).original = file;
  if (kind === 'variants') {
    const [, picture, id] = rest.match(/^(.*)\/([^/]+)\.\w+$/);
    const entry = pictures.get(picture) ?? pictures.set(picture, { copies: [], trims: {} }).get(picture);
    if (id.startsWith('trim')) entry.trims[id] = file;
    else entry.copies.push({ id, file });
  }
}
// The 205 the published table is about, and the rest.
const isMain = (picture) => /^(ai|real)\//.test(picture);
const isDuplicate = (picture) => picture.startsWith('duplicates/');
const isFlyer = (picture) => picture.startsWith('flyers/');

line('Fixtures (made up, nothing from test-images/)');
const expected = existsSync(join(OUT, 'fixtures/expected.json')) ? JSON.parse(readFileSync(join(OUT, 'fixtures/expected.json'), 'utf8')) : {};
for (const run of complete) {
  const got = (name) => run.results[`fixtures/${name}`] ?? {};
  const problems = [];
  for (const [file, hex] of Object.entries(expected)) {
    const r = run.results[file];
    if (hex && r.phash !== hex) problems.push(`${file}: ${r.phash ?? r.why}, Node has ${hex}, ${r.phash ? distance(r.phash, hex) : '?'} bits`);
  }
  for (const [name, why] of Object.entries({
    'too-narrow.png': 'small',
    'over-40mp.jpg': 'large',
    'flat-white.png': 'flat',
    'flat-gray.jpg': 'flat',
    'faint1.png': 'flat',
    'faint1.jpg': 'flat',
    'faint3.png': 'flat',
    'faint3.jpg': 'flat',
    'faint8.png': 'flat',
    'faint8.jpg': 'flat',
    'animated.gif': 'animated',
    'animated.webp': 'animated',
    'animated-apng.png': 'animated',
  })) {
    if (got(name).why !== why) problems.push(`${name} should be ${why}, got ${got(name).phash ?? got(name).why}`);
  }
  for (const name of ['still.gif', 'still.webp', 'exactly-32.png', 'under-40mp.jpg', 'very-wide.jpg', 'display-p3.jpg']) {
    if (!got(name).phash) problems.push(`${name} should have a hash, got ${got(name).why}`);
  }
  const pair = (a, b) => (got(a).phash && got(b).phash ? distance(got(a).phash, got(b).phash) : '?');
  const upright = pair('orient6.jpg', 'upright.png');
  const sideways = pair('orient6.jpg', 'sideways.png');
  const white = pair('half-clear.png', 'half-clear-on-white.png');
  if (upright === '?' || upright > LIMIT) problems.push(`EXIF 6 is ${upright} bits from upright`);
  if (white === '?' || white > LIMIT) problems.push(`half-clear is ${white} bits from the same on white`);
  console.log(`${names(run)}: ${problems.length ? 'FAILED' : 'ok'}. EXIF 6 vs upright ${upright} bits, vs sideways ${sideways}; half-clear vs on white ${white}`);
  for (const problem of problems) console.log(`  ${problem}`);
  const spread = (name) => `${name} ${Math.round(got(name).spread ?? 0)}`;
  console.log(`  spreads: ${['flat-gray.jpg', 'faint1.png', 'faint1.jpg', 'faint3.png', 'faint3.jpg', 'faint8.png', 'faint8.jpg'].map(spread).join(', ')}`);
}
for (const file of Object.keys(sample.results).filter((f) => f.startsWith('fixtures/'))) {
  const seen = complete.map((run) => run.results[file]?.phash);
  if (new Set(seen).size > 1) {
    const hashed = seen.filter(Boolean);
    let worst = 0;
    for (const a of hashed) for (const b of hashed) worst = Math.max(worst, distance(a, b));
    console.log(`browsers differ on ${file}: ${worst} bits${hashed.length < seen.length ? ', and some gave no hash' : ''}`);
  }
}

line(`The CROWD-API table again, ${[...pictures.keys()].filter(isMain).length} pictures, each browser against itself`);
const closest = [];
for (const run of complete) {
  const hex = (file) => run.results[file]?.phash;
  const recompressed = [];
  const trims = { trim3: [], trim8: [] };
  for (const [picture, entry] of pictures) {
    if (!isMain(picture) || !hex(entry.original)) continue;
    for (const { file } of entry.copies) if (hex(file)) recompressed.push(distance(hex(entry.original), hex(file)));
    for (const id of Object.keys(trims)) if (hex(entry.trims[id])) trims[id].push(distance(hex(entry.original), hex(entry.trims[id])));
  }
  const list = [...pictures].filter(([picture, entry]) => isMain(picture) && hex(entry.original));
  const different = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = distance(hex(list[i][1].original), hex(list[j][1].original));
      different.push(d);
      if (run === complete[0]) closest.push([d, list[i][0], list[j][0]]);
    }
  }
  console.log(`${names(run)}:`);
  console.log(`  resize and recompress: ${range(recompressed)}; over ${LIMIT}: ${recompressed.filter((d) => d > LIMIT).length}`);
  console.log(`  trim 3%: ${range(trims.trim3)}; at or under ${LIMIT}: ${trims.trim3.filter((d) => d <= LIMIT).length}`);
  console.log(`  trim 8%: ${range(trims.trim8)}; at or under ${LIMIT}: ${trims.trim8.filter((d) => d <= LIMIT).length}`);
  console.log(`  different pictures: ${range(different)}; at or under ${LIMIT}: ${different.filter((d) => d <= LIMIT).length}`);
}
console.log('Trims are known misses: a crop a site makes itself will not match.');

line('Closest different pictures');
closest.sort((a, b) => a[0] - b[0]);
for (const [d, a, b] of closest.slice(0, 12)) console.log(`${d}  ${a}  ${b}`);

line('test-images/duplicates/ as true reposts');
const hexOf = (file) => complete[0]?.results[file]?.phash;
for (const [picture, entry] of pictures) {
  if (!isDuplicate(picture) || !hexOf(entry.original)) continue;
  const stem = picture.split('/').pop().replace(/(-\d+)?\.\w+$/, '');
  const sameName = [...pictures.keys()].filter((p) => p !== picture && p.split('/').pop().replace(/(-\d+)?\.\w+$/, '') === stem);
  let best = [Infinity, null];
  for (const [other, candidate] of pictures) {
    if (other === picture || !hexOf(candidate.original)) continue;
    const d = distance(hexOf(entry.original), hexOf(candidate.original));
    if (d < best[0]) best = [d, other];
  }
  const named = sameName.filter((p) => hexOf(pictures.get(p).original)).map((p) => distance(hexOf(entry.original), hexOf(pictures.get(p).original)));
  console.log(`${picture}: same name ${named.length ? `${named.join(', ')} bits` : 'none'}; nearest ${best[0]} bits ${best[1]}`);
}

// Every browser against every other at every size, for one picture.
function hashesOf(entry) {
  const out = [];
  for (const run of complete) {
    for (const { file, id } of [{ file: entry.original, id: 'original' }, ...entry.copies]) {
      const hex = run.results[file]?.phash;
      if (hex) out.push({ browser: names(run), id, hex });
    }
  }
  return out;
}

line('Browsers against each other on the same file');
const sameFile = [];
const browserPairs = new Map();
const files = Object.keys(sample.results).filter((f) => !f.startsWith('fixtures/') && !/\/trim\d\.jpg$/.test(f));
for (const file of files) {
  for (let a = 0; a < complete.length; a++) {
    for (let b = a + 1; b < complete.length; b++) {
      const [x, y] = [complete[a].results[file]?.phash, complete[b].results[file]?.phash];
      if (!x || !y) continue;
      const d = distance(x, y);
      sameFile.push(d);
      const key = `${names(complete[a])} vs ${names(complete[b])}`;
      (browserPairs.get(key) ?? browserPairs.set(key, []).get(key)).push(d);
    }
  }
}
for (const [key, values] of browserPairs) console.log(`${key}: worst ${values.reduce((worst, d) => Math.max(worst, d), 0)}, over ${LIMIT}: ${values.filter((d) => d > LIMIT).length} of ${values.length}; ${histogram(values)}`);
const worstSameFile = sameFile.reduce((worst, d) => Math.max(worst, d), 0);
console.log(`all: worst ${worstSameFile}, over ${LIMIT}: ${sameFile.filter((d) => d > LIMIT).length} of ${sameFile.length}`);

line('The whole matrix: browser A at one size against browser B at another');
console.log(`Four 16-bit bands only promise a shared band up to ${LIMIT} bits, so this is the number that has to fit.`);
const allPairs = [];
const worstByPicture = [];
const worstByCopy = new Map();
const pairOfSizes = new Map();
for (const [picture, entry] of pictures) {
  const hashes = hashesOf(entry);
  let worst = -1;
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const d = distance(hashes[i].hex, hashes[j].hex);
      allPairs.push(d);
      worst = Math.max(worst, d);
      for (const id of [hashes[i].id, hashes[j].id]) {
        const seen = worstByCopy.get(id) ?? worstByCopy.set(id, { over: 0, worst: 0, n: 0 }).get(id);
        seen.n++;
        seen.worst = Math.max(seen.worst, d);
        if (d > LIMIT) seen.over++;
      }
      if (d > LIMIT) {
        const key = [hashes[i].id, hashes[j].id].sort().join(' / ');
        pairOfSizes.set(key, (pairOfSizes.get(key) ?? 0) + 1);
      }
    }
  }
  if (worst >= 0) worstByPicture.push({ picture, worst, spread: complete.reduce((s, run) => Math.min(s, run.results[entry.original]?.spread ?? Infinity), Infinity), hashes: hashes.length });
}
const overPairs = allPairs.filter((d) => d > LIMIT).length;
const overPictures = worstByPicture.filter((p) => p.worst > LIMIT).length;
const worstMatrix = allPairs.reduce((worst, d) => Math.max(worst, d), 0);
console.log(`pairs: ${allPairs.length}, over ${LIMIT}: ${overPairs} (${((100 * overPairs) / allPairs.length).toFixed(2)}%), worst ${worstMatrix}`);
console.log(`distances: ${histogram(allPairs)}`);
console.log(`pictures: ${worstByPicture.length}, with a pair over ${LIMIT}: ${overPictures}; worst per picture: ${histogram(worstByPicture.map((p) => p.worst))}`);
console.log('share of pairs over the limit, by copy:');
for (const [id, seen] of [...worstByCopy].sort((a, b) => b[1].over / b[1].n - a[1].over / a[1].n)) {
  console.log(`  ${id}: worst ${seen.worst}, over ${LIMIT}: ${seen.over} of ${seen.n} (${((100 * seen.over) / seen.n).toFixed(2)}%)`);
}
console.log('pairs of copies most often over:');
for (const [key, n] of [...pairOfSizes].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${n}  ${key}`);

line('Spread against stability');
const byWorst = [...worstByPicture].sort((a, b) => a.spread - b.spread);
console.log(`smallest spreads among real pictures (spread, worst matrix distance): ${byWorst.slice(0, 12).map((p) => `${Math.round(p.spread)}:${p.worst}`).join(' ')}`);
for (const [low, high] of [[0, 20000], [20000, 40000], [40000, 80000], [80000, Infinity]]) {
  const band = worstByPicture.filter((p) => p.spread >= low && p.spread < high);
  if (band.length) console.log(`spread ${low}–${high}: ${band.length} pictures, median worst ${median(band.map((p) => p.worst).sort((a, b) => a - b))}, over ${LIMIT}: ${band.filter((p) => p.worst > LIMIT).length}`);
}

line('Different pictures across the whole matrix');
const entries = [...pictures].map(([picture, entry]) => ({ picture, hexes: [...new Set(hashesOf(entry).map((h) => h.hex))] })).filter((e) => e.hexes.length);
let collisions = 0;
let pairCount = 0;
let closestAny = Infinity;
const nearMiss = [];
for (let i = 0; i < entries.length; i++) {
  for (let j = i + 1; j < entries.length; j++) {
    if (isDuplicate(entries[i].picture) || isDuplicate(entries[j].picture)) continue;
    let best = Infinity;
    for (const x of entries[i].hexes) for (const y of entries[j].hexes) best = Math.min(best, distance(x, y));
    pairCount++;
    closestAny = Math.min(closestAny, best);
    if (best <= LIMIT) collisions++;
    nearMiss.push([best, entries[i].picture, entries[j].picture]);
  }
}
console.log(`picture pairs: ${pairCount}, closest any copy ever gets: ${closestAny}, pairs that would merge: ${collisions}`);
for (const [d, a, b] of nearMiss.sort((x, y) => x[0] - y[0]).slice(0, 6)) console.log(`  ${d}  ${a}  ${b}`);

line('Flyers from one template');
const flyers = [...pictures.keys()].filter(isFlyer);
if (!flyers.length) console.log('No flyers in this run. Add them to test-images/flyers/, restart the server and run every browser again.');
const templates = new Map();
for (const picture of flyers) {
  const template = picture.split('/')[1];
  (templates.get(template) ?? templates.set(template, []).get(template)).push(picture);
}
for (const [template, members] of templates) {
  const values = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const [x, y] = [hexOf(pictures.get(members[i]).original), hexOf(pictures.get(members[j]).original)];
      if (x && y) values.push(distance(x, y));
    }
  }
  console.log(`${template}: ${members.length} pictures, ${range(values)}; at or under ${LIMIT}: ${values.filter((d) => d <= LIMIT).length}`);
}

line('Verdict');
const verdict = (ok, text) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`);
verdict(worstSameFile <= LIMIT, `browsers agree within ${LIMIT} on the same file: worst ${worstSameFile}`);
verdict(worstMatrix <= LIMIT, `reposts and copies stay within ${LIMIT} across the whole matrix: worst ${worstMatrix}, ${overPairs} pairs over`);
verdict(collisions === 0, `different pictures stay over ${LIMIT}: ${collisions} pairs at or under, closest ${closestAny}`);
