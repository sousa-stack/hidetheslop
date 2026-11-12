// Prints a picture's perceptual hash, worked out the way the extension works it out: the
// real extension/src/phash.js, decoding through createImageBitmap in a headless Chrome for
// Testing (the one vote-check.mjs uses). For a picture someone reports, when Kevin has the
// file, so he can block its hash on the server. Run from this folder:
//
//   node phash-of.mjs <file>
//
// It prints the 16 hex digits, or why the picture has no hash. The picture stays on this
// machine: it's served on 127.0.0.1 to a throwaway profile, which is deleted afterwards.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromePath, rpc } from './vote-check.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The type a site would serve it with, which is what the extension's download sees.
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('usage: node phash-of.mjs <file>');
  process.exit(2);
}
const bytes = readFileSync(file);
const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';

const server = http.createServer((req, res) => {
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><script src="/phash.js"></script>');
  if (req.url === '/phash.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(here('../extension/src/phash.js')));
  if (req.url === '/picture') return res.writeHead(200, { 'content-type': type }).end(bytes);
  return res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const page = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(join(tmpdir(), 'hts-phash-of-'));
const chrome = spawn(chromePath(), [
  '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-extensions', page,
], { stdio: 'ignore' });

let result = null;
let cdp = null;
try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.url === page);
    if (!target) await sleep(100);
  }
  if (!target) throw new Error('the page never opened');
  cdp = await rpc(target.webSocketDebuggerUrl);
  const expression = `(async () => {
    while (typeof SlopHash === 'undefined') await new Promise((r) => setTimeout(r, 50));
    return JSON.stringify(await SlopHash.fromBlob(await (await fetch('/picture')).blob()));
  })()`;
  const m = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error('phash.js failed in the page');
  result = JSON.parse(m.result.result.value);
} finally {
  cdp?.close();
  chrome.kill();
  for (let i = 0; i < 50 && chrome.exitCode === null && chrome.signalCode === null; i++) await sleep(100);
  rmSync(profile, { recursive: true, force: true });
  server.close();
}

if (result?.phash) {
  console.log(result.phash);
} else {
  console.error(`no hash: ${result?.why || 'unknown'}`);
  process.exitCode = 1;
}
