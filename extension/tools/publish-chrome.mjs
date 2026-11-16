// Uploads a built zip to the Chrome Web Store and sends it for review, through the
// store's V2 API. The release workflow runs this; nothing in the extension uses it.
//
//   node tools/publish-chrome.mjs dist/hidetheslop-chrome-1.12.0.zip
//   node tools/publish-chrome.mjs --check     signs in and reads the item's status, uploads nothing
//
// It reads CHROME_PUBLISHER_ID and CHROME_ITEM_ID, and signs in with either
// CHROME_SERVICE_ACCOUNT_JSON (a service account's key file, whole) or the three of
// CHROME_CLIENT_ID, CHROME_CLIENT_SECRET and CHROME_REFRESH_TOKEN. No dependencies, so
// the workflow downloads nothing to run it. docs/store/browser-stores.md has the steps.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

const b64url = (v) => Buffer.from(v).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Google's and the store's error bodies say what was wrong with the request. They
// never repeat the token, so they're safe in a public log.
async function json(res, what) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${text.slice(0, 2000)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what}: the answer wasn't JSON`);
  }
}

export async function accessToken(env, { tokenUrl = TOKEN_URL, now = Date.now() } = {}) {
  let body;
  if (env.CHROME_SERVICE_ACCOUNT_JSON) {
    let key;
    try {
      key = JSON.parse(env.CHROME_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error('CHROME_SERVICE_ACCOUNT_JSON is not JSON. Paste the whole key file into the secret.');
    }
    if (!key.client_email || !key.private_key) throw new Error('CHROME_SERVICE_ACCOUNT_JSON has no client_email or private_key');
    const iat = Math.floor(now / 1000);
    // The audience is always Google's own address, whatever the key file's token_uri says.
    const claims = { iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 600 };
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
    body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` });
  } else if (env.CHROME_CLIENT_ID && env.CHROME_CLIENT_SECRET && env.CHROME_REFRESH_TOKEN) {
    body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.CHROME_CLIENT_ID,
      client_secret: env.CHROME_CLIENT_SECRET,
      refresh_token: env.CHROME_REFRESH_TOKEN,
    });
  } else {
    throw new Error('No Chrome Web Store credentials. Set CHROME_SERVICE_ACCOUNT_JSON, or CHROME_CLIENT_ID, CHROME_CLIENT_SECRET and CHROME_REFRESH_TOKEN, in the stores environment.');
  }
  const res = await fetch(tokenUrl, { method: 'POST', body });
  const out = await json(res, 'Signing in to Google');
  if (!out.access_token) throw new Error('Signing in to Google gave no access token');
  return out.access_token;
}

const describe = (rev) =>
  rev ? `${rev.state} ${(rev.distributionChannels || []).map((c) => `${c.crxVersion} at ${c.deployPercentage}%`).join(', ')}`.trim() : 'none';

export async function publishChrome({ env, zip, version, check = false, api = API, tokenUrl, pollMs = 5000, pollTries = 60, log = console.log }) {
  const { CHROME_PUBLISHER_ID: publisher, CHROME_ITEM_ID: item } = env;
  if (!publisher) throw new Error('Set the CHROME_PUBLISHER_ID secret in the stores environment.');
  if (!item) throw new Error('CHROME_ITEM_ID is not set.');
  const name = `publishers/${encodeURIComponent(publisher)}/items/${encodeURIComponent(item)}`;
  const auth = { Authorization: `Bearer ${await accessToken(env, { tokenUrl })}` };
  const status = async () => json(await fetch(`${api}/v2/${name}:fetchStatus`, { headers: auth }), 'Reading the item');

  const before = await status();
  log(`Chrome Web Store item ${item}: published ${describe(before.publishedItemRevisionStatus)}; submitted ${describe(before.submittedItemRevisionStatus)}`);
  if (before.takenDown) log('The store says this item is taken down.');
  if (before.warned) log('The store says this item has a warning.');
  if (check) return { checked: true };

  // The docs don't say what an upload does to a version that's waiting for review, so
  // this stops instead of finding out with a real listing.
  if (before.submittedItemRevisionStatus?.state === 'PENDING_REVIEW') {
    throw new Error('An earlier version is still waiting for review. Wait for it, or cancel it in the Developer Dashboard, then run this job again.');
  }

  let up = await json(await fetch(`${api}/upload/v2/${name}:upload`, { method: 'POST', headers: auth, body: readFileSync(zip) }), 'Uploading the zip');
  let state = up.uploadState;
  for (let i = 0; state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS'; i++) {
    if (i >= pollTries) throw new Error('The store was still working on the upload when this gave up. Check the Developer Dashboard.');
    await sleep(pollMs);
    state = (await status()).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`The upload ended as ${state || 'nothing the docs name'}.`);
  if (version && up.crxVersion && up.crxVersion !== version) throw new Error(`The store read version ${up.crxVersion} from the zip, not ${version}.`);
  log(`Uploaded ${up.crxVersion || version || 'the zip'}.`);

  // DEFAULT_PUBLISH: it goes to review, and goes public by itself once approved.
  const sent = await json(
    await fetch(`${api}/v2/${name}:publish`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
    }),
    'Sending it for review',
  );
  log(`Sent for review. The store says: ${sent.state}${sent.warningInfo ? `, with a warning: ${JSON.stringify(sent.warningInfo)}` : ''}`);
  return { state: sent.state };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const zip = args.find((a) => !a.startsWith('--'));
  if (!check && !zip) {
    console.error('usage: node tools/publish-chrome.mjs <zip> | --check');
    process.exit(2);
  }
  publishChrome({ env: process.env, zip, version: process.env.RELEASE_VERSION, check }).catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
