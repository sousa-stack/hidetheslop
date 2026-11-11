// Runs the real extension in throwaway headless browsers against a local stand-in for the
// API, and checks the crowd's list end to end: what a list download sends, a match hiding
// a drawn picture through Chrome's offscreen page and Firefox's background page, your own
// Not AI beating the list, turning it off, and what hashing every inspected picture costs.
// Run from this folder, after building: node crowd-check.mjs (or: node crowd-check.mjs chrome)
//
// It never reaches the live API: it uses vote-check.mjs's copies of dist/ pointed at this
// machine, its temporary profiles and its drawn pictures, so nothing from test-images/ is
// involved. The verdict list it serves is made up here.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { finish, picture, pointAtLocal, startChrome, startFirefox, treeMb } from './vote-check.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = here('models/Xenova/clip-vit-base-patch32/onnx/vision_model_int8.onnx');
const FF_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const only = process.argv[2];

async function makeFixtures() {
  return {
    'listed.jpg': await picture(1080, 1080, 31).jpeg({ quality: 85 }).toBuffer(),
    'unlisted.jpg': await picture(1080, 1080, 33).jpeg({ quality: 85 }).toBuffer(),
    'yours.jpg': await picture(1080, 1080, 35).jpeg({ quality: 85 }).toBuffer(),
    'feed-1mp.jpg': await picture(1080, 1080, 11).jpeg({ quality: 85 }).toBuffer(),
    'big-12mp.jpg': await picture(4000, 3000, 13).jpeg({ quality: 85 }).toBuffer(),
    'over-12mp.jpg': await picture(4200, 3000, 15).jpeg({ quality: 85 }).toBuffer(),
  };
}

// A feed with three posts, each with one big picture. Served from this machine, so the
// content script runs on it like any other page.
const PAGE = `<!doctype html><meta charset="utf-8"><title>feed</title>
<style>figure { margin: 10px; } img { width: 300px; height: 300px; display: block; }</style>
<figure id="listed"><img src="/fixture/listed.jpg"><figcaption>on the list</figcaption></figure>
<figure id="unlisted"><img src="/fixture/unlisted.jpg"><figcaption>not on the list</figcaption></figure>
<figure id="yours"><img src="/fixture/yours.jpg"><figcaption>on the list, but you said Not AI</figcaption></figure>`;

function startServer(fixtures, list) {
  const log = { gets: [], pictures: {} };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/v1/verdicts') {
      log.gets.push({ url: req.url, method: req.method, headers: req.rawHeaders });
      const since = Number(url.searchParams.get('since'));
      const reply = list(since);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' });
      return res.end(JSON.stringify(reply));
    }
    if (url.pathname === '/model') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(readFileSync(MODEL));
    }
    if (url.pathname === '/feed.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(PAGE);
    }
    const name = url.pathname.split('/').pop();
    if (!fixtures[name]) return res.writeHead(404).end();
    log.pictures[url.pathname] = (log.pictures[url.pathname] || 0) + 1;
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' });
    res.end(fixtures[name]);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, log, port: server.address().port })));
}

const headersOf = (raw) => {
  const out = {};
  for (let i = 0; i < raw.length; i += 2) out[raw[i].toLowerCase()] = raw[i + 1];
  return out;
};

async function until(check, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

// inspect() with and without the hash, where it really runs. Medians of 5, and the peak
// of the browser's whole process tree over those runs.
async function measure(browser, url, hash) {
  const run = (expr) => (browser.name === 'chrome' ? browser.inOffscreen(expr) : browser.evaluate(`(async () => { const SlopVision = (await browser.runtime.getBackgroundPage()).SlopVision; const performance = (await browser.runtime.getBackgroundPage()).performance; return ${expr}; })()`));
  const once = `(async () => { const t = performance.now(); const r = await SlopVision.inspect(${JSON.stringify(url)}, { hash: ${hash} }); return { ms: performance.now() - t, phash: r && r.phash }; })()`;
  await run(once); // warm: the picture is in the HTTP cache and the session is loaded
  const base = treeMb(browser.proc.pid);
  let peak = base;
  const sampler = setInterval(() => (peak = Math.max(peak, treeMb(browser.proc.pid))), 40);
  const runs = [];
  let phash;
  for (let i = 0; i < 5; i++) {
    const r = await run(once);
    runs.push(r.ms);
    phash = r.phash;
  }
  clearInterval(sampler);
  runs.sort((a, b) => a - b);
  return { medianMs: Math.round(runs[2]), slowestMs: Math.round(runs[4]), peakExtraMb: Math.round(peak - base), phash };
}

async function check(browser, ctx) {
  const { log, port, modelUrl } = ctx;
  const base = `http://127.0.0.1:${port}`;
  const results = [];
  const ok = (name, pass, detail = '') => {
    results.push({ name: `${browser.name}: ${name}`, pass });
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  };
  const local = (keys) => browser.evaluate(`SLOP_API.storage.local.get(${JSON.stringify(keys)})`);
  const goto = async (page) => {
    await browser.evaluate(`(() => { setTimeout(() => (location.href = ${JSON.stringify(page)}), 0); return true; })()`);
    await sleep(800);
    await until(async () => (await browser.evaluate(`document.readyState`)) === 'complete', 10000, page);
    await sleep(300);
  };

  console.log(`\n=== ${browser.version}`);
  for (const key of Object.keys(log.pictures)) delete log.pictures[key]; // one server serves both browsers
  await until(() => browser.evaluate(`document.readyState === 'complete' && typeof SLOP_API === 'object'`), 10000, 'the welcome page');
  await sleep(500);
  const alarm = await browser.evaluate(`SLOP_API.alarms.get('fetch-crowd')`);
  ok('the 6-hourly list alarm exists', alarm?.periodInMinutes === 360, `first in ${Math.round((alarm?.scheduledTime - Date.now()) / 60000)} min`);
  ok('nothing was fetched at start, with your robot off', log.gets.length === 0);

  // Your robot on, with the model from eval/models. useCrowdList is on by default.
  await browser.evaluate(`(async () => {
    const buf = await (await fetch(${JSON.stringify(`${base}/model`)})).arrayBuffer();
    await (await caches.open('hidetheslop-model')).put(${JSON.stringify(modelUrl)}, new Response(buf));
    await SLOP_API.storage.sync.set({ visualCheck: true });
    return true;
  })()`);
  const settings = await browser.evaluate(`slopGetSettings()`);
  ok('the list is on by default', settings.useCrowdList === true);
  const moved = await until(async () => {
    const a = await browser.evaluate(`SLOP_API.alarms.get('fetch-crowd')`);
    return a && a.scheduledTime - Date.now() <= 30 * 60000 ? a : null;
  }, 5000, 'the alarm to move').catch(() => null);
  ok('turning your robot on brings the alarm within 30 minutes', !!moved, moved && `in ${Math.round((moved.scheduledTime - Date.now()) / 60000)} min`);

  // Fire the real alarm now, rather than waiting up to half an hour.
  const fired = Date.now();
  await browser.evaluate(`(SLOP_API.alarms.create('fetch-crowd', { when: Date.now() + 200, periodInMinutes: 360 }), true)`);
  const stored = await until(async () => {
    const got = await local(['crowdList', 'crowdSeq', 'crowdFetchedAt']);
    return got.crowdFetchedAt ? got : null;
  }, 70000, 'the list download');
  ok('the alarm downloads the list, following more', log.gets.map((g) => g.url).join() === '/v1/verdicts?since=0&hashVersion=1,/v1/verdicts?since=2&hashVersion=1', `${Date.now() - fired} ms after the alarm was set`);
  ok('the list is stored with its seq', stored.crowdSeq === 3 && stored.crowdList.length === ctx.list.length, `${stored.crowdList.length} hashes`);
  for (const get of log.gets) {
    const heads = headersOf(get.headers);
    ok(`${get.url} is a GET with no cookie, referer or body`, get.method === 'GET' && !heads.cookie && !heads.referer && !heads['content-length']);
    if (browser.name === 'firefox') ok(`${get.url} has no moz-extension Origin`, !heads.origin && !JSON.stringify(get.headers).includes(FF_UUID), `origin: ${heads.origin ?? 'none'}`);
  }
  ctx.gets[browser.name] = log.gets.splice(0);
  if (browser.name === 'firefox') {
    // A control, with the strip rule off: a POST must then carry the install's address, or
    // the check above proves nothing. What a GET carries is printed alongside.
    await browser.evaluate(`SLOP_API.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['strip-origin'] })`);
    const rules = await browser.evaluate(`SLOP_API.declarativeNetRequest.getEnabledRulesets()`);
    const send = (method) => browser.evaluate(`(async () => { const bg = await browser.runtime.getBackgroundPage(); await bg.fetch('http://api.hidetheslop.com:${port}/v1/verdicts?since=99&hashVersion=1', { method: '${method}', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' }); return true; })()`);
    await send('GET');
    await send('POST');
    const [get, post] = log.gets.splice(0).map((g) => headersOf(g.headers));
    ok('control: with the strip rule off, a POST carries the moz-extension Origin', !rules.includes('strip-origin') && (post?.origin || '').includes(FF_UUID), `GET origin: ${get?.origin ?? 'none'}, POST origin: ${post?.origin ?? 'none'}`);
    await browser.evaluate(`SLOP_API.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ['strip-origin'] })`);
  }

  // Your Not AI on a copy at another address: only the hash can tell it's the same picture.
  await browser.evaluate(`SLOP_API.runtime.sendMessage({ type: 'learn', url: ${JSON.stringify(`${base}/copy/yours.jpg`)}, label: 'real', source: 'rated' })`);
  const own = await local(['ownVerdicts']);
  ok('a rating is remembered with its hash, sharing off', own.ownVerdicts?.length === 1 && own.ownVerdicts[0].phash === ctx.hashes.yours && own.ownVerdicts[0].label === 'real');

  // The real content script on a real page, through the offscreen or background path.
  await goto(`${base}/feed.html`);
  const state = await until(async () => {
    const s = await browser.evaluate(`(() => {
      const out = {};
      for (const f of document.querySelectorAll('figure')) {
        const img = f.querySelector('img');
        const el = f.dataset.hidetheslop ? f : img;
        out[f.id] = { state: el.dataset.hidetheslop || 'visible', why: (el.querySelector(':scope > .hidetheslop-ph')?.shadowRoot.textContent.match(/hid this: [^\\n]*?(?=Show|$)/) || [el.title || ''])[0].trim() };
      }
      return out;
    })()`);
    return s.listed.state !== 'visible' ? s : null;
  }, 30000, 'the listed picture to be hidden').catch(() => null);
  const why = state?.listed.why || '';
  ok('a picture on the list is hidden, and says the crowd flagged it', /the crowd flagged it/.test(why), why);
  await sleep(1500); // the others get the same time to be wrongly hidden
  const after = await browser.evaluate(`[...document.querySelectorAll('figure')].map((f) => [f.id, f.dataset.hidetheslop || f.querySelector('img').dataset.hidetheslop || 'visible', f.querySelector('img').title || ''])`);
  ok('a picture not on the list is not crowd-hidden', !after.find(([id]) => id === 'unlisted')[2].includes('crowd'), JSON.stringify(after.find(([id]) => id === 'unlisted')));
  ok('a picture you rated Not AI elsewhere is not crowd-hidden', !after.find(([id]) => id === 'yours')[2].includes('crowd'), JSON.stringify(after.find(([id]) => id === 'yours')));
  ok('hashing added no download: at most one by the page and one by the extension', ['listed', 'unlisted', 'yours'].every((n) => log.pictures[`/fixture/${n}.jpg`] <= 2), JSON.stringify(log.pictures));

  // Back to an extension page for the rest.
  ctx.costs[browser.name] = {};
  await browser.home();
  for (const name of ['feed-1mp.jpg', 'big-12mp.jpg', 'over-12mp.jpg']) {
    const url = `${base}/fixture/${name}`;
    ctx.costs[browser.name][name] = { without: await measure(browser, url, false), with: await measure(browser, url, true) };
  }
  ok('over 12 megapixels is not hashed', ctx.costs[browser.name]['over-12mp.jpg'].with.phash === undefined);
  ok('a feed picture and a 12 MP one are hashed in inspect()', ['feed-1mp.jpg', 'big-12mp.jpg'].every((n) => /^[0-9a-f]{16}$/.test(ctx.costs[browser.name][n].with.phash || '')));

  // Off deletes the list, and the alarm then fetches nothing.
  await browser.evaluate(`SLOP_API.storage.sync.set({ useCrowdList: false })`);
  const gone = await until(async () => {
    const got = await local(['crowdList', 'crowdSeq', 'crowdFetchedAt', 'crowdFullAt']);
    return Object.keys(got).length === 0;
  }, 5000, 'the list to be deleted').catch(() => false);
  ok('turning it off deletes the list', gone);
  await browser.evaluate(`(SLOP_API.alarms.create('fetch-crowd', { when: Date.now() + 200, periodInMinutes: 360 }), true)`);
  await sleep(3000);
  ok('the alarm fetches nothing while it is off', log.gets.length === 0);
  await browser.evaluate(`SLOP_API.storage.sync.set({ useCrowdList: true, visualCheck: false })`);
  await browser.evaluate(`(SLOP_API.alarms.create('fetch-crowd', { when: Date.now() + 200, periodInMinutes: 360 }), true)`);
  await sleep(3000);
  ok('nothing is fetched with your robot off either', log.gets.length === 0 && !(await local(['crowdList'])).crowdList);
  return results;
}

const fixtures = await makeFixtures();
const ctx = { gets: {}, costs: {}, hashes: {} };
const { server, log, port } = await startServer(fixtures, (since) => (since === 0 ? { seq: 2, add: ctx.list.slice(0, 2), remove: [], more: true } : { seq: 3, add: ctx.list.slice(2), remove: [], more: false }));
ctx.log = log;
ctx.port = port;
ctx.modelUrl = /MODEL_URL =\s*'([^']+)'/.exec(readFileSync(here('../extension/src/vision.js'), 'utf8'))[1];
const results = [];
const failures = [];
for (const [name, boot] of [['chrome', startChrome], ['firefox', startFirefox]]) {
  if (only && only !== name) continue;
  const extension = pointAtLocal(name, port);
  let browser = null;
  try {
    browser = await boot(extension);
    const home = await browser.evaluate('location.href');
    // A web page can't open an extension page, so this goes through the remote protocol.
    browser.home = async () => {
      await browser.navigate(home);
      await sleep(800);
      await until(async () => (await browser.evaluate(`document.readyState === 'complete' && typeof SLOP_API === 'object'`)), 10000, 'the welcome page again');
    };
    // The list holds the hashes of two of the pictures, worked out on this extension page
    // by the real phash.js from another address, plus made-up ones. Both browsers must agree.
    await browser.evaluate(`new Promise((resolve) => { const s = document.createElement('script'); s.src = 'phash.js'; s.onload = () => resolve(true); document.head.append(s); })`);
    const hashOf = (file) => browser.evaluate(`(async () => (await SlopHash.fromBlob(await (await fetch(${JSON.stringify(`http://127.0.0.1:${port}/hashsrc/${file}`)})).blob())).phash)()`);
    const hashes = { listed: await hashOf('listed.jpg'), yours: await hashOf('yours.jpg'), unlisted: await hashOf('unlisted.jpg') };
    if (ctx.hashes.listed && (ctx.hashes.listed !== hashes.listed || ctx.hashes.yours !== hashes.yours)) failures.push(`${name}: hashes differ from the other browser`);
    Object.assign(ctx.hashes, hashes);
    ctx.list = ['0123456789abcdef', hashes.listed, hashes.yours, 'fedcba9876543210'];
    results.push(...(await check(browser, ctx)));
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`  FAIL  ${name} stopped: ${e.message}`);
  } finally {
    await finish(browser, extension);
  }
}
server.close();
server.closeAllConnections();

console.log('\n=== List downloads, exactly as the server saw them');
for (const [name, gets] of Object.entries(ctx.gets)) {
  for (const get of gets) {
    console.log(`\n--- ${name} ${get.method} ${get.url}`);
    for (let i = 0; i < get.headers.length; i += 2) console.log(`${get.headers[i]}: ${get.headers[i + 1]}`);
  }
}
console.log('\n=== The drawn pictures\' hashes');
console.log(JSON.stringify(ctx.hashes));
console.log('\n=== inspect() with and without the hash');
console.log(JSON.stringify(ctx.costs, null, 1));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failures.length ? `, ${failures.length} problem(s)` : ''}`);
for (const f of failed) console.log(`FAILED: ${f.name}`);
for (const f of failures) console.log(`STOPPED: ${f}`);
process.exit(failed.length || failures.length ? 1 : 0);
