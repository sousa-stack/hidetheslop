// node --test test/meta.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { atob };
vm.runInNewContext(readFileSync(new URL('../src/meta.js', import.meta.url), 'utf8'), ctx);
const { scan, scanDataUrl } = vm.runInNewContext('SlopMeta', ctx);

const enc = (s) => new Uint8Array(Buffer.from(s, 'latin1'));
const jpegWith = (meta) => enc('\xff\xd8\xff\xe1' + meta + '\xff\xdb' + 'x'.repeat(2000));
const iptc = (t) => `<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/${t}</Iptc4xmpExt:DigitalSourceType>`;

test('IPTC/C2PA trainedAlgorithmicMedia is AI-generated', () => {
  const r = scan(jpegWith(iptc('trainedAlgorithmicMedia')));
  assert.equal(r.ai, true);
});

test('compositeWithTrainedAlgorithmicMedia is AI-edited, not generated', () => {
  const r = scan(jpegWith(iptc('compositeWithTrainedAlgorithmicMedia')));
  assert.deepEqual([r.ai, r.edited], [false, true]);
});

test('camera capture with C2PA is left alone', () => {
  const r = scan(jpegWith('jumbc2pa.claim' + iptc('digitalCapture') + 'Leica M11-P'));
  assert.deepEqual([r.ai, r.edited], [false, false]);
});

test('Stable Diffusion parameters in a PNG tEXt chunk', () => {
  const r = scan(enc('\x89PNG\r\n\x1a\n....tEXtparameters\x00a burger, Negative prompt: blurry\nSteps: 30, Sampler: Euler a, CFG scale: 7'));
  assert.equal(r.ai, true);
  assert.match(r.reason, /Stable Diffusion/);
});

test('ComfyUI workflow', () => {
  assert.equal(scan(enc('tEXtprompt\x00{"3": {"class_type": "KSampler"}}')).ai, true);
});

test('generator names in metadata', () => {
  for (const name of ['Midjourney', 'DALL·E 3', 'Adobe Firefly', 'ChatGPT', 'Leonardo.Ai', 'Ideogram']) {
    assert.equal(scan(jpegWith(`<xmp:CreatorTool>${name}</xmp:CreatorTool>`)).ai, true, name);
  }
});

test('China AIGC label', () => {
  assert.equal(scan(jpegWith('AIGC{"Label":"1","ContentProducer":"x"}')).ai, true);
  assert.equal(scan(jpegWith('AIGC{"Label":"3"}')).ai, false);
});

test('ordinary photo metadata is not flagged', () => {
  const r = scan(jpegWith('Exif\x00\x00Canon EOS R5\x00Adobe Photoshop Lightroom Classic 13.1 (Macintosh)\x00Tony\'s Pizza grand opening'));
  assert.equal(r.ai, false);
  assert.equal(r.edited, false);
});

test('random bytes are not flagged', () => {
  const bytes = new Uint8Array(512 * 1024);
  let x = 12345;
  for (let i = 0; i < bytes.length; i++) bytes[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
  assert.equal(scan(bytes).ai, false);
});

test('base64 data URLs', () => {
  const url = 'data:image/png;base64,' + Buffer.from('tEXtSoftware\x00Midjourney').toString('base64');
  assert.equal(scanDataUrl(url, 512 * 1024).ai, true);
  assert.equal(scanDataUrl('data:image/svg+xml,<svg/>', 1024), null);
});
