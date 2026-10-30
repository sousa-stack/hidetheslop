// Chrome runs this as a service worker (needs importScripts); Firefox loads
// common.js, meta.js, train.js and the image model files first via background.scripts.
if (typeof importScripts === 'function' && typeof SlopMeta === 'undefined') {
  importScripts('common.js', 'meta.js', 'train.js');
}

const api = SLOP_API;
const READ_LIMIT = 512 * 1024; // metadata lives at the start of the file
const MAX_PARALLEL = 4;
const CACHE_MAX = 3000;

// ---- image scanning -------------------------------------------------------

// Runs `work(url)` at most `parallel` at a time, once per URL, remembering up to
// `max` results.
function cachedQueue(work, parallel, max = CACHE_MAX) {
  const cache = new Map();
  const inflight = new Map();
  const queue = [];
  let running = 0;
  function pump() {
    while (running < parallel && queue.length) {
      const { url, resolve } = queue.shift();
      running++;
      Promise.resolve()
        .then(() => work(url))
        .then(
          (result) => ({ result, ok: true }),
          () => ({ result: null, ok: false }) // e.g. model not downloaded yet: try again later
        )
        .then(({ result, ok }) => {
          running--;
          if (cache.size >= max) cache.delete(cache.keys().next().value);
          if (ok) cache.set(url, result);
          inflight.delete(url);
          resolve(result);
          pump();
        });
    }
  }
  return (url) => {
    if (cache.has(url)) return Promise.resolve(cache.get(url));
    if (inflight.has(url)) return inflight.get(url);
    const p = new Promise((resolve) => queue.push({ url, resolve }));
    inflight.set(url, p);
    pump();
    return p;
  };
}

async function readHead(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      credentials: 'omit',
      cache: 'force-cache',
      headers: { Range: `bytes=0-${READ_LIMIT - 1}` },
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const out = new Uint8Array(READ_LIMIT);
    let n = 0;
    while (n < READ_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, READ_LIMIT - n);
      out.set(value.subarray(0, take), n);
      n += take;
    }
    reader.cancel().catch(() => {});
    return out.subarray(0, n);
  } finally {
    clearTimeout(timer);
  }
}

const scanUrl = cachedQueue(async (url) => {
  const bytes = await readHead(url);
  return bytes ? SlopMeta.scan(bytes) : null;
}, MAX_PARALLEL);

// ---- looking at the picture itself ---------------------------------------
// Chrome's service worker can't run the model, so it goes to an offscreen page.
// Firefox's background page runs it directly (vision.js is loaded before this file).

let creatingOffscreen = null;
async function ensureOffscreen() {
  if (await api.offscreen.hasDocument()) return;
  creatingOffscreen ??= api.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Runs the AI-image model in WebAssembly',
    })
    .finally(() => (creatingOffscreen = null));
  await creatingOffscreen;
}

// The picture's 512-number summary, kept so a rating can reuse it.
const embedUrl = cachedQueue(async (url) => {
  if (typeof SlopVision !== 'undefined') return SlopVision.embed(url);
  await ensureOffscreen();
  return api.runtime.sendMessage({ target: 'offscreen', type: 'embed', url });
}, 2, 500);

// The classifier: retrained from your ratings if you've made any, else the shipped one.
let classifier = null;
async function currentClassifier() {
  if (!classifier) {
    const { visionModel } = await api.storage.local.get('visionModel');
    classifier = visionModel || (await (await fetch(api.runtime.getURL('vision-weights.json'))).json());
  }
  return classifier;
}
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.visionModel) classifier = null;
});

async function classify(url) {
  const e = await embedUrl(url);
  return e ? SlopTrain.score(await currentClassifier(), e) : null;
}

// ---- learning from your ratings --------------------------------------------

const MAX_RATINGS = 500; // per kind; oldest go first
const RATING_WEIGHT = 3; // one of your ratings counts as much as three shipped examples

let learning = Promise.resolve();
function learn(url, label) {
  learning = learning.then(async () => {
    const e = await embedUrl(url);
    if (!e) return false;
    const { visionRatings = { ai: [], real: [] } } = await api.storage.local.get('visionRatings');
    const key = imageKey(url);
    // Rating the same picture again replaces the old rating.
    for (const kind of ['ai', 'real']) visionRatings[kind] = visionRatings[kind].filter((r) => r.key !== key);
    visionRatings[label].push({ key, e: e.map((x) => +x.toFixed(5)) });
    visionRatings[label] = visionRatings[label].slice(-MAX_RATINGS);
    await api.storage.local.set({ visionRatings, visionModel: await retrain(visionRatings) });
    return true;
  }).catch(() => false);
  return learning;
}

async function retrain(ratings) {
  const base = await (await fetch(api.runtime.getURL('vision-examples.json'))).json();
  const X = [], y = [], sw = [];
  const add = (list, label, weight) => list.forEach((e) => (X.push(e), y.push(label), sw.push(weight)));
  add(base.ai, 1, 1);
  add(base.real, 0, 1);
  add(ratings.ai.map((r) => r.e), 1, RATING_WEIGHT);
  add(ratings.real.map((r) => r.e), 0, RATING_WEIGHT);
  return SlopTrain.train(X, y, { sampleWeight: sw });
}

// Same picture, different size or signature in the URL.
function imageKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

// ---- badge / per-tab stats ------------------------------------------------

const tabStats = new Map(); // tabId -> Map(frameId -> {count, reasons})

function updateBadge(tabId) {
  const frames = tabStats.get(tabId);
  let total = 0;
  if (frames) for (const f of frames.values()) total += f.count;
  api.action.setBadgeText({ tabId, text: total ? String(total) : '' }).catch(() => {});
}

function statsFor(tabId) {
  const reasons = {};
  let count = 0;
  for (const f of (tabStats.get(tabId) || new Map()).values()) {
    count += f.count;
    for (const [r, n] of Object.entries(f.reasons)) reasons[r] = (reasons[r] || 0) + n;
  }
  return { count, reasons };
}

api.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') {
    tabStats.delete(tabId);
    updateBadge(tabId);
  }
});
api.tabs.onRemoved.addListener((tabId) => tabStats.delete(tabId));

// ---- messages -------------------------------------------------------------

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return false;
  if (msg.type === 'scan') {
    scanUrl(msg.url).then(sendResponse);
    return true;
  }
  if (msg.type === 'classify') {
    classify(msg.url).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.type === 'learn') {
    learn(msg.url, msg.label).then(sendResponse);
    return true;
  }
  if (msg.type === 'stats' && sender.tab) {
    const tabId = sender.tab.id;
    if (!tabStats.has(tabId)) tabStats.set(tabId, new Map());
    tabStats.get(tabId).set(sender.frameId || 0, { count: msg.count, reasons: msg.reasons });
    updateBadge(tabId);
    return false;
  }
  if (msg.type === 'tabStats') {
    sendResponse(statsFor(msg.tabId));
    return false;
  }
  return false;
});

// ---- context menu ---------------------------------------------------------

function createMenus() {
  Promise.resolve(api.contextMenus.removeAll()).then(() => {
    api.contextMenus.create({ id: 'hide', title: 'Hide this as AI slop', contexts: ['all'] });
    api.contextMenus.create({ id: 'block', title: 'Always hide posts from this account…', contexts: ['all'] });
  });
}

api.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id < 0) return;
  api.tabs
    .sendMessage(tab.id, { type: 'menu', id: info.menuItemId, srcUrl: info.srcUrl }, { frameId: info.frameId || 0 })
    .catch(() => {});
});

api.runtime.onInstalled.addListener(async () => {
  createMenus();
  api.action.setBadgeBackgroundColor({ color: '#c80000' }).catch(() => {});
  // Firefox lets people install without granting site access; nothing works until they do.
  const granted = await api.permissions.contains({ origins: SLOP_ORIGINS }).catch(() => true);
  if (!granted) api.runtime.openOptionsPage();
});
api.runtime.onStartup.addListener(createMenus);
