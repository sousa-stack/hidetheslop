// Sends your ratings to the shared pool, when you've turned that on. A vote is a hash of
// the picture, a token, your answer and how you gave it, and nothing else ever goes in a
// request: no rating key, no URL, no page. The promises this keeps are in
// docs/CROWD-API.md.
//
// Votes wait in storage.local and go in small batches on an alarm, so the timing doesn't
// follow your browsing. Everything here fails quietly: a dead server must never touch
// hiding or rating, and nothing with a hash, token or URL in it gets logged.
//
// Runs in the background. token, vectorOf, distance and the rest run in Node with fake
// storage and fetch (test/votes.test.mjs).
/* exported SlopVotes */

var SlopVotes = (() => {
  const API = 'https://api.hidetheslop.com';
  const HOST_ACCESS = [`${API}/*`];
  const HASH_VERSION = 1;
  const MODEL_VERSION = 1;
  const MAX_QUEUE = 500;
  const MAX_BATCH = 5; // small, because CROWD-API.md says xmin can group what arrives together
  const MAX_SENT = 5000;
  const SAME_PICTURE_BITS = 3; // the same limit the server merges at
  const TIMEOUT_MS = 15000;
  const HOUR = 60 * 60 * 1000;
  const ALARM = 'send-votes';
  const STOP_AFTER = 3; // batches refused in a row, before you get told to update
  // Measured with eval/quantize.mjs: the smallest change to the scores, and a unit vector
  // can't reach the clamp.
  const VECTOR_SCALE = 127;
  const PHASH = /^[0-9a-f]{16}$/;

  // ---- pure parts ---------------------------------------------------------

  const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const unhex = (text) => Uint8Array.from(text.match(/../g), (h) => parseInt(h, 16));

  // First 16 bytes of the HMAC, so one picture always gets one token from you, and
  // tokens for different pictures look unrelated.
  async function token(key, phash) {
    const message = new TextEncoder().encode(`hts-vote-v1:${HASH_VERSION}:${phash}`);
    return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, message)).slice(0, 16));
  }

  const importSecret = (secret) =>
    crypto.subtle.importKey('raw', unhex(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  // 512 int8 values in base64. Always from the raw CLIP embedding.
  function vectorOf(embedding) {
    const bytes = embedding.map((x) => Math.max(-127, Math.min(127, Math.round(x * VECTOR_SCALE))) & 255);
    return btoa(String.fromCharCode(...bytes));
  }

  function bits(n) {
    let count = 0;
    for (; n; n &= n - 1) count++;
    return count;
  }

  // Hashes are 16 hex digits, which is too many for a double, so two halves.
  function distance(a, b) {
    const half = (at, text) => parseInt(text.slice(at, at + 8), 16);
    return bits(half(0, a) ^ half(0, b)) + bits(half(8, a) ^ half(8, b));
  }

  // The server counts votes across merged hashes, so two near copies from one install
  // would be two votes. Reuse the first hash you voted on, which replaces that vote. This
  // covers honest use, not a hostile client.
  function sameAs(phash, known) {
    if (known.includes(phash)) return phash;
    return known.find((other) => distance(phash, other) <= SAME_PICTURE_BITS) ?? phash;
  }

  function shuffled(list) {
    const out = [...list];
    const random = crypto.getRandomValues(new Uint32Array(out.length));
    for (let i = out.length - 1; i > 0; i--) {
      const k = random[i] % (i + 1);
      [out[i], out[k]] = [out[k], out[i]];
    }
    return out;
  }

  // The API's schema is strict, so these pick each field by hand. Nothing else can get in.
  const voteBody = (items, tokens) => ({
    hashVersion: HASH_VERSION,
    votes: items.map(({ phash, label, source }, i) => ({ phash, token: tokens[i], label, source })),
  });
  const embeddingBody = (items, tokens) => ({
    hashVersion: HASH_VERSION,
    modelVersion: MODEL_VERSION,
    items: items.map(({ phash, vector }, i) => ({ phash, token: tokens[i], vector })),
  });

  function accepted(json) {
    return (
      !!json && Number.isFinite(json.accepted) && Array.isArray(json.needEmbedding) &&
      json.needEmbedding.every((h) => typeof h === 'string')
    );
  }

  // ---- one lock -----------------------------------------------------------
  // Every change to the queue waits its turn here, so nothing writes a stale copy over
  // a newer one. Never hold this across the network.

  const local = () => SLOP_API.storage.local;
  let lock = Promise.resolve();
  function locked(work) {
    const turn = lock.then(work);
    lock = turn.catch(() => {});
    return turn;
  }

  // Two secrets would give one picture two tokens, which is a double vote, so everyone
  // shares this one promise.
  let key = null;
  function secretKey() {
    key ??= locked(async () => {
      let { voteSecret } = await local().get('voteSecret');
      if (!voteSecret) {
        voteSecret = hex(crypto.getRandomValues(new Uint8Array(32)));
        await local().set({ voteSecret });
      }
      return importSecret(voteSecret);
    }).catch((e) => {
      key = null;
      throw e;
    });
    return key;
  }

  async function readQueue() {
    const { voteQueue = [] } = await local().get('voteQueue');
    return voteQueue;
  }

  function clear() {
    return locked(() => local().remove('voteQueue'));
  }

  // ---- queueing -----------------------------------------------------------

  // Saves a rating for later. Rating a picture again replaces the waiting vote.
  function add({ phash, label, source, embedding }) {
    const vector = vectorOf(embedding);
    return locked(async () => {
      if (!(await slopGetShare())) return false;
      const { voteQueue = [], voteSent = [] } = await local().get(['voteQueue', 'voteSent']);
      const same = sameAs(phash, [...voteSent, ...voteQueue.map((v) => v.phash)]);
      const n = voteQueue.reduce((most, v) => Math.max(most, v.n), 0) + 1;
      const after = Date.now() + HOUR + Math.random() * 5 * HOUR;
      const kept = voteQueue.filter((v) => v.phash !== same);
      kept.push({ phash: same, label, source, vector, after, n });
      await local().set({ voteQueue: kept.slice(-MAX_QUEUE) });
      return true;
    });
  }

  // Removes what the server took, unless it was rated again while this was in the air.
  // The number on an entry changes when it's replaced.
  function settle(items, { sent = true } = {}) {
    return locked(async () => {
      const { voteQueue = [], voteSent = [] } = await local().get(['voteQueue', 'voteSent']);
      const gone = new Map(items.map((v) => [v.phash, v.n]));
      const patch = { voteQueue: voteQueue.filter((v) => gone.get(v.phash) !== v.n) };
      if (sent) {
        const fresh = items.map((v) => v.phash).filter((h) => !voteSent.includes(h));
        patch.voteSent = [...voteSent, ...fresh].slice(-MAX_SENT);
      }
      await local().set(patch);
    });
  }

  // ---- sending ------------------------------------------------------------

  // On Firefox, a request that could carry the install's own moz-extension address must
  // not go out, so the rule that strips it has to be on as well.
  async function allowed() {
    try {
      const { permissions, declarativeNetRequest } = SLOP_API;
      if (!(await slopGetShare())) return false;
      if (!(await permissions.contains({ origins: HOST_ACCESS }))) return false;
      if (!slopIsFirefox()) return true;
      if (!(await permissions.contains({ data_collection: ['websiteContent'] }))) return false;
      return (await declarativeNetRequest.getEnabledRulesets()).includes('strip-origin');
    } catch {
      return false;
    }
  }

  // Off means off: `aborts` lets the storage listener cut these short.
  const aborts = new Set();
  async function post(path, body) {
    if (!(await allowed())) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    aborts.add(ctrl);
    try {
      const res = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error', // a vote is for this server and no other
        signal: ctrl.signal,
      });
      let json = null;
      try {
        json = JSON.parse(await res.text());
      } catch {
        json = null; // a proxy's HTML page, say
      }
      return { status: res.status, json };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      aborts.delete(ctrl);
    }
  }

  // One try for each hash the server asked for: a later voter can supply it.
  async function sendEmbeddings(items, tokens, need) {
    const wanted = new Set(need.filter((h) => PHASH.test(h)));
    const picked = items.map((item, i) => [item, tokens[i]]).filter(([item]) => wanted.has(item.phash));
    if (!picked.length) return;
    await post('/v1/embeddings', embeddingBody(picked.map(([item]) => item), picked.map(([, t]) => t)));
  }

  // 'sent', 'refused' (a 400 or 413 somewhere in it) or 'kept' (try at the next alarm).
  // The API doesn't say which item it refused, so split the batch to find it, and drop
  // an item only when it's alone and the reply is the API's own error, so a proxy's page
  // or a bug of ours can't delete everyone's votes. While `stopped` nothing gets dropped.
  async function sendBatch(items, stopped) {
    const tokens = await Promise.all(items.map((v) => secretKey().then((k) => token(k, v.phash))));
    const reply = await post('/v1/votes', voteBody(items, tokens));
    if (!reply) return 'kept';
    if (reply.status === 202 && accepted(reply.json)) {
      await settle(items);
      await sendEmbeddings(items, tokens, reply.json.needEmbedding);
      return 'sent';
    }
    if (reply.status !== 400 && reply.status !== 413) return 'kept';
    if (stopped) return 'refused';
    if (items.length === 1) {
      if (typeof reply.json?.error === 'string') await settle(items, { sent: false });
      return 'refused';
    }
    const middle = items.length >> 1;
    const first = await sendBatch(items.slice(0, middle), stopped);
    if (first === 'kept') return 'kept';
    const second = await sendBatch(items.slice(middle), stopped);
    return second === 'kept' ? 'kept' : 'refused';
  }

  // Alarm and Send now can't overlap. After a worker restart this can resend, which is
  // harmless, because the API replaces on hash and token.
  let sending = false;
  async function run({ now = false } = {}) {
    if (sending) return;
    sending = true;
    try {
      if (!(await allowed())) return;
      const { voteQueue = [], voteRefused = 0 } = await local().get(['voteQueue', 'voteRefused']);
      const stopped = voteRefused >= STOP_AFTER;
      if (stopped && !now) return;
      const due = now ? voteQueue : voteQueue.filter((v) => v.after <= Date.now());
      const batch = shuffled(due).slice(0, MAX_BATCH);
      if (!batch.length) return;
      const result = await sendBatch(batch, stopped);
      if (result === 'sent' && voteRefused) await local().remove('voteRefused');
      if (result === 'refused' && !stopped) await local().set({ voteRefused: voteRefused + 1 });
    } catch {
      // Stays in the queue for the next alarm.
    } finally {
      sending = false;
    }
  }

  // What Settings shows. `stuck`: the server keeps refusing what this version sends.
  async function state() {
    const { voteQueue = [], voteRefused = 0 } = await local().get(['voteQueue', 'voteRefused']);
    return { on: await slopGetShare(), waiting: voteQueue.length, stuck: voteRefused >= STOP_AFTER };
  }

  // ---- staying in step with your settings ----------------------------------

  async function ensureAlarm() {
    if (!(await SLOP_API.alarms.get(ALARM))) SLOP_API.alarms.create(ALARM, { periodInMinutes: 60 });
  }

  // Turning sharing off, however it happened, clears the queue. Revoked consent can land
  // while the Firefox background page is asleep, so this also runs on every start.
  async function tidy() {
    const on = await slopGetShare();
    if (on && slopIsFirefox() && !(await SLOP_API.permissions.contains({ data_collection: ['websiteContent'] }))) {
      await local().set({ shareRatings: false });
    } else if (!on) {
      await clear();
    }
  }

  // Listeners go on at the top level of the background, so these events can wake it.
  function start() {
    SLOP_API.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM) run();
    });
    SLOP_API.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.shareRatings || changes.shareRatings.newValue === true) return;
      for (const ctrl of aborts) ctrl.abort();
      clear().catch(() => {});
    });
    SLOP_API.permissions.onRemoved.addListener((removed) => {
      if (removed.data_collection?.includes('websiteContent')) local().set({ shareRatings: false }).catch(() => {});
    });
    ensureAlarm().catch(() => {});
    tidy().catch(() => {});
  }

  // A new version might be the fix `stuck` asks you to go and get.
  const updated = () => local().remove('voteRefused');

  return { start, add, run, state, clear, updated, token, importSecret, vectorOf, distance, sameAs, VECTOR_SCALE };
})();
