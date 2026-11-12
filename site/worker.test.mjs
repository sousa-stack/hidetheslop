// node --test worker.test.mjs
// The origin check in worker.js, run directly with Node's own Request and Response.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from './worker.js';

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

test('it stores and logs nothing, and the config keeps logs off and the script to one path', () => {
  const source = readFileSync(new globalThis.URL('./worker.js', import.meta.url), 'utf8');
  for (const word of ['console.', 'env.KV', 'caches', 'fetch(request.url', '.body', '.json()', '.text()']) assert.ok(!source.includes(word), word);
  const config = JSON.parse(readFileSync(new globalThis.URL('./wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(config.observability, { enabled: false });
  assert.deepEqual(config.assets.run_worker_first, ['/.well-known/origin-check']);
  assert.equal(config.main, 'worker.js');
});
