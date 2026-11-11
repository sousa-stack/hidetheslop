// Runs the real extension in throwaway headless browsers against a local server, and
// prints exactly what a vote sends. Run from this folder, after building: node vote-check.mjs
//
// It never reaches the live API: each browser gets a copy of dist/ with the API address
// pointed at this machine, and it stops if the https address is still in the copy. On
// Firefox the copy keeps the real hostname with plain http and a random port, and a test
// pref resolves that name to 127.0.0.1, so the strip rule that runs is the one that
// ships. If that pref failed, Cloudflare doesn't listen on that port. Profiles are
// temporary and deleted afterwards, the model comes from eval/models, and the pictures
// are drawn here, so nothing from test-images/ is involved.
//
// Chrome needs Playwright's Chrome for Testing in ~/Library/Caches/ms-playwright, because
// branded Chrome ignores --load-extension. Firefox is the installed app. BiDi and CDP are
// plain WebSockets, so this adds no dependencies. crowd-check.mjs borrows the browser
// parts, so they're exported and the run only starts when this file is run itself.
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = here('models/Xenova/clip-vit-base-patch32/onnx/vision_model_int8.onnx');
const FIREFOX = '/Applications/Firefox.app/Contents/MacOS/firefox';
const FF_ID = 'hidetheslop@hidetheslop.com';
const FF_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const only = process.argv[2]; // chrome or firefox, to run one

export function chromePath() {
  const root = join(homedir(), 'Library/Caches/ms-playwright');
  const dir = readdirSync(root).filter((d) => /^chromium-\d+/.test(d)).sort().pop();
  return join(root, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
}

// ---- pictures -----------------------------------------------------------------

export function picture(width, height, seed) {
  const rgb = Buffer.alloc(width * height * 3);
  const blocks = Array.from({ length: 24 }, (_, i) => {
    const r = (n) => ((seed * 7919 + i * 104729 + n * 1299709) % 1000) / 1000;
    return { x: r(1) * width, y: r(2) * height, w: (0.1 + r(3) * 0.4) * width, h: (0.1 + r(4) * 0.4) * height, v: r(5) * 255 };
  });
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 3) {
      const u = x / width, v = y / height;
      let g = 128 + 90 * Math.sin(6 * u + seed) * Math.cos(4 * v - seed) + 30 * Math.sin(40 * u * v);
      for (const b of blocks) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) g = (g + b.v) / 2;
      const noise = ((x * 31 + y * 17 + seed) % 11) - 5;
      rgb[i] = Math.max(0, Math.min(255, g + noise));
      rgb[i + 1] = Math.max(0, Math.min(255, g * 0.8 + 40 * u));
      rgb[i + 2] = Math.max(0, Math.min(255, 255 - g + 30 * v));
    }
  }
  return sharp(rgb, { raw: { width, height, channels: 3 } });
}

async function makeFixtures() {
  const files = {};
  files['shapes.png'] = await picture(1280, 960, 3).png().toBuffer();
  files['photo.jpg'] = await picture(1280, 1600, 5).jpeg({ quality: 85 }).toBuffer();
  files['rotated.jpg'] = await picture(900, 1200, 7).jpeg({ quality: 85 }).withMetadata({ orientation: 6 }).toBuffer();
  files['small.webp'] = await picture(640, 480, 9).webp({ quality: 80 }).toBuffer();
  files['feed-1mp.jpg'] = await picture(1080, 1080, 11).jpeg({ quality: 85 }).toBuffer();
  files['big-12mp.jpg'] = await picture(4000, 3000, 13).jpeg({ quality: 85 }).toBuffer();
  files['huge-36mp.jpg'] = await picture(6000, 6000, 15).jpeg({ quality: 80 }).toBuffer();
  return files;
}

// ---- the stand-in API -----------------------------------------------------------

function startServer(fixtures) {
  const log = { posts: [], gets: {} };
  const reject = (res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end('{"error":"invalid_request"}');
  };
  const voteOk = (b) =>
    Object.keys(b).sort().join() === 'hashVersion,votes' && b.hashVersion === 1 &&
    b.votes.every((v) => Object.keys(v).sort().join() === 'label,phash,source,token' && /^[0-9a-f]{16}$/.test(v.phash) &&
      /^[0-9a-f]{32}$/.test(v.token) && ['ai', 'real'].includes(v.label) && ['rated', 'hid'].includes(v.source));
  const embOk = (b) =>
    Object.keys(b).sort().join() === 'hashVersion,items,modelVersion' && b.hashVersion === 1 && b.modelVersion === 1 &&
    b.items.every((i) => Object.keys(i).sort().join() === 'phash,token,vector' && Buffer.from(i.vector, 'base64').length === 512 &&
      Buffer.from(i.vector, 'base64').toString('base64') === i.vector);
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    let text = '';
    req.on('data', (d) => (text += d));
    req.on('end', () => {
      if (req.method === 'POST') {
        log.posts.push({ path, headers: req.rawHeaders, body: text });
        const body = JSON.parse(text);
        if (path === '/v1/votes' && voteOk(body)) {
          res.writeHead(202, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ accepted: body.votes.length, needEmbedding: body.votes.map((v) => v.phash) }));
        }
        if (path === '/v1/embeddings' && embOk(body)) {
          res.writeHead(202, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ accepted: body.items.length }));
        }
        return reject(res);
      }
      if (path === '/model') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(readFileSync(MODEL));
      }
      const name = path.split('/').pop();
      if (!fixtures[name]) return res.writeHead(404).end();
      log.gets[name] = (log.gets[name] || 0) + 1;
      if (req.headers.cookie) log.cookie = true;
      res.writeHead(200, { 'content-type': name.endsWith('png') ? 'image/png' : name.endsWith('webp') ? 'image/webp' : 'image/jpeg', 'cache-control': 'max-age=3600' });
      res.end(fixtures[name]);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, log, port: server.address().port })));
}

// A copy of a build that can only reach this machine. Both files that talk to the API,
// votes.js and crowd.js, are pointed here.
export function pointAtLocal(browser, port) {
  const dir = mkdtempSync(join(tmpdir(), `hts-${browser}-ext-`));
  cpSync(here(`../extension/dist/${browser}`), dir, { recursive: true });
  const host = browser === 'firefox' ? 'api.hidetheslop.com' : '127.0.0.1';
  for (const file of ['votes.js', 'crowd.js']) {
    const path = join(dir, file);
    const source = readFileSync(path, 'utf8')
      .replace("const API = 'https://api.hidetheslop.com';", `const API = 'http://${host}:${port}';`)
      .replace('const HOST_ACCESS = [`${API}/*`];', `const HOST_ACCESS = ['http://${host}/*'];`);
    writeFileSync(path, source);
    if (readFileSync(path, 'utf8').includes('https://api.hidetheslop.com')) throw new Error(`${file} still points at the live API`);
  }
  return dir;
}

// ---- two remote-control protocols, one shape ---------------------------------------

export function rpc(url, onEvent = () => {}) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    } else onEvent(m);
  };
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      waiting.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ call, close: () => ws.close() });
    ws.onerror = reject;
  });
}

const wrap = (expr) => `(async () => JSON.stringify(await (async () => (${expr}))()))()`;
const rectOf = (selector) =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;

export async function startFirefox(extension) {
  const profile = mkdtempSync(join(tmpdir(), 'hts-firefox-'));
  const prefs = {
    'extensions.webextensions.uuids': JSON.stringify({ [FF_ID]: FF_UUID }),
    'extensions.webextOptionalPermissionPrompts': false, // answers the consent prompt, which headless can't show
    'network.dns.localDomains': 'api.hidetheslop.com',
    'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.enabled': false,
    'extensions.update.enabled': false, 'browser.shell.checkDefaultBrowser': false, 'network.captive-portal-service.enabled': false,
    'browser.safebrowsing.malware.enabled': false, 'browser.safebrowsing.phishing.enabled': false, 'browser.aboutwelcome.enabled': false,
  };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
  const proc = spawn(FIREFOX, ['--headless', '--no-remote', '--new-instance', '--profile', profile, '--remote-debugging-port=0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
  });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const read = (d) => {
      out += d;
      const m = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(out);
      if (m) resolve(m[1]);
    };
    proc.stdout.on('data', read);
    proc.stderr.on('data', read);
    setTimeout(() => reject(new Error('Firefox did not start')), 30000);
  });
  const bidi = await rpc(`${url.replace(/\/$/, '')}/session`);
  await bidi.call('session.new', { capabilities: {} });
  const installed = await bidi.call('webExtension.install', { extensionData: { type: 'path', path: extension } });
  if (installed.type === 'error') throw new Error(installed.message);
  let context = null;
  for (let i = 0; i < 100 && !context; i++) {
    const tree = await bidi.call('browsingContext.getTree');
    context = tree.result.contexts.find((c) => c.url.startsWith('moz-extension:'))?.context;
    if (!context) await sleep(100);
  }
  if (!context) throw new Error('the welcome page never opened');
  const evaluate = async (expr, { activate = false } = {}) => {
    const m = await bidi.call('script.evaluate', { target: { context }, awaitPromise: true, userActivation: activate, expression: wrap(expr) });
    if (m.result?.type !== 'success') throw new Error(`evaluate: ${JSON.stringify(m).slice(0, 400)}`);
    return JSON.parse(m.result.result.value ?? 'null');
  };
  return {
    name: 'firefox', proc, profile, evaluate,
    version: execFileSync(FIREFOX, ['--version'], { encoding: 'utf8' }).trim(),
    click: async (selector) => {
      const { x, y } = await evaluate(rectOf(selector));
      await bidi.call('input.performActions', {
        context,
        actions: [{ type: 'pointer', id: 'mouse', actions: [
          { type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
        ] }],
      });
    },
    navigate: (url) => bidi.call('browsingContext.navigate', { context, url, wait: 'complete' }),
    hash: (url) => evaluate(`(await browser.runtime.getBackgroundPage()).SlopVision.hash(${JSON.stringify(url)})`),
    timeHash: (url) => evaluate(`(async () => { const bg = await browser.runtime.getBackgroundPage(); const t = bg.performance.now(); const h = await bg.SlopVision.hash(${JSON.stringify(url)}); return { ms: bg.performance.now() - t, h }; })()`),
    stop: () => bidi.close(),
  };
}

export async function startChrome(extension) {
  const binary = chromePath();
  const profile = mkdtempSync(join(tmpdir(), 'hts-chrome-'));
  const proc = spawn(binary, [
    '--headless=new', `--user-data-dir=${profile}`, `--load-extension=${extension}`, `--disable-extensions-except=${extension}`,
    '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
    '--disable-component-update', '--window-size=1200,900', 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const find = async (test) => {
    for (let i = 0; i < 100; i++) {
      const hit = (await targets()).find(test);
      if (hit) return hit;
      await sleep(100);
    }
    throw new Error('target not found');
  };
  const pageTarget = await find((t) => t.type === 'page' && t.url.endsWith('/welcome.html'));
  const cdp = await rpc(pageTarget.webSocketDebuggerUrl);
  const run = async (client, expr) => {
    const m = await client.call('Runtime.evaluate', { expression: wrap(expr), awaitPromise: true, returnByValue: true, userGesture: false });
    if (m.result?.exceptionDetails) throw new Error(`evaluate: ${JSON.stringify(m.result.exceptionDetails).slice(0, 400)}`);
    return JSON.parse(m.result.result.value ?? 'null');
  };
  const evaluate = (expr) => run(cdp, expr);
  let offscreen = null;
  const inOffscreen = async (expr) => {
    if (!offscreen) offscreen = await rpc((await find((t) => t.url.endsWith('/offscreen.html'))).webSocketDebuggerUrl);
    return run(offscreen, expr);
  };
  return {
    name: 'chrome', proc, profile, evaluate,
    version: execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
    click: async (selector) => {
      const { x, y } = await evaluate(rectOf(selector));
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    inOffscreen,
    navigate: (url) => cdp.call('Page.navigate', { url }),
    hash: (url) => evaluate(`chrome.runtime.sendMessage({ target: 'offscreen', type: 'hash', url: ${JSON.stringify(url)} })`),
    timeHash: (url) => inOffscreen(`(async () => { const t = performance.now(); const h = await SlopVision.hash(${JSON.stringify(url)}); return { ms: performance.now() - t, h }; })()`),
    stop: () => {
      offscreen?.close();
      cdp.close();
    },
  };
}

// The whole process tree's resident memory, in MB.
export function treeMb(rootPid) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const tree = new Set([rootPid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of rows) if (tree.has(ppid) && !tree.has(pid)) (tree.add(pid), (grew = true));
  }
  return rows.filter(([pid]) => tree.has(pid)).reduce((sum, row) => sum + row[2], 0) / 1024;
}

async function measure(browser, url) {
  const runs = [];
  let peak = 0;
  const base = treeMb(browser.proc.pid);
  const sampler = setInterval(() => (peak = Math.max(peak, treeMb(browser.proc.pid))), 40);
  for (let i = 0; i < 5; i++) runs.push((await browser.timeHash(url)).ms);
  clearInterval(sampler);
  runs.sort((a, b) => a - b);
  return { medianMs: Math.round(runs[2]), slowestMs: Math.round(runs[4]), baseMb: Math.round(base), peakExtraMb: Math.round(Math.max(0, peak - base)) };
}

// ---- the checks ----------------------------------------------------------------------

async function check(browser, ctx) {
  const { log, port, modelUrl } = ctx;
  const base = `http://127.0.0.1:${port}`;
  const results = [];
  const ok = (name, pass, detail = '') => {
    results.push({ name, pass });
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  };
  const local = (keys) => browser.evaluate(`SLOP_API.storage.local.get(${JSON.stringify(keys)})`);
  const learn = (url, label, source) => browser.evaluate(`SLOP_API.runtime.sendMessage({ type: 'learn', url: ${JSON.stringify(url)}, label: ${JSON.stringify(label)}, source: ${JSON.stringify(source)} })`);
  const goto = async (page) => {
    await browser.evaluate(`(() => { setTimeout(() => (location.href = ${JSON.stringify(page)}), 0); return true; })()`);
    await sleep(800);
    for (let i = 0; i < 50; i++) if ((await browser.evaluate(`document.readyState`)) === 'complete') break; else await sleep(100);
    await sleep(400);
  };

  console.log(`\n=== ${browser.version}`);
  for (let i = 0; i < 100 && !(await browser.evaluate(`document.readyState === 'complete' && typeof SLOP_API === 'object'`)); i++) await sleep(100);
  await sleep(500); // the page's own startup
  const manifest = await browser.evaluate(`SLOP_API.runtime.getManifest()`);
  ok('the first install opens the welcome page', (await browser.evaluate(`location.pathname`)) === '/welcome.html');
  ok('the welcome switch starts off', (await browser.evaluate(`document.getElementById('shareRatings').checked`)) === false);
  ok('the permission check for the real API host works', (await browser.evaluate(`SLOP_API.permissions.contains({ origins: ['https://api.hidetheslop.com/*'] })`)) === true);
  ok('the hourly alarm exists', (await browser.evaluate(`SLOP_API.alarms.get('send-votes')`))?.periodInMinutes === 60);

  await browser.evaluate(`(async () => {
    const buf = await (await fetch(${JSON.stringify(`${base}/model`)})).arrayBuffer();
    await (await caches.open('hidetheslop-model')).put(${JSON.stringify(modelUrl)}, new Response(buf));
    return true;
  })()`);

  // Sharing off: a rating saves and nothing queues.
  const fixture = `${base}/fixture/shapes.png`;
  const start = Date.now();
  const savedOff = await learn(fixture, 'ai', 'rated');
  const firstRatingMs = Date.now() - start;
  const before = await local(['voteQueue', 'visionRatings', 'voteSecret']);
  ok('a rating with sharing off saves', savedOff === true && before.visionRatings?.ai?.length === 1, `${firstRatingMs} ms including the model load`);
  ok('a rating with sharing off queues nothing', !before.voteQueue && !before.voteSecret);
  const offRating = Date.now();
  await learn(fixture, 'ai', 'rated');
  const offMs = Date.now() - offRating;

  // Consent has to come from a real click.
  if (browser.name === 'firefox') {
    const refused = await browser.evaluate(`SLOP_API.permissions.request({ data_collection: ['websiteContent'] }).then(() => 'granted', (e) => e.message)`);
    ok('Firefox refuses the request outside a click', refused !== 'granted', String(refused).slice(0, 70));
    ok('Firefox data permission starts off', (await browser.evaluate(`SLOP_API.permissions.contains({ data_collection: ['websiteContent'] })`)) === false);
    ok('Firefox manifest', manifest.browser_specific_settings.gecko.strict_min_version === '140.0' && manifest.declarative_net_request.rule_resources[0].id === 'strip-origin');
    ok('Firefox strip rule is on', (await browser.evaluate(`SLOP_API.declarativeNetRequest.getEnabledRulesets()`)).includes('strip-origin'));
  }

  await goto('options.html');
  await browser.click('#shareRatings');
  await sleep(600);
  const on = await local(['shareRatings']);
  ok('a real click on the switch turns sharing on', on.shareRatings === true);
  ok('the switch shows it', (await browser.evaluate(`[document.getElementById('shareRatings').checked, document.querySelector('#shareRatings').closest('label').querySelector('b').textContent]`)).join() === 'true,Share your ratings');
  if (browser.name === 'firefox') {
    ok('Firefox granted the data permission from that click', (await browser.evaluate(`SLOP_API.permissions.contains({ data_collection: ['websiteContent'] })`)) === true);
  }

  // A real rating with sharing on: hash through the offscreen or background path.
  const onRating = Date.now();
  await learn(fixture, 'ai', 'rated');
  const onMs = Date.now() - onRating;
  const gets = log.gets['shapes.png'];
  let queued = await local(['voteQueue', 'voteSecret']);
  const entry = queued.voteQueue?.[0];
  ok('a rating queues one vote', queued.voteQueue?.length === 1, entry && `hash ${entry.phash}, vector ${entry.vector.length} chars`);
  ok('it waits 1 to 6 hours', entry && entry.after > Date.now() + 3500000 && entry.after < Date.now() + 21700000);
  ok('Settings counts it', /^1 rating waiting/.test((await browser.evaluate(`document.getElementById('voteCount').textContent`)) || ''));
  ctx.ratingMs[browser.name] = { offMs, onMs, addedMs: onMs - offMs, downloadsOfThePicture: gets };

  // The hash is a real comparison across browsers, so collect it for every fixture.
  const hashes = {};
  for (const name of ctx.hashFiles) hashes[name] = await browser.hash(`${base}/fixture/${name}`);
  ctx.hashes[browser.name] = hashes;
  ok('the rating hashed the same as the hash path', entry?.phash === hashes['shapes.png']);

  // Send now, through the real link.
  const postsBefore = log.posts.length;
  await browser.click('#sendNow');
  for (let i = 0; i < 40 && log.posts.length < postsBefore + 2; i++) await sleep(100);
  await sleep(300);
  const posts = log.posts.slice(postsBefore);
  ok('Send now sends the vote and the asked-for embedding', posts.map((p) => p.path).join() === '/v1/votes,/v1/embeddings');
  queued = await local(['voteQueue', 'voteSent']);
  ok('the sent vote leaves the queue and goes on the sent list', queued.voteQueue?.length === 0 && queued.voteSent?.[0] === entry?.phash);
  ctx.posts[browser.name] = posts;
  for (const post of posts) {
    const heads = {};
    for (let i = 0; i < post.headers.length; i += 2) heads[post.headers[i].toLowerCase()] = post.headers[i + 1];
    ok(`${post.path} has no cookie`, !heads.cookie);
    ok(`${post.path} has no referer`, !heads.referer);
    if (browser.name === 'firefox') ok(`${post.path} has no moz-extension Origin`, !heads.origin && !JSON.stringify(post.headers).includes(FF_UUID), `origin: ${heads.origin ?? 'none'}`);
  }
  ok('no picture download sent a cookie', !log.cookie);

  // Off clears the queue, from a real click.
  await learn(`${base}/fixture/photo.jpg`, 'real', 'hid');
  queued = await local(['voteQueue', 'voteSecret']);
  ok('a hid rating queues as hid', queued.voteQueue?.[0]?.source === 'hid' && queued.voteQueue?.[0]?.label === 'real');
  const secret = queued.voteSecret;
  await browser.click('#shareRatings');
  await sleep(500);
  queued = await local(['voteQueue', 'voteSecret', 'shareRatings', 'voteSent']);
  ok('turning it off clears the queue and keeps the secret and sent list', queued.shareRatings === false && !queued.voteQueue?.length && queued.voteSecret === secret && queued.voteSent?.length === 1);
  const silent = log.posts.length;
  await browser.evaluate(`SLOP_API.runtime.sendMessage({ type: 'voteSend' })`);
  await sleep(300);
  ok('Send now with sharing off sends nothing', log.posts.length === silent);

  if (browser.name === 'firefox') {
    // Revoking in about:addons is the same event as this.
    await browser.click('#shareRatings');
    await sleep(500);
    await learn(`${base}/fixture/photo.jpg`, 'ai', 'rated');
    await browser.evaluate(`SLOP_API.permissions.remove({ data_collection: ['websiteContent'] })`);
    await sleep(500);
    queued = await local(['voteQueue', 'shareRatings']);
    ok('revoking the data permission turns sharing off and clears the queue', queued.shareRatings === false && !queued.voteQueue?.length);
  }

  // What a hash costs where it really runs.
  await sleep(1000);
  ctx.cost[browser.name] = {};
  for (const name of ['feed-1mp.jpg', 'big-12mp.jpg', 'huge-36mp.jpg']) ctx.cost[browser.name][name] = await measure(browser, `${base}/fixture/${name}`);
  return results;
}

// ---- running it -----------------------------------------------------------------------

export async function finish(browser, extension) {
  try { browser?.stop(); } catch { /* it's going away anyway */ }
  if (browser) {
    browser.proc.kill();
    for (let i = 0; i < 50 && browser.proc.exitCode === null && browser.proc.signalCode === null; i++) await sleep(100);
    rmSync(browser.profile, { recursive: true, force: true });
  }
  rmSync(extension, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

async function main() {
  const fixtures = await makeFixtures();
  const { server, log, port } = await startServer(fixtures);
  const modelUrl = /MODEL_URL =\s*'([^']+)'/.exec(readFileSync(here('../extension/src/vision.js'), 'utf8'))[1];
  const ctx = {
    log, port, modelUrl, ratingMs: {}, hashes: {}, posts: {}, cost: {},
    hashFiles: ['shapes.png', 'photo.jpg', 'rotated.jpg', 'small.webp', 'feed-1mp.jpg', 'big-12mp.jpg', 'huge-36mp.jpg'],
  };
  const results = [];
  const failures = [];
  for (const [name, boot] of [['chrome', startChrome], ['firefox', startFirefox]]) {
    if (only && only !== name) continue;
    const extension = pointAtLocal(name, port);
    let browser = null;
    try {
      browser = await boot(extension);
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

  console.log('\n=== Requests, exactly as the server saw them');
  for (const [name, posts] of Object.entries(ctx.posts)) {
    for (const post of posts) {
      console.log(`\n--- ${name} POST ${post.path}`);
      for (let i = 0; i < post.headers.length; i += 2) console.log(`${post.headers[i]}: ${post.headers[i + 1]}`);
      const body = post.body.replace(/"vector":"([^"]{24})[^"]*"/g, '"vector":"$1…"');
      console.log(`\n${body}`);
    }
  }

  console.log('\n=== One file, each browser (hash)');
  const names = Object.keys(ctx.hashes);
  for (const file of ctx.hashFiles) {
    const row = names.map((n) => ctx.hashes[n][file]);
    const same = names.length === 2 ? (row[0] === row[1] ? 'SAME' : 'DIFFERENT') : '';
    console.log(`${file.padEnd(16)} ${row.join('  ')}  ${same}`);
    if (names.length === 2) results.push({ name: `hash ${file}`, pass: !!row[0] && row[0] === row[1] });
  }
  console.log('\n=== What a hash adds at rating time');
  console.log(JSON.stringify({ rating: ctx.ratingMs, hash: ctx.cost }, null, 1));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failures.length ? `, ${failures.length} browser run(s) stopped` : ''}`);
  for (const f of failed) console.log(`FAILED: ${f.name}`);
  for (const f of failures) console.log(`STOPPED: ${f}`);
  process.exit(failed.length || failures.length ? 1 : 0);
}
