// Writes browser-check.json: what the shipped weights score each test image as,
// computed here with sharp. test-vision.html recomputes them in a browser.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const emb = JSON.parse(readFileSync('embeddings-clip-vit-base-patch32.json', 'utf8'));
const W = JSON.parse(readFileSync('../extension/src/vision-weights.json', 'utf8'));
// The embeddings cache also remembers pictures that have since been moved or removed.
const out = Object.entries(emb).filter(([key]) => existsSync(`../test-images/${key}`)).map(([key, v]) => {
  let z = W.bias;
  v.forEach((x, j) => (z += W.weights[j] * x * W.scale));
  return { image: `../test-images/${key}`, expected: 1 / (1 + Math.exp(-z)) };
});
writeFileSync('browser-check.json', JSON.stringify(out));
console.log(out.length, 'images');
