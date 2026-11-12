// node --test test/votes.test.mjs
// The vote client with fake storage and a fake network. Nothing here touches the API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const HOUR = 3600000;
const unit = Array.from({ length: 512 }, (_, i) => (i === 133 ? 0.7 : (i % 7) / 70 - 0.04));

// Hashes far enough apart that none counts as a copy of another: each of these differs
// from the rest in 32 bits or so.
const hashOf = (i) => {
  let out = '';
  let x = (i + 1) * 2654435761;
  for (let k = 0; k < 16; k++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    out += Math.floor(x / 268435456).toString(16);
  }
  return out;
};
const bump = (h, flips) => {
  // Flips the lowest bit of the first `flips` digits.
  let out = '';
  for (let i = 0; i < 16; i++) out += (parseInt(h[i], 16) ^ (i < flips ? 1 : 0)).toString(16);
  return out;
};

// A fresh SlopVotes. `reply(path, body)` answers each fetch, or throws for a network
// failure. `start` also runs its listeners and returns them. With `safari`, `canary(method)`
// answers the origin check on the website, and `canaries` and `rulesetCalls` record it.
function setup({ on = true, reply, local: seed = {}, firefox = false, safari = false, canary, perms = {}, start = false } = {}) {
  const local = { ...(on ? { shareRatings: true } : {}), ...seed };
  const requests = [];
  const listeners = { changed: [], alarm: [], removed: [] };
  const alarms = new Map();
  const area = {
    get: async (keys) => {
      const out = {};
      for (const k of typeof keys === 'string' ? [keys] : keys) if (k in local) out[k] = structuredClone(local[k]);
      return out;
    },
    set: async (patch) => {
      const changes = {};
      for (const [k, v] of Object.entries(patch)) {
        changes[k] = { oldValue: local[k], newValue: v };
        local[k] = structuredClone(v);
      }
      listeners.changed.forEach((l) => l(changes, 'local'));
    },
    remove: async (keys) => {
      for (const k of [].concat(keys)) delete local[k];
    },
  };
  const access = { origins: true, data: true, site: true, rules: ['strip-origin'], ...perms };
  const canaries = [];
  const rulesetCalls = [];
  const chrome = {
    storage: { local: area, onChanged: { addListener: (l) => listeners.changed.push(l) } },
    alarms: {
      get: async (name) => alarms.get(name),
      create: (name, info) => alarms.set(name, info),
      onAlarm: { addListener: (l) => listeners.alarm.push(l) },
    },
    permissions: {
      contains: async (q) => {
        if (!q.origins) return access.data;
        return access.origins && (!q.origins.includes('https://hidetheslop.com/*') || access.site);
      },
      onRemoved: { addListener: (l) => listeners.removed.push(l) },
    },
    declarativeNetRequest: {
      getEnabledRulesets: async () => access.rules,
      updateEnabledRulesets: async (change) => {
        rulesetCalls.push(JSON.parse(JSON.stringify(change))); // out of the vm's realm
        access.rules = access.rules.filter((id) => !(change.disableRulesetIds || []).includes(id));
        for (const id of change.enableRulesetIds || []) if (!access.rules.includes(id)) access.rules.push(id);
      },
    },
    runtime: {
      getManifest: () => (firefox ? { browser_specific_settings: { gecko: {} } } : safari ? { browser_specific_settings: { safari: {} } } : {}),
    },
  };
  const fetch = async (url, init) => {
    if (url === 'https://hidetheslop.com/.well-known/origin-check') {
      const method = init.method || 'GET';
      canaries.push({ method, init });
      const answer = await (canary ?? (() => ({ status: 200, json: { extension: false } })))(method);
      return { status: answer.status, text: async () => answer.text ?? JSON.stringify(answer.json) };
    }
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    requests.push({ url, path, init, body, raw: init.body });
    const answer = await (reply ?? ok)(path, body);
    return { status: answer.status, text: async () => answer.text ?? JSON.stringify(answer.json) };
  };
  const ctx = {
    chrome, fetch, crypto: globalThis.crypto, TextEncoder, AbortController, btoa, setTimeout, clearTimeout,
    Math, Date, console,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(here('../src/common.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(here('../src/votes.js'), 'utf8'), ctx);
  const votes = vm.runInContext('SlopVotes', ctx);
  if (start) votes.start();
  return { votes, local, requests, listeners, alarms, ctx, canaries, rulesetCalls };
}

const ok = (_path, body) => ({ status: 202, json: { accepted: (body.votes || body.items).length, needEmbedding: [] } });
const rate = (votes, i, label = 'ai', source = 'rated') => votes.add({ phash: hashOf(i), label, source, embedding: unit });
const rateMany = async (votes, n) => {
  for (let i = 0; i < n; i++) await rate(votes, i);
};
const flush = () => new Promise((r) => setTimeout(r, 5));

// Signing the token uses crypto.subtle, which really is asynchronous, so a few ticks
// aren't enough on a busy machine. Wait for the thing itself.
async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// The API's strict schema, field for field. The last test compares it with the source.
function assertVoteBody(body) {
  assert.deepEqual(Object.keys(body).sort(), ['hashVersion', 'votes']);
  assert.equal(body.hashVersion, 1);
  assert.ok(body.votes.length >= 1 && body.votes.length <= 50);
  const seen = new Map();
  for (const vote of body.votes) {
    assert.deepEqual(Object.keys(vote).sort(), ['label', 'phash', 'source', 'token']);
    assert.match(vote.phash, /^[0-9a-f]{16}$/);
    assert.match(vote.token, /^[0-9a-f]{32}$/);
    assert.ok(['ai', 'real'].includes(vote.label));
    assert.ok(['rated', 'hid'].includes(vote.source));
    assert.ok(!seen.has(vote.phash) || seen.get(vote.phash) === vote.token, 'two tokens for one hash');
    seen.set(vote.phash, vote.token);
  }
}
function assertEmbeddingBody(body) {
  assert.deepEqual(Object.keys(body).sort(), ['hashVersion', 'items', 'modelVersion']);
  assert.equal(body.hashVersion, 1);
  assert.equal(body.modelVersion, 1);
  for (const item of body.items) {
    assert.deepEqual(Object.keys(item).sort(), ['phash', 'token', 'vector']);
    assert.match(item.phash, /^[0-9a-f]{16}$/);
    assert.match(item.token, /^[0-9a-f]{32}$/);
    const bytes = Buffer.from(item.vector, 'base64');
    assert.equal(bytes.length, 512);
    assert.equal(bytes.toString('base64'), item.vector, 'canonical base64');
  }
}

// ---- the pure parts ---------------------------------------------------------

test('the token matches a vector worked out with Python hmac', async () => {
  const { votes } = setup();
  const secret = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
  const key = await votes.importSecret(secret);
  assert.equal(await votes.token(key, '0123456789abcdef'), 'b0b79006cb254f9d2936db3869a28f23');
});

test('the vector is 512 int8 values at the measured scale', () => {
  const { votes } = setup();
  assert.equal(votes.VECTOR_SCALE, 127);
  const bytes = Buffer.from(votes.vectorOf(unit), 'base64');
  assert.equal(bytes.length, 512);
  assert.equal(bytes.readInt8(133), Math.round(0.7 * 127));
  assert.equal(bytes.readInt8(0), Math.round(-0.04 * 127));
  const clamped = Buffer.from(votes.vectorOf([2, -2, ...unit.slice(2)]), 'base64');
  assert.equal(clamped.readInt8(0), 127);
  assert.equal(clamped.readInt8(1), -127);
});

test('distance counts differing bits, including the top of each half', () => {
  const { votes } = setup();
  assert.equal(votes.distance('0000000000000000', '0000000000000000'), 0);
  assert.equal(votes.distance('ffffffffffffffff', '0000000000000000'), 64);
  assert.equal(votes.distance('8000000080000000', '0000000000000000'), 2);
  assert.equal(votes.distance('0000000000000007', '0000000000000000'), 3);
});

// ---- off means off ----------------------------------------------------------

test('off sends nothing, even with Send now', async () => {
  const { votes, requests, local } = setup({ on: false, local: { voteQueue: [{ phash: hashOf(1), label: 'ai', source: 'rated', vector: '', after: 0, n: 1 }] } });
  await votes.run({ now: true });
  await votes.run();
  assert.equal(requests.length, 0);
  assert.equal(local.voteQueue.length, 1, 'run alone leaves it; the listener and start clear it');
});

test('a rating while off never queues', async () => {
  const { votes, local } = setup({ on: false });
  assert.equal(await rate(votes, 1), false);
  assert.equal(local.voteQueue, undefined);
});

test('background.js reads sharing when the rating is made, before its turn in the chain', () => {
  // A rating from before you opted in can sit behind a slow retrain. Reading the setting
  // late would queue it.
  const source = readFileSync(here('../src/background.js'), 'utf8');
  const learn = source.slice(source.indexOf('function learn('), source.indexOf('async function queueVote'));
  assert.ok(learn.indexOf('slopGetShare()') < learn.indexOf('learning = learning.then'));
  for (const skip of ['!incognito', "/^https?:/.test(url)", "source === 'rated'"]) assert.ok(learn.includes(skip), skip);
  assert.ok(learn.indexOf('storage.local.set') < learn.indexOf('queueVote('), 'the rating saves first');
});

test('turning it off clears the queue and aborts a send in flight, and keeps the secret', async () => {
  let release;
  const signals = [];
  const { votes, local, ctx } = setup({
    start: true,
    reply: () => new Promise((resolve) => (release = resolve)),
  });
  const realFetch = ctx.fetch;
  ctx.fetch = (url, init) => {
    signals.push(init.signal);
    return realFetch(url, init);
  };
  await rateMany(votes, 3);
  const sending = votes.run({ now: true });
  await until(() => signals.length === 1);
  const secret = local.voteSecret;
  assert.ok(secret);
  await ctx.chrome.storage.local.set({ shareRatings: false });
  await flush();
  assert.equal(local.voteQueue, undefined);
  assert.equal(signals[0].aborted, true);
  release({ status: 202, json: { accepted: 3, needEmbedding: [hashOf(0)] } });
  await sending;
  assert.equal(local.voteSecret, secret);
  assert.equal(local.voteQueue?.length ?? 0, 0);
});

test('a send that lands after turning off asks for nothing more', async () => {
  const { votes, requests, ctx, local } = setup({
    start: true,
    reply: async (path) => {
      await ctx.chrome.storage.local.set({ shareRatings: false });
      return { status: 202, json: { accepted: 1, needEmbedding: [hashOf(0)] } };
    },
  });
  await rate(votes, 0);
  await votes.run({ now: true });
  assert.deepEqual(requests.map((r) => r.path), ['/v1/votes']);
  assert.equal(local.voteQueue?.length ?? 0, 0);
});

test('the shareRatings check runs before each fetch, for votes and embeddings', async () => {
  const { votes, requests, ctx } = setup({
    reply: async (path, body) => {
      await ctx.chrome.storage.local.set({ shareRatings: false }); // no listener running here
      return { status: 202, json: { accepted: 1, needEmbedding: body.votes.map((v) => v.phash) } };
    },
  });
  await rate(votes, 0);
  await votes.run({ now: true });
  assert.deepEqual(requests.map((r) => r.path), ['/v1/votes']);
});

test('Firefox: no data permission, no site access or no strip rule means nothing is sent', async () => {
  for (const perms of [{ data: false }, { origins: false }, { rules: [] }]) {
    const { votes, requests } = setup({ firefox: true, perms });
    await rate(votes, 0);
    await votes.run({ now: true });
    assert.equal(requests.length, 0, JSON.stringify(perms));
  }
  const { votes, requests } = setup({ firefox: true });
  await rate(votes, 0);
  await votes.run({ now: true });
  assert.equal(requests.length, 1);
});

test('Chrome needs site access too, and no Firefox checks', async () => {
  const blocked = setup({ perms: { origins: false } });
  await rate(blocked.votes, 0);
  await blocked.votes.run({ now: true });
  assert.equal(blocked.requests.length, 0);
  const fine = setup({ perms: { data: false, rules: [] } });
  await rate(fine.votes, 0);
  await fine.votes.run({ now: true });
  assert.equal(fine.requests.length, 1);
});

test('Chrome and Firefox never send the origin check or touch the rulesets', async () => {
  for (const firefox of [false, true]) {
    const { votes, requests, canaries, rulesetCalls, ctx } = setup({ firefox, start: true });
    await vm.runInContext('slopArmStrip()', ctx);
    assert.equal(await vm.runInContext('slopStripReady()', ctx), true);
    await rate(votes, 0);
    await votes.run({ now: true });
    assert.equal(requests.length, 1);
    assert.equal(canaries.length, 0);
    assert.equal(rulesetCalls.length, 0);
  }
});

// ---- Safari: the Origin strip has to be proven in each run of the background ------------

test('Safari: the rule is switched off and on, then a GET and a POST check it, once a run', async () => {
  const { votes, requests, canaries, rulesetCalls } = setup({ safari: true });
  await rate(votes, 0);
  await rate(votes, 1);
  await votes.run({ now: true });
  assert.deepEqual(rulesetCalls, [{ disableRulesetIds: ['strip-origin'] }, { enableRulesetIds: ['strip-origin'] }]);
  assert.deepEqual(canaries.map((c) => c.method), ['GET', 'POST']);
  assert.deepEqual(requests.map((r) => r.path), ['/v1/votes']);
  await rate(votes, 2);
  await votes.run({ now: true });
  assert.equal(canaries.length, 2, 'not again in the same run');
  assert.equal(rulesetCalls.length, 2);
  assert.equal(requests.length, 2);
});

test('Safari: the check is shaped like a list download and a vote, and carries nothing', async () => {
  const { votes, canaries } = setup({ safari: true });
  await rate(votes, 0);
  await votes.run({ now: true });
  const [get, post] = canaries.map((c) => c.init);
  for (const init of [get, post]) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
  }
  assert.equal(get.body, undefined);
  assert.equal(post.method, 'POST');
  assert.deepEqual({ ...post.headers }, { 'content-type': 'application/json' });
  assert.equal(post.body, '{}');
});

test('Safari: an extension Origin arriving, or a failed check, keeps everything off for the run', async () => {
  const answers = [
    () => ({ status: 200, json: { extension: true } }),
    (m) => ({ status: 200, json: { extension: m === 'POST' } }),
    () => ({ status: 200, json: {} }),
    () => ({ status: 200, text: '<html>' }),
    () => ({ status: 404, json: { extension: false } }),
    () => {
      throw new Error('offline');
    },
  ];
  for (const canary of answers) {
    const { votes, requests, canaries } = setup({ safari: true, canary });
    await rate(votes, 0);
    await votes.run({ now: true });
    await votes.run({ now: true });
    assert.equal(requests.length, 0, String(canary));
    assert.ok(canaries.length <= 2, 'no second check in the same run');
  }
});

test('Safari: without access to the API or to the website, nothing goes, the check included', async () => {
  for (const perms of [{ origins: false }, { site: false }]) {
    const { votes, requests, canaries } = setup({ safari: true, perms });
    await rate(votes, 0);
    await votes.run({ now: true });
    assert.equal(requests.length + canaries.length, 0, JSON.stringify(perms));
  }
});

test('Safari: a run where the rule never comes back on sends nothing', async () => {
  const { votes, requests, canaries, ctx } = setup({ safari: true });
  ctx.chrome.declarativeNetRequest.updateEnabledRulesets = async () => {
    throw new Error('no');
  };
  await rate(votes, 0);
  await votes.run({ now: true });
  assert.equal(requests.length + canaries.length, 0);
});

test('Safari is told apart by its manifest, or by its own address if the key went missing', () => {
  const { ctx } = setup({ safari: true });
  assert.equal(vm.runInContext('slopIsSafari() && !slopIsFirefox()', ctx), true);
  const other = setup();
  assert.equal(vm.runInContext('slopIsSafari()', other.ctx), false);
  other.ctx.chrome.runtime.getURL = (p) => `safari-web-extension://1234/${p}`;
  assert.equal(vm.runInContext('slopIsSafari()', other.ctx), true);
  other.ctx.chrome.runtime.getURL = (p) => `chrome-extension://abcd/${p}`;
  assert.equal(vm.runInContext('slopIsSafari()', other.ctx), false);
});

test('revoking Firefox consent turns sharing off and clears the queue', async () => {
  const { votes, listeners, local } = setup({ firefox: true, start: true });
  await rate(votes, 0);
  listeners.removed[0]({ permissions: [], origins: [], data_collection: ['websiteContent'] });
  await flush();
  assert.equal(local.shareRatings, false);
  assert.equal(local.voteQueue, undefined);
});

test('consent revoked while asleep is caught on the next start', async () => {
  const seed = { voteQueue: [{ phash: hashOf(1), label: 'ai', source: 'rated', vector: '', after: 0, n: 1 }] };
  const { local } = setup({ firefox: true, start: true, perms: { data: false }, local: seed });
  await flush();
  assert.equal(local.shareRatings, false);
  assert.equal(local.voteQueue, undefined);
});

test('a queue left behind while off is cleared on start', async () => {
  const seed = { voteQueue: [{ phash: hashOf(1), label: 'ai', source: 'rated', vector: '', after: 0, n: 1 }] };
  const { local } = setup({ on: false, start: true, local: seed });
  await flush();
  assert.equal(local.voteQueue, undefined);
});

// ---- the queue --------------------------------------------------------------

test('rating a hash again replaces its entry and moves it to the end', async () => {
  const { votes, local } = setup();
  await rate(votes, 0, 'ai');
  await rate(votes, 1, 'ai');
  await rate(votes, 0, 'real', 'hid');
  assert.deepEqual(local.voteQueue.map((v) => [v.phash, v.label, v.source]), [[hashOf(1), 'ai', 'rated'], [hashOf(0), 'real', 'hid']]);
});

test('the queue keeps 500, dropping the oldest', async () => {
  const queue = Array.from({ length: 500 }, (_, i) => ({ phash: hashOf(i), label: 'ai', source: 'rated', vector: '', after: 0, n: i + 1 }));
  const { votes, local } = setup({ local: { voteQueue: queue } });
  await rate(votes, 1000);
  assert.equal(local.voteQueue.length, 500);
  assert.equal(local.voteQueue[0].phash, hashOf(1));
  assert.equal(local.voteQueue.at(-1).phash, hashOf(1000));
});

test('an entry stores the int8 vector and never the raw embedding', async () => {
  const { votes, local } = setup();
  await rate(votes, 0);
  const [entry] = local.voteQueue;
  assert.deepEqual(Object.keys(entry).sort(), ['after', 'label', 'n', 'phash', 'source', 'vector']);
  assert.ok(entry.vector.length < 700);
});

test('after is 1 to 6 hours ahead, and only Send now ignores it', async () => {
  const { votes, local, requests } = setup();
  const start = Date.now();
  await rateMany(votes, 30);
  for (const { after } of local.voteQueue) {
    assert.ok(after >= start + HOUR && after <= Date.now() + 6 * HOUR);
  }
  const spread = local.voteQueue.map((v) => v.after);
  assert.ok(Math.max(...spread) - Math.min(...spread) > HOUR, 'actually random');
  await votes.run();
  assert.equal(requests.length, 0);
  await votes.run({ now: true });
  assert.equal(requests.length, 1);
});

test('the alarm sends only what is due', async () => {
  const { votes, local, requests, listeners, alarms } = setup({ start: true });
  await flush();
  assert.equal(alarms.get('send-votes').periodInMinutes, 60);
  await rateMany(votes, 3);
  local.voteQueue[1].after = Date.now() - 1;
  const due = local.voteQueue[1].phash;
  listeners.alarm[0]({ name: 'other' });
  await flush();
  assert.equal(requests.length, 0);
  listeners.alarm[0]({ name: 'send-votes' });
  await flush();
  assert.deepEqual(requests[0].body.votes.map((v) => v.phash), [due]);
});

test('a start keeps an alarm that already exists, and makes one that went missing', async () => {
  const a = setup({ start: true });
  await flush();
  const first = a.alarms.get('send-votes');
  a.votes.start();
  await flush();
  assert.equal(a.alarms.get('send-votes'), first);
  a.alarms.clear();
  a.votes.start();
  await flush();
  assert.ok(a.alarms.get('send-votes'));
});

test('a batch is at most 5 and the next run sends the rest', async () => {
  const { votes, local, requests } = setup();
  await rateMany(votes, 12);
  await votes.run({ now: true });
  assert.equal(requests[0].body.votes.length, 5);
  assert.equal(local.voteQueue.length, 7);
  await votes.run({ now: true });
  await votes.run({ now: true });
  assert.deepEqual(requests.map((r) => r.body.votes.length), [5, 5, 2]);
  assert.equal(local.voteQueue.length, 0);
});

test('batches are shuffled, not in rating order', async () => {
  const orders = new Set();
  for (let i = 0; i < 12; i++) {
    const { votes, requests } = setup();
    await rateMany(votes, 8);
    await votes.run({ now: true });
    orders.add(requests[0].body.votes.map((v) => v.phash).join());
  }
  assert.ok(orders.size > 6, `only ${orders.size} different orders`);
  // And a batch isn't simply the oldest 5.
  const oldest = new Set([0, 1, 2, 3, 4].map(hashOf));
  const someNewer = [...orders].some((o) => o.split(',').some((h) => !oldest.has(h)));
  assert.ok(someNewer);
});

// ---- what goes over the wire ---------------------------------------------------

test('every request has the agreed options, and no key, URL or frame in the body', async () => {
  const need = hashOf(0);
  const { votes, requests, local } = setup({
    reply: (path, body) =>
      path === '/v1/votes' ? { status: 202, json: { accepted: 1, needEmbedding: [need] } } : { status: 202, json: { accepted: 1 } },
  });
  // A caller handing over more than it should must not get any of it through.
  await votes.add({
    phash: need, label: 'ai', source: 'rated', embedding: unit,
    key: 'https://scontent.xx.fbcdn.net/secret.jpg', url: 'https://example.com/post', e: unit,
  });
  await votes.run({ now: true });
  assert.deepEqual(requests.map((r) => r.url), ['https://api.hidetheslop.com/v1/votes', 'https://api.hidetheslop.com/v1/embeddings']);
  for (const { init, raw } of requests) {
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(Object.keys(init.headers), ['content-type']);
    for (const banned of ['http', 'fbcdn', 'example.com', 'data:', '"key"', '"url"', '"e"', '"after"', '"n"']) {
      assert.ok(!raw.includes(banned), `${banned} in ${raw.slice(0, 80)}`);
    }
  }
  assertVoteBody(requests[0].body);
  assertEmbeddingBody(requests[1].body);
  assert.ok(local.voteSecret);
  assert.ok(!requests.some((r) => r.raw.includes(local.voteSecret)));
});

test('the 15-second timeout aborts a request and keeps the votes', async () => {
  const realSetTimeout = setTimeout;
  const { votes, local, ctx, requests } = setup({ reply: () => new Promise(() => {}) });
  const timers = [];
  ctx.setTimeout = (fn, ms) => (timers.push(ms), realSetTimeout(fn, ms === 15000 ? 1 : ms));
  const realFetch = ctx.fetch;
  ctx.fetch = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      realFetch(url, init).then(resolve, reject);
    });
  await rate(votes, 0);
  await votes.run({ now: true });
  assert.deepEqual(timers, [15000]);
  assert.equal(requests.length, 1);
  assert.equal(local.voteQueue.length, 1);
});

test('the same picture gets the same token, across restarts', async () => {
  const seed = {};
  const first = setup({ local: seed });
  await rate(first.votes, 0);
  await first.votes.run({ now: true });
  const secret = first.local.voteSecret;
  const second = setup({ local: { voteSecret: secret } });
  await rate(second.votes, 0, 'real');
  await second.votes.run({ now: true });
  assert.equal(first.requests[0].body.votes[0].token, second.requests[0].body.votes[0].token);
});

test('two callers at once make one secret', async () => {
  const { votes, local, ctx, requests } = setup();
  const set = ctx.chrome.storage.local.set;
  let writes = 0;
  ctx.chrome.storage.local.set = (patch) => {
    if (patch.voteSecret) writes++;
    return set(patch);
  };
  await rateMany(votes, 5);
  await votes.run({ now: true });
  assert.equal(writes, 1);
  assert.equal(local.voteSecret.length, 64);
  assert.equal(new Set(requests[0].body.votes.map((v) => v.token)).size, 5);
});

test('different pictures get unrelated tokens', async () => {
  const { votes, requests } = setup();
  await rateMany(votes, 5);
  await votes.run({ now: true });
  const tokens = requests[0].body.votes.map((v) => v.token);
  assert.equal(new Set(tokens).size, 5);
});

// ---- replies ---------------------------------------------------------------------

test('202 removes what was sent and records the hashes', async () => {
  const { votes, local } = setup();
  await rateMany(votes, 3);
  await votes.run({ now: true });
  assert.equal(local.voteQueue.length, 0);
  assert.equal(local.voteSent.length, 3);
});

test('a 202 that does not parse as the API reply keeps everything', async () => {
  for (const answer of [
    { status: 202, text: '<html>hi</html>' },
    { status: 202, json: { accepted: 1 } },
    { status: 202, json: { accepted: '1', needEmbedding: [] } },
    { status: 202, json: { accepted: 1, needEmbedding: 'x' } },
    { status: 202, json: { accepted: 1, needEmbedding: [7] } },
  ]) {
    const { votes, local } = setup({ reply: () => answer });
    await rate(votes, 0);
    await votes.run({ now: true });
    assert.equal(local.voteQueue.length, 1, JSON.stringify(answer));
    assert.equal(local.voteSent, undefined);
  }
});

test('a re-rating during a send survives the 202', async () => {
  let votes;
  const made = setup({
    reply: async (path, body) => {
      await rate(votes, 0, 'real');
      return ok(path, body);
    },
  });
  votes = made.votes;
  await rate(votes, 0, 'ai');
  await votes.run({ now: true });
  assert.deepEqual(made.local.voteQueue.map((v) => v.label), ['real']);
});

test('only asked-for hashes from this batch get an embedding, once', async () => {
  const mine = hashOf(0);
  const { votes, requests } = setup({
    reply: (path, body) =>
      path === '/v1/votes'
        ? { status: 202, json: { accepted: 2, needEmbedding: [mine, hashOf(9), 'not-a-hash', mine.toUpperCase()] } }
        : { status: 500, text: '' },
  });
  await rateMany(votes, 2);
  await votes.run({ now: true });
  await votes.run({ now: true });
  assert.deepEqual(requests.map((r) => r.path), ['/v1/votes', '/v1/embeddings']);
  assert.deepEqual(requests[1].body.items.map((i) => i.phash), [mine]);
  assert.equal(requests[1].body.items[0].token, requests[0].body.votes.find((v) => v.phash === mine).token);
});

test('anything that is not 202, 400 or 413 keeps everything for the next alarm', async () => {
  const replies = [301, 302, 401, 403, 404, 408, 429, 500, 502, 503].map((status) => () => ({ status, json: { error: 'x' } }));
  replies.push(() => {
    throw new TypeError('network error');
  });
  for (const reply of replies) {
    const { votes, local, requests } = setup({ reply });
    await rateMany(votes, 3);
    await votes.run({ now: true });
    assert.equal(local.voteQueue.length, 3);
    assert.equal(requests.length, 1, 'no split, no retry in the same run');
    assert.equal(local.voteRefused, undefined);
  }
});

test('400 splits the batch and drops only the item the API refuses alone', async () => {
  const bad = hashOf(2);
  const { votes, local, requests } = setup({
    reply: (path, body) =>
      body.votes.some((v) => v.phash === bad) ? { status: 400, json: { error: 'invalid_request' } } : ok(path, body),
  });
  await rateMany(votes, 5);
  await votes.run({ now: true });
  assert.deepEqual(local.voteQueue, []);
  assert.equal(local.voteSent.length, 4);
  assert.ok(!local.voteSent.includes(bad));
  assert.ok(requests.length <= 9, `${requests.length} requests`);
  assert.equal(local.voteRefused, 1);
});

test('413 is treated like 400', async () => {
  const { votes, local } = setup({
    reply: (path, body) => (body.votes.length > 1 ? { status: 413, json: { error: 'payload_too_large' } } : ok(path, body)),
  });
  await rateMany(votes, 2);
  await votes.run({ now: true });
  assert.equal(local.voteQueue.length, 0);
  assert.equal(local.voteSent.length, 2);
});

test('a 400 that is not the API talking never drops a vote', async () => {
  for (const answer of [{ status: 400, text: '<html>blocked</html>' }, { status: 400, json: { message: 'x' } }, { status: 413, text: '' }]) {
    const { votes, local } = setup({ reply: () => answer });
    await rateMany(votes, 4);
    await votes.run({ now: true });
    assert.equal(local.voteQueue.length, 4, JSON.stringify(answer));
  }
});

test('three refused batches in a row stop sending, and Settings says so', async () => {
  const { votes, local, requests } = setup({ reply: () => ({ status: 400, text: 'nope' }) });
  await rateMany(votes, 8);
  for (let i = 0; i < 3; i++) {
    await votes.run({ now: true });
    assert.equal((await votes.state()).stuck, i === 2);
  }
  const sentSoFar = requests.length;
  for (const v of local.voteQueue) v.after = 0;
  await votes.run(); // the alarm
  assert.equal(requests.length, sentSoFar, 'stopped');
  assert.equal(local.voteQueue.length, 8, 'nothing deleted');
});

test('real API errors stop after three batches too, so a client bug loses few votes', async () => {
  const { votes, local } = setup({ reply: () => ({ status: 400, json: { error: 'invalid_request' } }) });
  await rateMany(votes, 40);
  for (let i = 0; i < 10; i++) await votes.run({ now: true });
  assert.equal(local.voteQueue.length, 40 - 15);
  assert.equal((await votes.state()).stuck, true);
});

test('a good batch resets the count of refused ones', async () => {
  let refuse = true;
  const { votes, local } = setup({ reply: (path, body) => (refuse ? { status: 400, text: '' } : ok(path, body)) });
  await rateMany(votes, 6);
  await votes.run({ now: true });
  await votes.run({ now: true });
  assert.equal(local.voteRefused, 2);
  refuse = false;
  await votes.run({ now: true });
  assert.equal(local.voteRefused, undefined);
});

test('when stuck, Send now tries once without dropping anything, and a good reply clears it', async () => {
  let refuse = true;
  const { votes, local, requests } = setup({
    local: { voteRefused: 3 },
    reply: (path, body) => (refuse ? { status: 400, json: { error: 'invalid_request' } } : ok(path, body)),
  });
  await rateMany(votes, 1);
  await votes.run({ now: true });
  assert.equal(requests.length, 1);
  assert.equal(local.voteQueue.length, 1);
  refuse = false;
  await votes.run({ now: true });
  assert.equal(local.voteQueue.length, 0);
  assert.equal((await votes.state()).stuck, false);
});

test('updating the extension clears a stop', async () => {
  const { votes, local } = setup({ local: { voteRefused: 3 } });
  await votes.updated();
  assert.equal(local.voteRefused, undefined);
});

// ---- staying safe under load --------------------------------------------------------

test('an alarm during Send now does not start a second send', async () => {
  let release;
  const { votes, requests } = setup({ reply: () => new Promise((r) => (release = r)) });
  await rateMany(votes, 3);
  const first = votes.run({ now: true });
  await until(() => requests.length === 1);
  await votes.run({ now: true });
  assert.equal(requests.length, 1);
  release({ status: 202, json: { accepted: 3, needEmbedding: [] } });
  await first;
});

test('ratings arriving together all land, with nothing written over', async () => {
  const { votes, local } = setup();
  await Promise.all(Array.from({ length: 50 }, (_, i) => rate(votes, i)));
  assert.equal(local.voteQueue.length, 50);
  assert.equal(new Set(local.voteQueue.map((v) => v.n)).size, 50);
});

test('clearing waits its turn and leaves the secret and sent list', async () => {
  const { votes, local } = setup();
  await rate(votes, 0);
  await votes.run({ now: true });
  await rate(votes, 1);
  const [cleared] = await Promise.all([votes.clear(), rate(votes, 2)]);
  assert.equal(cleared, undefined);
  assert.ok(local.voteSecret);
  assert.equal(local.voteSent.length, 1);
  assert.deepEqual((local.voteQueue ?? []).map((v) => v.phash).filter((h) => h === hashOf(1)), []);
});

test('a clear during a rating is not undone by that rating writing a stale queue', async () => {
  const { votes, local, ctx } = setup();
  await rate(votes, 0);
  const area = ctx.chrome.storage.local;
  const get = area.get;
  let open;
  const gate = new Promise((r) => (open = r));
  area.get = async (keys) => {
    const value = await get(keys);
    if ([].concat(keys).includes('voteSent')) await gate; // the add has read the old queue
    return value;
  };
  const adding = rate(votes, 1);
  await flush();
  const clearing = votes.clear();
  await flush();
  open();
  await Promise.all([adding, clearing]);
  assert.equal(local.voteQueue, undefined);
});

// ---- near copies --------------------------------------------------------------------

test('a near copy of a sent hash reuses that hash, so it replaces the vote', async () => {
  const { votes, local, requests } = setup();
  const original = hashOf(0);
  await votes.add({ phash: original, label: 'ai', source: 'rated', embedding: unit });
  await votes.run({ now: true });
  const copy = bump(original, 3);
  assert.equal(votes.distance(original, copy), 3);
  await votes.add({ phash: copy, label: 'real', source: 'rated', embedding: unit });
  assert.deepEqual(local.voteQueue.map((v) => v.phash), [original]);
  await votes.run({ now: true });
  assert.equal(requests[1].body.votes[0].phash, original);
  assert.equal(requests[1].body.votes[0].token, requests[0].body.votes[0].token);
  assert.equal(local.voteSent.length, 1);
});

test('a near copy of a waiting hash merges with it', async () => {
  const { votes, local } = setup();
  const original = hashOf(0);
  await votes.add({ phash: original, label: 'ai', source: 'rated', embedding: unit });
  await votes.add({ phash: bump(original, 2), label: 'real', source: 'hid', embedding: unit });
  assert.deepEqual(local.voteQueue.map((v) => [v.phash, v.label, v.source]), [[original, 'real', 'hid']]);
});

test('a hash 4 bits away is a different picture', async () => {
  const { votes, local } = setup();
  const original = hashOf(0);
  await votes.add({ phash: original, label: 'ai', source: 'rated', embedding: unit });
  await votes.add({ phash: bump(original, 4), label: 'ai', source: 'rated', embedding: unit });
  assert.equal(local.voteQueue.length, 2);
});

test('turning off keeps the sent list, so a later near copy still replaces', async () => {
  const { votes, local, ctx } = setup({ start: true });
  await rate(votes, 0);
  await votes.run({ now: true });
  await ctx.chrome.storage.local.set({ shareRatings: false });
  await flush();
  assert.equal(local.voteSent.length, 1);
  await ctx.chrome.storage.local.set({ shareRatings: true });
  await votes.add({ phash: bump(hashOf(0), 1), label: 'real', source: 'rated', embedding: unit });
  assert.equal(local.voteQueue[0].phash, hashOf(0));
});

test('state counts what is waiting', async () => {
  const { votes } = setup();
  await rateMany(votes, 2);
  const state = await votes.state();
  assert.equal(state.on, true);
  assert.equal(state.waiting, 2);
  assert.equal(state.stuck, false);
});

test('nothing logs a hash, token or URL', async () => {
  const source = readFileSync(here('../src/votes.js'), 'utf8');
  assert.equal(/console\.|\.log\(/.test(source), false);
});

// ---- the real API's rules ---------------------------------------------------------

test('the fields above still match the API source', () => {
  const votes = readFileSync(here('../../api/src/routes/votes.ts'), 'utf8');
  const embeddings = readFileSync(here('../../api/src/routes/embeddings.ts'), 'utf8');
  const config = readFileSync(here('../../api/src/config.ts'), 'utf8');
  for (const line of [
    'phashSchema = z.string().regex(/^[0-9a-f]{16}$/)',
    'tokenSchema = z.string().regex(/^[0-9a-f]{32}$/)',
    'hashVersion: z.literal(1)',
    'phash: phashSchema,',
    'token: tokenSchema,',
    "label: z.enum(['ai', 'real'])",
    "source: z.enum(['rated', 'hid'])",
    'z.strictObject({',
  ]) assert.ok(votes.includes(line), line);
  for (const line of ['modelVersion: z.literal(CURRENT_MODEL_VERSION)', 'vector: z.string().refine(isCanonicalVector)', 'const VECTOR_BYTES = 512;']) {
    assert.ok(embeddings.includes(line), line);
  }
  assert.ok(config.includes('CURRENT_MODEL_VERSION = 1;'));
});

test('every manifest has what the sender needs', () => {
  const build = readFileSync(here('../build.mjs'), 'utf8');
  assert.ok(build.includes("'alarms'"));
  assert.ok(build.includes("optional: ['websiteContent']"));
  const rules = JSON.parse(readFileSync(here('../src/origin-rules.json'), 'utf8'));
  // The API, and Safari's origin check on the website, which must be the only page there.
  assert.deepEqual(rules.map((r) => r.condition.requestDomains), [['api.hidetheslop.com'], ['hidetheslop.com']]);
  assert.equal(rules[0].condition.urlFilter, undefined);
  assert.equal(rules[1].condition.urlFilter, '|https://hidetheslop.com/.well-known/origin-check');
  const common = readFileSync(here('../src/common.js'), 'utf8');
  assert.ok(common.includes("var SLOP_ORIGIN_CHECK = 'https://hidetheslop.com/.well-known/origin-check';"));
  for (const rule of rules) {
    assert.deepEqual(rule.action.requestHeaders, [{ header: 'origin', operation: 'remove' }]);
    assert.deepEqual(rule.condition.requestMethods.sort(), ['get', 'post']);
    assert.deepEqual(rule.condition.resourceTypes, ['xmlhttprequest']);
  }
  // Safari runs the strip rule as Firefox does, and nothing of Firefox's consent.
  assert.ok(/safari: \{[\s\S]*'declarativeNetRequestWithHostAccess'[\s\S]*rule_resources: \[\{ id: 'strip-origin', enabled: true, path: 'origin-rules.json' \}\]/.test(build));
  const background = readFileSync(here('../src/background.js'), 'utf8');
  assert.ok(background.indexOf('slopArmStrip();') < background.indexOf('SlopVotes.start();'), 'armed before anything starts');
});
