// The crowd's list: hashes of pictures that people who share their ratings confirmed as
// AI. The whole list comes down every few hours and matching happens here, so nothing is
// ever looked up per picture. A lookup would hand the server a stream of what you look
// at, and that must never change. The promises are in docs/CROWD-API.md.
//
// Matching needs a hash, and only your robot downloads pictures, so the list is only
// fetched while useCrowdList and visualCheck are on and the model is downloaded.
// Turning any of those off deletes it. Everything here fails quietly: a dead server
// leaves the old list in place.
//
// Runs in the background. The matching and the fetch run in Node with fake storage and
// fetch (test/crowd.test.mjs), and the harness runs flagged() in a page.
/* exported SlopCrowd */

var SlopCrowd = (() => {
  const API = 'https://api.hidetheslop.com';
  const HOST_ACCESS = [`${API}/*`];
  const HASH_VERSION = 1;
  const ALARM = 'fetch-crowd';
  const HOUR = 60 * 60 * 1000;
  const PERIOD_MINUTES = 360; // the server publishes hourly and the list is cached an hour
  const STALE = 6 * HOUR;
  const RESYNC = 7 * 24 * HOUR;
  const MAX_PAGES = 5; // 10,000 entries a page, well past MAX_HASHES
  const MAX_HASHES = 20000; // storage.local holds 10 MB, and your ratings need most of it
  const MAX_OWN = 2000;
  const SAME_PICTURE_BITS = 3; // the same limit the server merges at
  const MODEL_CACHE = 'hidetheslop-model';
  const PHASH = /^[0-9a-f]{16}$/;
  const KEYS = ['crowdList', 'crowdSeq', 'crowdFetchedAt', 'crowdFullAt'];

  const local = () => SLOP_API.storage.local;

  // ---- matching -------------------------------------------------------------

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

  // Two hashes within 3 bits share at least one of their four 16-bit bands, the same
  // trick the server merges with, so a check is four lookups rather than a scan.
  function bandIndex(hashes) {
    const bands = [new Map(), new Map(), new Map(), new Map()];
    for (const h of hashes) {
      for (let b = 0; b < 4; b++) {
        const part = h.slice(b * 4, b * 4 + 4);
        if (!bands[b].has(part)) bands[b].set(part, []);
        bands[b].get(part).push(h);
      }
    }
    return bands;
  }

  function near(bands, phash) {
    for (let b = 0; b < 4; b++) {
      for (const h of bands[b].get(phash.slice(b * 4, b * 4 + 4)) || []) {
        if (distance(phash, h) <= SAME_PICTURE_BITS) return true;
      }
    }
    return false;
  }

  // Built the first time a check needs them, and again after the lists change. check()
  // awaits this, so the first checks after a worker wakes don't miss.
  let crowd = null;
  let mine = null;
  function crowdIndex() {
    crowd ??= local().get('crowdList').then(({ crowdList }) => {
      const list = Array.isArray(crowdList) ? crowdList.filter((h) => PHASH.test(h)) : [];
      return { size: list.length, bands: bandIndex(list) };
    }).catch((e) => {
      crowd = null;
      throw e;
    });
    return crowd;
  }

  // Pictures you said weren't AI. Ratings from before 1.9.0 have no hash, so their keys
  // count too.
  function mineIndex() {
    mine ??= local().get(['ownVerdicts', 'visionRatings']).then(({ ownVerdicts = [], visionRatings }) => {
      const real = ownVerdicts.filter((v) => v.label === 'real');
      const keys = new Set(real.map((v) => v.key));
      for (const r of visionRatings?.real || []) keys.add(r.key);
      return { keys, bands: bandIndex(real.map((v) => v.phash).filter((h) => PHASH.test(h || ''))) };
    }).catch((e) => {
      mine = null;
      throw e;
    });
    return mine;
  }

  // Whether the crowd flagged this picture. Your own Not AI wins, by address or by hash.
  async function flagged(key, phash) {
    if (typeof phash !== 'string' || !PHASH.test(phash)) return false;
    const list = await crowdIndex();
    if (!list.size || !near(list.bands, phash)) return false;
    const yours = await mineIndex();
    return !yours.keys.has(key) && !near(yours.bands, phash);
  }

  // ---- your own verdicts ------------------------------------------------------

  let lock = Promise.resolve();
  function locked(work) {
    const turn = lock.then(work);
    lock = turn.catch(() => {});
    return turn;
  }

  // Every rating lands here, shared or not, because a rating keeps no hash of its own and
  // the oldest go after 500. Rating a picture again replaces its entry.
  function remember(key, phash, label) {
    return locked(async () => {
      const { ownVerdicts = [] } = await local().get('ownVerdicts');
      const hash = typeof phash === 'string' && PHASH.test(phash) ? phash : null;
      const kept = ownVerdicts.filter((v) => v.key !== key && (!hash || v.phash !== hash));
      kept.push({ key, phash: hash, label });
      await local().set({ ownVerdicts: kept.slice(-MAX_OWN) });
    });
  }

  // ---- whether to fetch ---------------------------------------------------------

  // Whether inspect() should hash what it downloads. Pictures inspected before the first
  // list arrives still get their hash this way.
  async function inUse() {
    const { useCrowdList, visualCheck } = await slopGetSettings();
    return !!useCrowdList && !!visualCheck;
  }

  async function modelDownloaded() {
    const cache = await caches.open(MODEL_CACHE);
    return (await cache.keys()).length > 0;
  }

  // The list is useless without your robot, so it isn't downloaded without it.
  async function wanted() {
    try {
      return (await inUse()) && (await modelDownloaded());
    } catch {
      return false;
    }
  }

  // On Firefox the strip rule must be on, or the GET could carry the install's own
  // moz-extension address, and on Safari it must be proven to work in this run (common.js).
  // Unlike a vote, this needs no sharing and no data permission.
  async function listAllowed() {
    try {
      const { permissions, declarativeNetRequest } = SLOP_API;
      if (!(await permissions.contains({ origins: HOST_ACCESS }))) return false;
      if (slopIsSafari()) return await slopStripReady();
      if (!slopIsFirefox()) return true;
      return (await declarativeNetRequest.getEnabledRulesets()).includes('strip-origin');
    } catch {
      return false;
    }
  }

  // ---- fetching -----------------------------------------------------------------

  function validPage(json, since) {
    return (
      !!json && typeof json === 'object' && Number.isSafeInteger(json.seq) && json.seq >= since &&
      typeof json.more === 'boolean' && Array.isArray(json.add) && Array.isArray(json.remove) &&
      json.add.every((h) => typeof h === 'string' && PHASH.test(h)) &&
      json.remove.every((h) => typeof h === 'string' && PHASH.test(h))
    );
  }

  // Off means off: `aborts` lets the storage listener cut these short.
  const aborts = new Set();
  async function getPage(since) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), slopRequestTimeout());
    aborts.add(ctrl);
    try {
      // Everyone asks for the same pages, with nothing of their own, which is what lets
      // Cloudflare cache it.
      const res = await fetch(`${API}/v1/verdicts?since=${since}&hashVersion=${HASH_VERSION}`, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error', // the list comes from this server and no other
        signal: ctrl.signal,
      });
      if (res.status !== 200) return null;
      const json = JSON.parse(await res.text());
      return validPage(json, since) ? json : null;
    } catch {
      return null; // offline, a timeout, or a proxy's HTML page
    } finally {
      clearTimeout(timer);
      aborts.delete(ctrl);
    }
  }

  // Follows `more` to the end, then applies it all at once. Every 7 days it starts from 0
  // and replaces the set, because expiry or a restore on the server can leave this copy
  // wrong with no `remove` to fix it. A page that doesn't validate, or a `more` that
  // doesn't move `seq`, applies nothing.
  let fetching = false;
  async function refresh({ minAge = 0 } = {}) {
    if (fetching) return false;
    fetching = true;
    try {
      if (!(await wanted())) {
        await clear();
        return false;
      }
      if (!(await listAllowed())) return false;
      const { crowdSeq, crowdFetchedAt = 0, crowdFullAt = 0 } = await local().get(KEYS);
      if (Date.now() - crowdFetchedAt < minAge) return false;
      const whole = !Number.isSafeInteger(crowdSeq) || Date.now() - crowdFullAt >= RESYNC;
      const from = whole ? 0 : crowdSeq;
      const pages = [];
      let since = from;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await getPage(since);
        if (!page) return false;
        if (page.more && page.seq === since) return false;
        pages.push(page);
        since = page.seq;
        if (!page.more) break;
      }
      // The cap stops early with `more` still true. The next fetch carries on from here.
      return await locked(async () => {
        if (!(await wanted())) return false;
        const now = await local().get(['crowdList', 'crowdSeq']);
        if (!whole && now.crowdSeq !== crowdSeq) return false; // cleared or moved while this was out
        const set = new Set(whole ? [] : now.crowdList || []);
        for (const page of pages) {
          for (const h of page.remove) set.delete(h);
          // Newest last, so the cap drops the oldest.
          for (const h of page.add) {
            set.delete(h);
            set.add(h);
          }
        }
        const patch = { crowdList: [...set].slice(-MAX_HASHES), crowdSeq: since, crowdFetchedAt: Date.now() };
        if (whole) patch.crowdFullAt = Date.now();
        try {
          await local().set(patch);
        } catch {
          return false; // storage is full; the old list stays, and your ratings never wait on this
        }
        return true;
      });
    } catch {
      return false;
    } finally {
      fetching = false;
    }
  }

  function clear() {
    for (const ctrl of aborts) ctrl.abort();
    return locked(() => local().remove(KEYS));
  }

  // ---- staying in step with your settings ----------------------------------------

  // The first fetch lands 1 to 30 minutes in, so installs that start together don't all
  // ask in the same minute, and every 6 hours after that.
  function schedule() {
    SLOP_API.alarms.create(ALARM, { delayInMinutes: 1 + Math.random() * 29, periodInMinutes: PERIOD_MINUTES });
  }
  async function ensureAlarm() {
    if (!(await SLOP_API.alarms.get(ALARM))) schedule();
  }

  async function stale() {
    const { crowdFetchedAt = 0 } = await local().get('crowdFetchedAt');
    return Date.now() - crowdFetchedAt >= STALE;
  }

  // Listeners go on at the top level of the background, so these events can wake it.
  // Nothing fetches from here: Chrome wakes the worker on every picture check, and a
  // fetch on waking would follow your browsing.
  function start() {
    SLOP_API.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM) refresh({ minAge: HOUR });
    });
    SLOP_API.runtime.onStartup.addListener(() => {
      stale().then((old) => old && refresh()).catch(() => {});
    });
    SLOP_API.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.crowdList) crowd = null;
      if (area === 'local' && (changes.ownVerdicts || changes.visionRatings)) mine = null;
      if (area !== 'sync' || !(changes.useCrowdList || changes.visualCheck)) return;
      wanted().then(async (yes) => {
        if (!yes) return clear();
        if (await stale()) schedule(); // just turned on: soon, not in up to 6 hours
      }).catch(() => {});
    });
    ensureAlarm().catch(() => {});
    wanted().then((yes) => yes || clear()).catch(() => {});
  }

  return { start, refresh, flagged, remember, inUse, clear, bandIndex, near, distance, MAX_HASHES, MAX_OWN };
})();
