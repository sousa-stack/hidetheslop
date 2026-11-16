// node --test test/release.test.mjs
// The two store uploaders against a fake Chrome Web Store and a fake AMO on this
// computer, and the reviewer notes against the files they describe. Nothing here
// reaches a real store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessToken, publishChrome } from '../tools/publish-chrome.mjs';
import { amoJwt, publishFirefox } from '../tools/publish-firefox.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const zip = join(mkdtempSync(join(tmpdir(), 'slop-release-')), 'hidetheslop-test-9.9.9.zip');
const zipBytes = Buffer.from('PK not really a zip');
writeFileSync(zip, zipBytes);
const quiet = () => {};

// A server that records what it was sent and answers from `routes`: 'METHOD /path' to
// a function returning [status, body].
async function fake(routes) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const call = { method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks) };
      seen.push(call);
      const route = routes[`${req.method} ${req.url}`];
      const [status, body] = route ? route(call) : [404, { error: `no route for ${req.method} ${req.url}` }];
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

const ITEM = 'publishers/pub-1/items/abcdefghijklmnopabcdefghijklmnop';
const chromeEnv = { CHROME_PUBLISHER_ID: 'pub-1', CHROME_ITEM_ID: 'abcdefghijklmnopabcdefghijklmnop', CHROME_CLIENT_ID: 'id', CHROME_CLIENT_SECRET: 'shh', CHROME_REFRESH_TOKEN: 'again' };
const published = { publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '9.9.8', deployPercentage: 100 }] } };

test('Chrome: signs in with a service account key', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const s = await fake({ 'POST /token': () => [200, { access_token: 'tok' }] });
  const key = { client_email: 'robot@project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  assert.equal(await accessToken({ CHROME_SERVICE_ACCOUNT_JSON: JSON.stringify(key) }, { tokenUrl: `${s.url}/token` }), 'tok');
  const sent = new URLSearchParams(s.seen[0].body.toString());
  assert.equal(sent.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [head, claims, signature] = sent.get('assertion').split('.');
  assert.ok(createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, signature, 'base64url'));
  const c = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(c.iss, key.client_email);
  assert.equal(c.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(c.scope, 'https://www.googleapis.com/auth/chromewebstore');
  assert.ok(c.exp - c.iat <= 3600);
  await s.close();
});

test('Chrome: no credentials is an error that names the secrets', async () => {
  await assert.rejects(accessToken({}), /CHROME_SERVICE_ACCOUNT_JSON/);
  await assert.rejects(publishChrome({ env: {}, zip }), /CHROME_PUBLISHER_ID/);
});

test('Chrome: uploads the zip, waits for it, then sends it for review', async () => {
  let polls = 0;
  const s = await fake({
    'POST /token': () => [200, { access_token: 'tok' }],
    [`GET /v2/${ITEM}:fetchStatus`]: () => [200, { ...published, lastAsyncUploadState: ++polls > 2 ? 'SUCCEEDED' : 'IN_PROGRESS' }],
    [`POST /upload/v2/${ITEM}:upload`]: () => [200, { uploadState: 'IN_PROGRESS' }],
    [`POST /v2/${ITEM}:publish`]: () => [200, { state: 'PENDING_REVIEW' }],
  });
  const out = await publishChrome({ env: chromeEnv, zip, version: '9.9.9', api: s.url, tokenUrl: `${s.url}/token`, pollMs: 1, log: quiet });
  assert.equal(out.state, 'PENDING_REVIEW');
  const token = new URLSearchParams(s.seen[0].body.toString());
  assert.equal(token.get('grant_type'), 'refresh_token');
  assert.equal(token.get('refresh_token'), 'again');
  const upload = s.seen.find((c) => c.path.endsWith(':upload'));
  assert.deepEqual(upload.body, zipBytes);
  assert.equal(upload.headers.authorization, 'Bearer tok');
  const last = s.seen.at(-1);
  assert.ok(last.path.endsWith(':publish'));
  assert.deepEqual(JSON.parse(last.body), { publishType: 'DEFAULT_PUBLISH' });
  await s.close();
});

test('Chrome: stops before uploading while a version waits for review', async () => {
  const s = await fake({
    'POST /token': () => [200, { access_token: 'tok' }],
    [`GET /v2/${ITEM}:fetchStatus`]: () => [200, { ...published, submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } }],
  });
  await assert.rejects(publishChrome({ env: chromeEnv, zip, api: s.url, tokenUrl: `${s.url}/token`, log: quiet }), /waiting for review/);
  assert.equal(s.seen.filter((c) => c.method === 'POST' && c.path !== '/token').length, 0);
  await s.close();
});

test('Chrome: a failed upload or a wrong version is never sent for review', async () => {
  for (const [answer, error] of [
    [[200, { uploadState: 'FAILED' }], /ended as FAILED/],
    [[400, { error: { message: 'version not higher' } }], /HTTP 400.*version not higher/],
    [[200, { uploadState: 'SUCCEEDED', crxVersion: '1.0.0' }], /read version 1\.0\.0/],
  ]) {
    const s = await fake({
      'POST /token': () => [200, { access_token: 'tok' }],
      [`GET /v2/${ITEM}:fetchStatus`]: () => [200, published],
      [`POST /upload/v2/${ITEM}:upload`]: () => answer,
    });
    await assert.rejects(publishChrome({ env: chromeEnv, zip, version: '9.9.9', api: s.url, tokenUrl: `${s.url}/token`, log: quiet }), error);
    assert.ok(!s.seen.some((c) => c.path.endsWith(':publish')));
    await s.close();
  }
});

test('Chrome: --check reads the item and changes nothing', async () => {
  const s = await fake({
    'POST /token': () => [200, { access_token: 'tok' }],
    [`GET /v2/${ITEM}:fetchStatus`]: () => [200, published],
  });
  const lines = [];
  await publishChrome({ env: chromeEnv, check: true, api: s.url, tokenUrl: `${s.url}/token`, log: (l) => lines.push(l) });
  assert.match(lines[0], /PUBLISHED 9\.9\.8 at 100%/);
  assert.deepEqual(s.seen.map((c) => c.method), ['POST', 'GET']);
  await s.close();
});

const GUID = 'hidetheslop@hidetheslop.com';
const VERSIONS = `/addons/addon/${encodeURIComponent(GUID)}/versions/`;
const amoEnv = { AMO_JWT_ISSUER: 'user:1:2', AMO_JWT_SECRET: 'sssh', AMO_ADDON_ID: GUID, AMO_NOTES_FILE: here('../../docs/store/amo-reviewer-notes.txt') };

function checkJwt(header) {
  const [scheme, token] = header.split(' ');
  assert.equal(scheme, 'JWT');
  const [head, claims, signature] = token.split('.');
  assert.equal(createHmac('sha256', 'sssh').update(`${head}.${claims}`).digest('base64url'), signature);
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  return JSON.parse(Buffer.from(claims, 'base64url'));
}

test('Firefox: the token is what AMO asks for', () => {
  const c = checkJwt(`JWT ${amoJwt('user:1:2', 'sssh')}`);
  assert.equal(c.iss, 'user:1:2');
  assert.ok(c.exp - c.iat <= 300);
  assert.notEqual(c.jti, checkJwt(`JWT ${amoJwt('user:1:2', 'sssh')}`).jti);
});

test('Firefox: uploads as listed, waits for the validator, then creates the version with the notes', async () => {
  let polls = 0;
  const s = await fake({
    'POST /addons/upload/': () => [201, { uuid: 'u-1', processed: false }],
    'GET /addons/upload/u-1/': () => [200, ++polls > 1 ? { uuid: 'u-1', processed: true, valid: true, version: '9.9.9', validation: { messages: [{ type: 'warning', message: 'innerHTML' }] } } : { uuid: 'u-1', processed: false }],
    [`POST ${VERSIONS}`]: (c) => [201, { id: 7, version: '9.9.9', file: { status: 'unreviewed' }, approval_notes: JSON.parse(c.body).approval_notes }],
  });
  const out = await publishFirefox({ env: amoEnv, zip, version: '9.9.9', api: s.url, pollMs: 1, log: quiet });
  assert.deepEqual(out, { version: '9.9.9', status: 'unreviewed' });
  for (const c of s.seen) checkJwt(c.headers.authorization);
  const upload = s.seen[0];
  assert.match(upload.headers['content-type'], /^multipart\/form-data/);
  const sent = upload.body.toString('latin1');
  assert.match(sent, /name="channel"\r\n\r\nlisted\r\n/);
  assert.match(sent, /name="upload"; filename="hidetheslop-test-9\.9\.9\.zip"/);
  assert.ok(sent.includes(zipBytes.toString('latin1')));
  const made = JSON.parse(s.seen.at(-1).body);
  assert.equal(made.upload, 'u-1');
  assert.equal(made.approval_notes, readFileSync(amoEnv.AMO_NOTES_FILE, 'utf8').trim());
  assert.deepEqual(Object.keys(made).sort(), ['approval_notes', 'upload']); // no source, no license
  await s.close();
});

test('Firefox: a zip the validator turns down, or the wrong version, creates nothing', async () => {
  for (const [detail, error] of [
    [{ uuid: 'u-1', processed: true, valid: false, validation: { messages: [{ type: 'error', message: 'Version 9.9.9 already exists.' }] } }, /turned the zip down/],
    [{ uuid: 'u-1', processed: true, valid: true, version: '1.0.0' }, /read version 1\.0\.0/],
  ]) {
    const s = await fake({ 'POST /addons/upload/': () => [201, detail] });
    await assert.rejects(publishFirefox({ env: amoEnv, zip, version: '9.9.9', api: s.url, pollMs: 1, log: quiet }), error);
    assert.equal(s.seen.length, 1);
    await s.close();
  }
});

test('Firefox: --check lists the versions and uploads nothing', async () => {
  const s = await fake({ [`GET ${VERSIONS}?filter=all_with_unlisted`]: () => [200, { count: 1, results: [{ version: '9.9.8', file: { status: 'public' } }] }] });
  const lines = [];
  await publishFirefox({ env: amoEnv, check: true, api: s.url, log: (l) => lines.push(l) });
  assert.match(lines[0], /9\.9\.8 \(public\)/);
  assert.equal(s.seen.length, 1);
  await s.close();
});

test('Firefox: missing secrets are named', async () => {
  await assert.rejects(publishFirefox({ env: {}, zip }), /AMO_JWT_ISSUER/);
});

// The notes go to Mozilla with every version, unread by anyone, so they have to stay
// true about the one library that isn't readable source.
test('the reviewer notes fit, and match the bundled onnxruntime-web', () => {
  const notes = readFileSync(amoEnv.AMO_NOTES_FILE, 'utf8').trim();
  assert.ok(notes.length <= 3000, `${notes.length} characters`);
  const [, ortVersion] = readFileSync(here('../src/ort/VERSION'), 'utf8').match(/onnxruntime-web (\S+)/);
  assert.ok(notes.includes(`onnxruntime-web ${ortVersion} `));
  assert.ok(notes.includes(`onnxruntime-web/v/${ortVersion}`));
  for (const f of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    const hash = createHash('sha256').update(readFileSync(here(`../src/ort/${f}`))).digest('hex');
    assert.ok(notes.includes(`${f} ${hash}`), `${f} has changed: update docs/store/amo-reviewer-notes.txt`);
  }
});
