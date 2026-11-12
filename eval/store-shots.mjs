// Makes the Chrome, Edge and Firefox store images from the real extension, so a new
// version gets fresh screenshots instead of mock-ups. Run from this folder, after
// building: node store-shots.mjs. Everything lands in docs/store/browser/.
//
// The stores want 1280×800 with no transparency, so pages are drawn at twice that and
// shrunk, which reads better than Chrome's 1× text, then flattened and saved without
// metadata. The browser is Playwright's Chrome for Testing (vote-check.mjs explains why)
// in a temporary profile, deleted afterwards, with a copy of dist/chrome so nothing
// under extension/ is touched.
//
// Your robot comes from eval/models, put in the extension's cache under the address it
// checks, so turning it on doesn't download anything. The model hosts and the API are
// unreachable from this browser, so a slip can't download the model or ask the live API
// for the crowd's list. The demo on hidetheslop.com is fetched live, because that's the
// page the screenshot is of. Its posts aren't <figure>s and the site isn't one of the
// feeds in content.js, so the extension can't put its own bars there: the "was this AI?"
// shot uses a plain page served from here, with the same three demo pictures from
// site/public/images. Nothing from test-images/ is involved.
//
// The promo tile and the popup's frame are small pages using poster.css, drawn by the
// same browser, so they get the fonts this Mac already has and no web fonts.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromePath, rpc } from './vote-check.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = here('../docs/store/browser/');
const MODEL = here('models/Xenova/clip-vit-base-patch32/onnx/vision_model_int8.onnx');
const SITE = 'https://hidetheslop.com/';
const W = 1280, H = 800, SCALE = 2;
const BLOCKED = ['api.hidetheslop.com', 'models.hidetheslop.com', 'huggingface.co', '*.huggingface.co'];

// ---- what the local server hands out ---------------------------------------------------

const feedPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sample feed</title>
<style>
  body { margin: 0; background: #f3f2ef; color: #1f2023; font: 15px/1.45 system-ui, -apple-system, sans-serif; }
  main { max-width: 600px; margin: 0 auto; padding: 28px 0 400px; }
  figure { margin: 0 0 22px; padding: 14px; background: #fff; border: 1px solid #dddcd8; border-radius: 10px; }
  img { display: block; width: 100%; height: auto; border-radius: 6px; }
  figcaption { margin-top: 10px; }
  figcaption b { display: block; }
  figcaption span { color: #66655f; }
</style></head>
<body><main>
  <figure><img src="/images/sunset-jazz.webp" alt="" width="900" height="600">
    <figcaption><b>Sunset Jazz Night</b><span>Rooftop, Friday at eight</span></figcaption></figure>
  <figure><img src="/images/dog.webp" alt="" width="900" height="675">
    <figcaption><b>A real dog</b><span>Photographed by a person. No robots involved.</span></figcaption></figure>
  <figure><img src="/images/robot-rock.webp" alt="" width="900" height="600">
    <figcaption><b>Robot Rock grand opening</b><span>Doors at nine</span></figcaption></figure>
</main></body></html>`;

const promoPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/poster.css">
<style>
  html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; background: var(--amber); }
  .tile { display: flex; align-items: center; gap: 18px; height: 280px; padding: 0 30px 0 22px; }
  img { flex: none; width: 196px; height: 196px; }
  h1 { font-size: 82px; line-height: .86; }
</style></head>
<body><div class="tile"><img src="/logo.png" alt=""><h1>Hide<br>the<br>slop</h1></div></body></html>`;

// Chrome's marquee, only shown if the store features the listing.
const marqueePage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/poster.css">
<style>
  html, body { margin: 0; width: 1400px; height: 560px; overflow: hidden; background: var(--amber); }
  .tile { display: flex; align-items: center; gap: 64px; height: 560px; padding: 0 90px 0 96px; }
  img { flex: none; width: 400px; height: 400px; }
  h1 { font-size: 168px; line-height: .86; margin: 0; }
  p { margin: 30px 0 0; font-size: 34px; font-weight: 700; line-height: 1.25; color: var(--ink); }
</style></head>
<body><div class="tile"><img src="/logo.png" alt=""><div><h1>Hide the slop</h1><p>Hides AI-generated posts, pictures and ads as you browse.</p></div></div></body></html>`;

const popupFrame = (w, h) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/poster.css">
<style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: var(--paper); }
  .frame { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 64px; height: ${H}px; padding: 0 120px 0 110px; }
  h1 { font-size: 104px; line-height: .9; }
  p { margin: 34px 0 0; max-width: 470px; font-size: 24px; font-weight: 600; line-height: 1.35; }
  img { display: block; width: ${w}px; height: ${h}px; border: 3px solid var(--ink); }
</style></head>
<body><div class="frame">
  <div><h1>What it hid, and why</h1><p>See it all again, or pause it on a site, from your toolbar.</p></div>
  <img src="/popup.png" alt="">
</div></body></html>`;

const files = { popup: null };
function serve() {
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const send = (type, body) => {
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (path === '/model') return send('application/octet-stream', readFileSync(MODEL));
    if (path === '/feed.html') return send('text/html', feedPage);
    if (path === '/promo.html') return send('text/html', promoPage);
    if (path === '/marquee.html') return send('text/html', marqueePage);
    if (path === '/popup-frame.html') return send('text/html', popupFrame(files.popupW, files.popupH));
    if (path === '/popup.png') return send('image/png', files.popup);
    if (path === '/poster.css') return send('text/css', readFileSync(here('../extension/src/poster.css')));
    if (path === '/logo.png') return send('image/png', readFileSync(here('../brand/logo-1024.png')));
    const image = /^\/images\/(dog|robot-rock|sunset-jazz)\.webp$/.exec(path);
    if (image) return send('image/webp', readFileSync(here(`../site/public/images/${image[1]}.webp`)));
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---- the browser ----------------------------------------------------------------------

const wrap = (expr) => `(async () => JSON.stringify(await (async () => (${expr}))()))()`;

async function startChrome(extension) {
  const profile = mkdtempSync(join(tmpdir(), 'hts-shots-chrome-'));
  const proc = spawn(chromePath(), [
    '--headless=new', `--user-data-dir=${profile}`, `--load-extension=${extension}`, `--disable-extensions-except=${extension}`,
    '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
    '--disable-component-update', `--window-size=${W},${H}`, '--hide-scrollbars', '--force-color-profile=srgb',
    `--host-resolver-rules=${BLOCKED.map((h) => `MAP ${h} ~NOTFOUND`).join(', ')}`, 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  const [port, browserPath] = readFileSync(portFile, 'utf8').split('\n');
  const browser = await rpc(`ws://127.0.0.1:${port}${browserPath}`);
  const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const find = async (test) => {
    for (let i = 0; i < 150; i++) {
      const hit = (await targets()).find(test);
      if (hit) return hit;
      await sleep(100);
    }
    throw new Error('target not found');
  };

  async function attach(target, { width = W, height = H, scale = SCALE } = {}) {
    const cdp = await rpc(target.webSocketDebuggerUrl);
    await cdp.call('Page.enable');
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    // No animations mid-shot, and hidetheslop.com's demo scrolls without easing.
    await cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const evaluate = async (expr) => {
      const m = await cdp.call('Runtime.evaluate', { expression: wrap(expr), awaitPromise: true, returnByValue: true });
      if (m.result?.exceptionDetails) throw new Error(`evaluate: ${JSON.stringify(m.result.exceptionDetails).slice(0, 400)}`);
      return JSON.parse(m.result.result.value ?? 'null');
    };
    const settle = async () => {
      await sleep(500);
      for (let i = 0; i < 100; i++) if ((await evaluate('document.readyState')) === 'complete') break; else await sleep(100);
      await evaluate(`Promise.all([...document.images].map((i) => i.complete || new Promise((r) => (i.onload = i.onerror = r))))`);
      await evaluate('document.fonts.ready.then(() => true)');
      await sleep(400);
    };
    const mouse = async (type, x, y) => cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
    return {
      targetId: target.id, evaluate, settle,
      goto: async (url) => {
        await cdp.call('Page.navigate', { url });
        await settle();
      },
      reload: async () => {
        await cdp.call('Page.reload', {});
        await settle();
      },
      hover: (x, y) => mouse('mouseMoved', x, y),
      clickAt: async (x, y) => {
        await mouse('mouseMoved', x, y);
        await mouse('mousePressed', x, y);
        await mouse('mouseReleased', x, y);
      },
      click: async (selector) => {
        const r = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await mouse('mouseMoved', r.x, r.y);
        await mouse('mousePressed', r.x, r.y);
        await mouse('mouseReleased', r.x, r.y);
      },
      capture: async (clip) => {
        await browser.call('Target.activateTarget', { targetId: target.id });
        await sleep(300);
        const m = await cdp.call('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
        return Buffer.from(m.result.data, 'base64');
      },
      close: () => cdp.close(),
    };
  }

  const open = async (url, options) => {
    const m = await browser.call('Target.createTarget', { url: 'about:blank' });
    const page = await attach(await find((t) => t.id === m.result.targetId), options);
    if (url) await page.goto(url);
    return page;
  };

  return { proc, profile, browser, find, attach, open };
}

// ---- saving -----------------------------------------------------------------------------

// The stores reject transparency, and nothing about this Mac should ride along: sharp
// writes no metadata unless asked, and flatten() drops the alpha channel.
async function save(name, png, width = W, height = H) {
  const path = join(OUT, name);
  await sharp(png).resize(width, height, { kernel: 'lanczos3' }).flatten({ background: '#ffffff' }).png({ compressionLevel: 9 }).toFile(path);
  const meta = await sharp(path).metadata();
  if (meta.width !== width || meta.height !== height || meta.hasAlpha) throw new Error(`${name} came out ${meta.width}×${meta.height}, alpha ${meta.hasAlpha}`);
  console.log(`  ${name}  ${meta.width}×${meta.height}`);
}

// ---- the shots ------------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const local = `http://127.0.0.1:${server.address().port}`;
  const extension = mkdtempSync(join(tmpdir(), 'hts-shots-ext-'));
  cpSync(here('../extension/dist/chrome'), extension, { recursive: true });
  const version = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8')).version;
  console.log(`Hide the Slop ${version}, ${execFileSync(chromePath(), ['--version'], { encoding: 'utf8' }).trim()}`);
  let chrome = null;
  try {
    chrome = await startChrome(extension);

    // 5. The welcome page, as a first install opens it, before anything is turned on.
    const welcomeTarget = await chrome.find((t) => t.type === 'page' && t.url.endsWith('/welcome.html'));
    const id = new URL(welcomeTarget.url).host;
    const welcome = await chrome.attach(welcomeTarget);
    await welcome.reload();
    await save('5-welcome.png', await welcome.capture());

    // 1. The demo on hidetheslop.com, after its own button, with the robot still off.
    const site = await chrome.open(SITE);
    await site.evaluate(`(() => { document.querySelector('.try').scrollIntoView(); return true; })()`);
    await site.settle();
    await site.click('#toggle');
    await sleep(600);
    await site.evaluate(`(() => { scrollTo(0, document.querySelector('.try').getBoundingClientRect().top + scrollY - 28); return true; })()`);
    await sleep(600);
    await save('1-demo-hidden.png', await site.capture());

    // 3. Settings, with your robot turned on by a real click on its switch.
    const options = await chrome.open(`chrome-extension://${id}/options.html`);
    const modelUrl = /MODEL_URL =\s*'([^']+)'/.exec(readFileSync(join(extension, 'vision.js'), 'utf8'))[1];
    await options.evaluate(`(async () => {
      const buf = await (await fetch(${JSON.stringify(`${local}/model`)})).arrayBuffer();
      await (await caches.open('hidetheslop-model')).put(${JSON.stringify(modelUrl)}, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
      return true;
    })()`);
    await options.reload();
    await options.click('#visualCheck');
    for (let i = 0; i < 100 && !(await options.evaluate(`SLOP_API.storage.sync.get('visualCheck').then((s) => s.visualCheck === true)`)); i++) await sleep(100);
    if (!(await options.evaluate(`SLOP_API.storage.sync.get('visualCheck').then((s) => s.visualCheck === true)`))) {
      throw new Error(`your robot didn't turn on: ${await options.evaluate(`document.getElementById('visualStatus').textContent`)}`);
    }
    await sleep(800);
    await options.evaluate(`(() => { scrollTo(0, 0); return true; })()`);
    await sleep(300);
    await save('3-settings.png', await options.capture());
    console.log(`  Settings says: ${await options.evaluate(`[...document.querySelectorAll('#visualStatus, #modelState, #crowdStatus')].map((e) => e.textContent).join(' | ')`)}`);

    // 2. A post your robot hid, after Show: the "was this AI?" question.
    const feed = await chrome.open(`${local}/feed.html`);
    const hiddenNow = () => feed.evaluate(`[...document.querySelectorAll('figure')].map((f) => f.dataset.hidetheslop || '')`);
    let state = [];
    for (let i = 0; i < 120 && !state.includes('hidden'); i++) {
      state = await hiddenNow();
      await sleep(250);
    }
    await sleep(3000);
    state = await hiddenNow();
    console.log(`  the sample feed after your robot looked (jazz, dog, rock): ${JSON.stringify(state)}`);
    let pick = state[0] === 'hidden' ? 0 : state[2] === 'hidden' ? 2 : -1;
    if (pick < 0) {
      // Your robot let both flyers through, so hide the first one by hand, the way the
      // hover button does it.
      const r = await feed.evaluate(`(() => { const img = document.querySelector('figure img'); img.scrollIntoView({ block: 'center' }); const r = img.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right, top: r.top }; })()`);
      await feed.hover(r.x, r.y);
      await sleep(900);
      await feed.clickAt(r.right - 45, r.top + 22);
      await sleep(600);
      pick = 0;
      console.log('  hid the first flyer by hand');
    }
    const show = await feed.evaluate(`(() => {
      const fig = document.querySelectorAll('figure')[${pick}];
      fig.scrollIntoView({ block: 'start' });
      const b = fig.querySelector('.hidetheslop-ph').shadowRoot.querySelector('button.show');
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await feed.clickAt(show.x, show.y);
    await sleep(600);
    const asked = await feed.evaluate(`[...document.querySelectorAll('figure')[${pick}].querySelectorAll('.hidetheslop-ph')].map((p) => p.shadowRoot.textContent.replace(/\\s+/g, ' ').trim().slice(-60))`);
    console.log(`  after Show: ${JSON.stringify(asked)}`);
    await feed.evaluate(`(() => { const fig = document.querySelectorAll('figure')[${pick}]; scrollTo(0, fig.getBoundingClientRect().top + scrollY - (${pick} ? 120 : 28)); return true; })()`);
    await feed.hover(5, 5);
    await sleep(500);
    await save('2-was-this-ai.png', await feed.capture());

    // 4. The popup, opened as a page beside hidetheslop.com, so it reports on that tab.
    // A tab in the background never sees its pictures scroll into view, so it goes first.
    await chrome.browser.call('Target.activateTarget', { targetId: site.targetId });
    await site.reload();
    await site.evaluate(`(() => { document.querySelector('.try').scrollIntoView(); return true; })()`);
    for (let i = 0; i < 120 && !(await site.evaluate(`document.querySelectorAll('[data-hidetheslop]').length`)); i++) await sleep(250);
    await sleep(3000);
    console.log(`  hidetheslop.com with your robot on: ${await site.evaluate(`document.querySelectorAll('[data-hidetheslop]').length`)} hidden`);
    await options.evaluate(`(async () => {
      const [tab] = await SLOP_API.tabs.query({ url: ${JSON.stringify(SITE + '*')} });
      await SLOP_API.tabs.update(tab.id, { active: true });
      await SLOP_API.tabs.create({ url: 'popup.html', active: false, windowId: tab.windowId });
      return true;
    })()`);
    const popupTarget = await chrome.find((t) => t.type === 'page' && t.url.endsWith('/popup.html'));
    const popup = await chrome.attach(popupTarget, { width: 300, height: 700, scale: 4 });
    await popup.reload();
    await sleep(800);
    const popupH = await popup.evaluate('Math.ceil(document.body.getBoundingClientRect().height)');
    console.log(`  the popup says: ${await popup.evaluate(`document.querySelector('main').innerText.replace(/\\s+/g, ' ')`)}`);
    // capture() activates the popup's tab, which is fine now it has drawn.
    files.popup = await popup.capture({ x: 0, y: 0, width: 300, height: popupH });
    files.popupW = Math.round(300 * 1.6);
    files.popupH = Math.round(popupH * 1.6);
    const frame = await chrome.open(`${local}/popup-frame.html`);
    await save('4-popup.png', await frame.capture());

    // The small promo tile.
    const promo = await chrome.open(`${local}/promo.html`, { width: 440, height: 280, scale: 2 });
    await save('promo-small-440x280.png', await promo.capture(), 440, 280);
    const marquee = await chrome.open(`${local}/marquee.html`, { width: 1400, height: 560, scale: 2 });
    await save('marquee-1400x560.png', await marquee.capture(), 1400, 560);
  } finally {
    try { chrome?.browser.close(); } catch { /* going away anyway */ }
    if (chrome) {
      chrome.proc.kill();
      for (let i = 0; i < 50 && chrome.proc.exitCode === null && chrome.proc.signalCode === null; i++) await sleep(100);
      rmSync(chrome.profile, { recursive: true, force: true });
    }
    rmSync(extension, { recursive: true, force: true });
    server.close();
    server.closeAllConnections();
  }

  // The Edge store logo is the logo itself, only smaller.
  execFileSync('sips', ['-z', '300', '300', here('../brand/logo-1024.png'), '--out', join(OUT, 'edge-logo-300.png')], { stdio: 'ignore' });
  console.log('  edge-logo-300.png  300×300');
}

await main();
