// hidetheslop.com is static files, served straight from assets. This script runs only for
// the paths listed in run_worker_first in wrangler.jsonc:
//
// - Safari's origin check, which the Safari build sends before it votes or downloads the
//   list (extension/src/common.js). It answers whether an extension's Origin arrived, and
//   nothing else. It never sends the value back.
// - /hit/<page>, /get/<browser> and /stats: daily totals of page views and install-button
//   clicks, kept in the Totals Durable Object below. A total is a day, a name and a number.
//   Nothing about who made the request (address, browser, referrer, country, cookie, or a
//   time finer than the day) is ever stored.
//
// Nothing is logged; observability is off in wrangler.jsonc.
const ORIGIN_CHECK = '/.well-known/origin-check';

// Where each install button goes. Chrome, Firefox and Edge get their listing URLs once
// each store approves them; until then they land back on the home page.
const STORES = {
  chrome: 'https://hidetheslop.com/',
  firefox: 'https://hidetheslop.com/',
  edge: 'https://hidetheslop.com/',
  safari: 'https://apps.apple.com/app/id6834020766',
};
const PAGES = ['home', 'privacy'];
// Every name a total can have, so a made-up path can never create a row.
const NAMES = new Set([...PAGES, ...Object.keys(STORES).map((browser) => `get-${browser}`)]);

// Crawlers and link previews that say what they are. Most bots never load the image at
// all; this catches the honest ones that do. The user agent is only read here.
const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|scrape|archiver|facebookexternalhit|curl|wget|python|java\/|httpclient|http-client|okhttp/i;

const NO_STORE = { 'cache-control': 'no-store' };
const notFound = () => new Response(null, { status: 404, headers: NO_STORE });

// Anything but a web page's origin counts, so a scheme nobody has seen yet can't slip by.
// No Origin, or the literal "null" a stripped POST can carry, is what Safari should send.
function fromExtension(origin) {
  return origin !== null && origin !== 'null' && !/^https?:\/\//i.test(origin);
}

function originCheck(request) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST', 'cache-control': 'no-store' } });
  }
  // The body of the POST is never read.
  return new Response(JSON.stringify({ extension: fromExtension(request.headers.get('origin')) }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

function totals(env) {
  return env.TOTALS.get(env.TOTALS.idFromName('totals'));
}

// Adds one to today's total for a name. The Durable Object gets a fresh request carrying
// only the name, so none of the visitor's headers reach it. A failure only loses a count:
// the page and the redirect never depend on it.
async function addOne(env, name) {
  try {
    await totals(env).fetch(`https://totals/add/${name}`, { method: 'POST' });
  } catch {
    // Nothing to do, and nothing is logged.
  }
}

// Compares SHA-256 digests byte by byte without stopping early, so the time taken says
// nothing about how much of a guess was right, whatever its length.
async function sameSecret(given, secret) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([given, secret].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(s))));
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function stats(request, env) {
  const secret = env.STATS_TOKEN;
  const given = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '');
  if (request.method !== 'GET' || !secret || !given || !(await sameSecret(given[1], secret))) return notFound();
  return totals(env).fetch('https://totals/rows');
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === ORIGIN_CHECK) return originCheck(request);
    if (pathname === '/stats') return stats(request, env);

    const hit = /^\/hit\/([a-z]+)$/.exec(pathname);
    if (hit) {
      if (!PAGES.includes(hit[1])) return notFound();
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET', ...NO_STORE } });
      if (!BOT.test(request.headers.get('user-agent') || 'bot')) ctx.waitUntil(addOne(env, hit[1]));
      return new Response(null, { status: 204, headers: NO_STORE });
    }

    const get = /^\/get\/([a-z]+)$/.exec(pathname);
    if (get) {
      if (!Object.hasOwn(STORES, get[1])) return notFound();
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET', ...NO_STORE } });
      if (!BOT.test(request.headers.get('user-agent') || 'bot')) ctx.waitUntil(addOne(env, `get-${get[1]}`));
      return new Response(null, { status: 302, headers: { location: STORES[get[1]], ...NO_STORE } });
    }

    if (pathname.startsWith('/hit/') || pathname.startsWith('/get/')) return notFound();
    return env.ASSETS.fetch(request);
  },
};

// The totals: one row per day and name. One instance holds them all (idFromName('totals')).
// A plain class, so it runs without the cloudflare:workers import and can be tested in Node.
export class Totals {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS totals (
      day TEXT NOT NULL, name TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, name))`);
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/rows') {
      const rows = this.sql.exec('SELECT day, name, count FROM totals ORDER BY day DESC, name').toArray();
      return new Response(JSON.stringify(rows), {
        headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', ...NO_STORE },
      });
    }
    const name = pathname.startsWith('/add/') ? pathname.slice('/add/'.length) : '';
    if (request.method !== 'POST' || !NAMES.has(name)) return notFound();
    // The UTC date is the finest time ever stored.
    const day = new Date().toISOString().slice(0, 10);
    this.sql.exec(
      'INSERT INTO totals (day, name, count) VALUES (?, ?, 1) ON CONFLICT (day, name) DO UPDATE SET count = count + 1',
      day,
      name,
    );
    return new Response(null, { status: 204 });
  }
}
