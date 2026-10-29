// Scores image files with the model and weights the extension ships.
// node score.mjs <image>...
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const base = here('./models/Xenova/clip-vit-base-patch32/');
const prep = JSON.parse(readFileSync(base + 'preprocessor_config.json', 'utf8'));
const W = JSON.parse(readFileSync(here('../extension/src/vision-weights.json'), 'utf8'));
const session = await ort.InferenceSession.create(base + 'onnx/vision_model_int8.onnx');

const S = prep.crop_size.height;
for (const path of process.argv.slice(2)) {
  const rgb = await sharp(path).removeAlpha().toColourspace('srgb')
    .resize(S, S, { fit: 'cover', position: 'centre', kernel: 'cubic' }).raw().toBuffer();
  const plane = S * S;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) data[c * plane + i] = (rgb[i * 3 + c] / 255 - prep.image_mean[c]) / prep.image_std[c];
  }
  const { image_embeds } = await session.run({ pixel_values: new ort.Tensor('float32', data, [1, 3, S, S]) });
  const v = [...image_embeds.data];
  const norm = Math.hypot(...v);
  const z = v.reduce((z, x, j) => z + W.weights[j] * (x / norm) * W.scale, W.bias);
  console.log(`${(100 / (1 + Math.exp(-z))).toFixed(1).padStart(5)}%  ${path.split('/').pop()}`);
}
