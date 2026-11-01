// Hashes every file hash-check.mjs lists, in the same steps the extension will use,
// and posts the results back. Runs on the web page and on the test extension's page.
/* global SlopHash */

(async () => {
  const SERVER = 'http://127.0.0.1:8768';
  const onWeb = location.protocol === 'http:';
  const base = onWeb ? '' : SERVER;
  const status = document.getElementById('status');

  const ua = navigator.userAgent;
  // "webkit" is a plain WKWebView: Safari's engine without Safari's user agent.
  const browser = /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'webkit';
  const context = onWeb ? 'page' : 'extension';

  const post = (body) =>
    fetch(`${base}/results`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' }, // no preflight from the extension
      body: JSON.stringify({ browser, context, ...body }),
    });

  // Anti-fingerprinting noise shows up as a canvas that doesn't give back what went in.
  async function canvasIsHonest() {
    const size = 64;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([(i * 7) & 255, (i * 13) & 255, (i * 29) & 255, 255], i);
    const bitmap = await createImageBitmap(new ImageData(pixels, size, size), { premultiplyAlpha: 'none' });
    const ctx = new OffscreenCanvas(size, size).getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const back = ctx.getImageData(0, 0, size, size).data;
    return back.every((v, i) => v === pixels[i]);
  }

  try {
    const started = performance.now();
    const { files } = await (await fetch(`${base}/list`, { cache: 'no-store' })).json();
    await post({ start: true, ua, total: files.length, canvasHonest: await canvasIsHonest() });
    let batch = {};
    let done = 0;
    for (const file of files) {
      let result;
      let step = 'fetch';
      try {
        result = await Promise.race([
          (async () => {
            const res = await fetch(`${base}/file/${file.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(res.status);
            const blob = await res.blob();
            step = 'hash';
            return SlopHash.fromBlob(blob);
          })(),
          new Promise((_, fail) => setTimeout(() => fail(new Error('timed out')), 30000)),
        ]);
      } catch (e) {
        result = { phash: null, why: `failed at ${step}: ${e.message}`, spread: 0 };
      }
      batch[file] = result;
      if (++done % 25 === 0) {
        await post({ results: batch });
        batch = {};
        status.textContent = `${done} of ${files.length}`;
      }
    }
    await post({ results: batch, done: true, ms: Math.round(performance.now() - started) });
    status.textContent = `Done: ${done} files. You can close this tab.`;
  } catch (e) {
    status.textContent = `Failed: ${e.message}`;
    await post({ error: String(e.message) }).catch(() => {});
  }
})();
