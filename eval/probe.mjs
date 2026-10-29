// Trains a tiny classifier on CLIP image embeddings of test-images/ and measures it
// with leave-one-out: every image is scored by a classifier that never saw it.
// Run from this folder: node probe.mjs [--with ratings.json ...] [--export]
// --with adds ratings saved from the extension's Settings (small model only).
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const IMAGES = here('../test-images/');
const MODELS = ['clip-vit-base-patch32', 'clip-vit-large-patch14'];

const files = [];
for (const kind of ['ai', 'real']) {
  for (const f of readdirSync(join(IMAGES, kind)).sort()) {
    if (/\.(jpe?g|png|webp|avif|gif)$/i.test(f)) files.push({ kind, path: join(IMAGES, kind, f), name: f, y: kind === 'ai' ? 1 : 0 });
  }
}
// Ratings files from Settings → Your ratings → Save to a file.
const ratings = { ai: [], real: [] };
process.argv.forEach((arg, i) => {
  if (arg !== '--with') return;
  const r = JSON.parse(readFileSync(process.argv[i + 1], 'utf8'));
  ratings.ai.push(...r.ai);
  ratings.real.push(...r.real);
});
const withRatings = (model, X, y) =>
  model === 'clip-vit-base-patch32'
    ? [[...X, ...ratings.ai, ...ratings.real], [...y, ...ratings.ai.map(() => 1), ...ratings.real.map(() => 0)]]
    : [X, y];

const nAi = files.filter((f) => f.y).length + ratings.ai.length;
const nReal = files.length + ratings.ai.length + ratings.real.length - nAi;
console.log(`${nAi} AI, ${nReal} real` + (ratings.ai.length + ratings.real.length ? ` (incl. ${ratings.ai.length + ratings.real.length} from ratings files; small model only)` : '') + '\n');

// CLIP preprocessing: shortest edge to 224 (bicubic), centre crop 224, normalise.
async function toTensor(path, prep) {
  const S = prep.crop_size.height;
  const rgb = await sharp(path).removeAlpha().toColourspace('srgb')
    .resize(S, S, { fit: 'cover', position: 'centre', kernel: 'cubic' }).raw().toBuffer();
  const plane = S * S;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) data[c * plane + i] = (rgb[i * 3 + c] / 255 - prep.image_mean[c]) / prep.image_std[c];
  }
  return new ort.Tensor('float32', data, [1, 3, S, S]);
}

async function embeddings(model) {
  const cachePath = here(`./embeddings-${model}.json`);
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const base = here(`./models/Xenova/${model}/`);
  const prep = JSON.parse(readFileSync(base + 'preprocessor_config.json', 'utf8'));
  let session = null;
  let ms = 0, n = 0;
  for (const f of files) {
    const key = `${f.kind}/${f.name}`;
    if (cache[key]) continue;
    session ??= await ort.InferenceSession.create(base + 'onnx/vision_model_int8.onnx');
    const input = await toTensor(f.path, prep);
    const t = Date.now();
    const { image_embeds } = await session.run({ pixel_values: input });
    ms += Date.now() - t; n++;
    const v = [...image_embeds.data];
    const norm = Math.hypot(...v);
    cache[key] = v.map((x) => x / norm);
  }
  if (n) console.log(`${model}: embedded ${n} new images, ${Math.round(ms / n)} ms each`);
  writeFileSync(cachePath, JSON.stringify(cache));
  return files.map((f) => cache[`${f.kind}/${f.name}`]);
}

// The same trainer the extension uses to learn from your corrections.
const ctx = {};
vm.runInNewContext(readFileSync(here('../extension/src/train.js'), 'utf8'), ctx);
const SlopTrain = vm.runInNewContext('SlopTrain', ctx);

function auc(scores, y) {
  let wins = 0, pairs = 0;
  scores.forEach((s, i) => {
    if (!y[i]) return;
    scores.forEach((t, k) => {
      if (y[k]) return;
      pairs++;
      wins += s > t ? 1 : s === t ? 0.5 : 0;
    });
  });
  return wins / pairs;
}

const fileY = files.map((f) => f.y);
for (const model of MODELS) {
  const [X, y] = withRatings(model, await embeddings(model), fileY);
  const scores = X.map((x, i) => {
    const keep = X.map((_, k) => k).filter((k) => k !== i);
    return SlopTrain.score(SlopTrain.train(keep.map((k) => X[k]), keep.map((k) => y[k])), x);
  });
  console.log(`\n== ${model}   (AUC ${auc(scores, y).toFixed(3)}; 1.0 = perfect, 0.5 = coin flip)`);
  const pos = y.filter(Boolean).length;
  for (const th of [0.3, 0.5, 0.7, 0.9]) {
    const caught = y.filter((t, i) => t && scores[i] >= th).length;
    const wrong = y.filter((t, i) => !t && scores[i] >= th).length;
    console.log(`  cut-off ${Math.round(th * 100)}%: ${caught}/${pos} AI caught, ${wrong}/${y.length - pos} real wrongly flagged`);
  }
  const bad = files.map((f, i) => [f, scores[i]]).filter(([f, s]) => (f.y ? s < 0.5 : s >= 0.5)); // image files only
  if (bad.length) console.log('  wrong at 50%: ' + bad.map(([f, s]) => `${f.kind}/${f.name.slice(0, 9)} ${(s * 100).toFixed(0)}%`).join(', '));
}

// node probe.mjs --export  → train on every image with the small model and write
// what the extension ships: the trained weights, and the examples themselves so it
// can retrain when you correct it.
if (process.argv.includes('--export')) {
  const [X, y] = withRatings('clip-vit-base-patch32', await embeddings('clip-vit-base-patch32'), fileY);
  const model = SlopTrain.train(X, y);
  const about = `Logistic regression on CLIP ViT-B/32 image embeddings, trained on ${nAi} AI and ${nReal} real images.`;
  const trained = new Date().toISOString().slice(0, 10);
  writeFileSync(here('../extension/src/vision-weights.json'), JSON.stringify({ about, trained, ...model }) + '\n');
  const round = (v) => v.map((x) => +x.toFixed(5));
  const examples = { ai: X.filter((_, i) => y[i]).map(round), real: X.filter((_, i) => !y[i]).map(round) };
  writeFileSync(here('../extension/src/vision-examples.json'), JSON.stringify(examples) + '\n');
  console.log(`\nwrote extension/src/vision-weights.json and vision-examples.json (${X.length} examples)`);
}
