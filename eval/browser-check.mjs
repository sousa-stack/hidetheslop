// Writes browser-check.json: what the shipped weights score each test image as,
// computed here with sharp. test-vision.html recomputes them in a browser.
import { readFileSync, writeFileSync } from 'node:fs';
const emb = JSON.parse(readFileSync('embeddings-clip-vit-base-patch32.json', 'utf8'));
const W = JSON.parse(readFileSync('../extension/src/vision-weights.json', 'utf8'));
const out = Object.entries(emb).map(([key, v]) => {
  let z = W.bias;
  v.forEach((x, j) => (z += W.weights[j] * x * W.scale));
  return { image: `../test-images/${key}`, expected: 1 / (1 + Math.exp(-z)) };
});
writeFileSync('browser-check.json', JSON.stringify(out));
console.log(out.length, 'images');
