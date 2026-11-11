// node --test test/crowd.test.mjs
// The crowd's list with fake storage and a fake network. Nothing here touches the API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const HOUR = 3600000;
const DAY = 24 * HOUR;
const LIST = 'https://api.hidetheslop.com/v1/verdicts';

// Hashes far enough apart that none counts as a copy of another.
const hashOf = (i) => {
  let out = '';
  let x = (i + 1) * 2654435761;
  for (let k = 0; k < 16; k++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    out += Math.floor(x / 268435456).toString(16);
  }
  return out;
};
// Flips one bit in each of the digits listed, so `[0, 5, 9]` is 3 bits in 3 bands.
const flip = (h, digits) => [...h].map((c, i) => (digits.includes(i) ? (parseInt(c, 16) ^ 1).toString(16) : c)).join('');

// A fresh SlopCrowd. `reply(since)` answers each list fetch, or throws for a network
// failure: a { status, json } or { status, text }.
function setup({ sync = {}, local: seed = {}, reply, model = true, firefox = false, perms = {}, start = false } = {}) {
  const store = { sync: { visualCheck: true, ...sync }, local: { ...seed } };
  const requests = [];
  const listeners = { changed: [], alarm: [], startup: [] };
  const alarms = new Map();
  const quota = { full: false };
  const area = (name) => ({
    get: async (keys) => {
      const out = {};
      if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
        for (const [k, v] of Object.entries(keys)) out[k] = k in store[name] ? structuredClone(store[name][k]) : v;
        return out;
      }
      for (const k of typeof keys === 'string' ? [keys] : keys) if (k in store[name]) out[k] = structuredClone(store[name][k]);
      return out;
    },
    set: async (patch) => {
      if (quota.full && name === 'local' && 'crowdList' in patch) throw new Error('QUOTA_BYTES quota exceeded');
      const changes = {};
      for (const [k, v] of Object.entries(patch)) {
        changes[k] = { oldValue: store[name][k], newValue: v };
        store[name][k] = structuredClone(v);
      }
      listeners.changed.forEach((l) => l(changes, name));
    },
    remove: async (keys) => {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (k in store[name]) changes[k] = { oldValue: store[name][k] };
        delete store[name][k];
      }
      if (Object.keys(changes).length) listeners.changed.forEach((l) => l(changes, name));
    },
  });
  const access = { origins: true, rules: ['strip-origin'], ...perms };
  const chrome = {
    storage: { sync: area('sync'), local: area('local'), onChanged: { addListener: (l) => listeners.changed.push(l) } },
    alarms: {
      get: async (name) => alarms.get(name),
      create: (name, info) => alarms.set(name, info),
      onAlarm: { addListener: (l) => listeners.alarm.push(l) },
    },
    permissions: { contains: async (q) => (q.origins ? access.origins : false) },
    declarativeNetRequest: { getEnabledRulesets: async () => access.rules },
    runtime: {
      getManifest: () => (firefox ? { browser_specific_settings: { gecko: {} } } : {}),
      onStartup: { addListener: (l) => listeners.startup.push(l) },
    },
  };
  const caches = { open: async () => ({ keys: async () => (model ? [{}] : []) }) };
  const fetch = async (url, init) => {
    requests.push({ url, init });
    const since = Number(new URL(url).searchParams.get('since'));
    const answer = await (reply ?? (() => ({ status: 200, json: { seq: since, add: [], remove: [], more: false } })))(since);
    return { status: answer.status, text: async () => answer.text ?? JSON.stringify(answer.json) };
  };
  const ctx = {
    chrome, fetch, caches, AbortController, setTimeout, clearTimeout, URL, Math, Date, console, Number, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(here('../src/common.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(here('../src/crowd.js'), 'utf8'), ctx);
  const crowd = vm.runInContext('SlopCrowd', ctx);
  if (start) crowd.start();
  return { crowd, store, local: store.local, requests, listeners, alarms, ctx, quota };
}

const page = (seq, add = [], remove = [], more = false) => ({ status: 200, json: { seq, add, remove, more } });
const flush = () => new Promise((r) => setTimeout(r, 5));
async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
// A list that's up to date as of now, so the next fetch is an update, not a resync.
const fresh = (list, seq = 10) => ({ crowdList: list, crowdSeq: seq, crowdFetchedAt: Date.now(), crowdFullAt: Date.now() });

// ---- fetching ----------------------------------------------------------------

test('a first fetch starts at 0 and follows more until it is false', async () => {
  const pages = { 0: page(4, [hashOf(1), hashOf(2)], [], true), 4: page(9, [hashOf(3)], [], true), 9: page(12, [hashOf(4)]) };
  const { crowd, local, requests } = setup({ reply: (since) => pages[since] });
  assert.equal(await crowd.refresh(), true);
  assert.deepEqual(requests.map((r) => r.url), [0, 4, 9].map((s) => `${LIST}?since=${s}&hashVersion=1`));
  assert.deepEqual(local.crowdList, [1, 2, 3, 4].map(hashOf));
  assert.equal(local.crowdSeq, 12);
  assert.ok(Date.now() - local.crowdFetchedAt < 1000);
  assert.ok(Date.now() - local.crowdFullAt < 1000);
});

test('an update starts at the saved seq and applies add and remove', async () => {
  const { crowd, local, requests } = setup({
    local: fresh([hashOf(1), hashOf(2), hashOf(3)]),
    reply: () => page(14, [hashOf(4)], [hashOf(2)]),
  });
  assert.equal(await crowd.refresh(), true);
  assert.equal(requests[0].url, `${LIST}?since=10&hashVersion=1`);
  assert.deepEqual(local.crowdList, [hashOf(1), hashOf(3), hashOf(4)]);
  assert.equal(local.crowdSeq, 14);
});

test('a hash added again moves to the newest end', async () => {
  const { crowd, local } = setup({ local: fresh([hashOf(1), hashOf(2)]), reply: () => page(11, [hashOf(1)]) });
  await crowd.refresh();
  assert.deepEqual(local.crowdList, [hashOf(2), hashOf(1)]);
});

test('every 7 days it fetches from 0 and replaces the set instead of merging', async () => {
  const { crowd, local, requests } = setup({
    local: { ...fresh([hashOf(1), hashOf(2)], 50), crowdFullAt: Date.now() - 7 * DAY - 1000 },
    reply: () => page(60, [hashOf(2), hashOf(3)]),
  });
  await crowd.refresh();
  assert.equal(requests[0].url, `${LIST}?since=0&hashVersion=1`);
  assert.deepEqual(local.crowdList, [hashOf(2), hashOf(3)]);
  assert.equal(local.crowdSeq, 60);
  assert.ok(Date.now() - local.crowdFullAt < 1000);
});

test('a page that does not validate applies nothing, even after good pages', async () => {
  const bad = [
    { status: 200, json: { seq: 5, add: ['51A44EDB16C5E271'], remove: [], more: false } }, // upper case
    { status: 200, json: { seq: 5, add: ['abc'], remove: [], more: false } },
    { status: 200, json: { seq: 5, add: [12], remove: [], more: false } },
    { status: 200, json: { seq: 5, add: [], remove: ['zzzzzzzzzzzzzzzz'], more: false } },
    { status: 200, json: { seq: '5', add: [], remove: [], more: false } },
    { status: 200, json: { seq: 5, add: [], remove: [], more: 'no' } },
    { status: 200, json: { seq: 5, add: 'x', remove: [], more: false } },
    { status: 200, json: { seq: 5, add: [] , more: false } },
    { status: 200, json: { seq: 3, add: [], remove: [], more: false } }, // seq went backwards
    { status: 200, json: null },
    { status: 200, text: '<html>a proxy page</html>' },
    { status: 304, json: { seq: 5, add: [hashOf(9)], remove: [], more: false } },
    { status: 429, json: { error: 'rate_limited' } },
    { status: 503, text: '' },
  ];
  for (const last of bad) {
    let n = 0;
    const before = fresh([hashOf(1)], 4);
    const { crowd, local } = setup({ local: before, reply: () => (n++ === 0 ? page(5, [hashOf(2)], [], true) : last) });
    assert.equal(await crowd.refresh(), false, JSON.stringify(last));
    assert.deepEqual(local.crowdList, [hashOf(1)]);
    assert.equal(local.crowdSeq, 4);
    assert.equal(local.crowdFetchedAt, before.crowdFetchedAt);
  }
});

test('a network failure keeps the old list', async () => {
  const before = fresh([hashOf(1)]);
  const { crowd, local } = setup({ local: before, reply: () => { throw new Error('offline'); } });
  assert.equal(await crowd.refresh(), false);
  assert.deepEqual(local, before);
});

test('more with a seq that did not move stops without applying anything', async () => {
  const { crowd, local, requests } = setup({ local: fresh([hashOf(1)], 7), reply: () => page(7, [hashOf(2)], [], true) });
  assert.equal(await crowd.refresh(), false);
  assert.equal(requests.length, 1);
  assert.deepEqual(local.crowdList, [hashOf(1)]);
});

test('the number of pages is capped, and the next fetch carries on from there', async () => {
  const { crowd, local, requests } = setup({ local: fresh([], 0), reply: (since) => page(since + 1, [hashOf(since)], [], true) });
  assert.equal(await crowd.refresh(), true);
  assert.equal(requests.length, 5);
  assert.equal(local.crowdSeq, 5);
  assert.deepEqual(local.crowdList, [0, 1, 2, 3, 4].map(hashOf));
  await crowd.refresh();
  assert.equal(requests[5].url, `${LIST}?since=5&hashVersion=1`);
});

test('the list keeps the newest 20,000 hashes', async () => {
  const many = Array.from({ length: 20005 }, (_, i) => i.toString(16).padStart(16, '0'));
  const { crowd, local } = setup({ reply: () => page(20005, many) });
  await crowd.refresh();
  assert.equal(crowd.MAX_HASHES, 20000);
  assert.equal(local.crowdList.length, 20000);
  assert.equal(local.crowdList[0], many[5]);
  assert.equal(local.crowdList.at(-1), many.at(-1));
});

test('a full store loses the list write quietly, never a rating', async () => {
  const before = fresh([hashOf(1)]);
  const { crowd, local, quota } = setup({ local: { ...before, visionRatings: { ai: [], real: [] } }, reply: () => page(11, [hashOf(2)]) });
  quota.full = true;
  assert.equal(await crowd.refresh(), false);
  assert.deepEqual(local.crowdList, [hashOf(1)]);
  quota.full = false;
  await crowd.remember('https://example.com/a.jpg', hashOf(5), 'real');
  assert.equal(local.ownVerdicts.length, 1);
});

test('the request has no body, no credentials, no referrer, no custom headers and no redirects', async () => {
  const { crowd, requests } = setup();
  await crowd.refresh();
  assert.equal(requests.length, 1);
  const { url, init } = requests[0];
  assert.equal(url, `${LIST}?since=0&hashVersion=1`);
  assert.deepEqual(Object.keys(init).sort(), ['credentials', 'redirect', 'referrerPolicy', 'signal']);
  assert.equal(init.method, undefined); // GET
  assert.equal(init.body, undefined);
  assert.equal(init.headers, undefined);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.redirect, 'error');
});

test('the 15-second timeout aborts a fetch and keeps the list', async () => {
  const realSetTimeout = setTimeout;
  const before = fresh([hashOf(1)]);
  const { crowd, local, ctx } = setup({ local: before, reply: () => new Promise(() => {}) });
  const timers = [];
  ctx.setTimeout = (fn, ms) => (timers.push(ms), realSetTimeout(fn, ms === 15000 ? 1 : ms));
  const realFetch = ctx.fetch;
  ctx.fetch = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      realFetch(url, init).then(resolve, reject);
    });
  assert.equal(await crowd.refresh(), false);
  assert.deepEqual(timers, [15000]);
  assert.deepEqual(local.crowdList, [hashOf(1)]);
});

// ---- only when it can be used ---------------------------------------------------

for (const [name, opts] of [
  ['the setting is off', { sync: { useCrowdList: false } }],
  ['your robot is off', { sync: { visualCheck: false } }],
  ['the model is not downloaded', { model: false }],
]) {
  test(`when ${name}, nothing is fetched and the list is deleted`, async () => {
    const { crowd, local, requests } = setup({ ...opts, local: { ...fresh([hashOf(1)]), visionModel: { w: [] } } });
    assert.equal(await crowd.refresh(), false);
    assert.equal(requests.length, 0);
    for (const key of ['crowdList', 'crowdSeq', 'crowdFetchedAt', 'crowdFullAt']) assert.equal(key in local, false, key);
    assert.ok(local.visionModel, 'nothing else is touched');
  });
}

test('the setting defaults to on', () => {
  const { ctx } = setup();
  assert.equal(vm.runInContext('SLOP_DEFAULTS.useCrowdList', ctx), true);
  assert.equal(vm.runInContext('SLOP_DEFAULTS.visualCheck', ctx), false);
});

test('turning it off deletes the list and aborts a fetch in flight, which then writes nothing', async () => {
  let release;
  const signals = [];
  const { crowd, local, ctx } = setup({ start: true, local: fresh([hashOf(1)]), reply: () => new Promise((r) => (release = r)) });
  const realFetch = ctx.fetch;
  ctx.fetch = (url, init) => (signals.push(init.signal), realFetch(url, init));
  const fetching = crowd.refresh();
  await until(() => signals.length === 1);
  await ctx.chrome.storage.sync.set({ useCrowdList: false });
  await until(() => !('crowdList' in local));
  assert.equal(signals[0].aborted, true);
  release(page(11, [hashOf(2)]));
  await fetching;
  assert.equal('crowdList' in local, false);
  assert.equal('crowdSeq' in local, false);
});

test('turning your robot off deletes the list too', async () => {
  const { local, ctx } = setup({ start: true, local: fresh([hashOf(1)]) });
  await ctx.chrome.storage.sync.set({ visualCheck: false });
  await until(() => !('crowdList' in local));
  assert.equal('crowdFetchedAt' in local, false);
});

test('a list left behind while off is deleted on start, without fetching', async () => {
  const { local, requests } = setup({ start: true, sync: { useCrowdList: false }, local: fresh([hashOf(1)]) });
  await until(() => !('crowdList' in local));
  assert.equal(requests.length, 0);
});

test('a fetch that lands after turning off writes nothing', async () => {
  const { crowd, local, ctx } = setup({
    reply: async () => {
      await ctx.chrome.storage.sync.set({ useCrowdList: false }); // no listener running here
      return page(3, [hashOf(2)]);
    },
  });
  assert.equal(await crowd.refresh(), false);
  assert.equal('crowdList' in local, false);
});

test('Firefox fetches only with site access and the strip rule, and needs no sharing or data permission', async () => {
  for (const perms of [{ rules: [] }, { origins: false }]) {
    const { crowd, requests } = setup({ firefox: true, perms });
    assert.equal(await crowd.refresh(), false);
    assert.equal(requests.length, 0, JSON.stringify(perms));
  }
  const { crowd, requests, local } = setup({ firefox: true });
  assert.equal(local.shareRatings, undefined);
  assert.equal(await crowd.refresh(), true);
  assert.equal(requests.length, 1);
});

test('Chrome needs site access', async () => {
  const { crowd, requests } = setup({ perms: { origins: false } });
  assert.equal(await crowd.refresh(), false);
  assert.equal(requests.length, 0);
});

// ---- when -----------------------------------------------------------------------------

test('start makes a 6-hourly alarm that first fires 1 to 30 minutes in, and fetches nothing itself', async () => {
  const delays = [];
  for (let i = 0; i < 30; i++) {
    const { alarms, requests } = setup({ start: true });
    await flush();
    const alarm = alarms.get('fetch-crowd');
    assert.equal(alarm.periodInMinutes, 360);
    assert.ok(alarm.delayInMinutes >= 1 && alarm.delayInMinutes <= 30, String(alarm.delayInMinutes));
    delays.push(alarm.delayInMinutes);
    assert.equal(requests.length, 0);
  }
  assert.ok(new Set(delays).size > 20, 'the delay is random');
});

test('a start keeps an alarm that already exists', async () => {
  const { alarms, crowd } = setup();
  alarms.set('fetch-crowd', { periodInMinutes: 360, kept: true });
  crowd.start();
  await flush();
  assert.equal(alarms.get('fetch-crowd').kept, true);
});

test('the alarm fetches, unless a fetch happened within the hour', async () => {
  const { listeners, requests, local } = setup({ start: true });
  listeners.alarm.forEach((l) => l({ name: 'send-votes' }));
  await flush();
  assert.equal(requests.length, 0);
  listeners.alarm.forEach((l) => l({ name: 'fetch-crowd' }));
  await until(() => local.crowdFetchedAt);
  assert.equal(requests.length, 1);
  listeners.alarm.forEach((l) => l({ name: 'fetch-crowd' }));
  await flush();
  assert.equal(requests.length, 1);
});

test('browser startup fetches only when the list is over 6 hours old', async () => {
  const recent = setup({ start: true, local: { ...fresh([]), crowdFetchedAt: Date.now() - 5 * HOUR } });
  recent.listeners.startup.forEach((l) => l());
  await flush();
  assert.equal(recent.requests.length, 0);
  const old = setup({ start: true, local: { ...fresh([]), crowdFetchedAt: Date.now() - 6 * HOUR - 1000 } });
  old.listeners.startup.forEach((l) => l());
  await until(() => old.requests.length === 1);
});

test('turning it on with no list brings the alarm forward', async () => {
  const { alarms, ctx, store } = setup({ start: true, sync: { useCrowdList: false } });
  alarms.set('fetch-crowd', { delayInMinutes: 300, periodInMinutes: 360 });
  store.sync.useCrowdList = true;
  await ctx.chrome.storage.sync.set({ useCrowdList: true });
  await until(() => alarms.get('fetch-crowd').delayInMinutes <= 30);
});

// ---- matching -------------------------------------------------------------------------

test('a match is anything within 3 bits, in one band or spread across them, and 4 is not', async () => {
  const base = hashOf(1);
  const { crowd } = setup({ local: { crowdList: [hashOf(7), base, hashOf(8)] } });
  const key = 'https://cdn.example.com/p.jpg';
  for (const digits of [[], [0], [0, 1], [0, 1, 2], [0, 5], [0, 5, 9], [3, 7, 15], [12, 13, 14]]) {
    const h = flip(base, digits);
    assert.equal(crowd.distance(base, h), digits.length);
    assert.equal(await crowd.flagged(key, h), true, `${digits.length} bits: ${digits}`);
  }
  for (const digits of [[0, 1, 2, 3], [0, 5, 9, 13], [0, 4, 8, 12], [1, 2, 3, 15]]) {
    assert.equal(await crowd.flagged(key, flip(base, digits)), false, `4 bits: ${digits}`);
  }
  assert.equal(await crowd.flagged(key, hashOf(2)), false);
});

test('the index finds a match by its bands, not a scan', () => {
  const { crowd } = setup();
  const list = Array.from({ length: 5000 }, (_, i) => hashOf(i));
  const bands = crowd.bandIndex(list);
  assert.equal(bands.length, 4);
  let looked = 0;
  for (const band of bands) for (const hashes of band.values()) looked = Math.max(looked, hashes.length);
  assert.ok(looked < 10, `a band bucket held ${looked}`);
  assert.equal(crowd.near(bands, flip(hashOf(4321), [2, 6, 10])), true);
});

test('no hash, a bad hash or an empty list never matches', async () => {
  const { crowd } = setup({ local: { crowdList: [] } });
  assert.equal(await crowd.flagged('k', hashOf(1)), false);
  const full = setup({ local: { crowdList: [hashOf(1)] } }).crowd;
  for (const h of [null, undefined, '', 'nope', hashOf(1).toUpperCase()]) assert.equal(await full.flagged('k', h), false);
});

test('the index is rebuilt when the list changes', async () => {
  const { crowd, local } = setup({ start: true, local: fresh([hashOf(1)]), reply: () => page(11, [hashOf(2)]) });
  assert.equal(await crowd.flagged('k', hashOf(2)), false);
  local.crowdFullAt = Date.now();
  await crowd.refresh();
  assert.equal(await crowd.flagged('k', hashOf(2)), true);
});

test('a check right after waking waits for the list instead of missing', async () => {
  const { crowd, ctx } = setup({ local: { crowdList: [hashOf(1)] } });
  const get = ctx.chrome.storage.local.get;
  ctx.chrome.storage.local.get = async (keys) => (await new Promise((r) => setTimeout(r, 30)), get(keys));
  assert.equal(await crowd.flagged('k', hashOf(1)), true);
});

// ---- your own verdicts ----------------------------------------------------------------

test('your Not AI wins, by address or by hash within 3 bits', async () => {
  const key = 'https://cdn.example.com/rated.jpg';
  const { crowd } = setup({
    start: true,
    local: { crowdList: [hashOf(1), hashOf(2), hashOf(3)] },
  });
  await crowd.remember(key, null, 'real'); // a rating with no hash still counts by address
  await crowd.remember('https://elsewhere.example/copy.jpg', hashOf(2), 'real');
  await crowd.remember('https://cdn.example.com/yes.jpg', hashOf(3), 'ai');
  assert.equal(await crowd.flagged(key, hashOf(1)), false);
  assert.equal(await crowd.flagged('https://cdn.example.com/other.jpg', hashOf(1)), true);
  assert.equal(await crowd.flagged('https://cdn.example.com/repost.jpg', flip(hashOf(2), [0, 7, 11])), false);
  assert.equal(await crowd.flagged('https://cdn.example.com/yes.jpg', hashOf(3)), true, 'your AI rating changes nothing');
});

test('a Not AI rating from before 1.9.0 counts by its address', async () => {
  const key = 'https://cdn.example.com/old.jpg';
  const { crowd } = setup({ local: { crowdList: [hashOf(1)], visionRatings: { ai: [], real: [{ key, e: [] }] } } });
  assert.equal(await crowd.flagged(key, hashOf(1)), false);
  assert.equal(await crowd.flagged('https://cdn.example.com/new.jpg', hashOf(1)), true);
});

test('changing your answer to AI lets the crowd hide it again', async () => {
  const key = 'https://cdn.example.com/a.jpg';
  const { crowd, local } = setup({ start: true, local: { crowdList: [hashOf(1)] } });
  await crowd.remember(key, hashOf(1), 'real');
  assert.equal(await crowd.flagged(key, hashOf(1)), false);
  await crowd.remember(key, hashOf(1), 'ai');
  assert.equal(local.ownVerdicts.length, 1);
  assert.equal(await crowd.flagged(key, hashOf(1)), true);
});

test('forgetting your ratings clears your verdicts too', async () => {
  const key = 'https://cdn.example.com/a.jpg';
  const { crowd, ctx } = setup({ start: true, local: { crowdList: [hashOf(1)] } });
  await crowd.remember(key, hashOf(1), 'real');
  assert.equal(await crowd.flagged(key, hashOf(1)), false);
  await ctx.chrome.storage.local.remove(['visionRatings', 'visionModel', 'ownVerdicts']);
  assert.equal(await crowd.flagged(key, hashOf(1)), true);
  const options = readFileSync(here('../src/options.js'), 'utf8');
  assert.ok(options.includes("remove(['visionRatings', 'visionModel', 'ownVerdicts'])"));
});

test('your verdicts keep the newest 2,000 and only a valid hash', async () => {
  const { crowd, local } = setup();
  for (let i = 0; i < 2003; i++) await crowd.remember(`k${i}`, i % 2 ? hashOf(i) : 'not-a-hash', 'real');
  assert.equal(local.ownVerdicts.length, 2000);
  assert.equal(local.ownVerdicts[0].key, 'k3');
  assert.equal(local.ownVerdicts[0].phash, hashOf(3));
  assert.equal(local.ownVerdicts[1].phash, null);
  assert.deepEqual(Object.keys(local.ownVerdicts[0]).sort(), ['key', 'label', 'phash']);
});

// ---- the wiring around it -------------------------------------------------------------

test('background.js hashes from the inspect download, remembers every rating and shares only when on', () => {
  const source = readFileSync(here('../src/background.js'), 'utf8');
  assert.ok(source.includes("importScripts('common.js', 'meta.js', 'train.js', 'votes.js', 'crowd.js')"));
  assert.ok(source.includes('SlopCrowd.start();'));
  assert.ok(source.includes('crowd: await SlopCrowd.flagged(imageKey(url), inspected.phash)'));
  const learn = source.slice(source.indexOf('function learn('), source.indexOf('async function queueVote'));
  assert.ok(learn.indexOf('storage.local.set') < learn.indexOf('SlopCrowd.remember('), 'the rating saves first');
  assert.ok(!learn.slice(learn.indexOf('SlopCrowd.remember(') - 60, learn.indexOf('SlopCrowd.remember(')).includes('share'), 'remembered whether or not you share');
  const rated = source.slice(source.indexOf('async function ratedHash('));
  assert.ok(rated.indexOf('inspected.phash') < rated.indexOf('hashUrl(url)'), 'reuses the hash before fetching again');
});

test('inspect() hashes the blob it already has, one at a time, and skips data: URLs and over 12 MP', () => {
  const vision = readFileSync(here('../src/vision.js'), 'utf8');
  const inspect = vision.slice(vision.indexOf('async function inspect('), vision.indexOf('async function hash('));
  assert.equal((inspect.match(/fetch\(/g) || []).length, 1, 'one download');
  assert.ok(inspect.indexOf('toTensor(blob)') < inspect.indexOf('hashBlob(blob)'));
  assert.ok(inspect.includes('/^https?:/.test(url)'));
  assert.ok(vision.includes('MAX_HASH_PIXELS = 12e6'));
  assert.ok(vision.includes('hashing = turn'));
  const offscreen = readFileSync(here('../src/offscreen.js'), 'utf8');
  assert.ok(offscreen.includes('SlopVision.inspect(msg.url, { hash: !!msg.hash })'));
});

test('the content script hides a crowd match with its own reason', () => {
  const content = readFileSync(here('../src/content.js'), 'utf8');
  assert.ok(/else if \(r\.crowd\) \{[^}]*hideForImage\(img, 'the crowd flagged it'\)/.test(content));
});

test('every manifest has what the list needs, and Firefox strips Origin from GETs', () => {
  const build = readFileSync(here('../build.mjs'), 'utf8');
  assert.ok(build.includes("'votes.js', 'crowd.js', 'ort/ort.wasm.min.js'"));
  assert.ok(build.includes("'alarms'"));
  const rules = JSON.parse(readFileSync(here('../src/origin-rules.json'), 'utf8'));
  assert.deepEqual(rules[0].condition.requestDomains, ['api.hidetheslop.com']);
  assert.deepEqual(rules[0].condition.requestMethods.sort(), ['get', 'post']);
  const options = readFileSync(here('../src/options.html'), 'utf8');
  assert.ok(options.indexOf('id="shareRatings"') < options.indexOf('id="useCrowdList"'), 'after Share your ratings');
  assert.ok(options.includes('data-key="useCrowdList"'));
});

test('the reply shape still matches the API source', () => {
  const route = readFileSync(here('../../api/src/routes/verdicts.ts'), 'utf8');
  for (const line of ['seq: z.number(),', 'add: z.array(z.string()),', 'remove: z.array(z.string()),', 'more: z.boolean(),', 'hashVersion: z.coerce.number().pipe(z.literal(1))', "'/v1/verdicts'"]) {
    assert.ok(route.includes(line), line);
  }
  const config = readFileSync(here('../../api/src/config.ts'), 'utf8');
  assert.ok(config.includes('VERDICTS_PAGE_SIZE = 10000;'));
});

test('nothing logs a hash or URL', () => {
  const source = readFileSync(here('../src/crowd.js'), 'utf8');
  assert.equal(/console\.|\.log\(/.test(source), false);
});
