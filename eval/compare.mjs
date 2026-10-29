// Scores every image in test-images/ai and test-images/real with each detector.
// Run from this folder: node compare.mjs
// The three detectors lost to probe.mjs and their models were deleted; to rerun this,
// download each MODELS entry's config.json, preprocessor_config.json and `file` from
// huggingface.co/<dir> into models/<dir>/.
//
// Runs the ONNX files directly (resize + normalise ourselves) instead of through
// transformers.js, which doesn't support SwinV2. The extension would do the same.
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const TRIM = process.argv.includes('--trim'); // cut flat borders (screenshot bars) before scoring
const JPEG = process.argv.includes('--jpeg'); // re-save as a Facebook-quality JPEG first
const IMAGES = here('../test-images/');
const MODELS = [
  { name: 'SwinV2', dir: 'SoldadoXara/ai-image-detector-deploy-ONNX', file: 'onnx/model_uint8.onnx', ai: ['artificial'] },
  { name: 'SigLIP', dir: 'RaidenIppen/ateeqq-onnx', file: 'onnx/model.onnx', ai: ['ai'] },
  { name: 'ViT', dir: 'prithivMLmods/AI-vs-Deepfake-vs-Real-ONNX', file: 'onnx/model_int8.onnx', ai: ['artificial', 'deepfake'] },
];

async function toTensor(path, prep) {
  const { width, height } = prep.size;
  const kernel = prep.resample === 3 ? 'cubic' : 'linear';
  let img = sharp(path);
  if (TRIM) img = sharp(await img.trim({ threshold: 20 }).toBuffer());
  if (JPEG) img = sharp(await img.jpeg({ quality: 80 }).toBuffer());
  const rgb = await img.removeAlpha().toColourspace('srgb').resize(width, height, { fit: 'fill', kernel }).raw().toBuffer();
  const data = new Float32Array(3 * width * height);
  const plane = width * height;
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      data[c * plane + i] = (rgb[i * 3 + c] * prep.rescale_factor - prep.image_mean[c]) / prep.image_std[c];
    }
  }
  return new ort.Tensor('float32', data, [1, 3, height, width]);
}

function softmax(xs) {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

const files = [];
for (const kind of ['ai', 'real']) {
  for (const f of readdirSync(join(IMAGES, kind)).sort()) {
    if (/\.(jpe?g|png|webp|avif|gif)$/i.test(f)) files.push({ kind, path: join(IMAGES, kind, f), name: f });
  }
}
const nAi = files.filter((f) => f.kind === 'ai').length;
const nReal = files.length - nAi;
console.log(`${nAi} AI images, ${nReal} real images\n`);

const results = {};
for (const m of MODELS) {
  const base = here(`./models/${m.dir}/`);
  const config = JSON.parse(readFileSync(base + 'config.json', 'utf8'));
  const prep = JSON.parse(readFileSync(base + 'preprocessor_config.json', 'utf8'));
  const labels = Object.keys(config.id2label).sort((a, b) => a - b).map((k) => config.id2label[k].toLowerCase());

  const t0 = Date.now();
  const session = await ort.InferenceSession.create(base + m.file);
  const load = Date.now() - t0;
  const scores = [];
  let total = 0;
  for (const f of files) {
    const input = await toTensor(f.path, prep);
    const t = Date.now();
    const { logits } = await session.run({ pixel_values: input });
    total += Date.now() - t;
    const p = softmax([...logits.data]);
    scores.push(labels.reduce((s, l, i) => s + (m.ai.includes(l) ? p[i] : 0), 0));
  }
  results[m.name] = scores;
  console.log(`${m.name}: loaded in ${(load / 1000).toFixed(1)}s, ${Math.round(total / files.length)} ms per image`);
}

// Per-image table: AI probability from each model (higher = more AI).
const pad = (s, n) => String(s).padEnd(n);
console.log('\n' + pad('image', 48) + MODELS.map((m) => pad(m.name, 8)).join(''));
files.forEach((f, i) => {
  const label = `${f.kind === 'ai' ? 'AI  ' : 'real'}  ${f.name.slice(0, 40)}`;
  console.log(pad(label, 48) + MODELS.map((m) => pad((results[m.name][i] * 100).toFixed(0) + '%', 8)).join(''));
});

console.log('\nAI images caught / real images wrongly flagged, at each cut-off:');
for (const th of [0.5, 0.7, 0.9]) {
  const row = MODELS.map((m) => {
    const s = results[m.name];
    const caught = files.filter((f, i) => f.kind === 'ai' && s[i] >= th).length;
    const wrong = files.filter((f, i) => f.kind === 'real' && s[i] >= th).length;
    return `${m.name} ${caught}/${nAi} caught, ${wrong}/${nReal} wrong`;
  });
  console.log(`  ${Math.round(th * 100)}%:  ${row.join('  |  ')}`);
}
