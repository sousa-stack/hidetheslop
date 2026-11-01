// node --test test/download.test.mjs
// Runs the model download with the real file, so it needs eval/models (not in git).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const modelPath = here('../../eval/models/Xenova/clip-vit-base-patch32/onnx/vision_model_int8.onnx');
const skip = existsSync(modelPath) ? false : 'needs eval/models';
const isMirror = (url) => url.includes('models.hidetheslop.com');

// A fresh SlopVision with a fake network and cache. Returns what it fetched and stored.
function setup(respond) {
  const fetched = [];
  const stored = new Map();
  const ctx = {
    crypto: globalThis.crypto,
    caches: { open: async () => ({ match: async (k) => stored.get(k), put: async (k, v) => stored.set(k, v) }) },
    Response: class { constructor(body) { this.body = body; } },
    fetch: async (url) => {
      fetched.push(url);
      return respond(url);
    },
  };
  vm.runInNewContext(readFileSync(here('../src/vision.js'), 'utf8') + '\nglobalThis.SlopVision = SlopVision;', ctx);
  return { vision: ctx.SlopVision, fetched, stored };
}

const body = (bytes) => new Response(bytes);

test('downloads from the mirror when it works', { skip }, async () => {
  const real = readFileSync(modelPath);
  const { vision, fetched, stored } = setup(() => body(real));
  await vision.download();
  assert.equal(fetched.length, 1);
  assert.ok(isMirror(fetched[0]));
  assert.equal([...stored.keys()][0].includes('huggingface.co'), true, 'cached under the Hugging Face address');
  assert.equal(await vision.isDownloaded(), true);
});

test('falls back to Hugging Face when the mirror is down', { skip }, async () => {
  const real = readFileSync(modelPath);
  const { vision, fetched } = setup((url) => (isMirror(url) ? new Response('', { status: 503 }) : body(real)));
  await vision.download();
  assert.equal(fetched.length, 2);
  assert.equal(await vision.isDownloaded(), true);
});

test('falls back when the mirror cannot be reached', { skip }, async () => {
  const real = readFileSync(modelPath);
  const { vision } = setup((url) => {
    if (isMirror(url)) throw new TypeError('network error');
    return body(real);
  });
  await vision.download();
  assert.equal(await vision.isDownloaded(), true);
});

test('rejects a tampered file from the mirror', { skip }, async () => {
  const real = readFileSync(modelPath);
  const tampered = Buffer.from(real);
  tampered[1000] ^= 1;
  const { vision, fetched } = setup((url) => body(isMirror(url) ? tampered : real));
  await vision.download();
  assert.equal(fetched.length, 2, 'went on to Hugging Face');
  assert.equal(await vision.isDownloaded(), true);
});

test('fails, and stores nothing, when both sources fail', { skip }, async () => {
  const { vision, stored } = setup(() => new Response('', { status: 503 }));
  await assert.rejects(vision.download(), /download failed/);
  assert.equal(stored.size, 0);
  assert.equal(await vision.isDownloaded(), false);
});

test('does nothing when the model is already downloaded', { skip }, async () => {
  const real = readFileSync(modelPath);
  const { vision, fetched } = setup(() => body(real));
  await vision.download();
  await vision.download();
  assert.equal(fetched.length, 1);
});
