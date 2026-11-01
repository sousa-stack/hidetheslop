// Picks the scale for the int8 vectors /v1/embeddings takes (docs/CROWD-API.md). It
// squeezes the shipped training embeddings to one byte a number at each scale, then
// reruns leave-one-out on them and compares with the full numbers.
// Run from this folder: node quantize.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const SCALES = [127, 256, 512];
const CUTOFF = 0.7; // the default in SLOP_DEFAULTS

const ctx = {};
vm.runInNewContext(readFileSync(here('../extension/src/train.js'), 'utf8'), ctx);
const SlopTrain = vm.runInNewContext('SlopTrain', ctx);

const { ai, real } = JSON.parse(readFileSync(here('../extension/src/vision-examples.json'), 'utf8'));
const X = [...ai, ...real];
const y = [...ai.map(() => 1), ...real.map(() => 0)];
const all = X.flat().map(Math.abs);
console.log(`${ai.length} AI, ${real.length} real. Largest value ${Math.max(...all).toFixed(4)}, typical ${[...all].sort((a, b) => a - b)[all.length >> 1].toFixed(4)}\n`);

const normal = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const squeeze = (v, scale) => v.map((x) => Math.max(-127, Math.min(127, Math.round(x * scale))));
const leaveOneOut = (vectors) =>
  vectors.map((v, i) => {
    const keep = vectors.map((_, k) => k).filter((k) => k !== i);
    return SlopTrain.score(SlopTrain.train(keep.map((k) => vectors[k]), keep.map((k) => y[k])), v);
  });
function auc(scores) {
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
const report = (name, scores, base) => {
  const caught = y.filter((t, i) => t && scores[i] >= CUTOFF).length;
  const wrong = y.filter((t, i) => !t && scores[i] >= CUTOFF).length;
  let extra = '';
  if (base) {
    const diffs = scores.map((s, i) => Math.abs(s - base[i]));
    const flips = scores.filter((s, i) => s >= CUTOFF !== base[i] >= CUTOFF).length;
    extra = `  flips ${flips}  mean |diff| ${(diffs.reduce((a, b) => a + b) / diffs.length).toFixed(5)}  worst ${Math.max(...diffs).toFixed(4)}`;
  }
  console.log(`${name.padEnd(12)} AUC ${auc(scores).toFixed(4)}  caught ${caught}/${ai.length}  wrong ${wrong}/${real.length}${extra}`);
};

const base = leaveOneOut(X);
report('full', base);
for (const scale of SCALES) {
  const bytes = X.map((v) => squeeze(v, scale));
  const clamped = bytes.flat().filter((b) => Math.abs(b) === 127).length;
  const cos = X.map((v, i) => {
    const q = normal(bytes[i]);
    return v.reduce((sum, x, k) => sum + x * q[k], 0) / Math.hypot(...v);
  });
  report(`scale ${scale}`, leaveOneOut(bytes.map(normal)), base);
  console.log(`             clamped ${clamped} of ${bytes.flat().length} values, lowest cosine to the original ${Math.min(...cos).toFixed(5)}`);
}
