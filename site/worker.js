// hidetheslop.com is static files, served straight from assets. This script runs for one
// path only (run_worker_first in wrangler.jsonc): Safari's origin check, which the Safari
// build sends before it votes or downloads the list (extension/src/common.js).
//
// It answers whether an extension's Origin arrived, and nothing else. It never sends the
// value back, and it stores and logs nothing; observability is off in wrangler.jsonc.
const ORIGIN_CHECK = '/.well-known/origin-check';

// Anything but a web page's origin counts, so a scheme nobody has seen yet can't slip by.
// No Origin, or the literal "null" a stripped POST can carry, is what Safari should send.
function fromExtension(origin) {
  return origin !== null && origin !== 'null' && !/^https?:\/\//i.test(origin);
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== ORIGIN_CHECK) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { allow: 'GET, POST', 'cache-control': 'no-store' } });
    }
    // The body of the POST is never read.
    return new Response(JSON.stringify({ extension: fromExtension(request.headers.get('origin')) }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  },
};
