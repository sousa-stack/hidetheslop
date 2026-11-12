// node --test worker.test.mjs
// worker.js run directly with Node's own Request and Response: the origin check, then the
// daily totals, with the Durable Object's SQLite faked by Node's built-in node:sqlite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { Totals } from './worker.js';

const URL = 'https://hidetheslop.com/.well-known/origin-check';
const assets = { fetch: async (req) => new Response(`asset ${new globalThis.URL(req.url).pathname}`) };

async function check(origin, method = 'GET') {
  const headers = origin === undefined ? {} : { origin };
  const res = await worker.fetch(new Request(URL, { method, headers, body: method === 'POST' ? '{"anything":1}' : undefined }), { ASSETS: assets });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

test('an extension Origin is reported as arrived, and its value is never sent back', async () => {
  for (const origin of ['safari-web-extension://0F2E8D7A-1111-2222-3333-444455556666', 'moz-extension://abc', 'chrome-extension://abc', 'webkit-extension://x', '']) {
    for (const method of ['GET', 'POST']) {
      const res = await check(origin, method);
      assert.equal(res.status, 200);
      assert.equal(res.text, '{"extension":true}', origin);
    }
  }
});

test('no Origin, the literal null, or a web page reads as no extension', async () => {
  for (const origin of [undefined, 'null', 'https://hidetheslop.com', 'http://127.0.0.1:8791']) {
    for (const method of ['GET', 'POST']) assert.equal((await check(origin, method)).text, '{"extension":false}', String(origin));
  }
});

test('the answer is never cached and is only ever the one key', async () => {
  const res = await check(undefined);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS, like the API');
  assert.deepEqual(Object.keys(JSON.parse(res.text)), ['extension']);
});

test('other methods are refused, and every other path is the static site', async () => {
  for (const method of ['PUT', 'DELETE', 'OPTIONS']) assert.equal((await check('safari-web-extension://x', method)).status, 405);
  const page = await worker.fetch(new Request('https://hidetheslop.com/privacy'), { ASSETS: assets });
  assert.equal(await page.text(), 'asset /privacy');
  const near = await worker.fetch(new Request('https://hidetheslop.com/.well-known/origin-check/x'), { ASSETS: assets });
  assert.equal(await near.text(), 'asset /.well-known/origin-check/x');
});

test('it stores and logs nothing, and the config keeps logs off and the script to its paths', () => {
  const source = readFileSync(new globalThis.URL('./worker.js', import.meta.url), 'utf8');
  for (const word of ['console.', 'env.KV', 'caches', 'fetch(request.url', '.body', '.json()', '.text()']) assert.ok(!source.includes(word), word);
  const config = JSON.parse(readFileSync(new globalThis.URL('./wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(config.observability, { enabled: false });
  assert.deepEqual(config.assets.run_worker_first, ['/.well-known/origin-check', '/hit/*', '/get/*', '/stats']);
  assert.equal(config.main, 'worker.js');
});

// The totals. A real Totals object over an in-memory SQLite, reached through a fake
// namespace that records what the Worker sends it.
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const today = () => new Date().toISOString().slice(0, 10);

function counter({ token } = {}) {
  const db = new DatabaseSync(':memory:');
  const sql = { exec: (query, ...bindings) => { const rows = db.prepare(query).all(...bindings); return { toArray: () => rows }; } };
  const object = new Totals({ storage: { sql } });
  const sent = [];
  const names = [];
  const TOTALS = {
    idFromName: (name) => { names.push(name); return name; },
    get: () => ({ fetch: (input, init) => { const req = new Request(input, init); sent.push(req); return object.fetch(req); } }),
  };
  const env = { ASSETS: assets, TOTALS, ...(token === undefined ? {} : { STATS_TOKEN: token }) };
  const rows = () => db.prepare('SELECT * FROM totals ORDER BY day, name').all().map((row) => ({ ...row }));
  return { env, db, object, sent, names, rows };
}

async function call(env, path, { headers = { 'user-agent': BROWSER }, method = 'GET' } = {}) {
  const pending = [];
  const res = await worker.fetch(new Request(`https://hidetheslop.com${path}`, { method, headers }), env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return res;
}

test('a hit adds exactly one to today for that page, and stores nothing else', async () => {
  const c = counter();
  const headers = { 'user-agent': BROWSER, referer: 'https://example.com/secret', cookie: 'a=b', 'cf-connecting-ip': '203.0.113.9', 'cf-ipcountry': 'US' };
  const res = await call(c.env, '/hit/home', { headers });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), '');
  assert.deepEqual(c.rows(), [{ day: today(), name: 'home', count: 1 }]);
  await call(c.env, '/hit/home');
  await call(c.env, '/hit/privacy');
  assert.deepEqual(c.rows(), [{ day: today(), name: 'home', count: 2 }, { day: today(), name: 'privacy', count: 1 }]);
  // The table can only ever hold a day, a name and a number.
  assert.deepEqual(c.db.prepare('PRAGMA table_info(totals)').all().map((col) => col.name), ['day', 'name', 'count']);
  // None of the visitor's headers reach the Durable Object, and there's only one of it.
  for (const req of c.sent) assert.deepEqual([...req.headers], [], req.url);
  assert.deepEqual(new Set(c.names), new Set(['totals']));
});

test('a self-declared bot, or no user agent at all, is answered but not counted', async () => {
  const c = counter();
  for (const ua of ['Googlebot/2.1 (+http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'facebookexternalhit/1.1', 'Mozilla/5.0 HeadlessChrome/130.0', 'Chrome-Lighthouse', 'Slackbot-LinkExpanding 1.0', 'curl/8.7.1', 'UptimeRobot/2.0 monitor', 'Yahoo! Slurp', 'Twitterbot preview', '']) {
    const res = await call(c.env, '/hit/home', { headers: ua ? { 'user-agent': ua } : {} });
    assert.equal(res.status, 204, ua);
    assert.equal((await call(c.env, '/get/safari', { headers: { 'user-agent': ua } })).status, 302, ua);
  }
  assert.deepEqual(c.rows(), []);
  assert.equal(c.sent.length, 0);
});

test('unknown names are refused and never create a row', async () => {
  const c = counter();
  for (const path of ['/hit/nope', '/hit/', '/hit/Home', '/hit/home/x', '/hit/constructor', '/get/opera', '/get/', '/get/constructor', '/get/__proto__', '/get/safari/x', '/hit']) {
    const res = await call(c.env, path);
    assert.equal(res.status, path === '/hit' ? 200 : 404, path); // /hit alone is just a missing page
  }
  // Even straight at the Durable Object, only known names count.
  for (const name of ['nope', 'get-opera', 'home%20', 'Home', '']) {
    assert.equal((await c.object.fetch(new Request(`https://totals/add/${name}`, { method: 'POST' }))).status, 404, name);
  }
  assert.deepEqual(c.rows(), []);
});

test('only GET counts', async () => {
  const c = counter();
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
    assert.equal((await call(c.env, '/hit/home', { method })).status, 405, method);
    assert.equal((await call(c.env, '/get/chrome', { method })).status, 405, method);
  }
  assert.deepEqual(c.rows(), []);
});

test('each install button counts once and redirects to its store', async () => {
  const c = counter();
  const stores = { chrome: 'https://hidetheslop.com/', firefox: 'https://hidetheslop.com/', edge: 'https://hidetheslop.com/', safari: 'https://apps.apple.com/app/id6834020766' };
  for (const [browser, url] of Object.entries(stores)) {
    const res = await call(c.env, `/get/${browser}`);
    assert.equal(res.status, 302, browser);
    assert.equal(res.headers.get('location'), url, browser);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(c.rows(), ['chrome', 'edge', 'firefox', 'safari'].map((b) => ({ day: today(), name: `get-${b}`, count: 1 })));
});

test('a broken counter never stops a page view or a redirect', async () => {
  const throwing = { ASSETS: assets, TOTALS: { idFromName: () => { throw new Error('down'); }, get: () => { throw new Error('down'); } } };
  const rejecting = { ASSETS: assets, TOTALS: { idFromName: () => 'totals', get: () => ({ fetch: async () => { throw new Error('down'); } }) } };
  for (const env of [throwing, rejecting, { ASSETS: assets }]) {
    const res = await call(env, '/get/safari');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://apps.apple.com/app/id6834020766');
    assert.equal((await call(env, '/hit/home')).status, 204);
  }
});

test('/stats is a plain 404 without the right token, and the totals with it', async () => {
  const unset = counter();
  await call(unset.env, '/hit/home');
  for (const authorization of [undefined, 'Bearer ', 'Bearer undefined', 'Bearer null', 'Bearer right-token']) {
    const res = await call(unset.env, '/stats', { headers: authorization ? { authorization } : {} });
    assert.equal(res.status, 404, `no secret set, ${authorization}`);
    assert.equal(await res.text(), '');
  }

  const c = counter({ token: 'right-token' });
  for (const authorization of [undefined, '', 'Bearer', 'Bearer wrong-token', 'Bearer right-tokenx', 'Bearer right-toke', 'bearer right-token', 'Basic right-token', 'right-token', 'Bearer  right-token', 'Bearer right-token extra']) {
    const res = await call(c.env, '/stats', { headers: authorization === undefined ? {} : { authorization } });
    assert.equal(res.status, 404, String(authorization));
    assert.equal(await res.text(), '');
  }
  assert.equal((await call(c.env, '/stats', { method: 'POST', headers: { authorization: 'Bearer right-token' } })).status, 404);

  c.db.prepare("INSERT INTO totals VALUES ('2026-11-10', 'home', 7), ('2026-11-11', 'get-safari', 2)").run();
  await call(c.env, '/hit/home');
  await call(c.env, '/get/safari');
  const res = await call(c.env, '/stats', { headers: { authorization: 'Bearer right-token' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(await res.text()), [
    { day: today(), name: 'get-safari', count: 1 },
    { day: today(), name: 'home', count: 1 },
    { day: '2026-11-11', name: 'get-safari', count: 2 },
    { day: '2026-11-10', name: 'home', count: 7 },
  ]);
});

test('the pages carry the counting image, and the config binds one SQLite Durable Object', () => {
  for (const [page, name] of [['index.html', 'home'], ['privacy.html', 'privacy']]) {
    const html = readFileSync(new globalThis.URL(`./public/${page}`, import.meta.url), 'utf8');
    assert.ok(html.includes(`<img src="/hit/${name}" alt="" width="1" height="1" class="hit"`), page);
  }
  const config = JSON.parse(readFileSync(new globalThis.URL('./wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(config.durable_objects, { bindings: [{ name: 'TOTALS', class_name: 'Totals' }] });
  assert.deepEqual(config.migrations, [{ tag: 'v1', new_sqlite_classes: ['Totals'] }]);
});
