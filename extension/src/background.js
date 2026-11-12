// Chrome runs this as a service worker (needs importScripts); Firefox and Safari load
// common.js, meta.js, train.js, votes.js, crowd.js and the image model files first via
// background.scripts.
if (typeof importScripts === 'function' && typeof SlopMeta === 'undefined') {
  importScripts('common.js', 'meta.js', 'train.js', 'votes.js', 'crowd.js');
}

const api = SLOP_API;
// Safari only: switch the Origin strip rule off and on before anything can be sent.
// Nothing goes to the network here; the first vote or list download checks it worked.
slopArmStrip();
const READ_LIMIT = 512 * 1024; // metadata lives at the start of the file
const MAX_PARALLEL = 4;
const CACHE_MAX = 3000;

// ---- image scanning -------------------------------------------------------

// Runs `work(url)` at most `parallel` at a time, once per URL, remembering up to
// `max` results. `.forget()` drops what it remembers.
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
  const run = (url) => {
    if (cache.has(url)) return Promise.resolve(cache.get(url));
    if (inflight.has(url)) return inflight.get(url);
    const p = new Promise((resolve) => queue.push({ url, resolve }));
    inflight.set(url, p);
    pump();
    return p;
  };
  run.forget = () => cache.clear();
  return run;
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
// Firefox's and Safari's background pages run it directly (vision.js is loaded before
// this file).

let creatingOffscreen = null;
// hasDocument() is only documented from Chrome 150, so older ones ask getContexts()
// (Chrome 116, the manifest's minimum).
async function hasOffscreen() {
  if (api.offscreen.hasDocument) return api.offscreen.hasDocument();
  return (await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
}
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= api.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Runs the AI-image model in WebAssembly',
    })
    .finally(() => (creatingOffscreen = null));
  await creatingOffscreen;
}

// One download gets the metadata verdict, the picture's 512-number summary and, while
// the crowd's list is in use, its hash. Kept so a rating can reuse them.
const inspectUrl = cachedQueue(async (url) => {
  const hash = /^https?:/.test(url) && (await SlopCrowd.inUse().catch(() => false));
  if (typeof SlopVision !== 'undefined') return SlopVision.inspect(url, { hash });
  await ensureOffscreen();
  return api.runtime.sendMessage({ target: 'offscreen', type: 'inspect', url, hash });
}, 2, 500);
// Pictures inspected before the list was turned on have no hash to match.
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.useCrowdList) inspectUrl.forget();
});

// The hash for a rating that inspect() didn't hash, from wherever the model runs. It
// decodes the picture again at full size, so it only happens for a rating.
async function hashUrl(url) {
  if (typeof SlopVision !== 'undefined') return SlopVision.hash(url);
  await ensureOffscreen();
  return api.runtime.sendMessage({ target: 'offscreen', type: 'hash', url });
}

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

// These hosts strip metadata from everything, so downloading a picture just to read
// its metadata would be wasted.
const STRIPS_METADATA = /(^|\.)(fbcdn\.net|cdninstagram\.com)$/;

// What a content script wants to know about an image. `picture`: score how it looks.
// `meta`: read its metadata. Returns { meta, score, crowd }, or null. `crowd` says the
// picture matches the crowd's list, matched here and never looked up. Only a match also
// carries the picture's `phash`, for Report this; the page has no use for any other hash.
async function check({ url, picture, meta }) {
  const inspected = picture ? await inspectUrl(url) : null;
  if (inspected) {
    const reply = {
      meta: meta ? inspected.meta : null,
      score: SlopTrain.score(await currentClassifier(), inspected.embedding),
      crowd: await SlopCrowd.flagged(imageKey(url), inspected.phash).catch(() => false),
    };
    if (reply.crowd) reply.phash = inspected.phash;
    return reply;
  }
  // No model (or it failed): the metadata check still works on its own.
  if (meta && !STRIPS_METADATA.test(new URL(url).hostname)) return { meta: await scanUrl(url), score: null };
  return null;
}

// ---- learning from your ratings --------------------------------------------

const MAX_RATINGS = 500; // per kind; oldest go first
const RATING_WEIGHT = 3; // one of your ratings counts as much as three shipped examples

let learning = Promise.resolve();
function learn(url, label, source, incognito) {
  // Read now, not when this gets its turn: only a rating made while sharing is on counts.
  const sharing = slopGetShare().catch(() => false);
  learning = learning.then(async () => {
    const inspected = await inspectUrl(url);
    if (!inspected) return false;
    const { visionRatings = { ai: [], real: [] } } = await api.storage.local.get('visionRatings');
    const key = imageKey(url);
    // Rating the same picture again replaces the old rating.
    for (const kind of ['ai', 'real']) visionRatings[kind] = visionRatings[kind].filter((r) => r.key !== key);
    visionRatings[label].push({ key, e: inspected.embedding.map((x) => +x.toFixed(5)) });
    visionRatings[label] = visionRatings[label].slice(-MAX_RATINGS);
    await api.storage.local.set({ visionRatings, visionModel: await retrain(visionRatings) });
    // The rating is saved by now, so nothing here can lose it. Video frames are skipped
    // because their hash changes with the frame.
    const share = (await sharing) && !incognito && /^https?:/.test(url) && (source === 'rated' || source === 'hid');
    const phash = await ratedHash(url, inspected, share).catch(() => null);
    // Remembered whether or not you share, so your Not AI beats the crowd's list.
    if (/^https?:/.test(url)) await SlopCrowd.remember(key, phash, label).catch(() => {});
    if (share) await queueVote(phash, label, source, inspected.embedding).catch(() => {});
    return true;
  }).catch(() => false);
  return learning;
}

async function queueVote(phash, label, source, embedding) {
  if (phash) await SlopVotes.add({ phash, label, source, embedding });
}

// The hash inspect() took from its own download, when the crowd's list is in use, so
// the picture isn't fetched again. Otherwise a second look, only if something needs it.
async function ratedHash(url, inspected, share) {
  if (!/^https?:/.test(url)) return null;
  if (inspected.phash !== undefined) return inspected.phash;
  if (!share && !(await SlopCrowd.inUse())) return null;
  return hashUrl(url);
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
  if (url.startsWith('data:')) return url.slice(-64); // a video frame
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

// ---- reporting a picture the crowd hid -------------------------------------

// Report this opens your own email app with the picture's fingerprint, the version and the
// browser, and nothing about the page; you choose whether to send it. It's opened from here
// rather than as a link in the page, so the site can't catch the click. A mailto: hands off
// to your email app without the tab leaving its page.
function reportPicture(phash, tabId) {
  if (typeof phash !== 'string' || !/^[0-9a-f]{16}$/.test(phash)) return;
  const body = `This picture isn't AI, but the crowd's list hid it.\n\nFingerprint: ${phash}\n\n---\nHide the Slop ${api.runtime.getManifest().version}, ${slopBrowserName()}`;
  const url = `mailto:hello@hidetheslop.com?subject=${encodeURIComponent('Hide the Slop: a real picture the crowd hid')}&body=${encodeURIComponent(body)}`;
  api.tabs.update(tabId, { url }).catch(() => {});
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
  if (msg.type === 'check') {
    check(msg).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.type === 'learn') {
    learn(msg.url, msg.label, msg.source, !!sender.tab?.incognito).then(sendResponse);
    return true;
  }
  if (msg.type === 'reportPicture' && sender.tab) {
    reportPicture(msg.phash, sender.tab.id);
    return false;
  }
  if (msg.type === 'voteState') {
    SlopVotes.state().then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.type === 'voteSend') {
    SlopVotes.run({ now: true }).then(() => SlopVotes.state()).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.type === 'voteClear') {
    SlopVotes.clear().then(() => sendResponse(true), () => sendResponse(false));
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

// Install and browser startup can both land here at once, and two runs at the same time
// would add each item twice, so each one waits for the last.
let menus = Promise.resolve();
function createMenus() {
  menus = menus.then(() => api.contextMenus.removeAll()).then(() => {
    api.contextMenus.create({ id: 'hide', title: 'Hide this as AI slop', contexts: ['all'] });
    api.contextMenus.create({ id: 'block', title: 'Always hide posts from this account…', contexts: ['all'] });
  }).catch(() => {});
}

api.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id < 0) return;
  api.tabs
    .sendMessage(tab.id, { type: 'menu', id: info.menuItemId, srcUrl: info.srcUrl }, { frameId: info.frameId || 0 })
    .catch(() => {});
});

api.runtime.onInstalled.addListener(async ({ reason }) => {
  createMenus();
  api.action.setBadgeBackgroundColor({ color: '#c80000' }).catch(() => {});
  // The welcome page also asks for site access if Firefox or Safari didn't get it at install.
  if (reason === 'install') {
    api.tabs.create({ url: api.runtime.getURL('welcome.html') }).catch(() => {});
    return;
  }
  // Ratings give you your own retrained classifier, which a new version's examples
  // wouldn't reach until your next rating.
  if (reason === 'update') {
    SlopVotes.updated().catch(() => {});
    const { visionRatings } = await api.storage.local.get('visionRatings');
    if (visionRatings) {
      await retrain(visionRatings).then((visionModel) => api.storage.local.set({ visionModel })).catch(() => {});
    }
  }
  // Firefox and Safari let people install without granting site access; nothing works
  // until they do.
  const granted = await slopCanSeeSites();
  if (!granted) api.runtime.openOptionsPage();
});
api.runtime.onStartup.addListener(createMenus);

SlopVotes.start();
SlopCrowd.start();
