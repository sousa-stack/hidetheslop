// Turns a picture into 512 numbers that describe how it looks (a CLIP ViT-B/32
// embedding). background.js scores those with the classifier in train.js. The same
// download also gets the metadata check, so a picture is only fetched once.
//
// Runs in a page with a DOM: Chrome's offscreen document, Firefox's background page.
// The options page also loads it, only to download the model.
/* global ort */
/* exported SlopVision */

var SlopVision = (() => {
  // Pinned to one revision and checked by hash, so the model can't change under us.
  const MODEL_URL =
    'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/6b7c523703ae26e39be4b03774966f8571c7f523/onnx/vision_model_int8.onnx';
  // A copy of the same file, so the picture check survives that Hugging Face account
  // going away. The hash check below applies to both.
  const MIRROR_URL =
    'https://models.hidetheslop.com/clip-vit-base-patch32/6b7c523703ae26e39be4b03774966f8571c7f523/vision_model_int8.onnx';
  const MODEL_SHA256 = '0ab0c1b3ace708e539633af1744d5a95247fe4e14d3e08ff197ef82a6cb9bd93';
  const MODEL_BYTES = 88648877;
  const CACHE = 'hidetheslop-model';

  const SIZE = 224;
  const MEAN = [0.48145466, 0.4578275, 0.40821073];
  const STD = [0.26862954, 0.26130258, 0.27577711];
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  const METADATA_BYTES = 512 * 1024; // metadata lives at the start of the file
  const MAX_HASH_PIXELS = 12e6;

  async function cached() {
    const cache = await caches.open(CACHE);
    return cache.match(MODEL_URL);
  }

  async function isDownloaded() {
    return !!(await cached());
  }

  async function sha256(buf) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function fetchChecked(url, onProgress) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
    const buf = new Uint8Array(MODEL_BYTES);
    const reader = res.body.getReader();
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > MODEL_BYTES) throw new Error('download was bigger than expected');
      buf.set(value, n);
      n += value.length;
      onProgress(n / MODEL_BYTES);
    }
    if (n !== MODEL_BYTES || (await sha256(buf)) !== MODEL_SHA256) throw new Error('downloaded file did not match');
    return buf;
  }

  // onProgress(fraction) is called while downloading. Our copy first, then Hugging
  // Face. It's cached under MODEL_URL wherever it came from, so existing downloads count.
  async function download(onProgress = () => {}) {
    if (await isDownloaded()) return;
    let buf;
    try {
      buf = await fetchChecked(MIRROR_URL, onProgress);
    } catch {
      onProgress(0);
      buf = await fetchChecked(MODEL_URL, onProgress);
    }
    const cache = await caches.open(CACHE);
    await cache.put(MODEL_URL, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
  }

  async function remove() {
    await caches.delete(CACHE);
    loading = null;
  }

  let loading = null; // Promise<InferenceSession>
  function load() {
    loading ??= (async () => {
      const res = await cached();
      if (!res) throw new Error('model not downloaded');
      ort.env.wasm.wasmPaths = SLOP_API.runtime.getURL('ort/');
      ort.env.wasm.numThreads = 1; // extension pages aren't cross-origin isolated
      // Firefox stops the background page after 30 idle seconds and never frees a
      // WebAssembly heap that lived in it, so each wake-up left about 245 MB behind.
      // A worker's memory goes when the page does.
      ort.env.wasm.proxy = true;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    })().catch((e) => {
      loading = null;
      throw e;
    });
    return loading;
  }

  // Same as CLIP's own preprocessing: shortest side to 224, centre crop, normalise. Also
  // says how many pixels the picture has, which decides whether it gets hashed.
  async function toTensor(blob) {
    const bmp = await createImageBitmap(blob);
    const pixels = bmp.width * bmp.height;
    const side = Math.min(bmp.width, bmp.height);
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    bmp.close();
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
    const plane = SIZE * SIZE;
    const out = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) out[c * plane + i] = (data[i * 4 + c] / 255 - MEAN[c]) / STD[c];
    }
    return { tensor: new ort.Tensor('float32', out, [1, 3, SIZE, SIZE]), pixels };
  }

  // The hash decodes at full size, outside the model's worker. Two at once can reach
  // about 320 MB on Firefox's background page, so they take turns.
  let hashing = Promise.resolve();
  function hashBlob(blob) {
    const turn = hashing.then(async () => {
      try {
        return (await SlopHash.fromBlob(blob)).phash;
      } catch {
        return null;
      }
    });
    hashing = turn;
    return turn;
  }

  // Returns { meta, embedding } for the image at `url`, or null. `meta` is SlopMeta's
  // verdict; `embedding` is 512 unit-length numbers. With `hash`, while the crowd's list
  // is in use, it adds `phash` from the same download: a hash or null. It's left out for a
  // picture over 12 megapixels, which is too much memory to spend on every picture.
  async function inspect(url, { hash = false } = {}) {
    const session = await load();
    const res = await fetch(url, { credentials: 'omit', cache: 'force-cache', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > MAX_IMAGE_BYTES || /^(text\/|application\/json)/.test(blob.type)) return null;
    const meta = SlopMeta.scan(new Uint8Array(await blob.slice(0, METADATA_BYTES).arrayBuffer()));
    const { tensor, pixels } = await toTensor(blob);
    const { image_embeds } = await session.run({ pixel_values: tensor });
    const v = image_embeds.data;
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    const out = { meta, embedding: Array.from(v, (x) => x / norm) };
    if (hash && typeof SlopHash !== 'undefined' && /^https?:/.test(url) && pixels <= MAX_HASH_PIXELS) {
      out.phash = await hashBlob(blob);
    }
    return out;
  }

  // The perceptual hash a shared rating needs, or null. It's a second look at a picture
  // you just rated, for when inspect() didn't hash it: it decodes at full size. The
  // options and welcome pages load this file without phash.js.
  async function hash(url) {
    if (typeof SlopHash === 'undefined') return null;
    try {
      const res = await fetch(url, { credentials: 'omit', cache: 'force-cache', signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size > MAX_IMAGE_BYTES || /^(text\/|application\/json)/.test(blob.type)) return null;
      return await hashBlob(blob);
    } catch {
      return null;
    }
  }

  return { inspect, hash, download, isDownloaded, remove, MODEL_BYTES };
})();
