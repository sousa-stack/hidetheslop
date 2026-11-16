// Submits a built zip to addons.mozilla.org as a new listed version, through AMO's v5
// API. The release workflow runs this; nothing in the extension uses it.
//
//   node tools/publish-firefox.mjs dist/hidetheslop-firefox-1.12.0.zip
//   node tools/publish-firefox.mjs --check     signs in and lists the add-on's versions, uploads nothing
//
// It reads AMO_JWT_ISSUER and AMO_JWT_SECRET (AMO's API key page calls them that),
// AMO_ADDON_ID (the add-on's id from the manifest) and AMO_NOTES_FILE (the notes for
// Mozilla's reviewers, sent with every version). No source upload: nothing here is
// built by a bundler or minifier, and the notes say where the one minified library
// comes from. No dependencies. docs/store/browser-stores.md has the steps.
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://addons.mozilla.org/api/v5';
const NOTES_MAX = 3000; // what AMO's own form allows

const b64url = (v) => Buffer.from(v).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A new token for every request: AMO allows five minutes at most, and a wait for the
// validator can run longer than that.
export function amoJwt(issuer, secret, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: issuer, jti: randomUUID(), iat, exp: iat + 60 }))}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

// AMO's error bodies name the field that was wrong and never repeat the token.
async function json(res, what) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${text.slice(0, 2000)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what}: the answer wasn't JSON`);
  }
}

export async function publishFirefox({ env, zip, version, check = false, api = API, pollMs = 5000, pollTries = 120, log = console.log }) {
  const { AMO_JWT_ISSUER: issuer, AMO_JWT_SECRET: secret, AMO_ADDON_ID: addon } = env;
  if (!issuer || !secret) throw new Error('Set the AMO_JWT_ISSUER and AMO_JWT_SECRET secrets in the stores environment.');
  if (!addon) throw new Error('AMO_ADDON_ID is not set.');
  const auth = () => ({ Authorization: `JWT ${amoJwt(issuer, secret)}` });
  const versionsUrl = `${api}/addons/addon/${encodeURIComponent(addon)}/versions/`;

  if (check) {
    // Only an author can ask for this filter, so an answer proves the key is the right account's.
    const list = await json(await fetch(`${versionsUrl}?filter=all_with_unlisted`, { headers: auth() }), 'Reading the add-on');
    log(`AMO add-on ${addon}: ${list.count} version(s); newest ${(list.results || []).slice(0, 3).map((v) => `${v.version} (${v.file?.status})`).join(', ') || 'none'}`);
    return { checked: true };
  }

  const notes = env.AMO_NOTES_FILE ? readFileSync(env.AMO_NOTES_FILE, 'utf8').trim() : '';
  if (notes.length > NOTES_MAX) throw new Error(`The notes for reviewers are ${notes.length} characters, and AMO takes ${NOTES_MAX}.`);

  const form = new FormData();
  form.set('upload', new Blob([readFileSync(zip)], { type: 'application/zip' }), basename(zip));
  form.set('channel', 'listed');
  let up = await json(await fetch(`${api}/addons/upload/`, { method: 'POST', headers: auth(), body: form }), 'Uploading the zip');
  for (let i = 0; !up.processed; i++) {
    if (i >= pollTries) throw new Error("AMO's validator hadn't finished when this gave up. Run this job again later.");
    await sleep(pollMs);
    up = await json(await fetch(`${api}/addons/upload/${encodeURIComponent(up.uuid)}/`, { headers: auth() }), 'Reading the upload');
  }
  const messages = up.validation?.messages || [];
  if (!up.valid) {
    for (const m of messages.filter((m) => m.type === 'error')) log(`error: ${m.message}${m.file ? ` (${m.file})` : ''}`);
    throw new Error("AMO's validator turned the zip down.");
  }
  if (version && up.version && up.version !== version) throw new Error(`AMO read version ${up.version} from the zip, not ${version}.`);
  log(`Uploaded and validated, with ${messages.filter((m) => m.type === 'warning').length} warning(s).`);

  // The license carries over from the version before. The docs list the reviewer notes
  // among the fields this takes.
  const body = { upload: up.uuid };
  if (notes) body.approval_notes = notes;
  const made = await json(
    await fetch(versionsUrl, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    'Creating the version',
  );
  log(`Submitted ${made.version} as a listed version. AMO says: ${made.file?.status}`);
  if (notes && made.approval_notes !== undefined && made.approval_notes !== notes) log('::warning::AMO did not keep the notes for reviewers as sent. Check them in the Developer Hub.');
  return { version: made.version, status: made.file?.status };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const zip = args.find((a) => !a.startsWith('--'));
  if (!check && !zip) {
    console.error('usage: node tools/publish-firefox.mjs <zip> | --check');
    process.exit(2);
  }
  publishFirefox({ env: process.env, zip, version: process.env.RELEASE_VERSION, check }).catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
