import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { BODY_LIMIT_BYTES, VOTES_RATE_LIMIT } from '../src/config.js';
import { openTestDb, reset, token, vote } from './helpers.js';

const { db, client } = openTestDb();

const SECRET_IP = '203.0.113.77';
const SECRET_PHASH = 'c0ffeec0ffeec0ff';
const SECRET_URL = 'https://example.com/private/picture.jpg';

let lines: string[];
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  await reset(db);
  lines = [];
  app = await buildApp({ db, logStream: { write: (line) => void lines.push(line) } });
});
afterEach(() => app.close());
after(() => client.end());

function send(payload: object, ip = SECRET_IP) {
  return app.inject({
    method: 'POST',
    url: '/v1/votes',
    headers: { 'x-forwarded-for': ip },
    payload,
  });
}

function assertClean(log: string): void {
  assert.ok(!log.includes(SECRET_IP), 'the log holds the IP');
  assert.ok(!log.includes(SECRET_PHASH), 'the log holds the phash');
  // Signed form, as Postgres would quote it in a query error.
  assert.ok(!log.includes(BigInt.asIntN(64, BigInt(`0x${SECRET_PHASH}`)).toString()), 'the log holds the signed phash');
  assert.ok(!log.includes(SECRET_URL), 'the log holds the URL');
}

describe('logs', () => {
  test('a 202 logs neither the IP nor the phash', async () => {
    const res = await send({ hashVersion: 1, votes: [vote(SECRET_PHASH)] });
    assert.equal(res.statusCode, 202);
    assertClean(lines.join(''));
  });

  test('a token is never logged', async () => {
    const t = token();
    await send({ hashVersion: 1, votes: [vote(SECRET_PHASH, { token: t })] });
    assert.ok(!lines.join('').includes(t));
  });

  test('a 400 logs and echoes neither', async () => {
    const res = await send({ hashVersion: 1, votes: [vote(SECRET_PHASH, { url: SECRET_URL })] });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: 'invalid_request' });
    assertClean(lines.join(''));
    assertClean(res.body);
  });

  test('a 500 from a real query failure logs only a fixed string, the route and the SQLSTATE', async () => {
    // A real DrizzleQueryError: its message and params hold the phash.
    await db.execute(sql`alter table hashes rename to hashes_hidden`);
    try {
      const res = await send({ hashVersion: 1, votes: [vote(SECRET_PHASH)] });
      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.json(), { error: 'internal' });
      assertClean(res.body);
    } finally {
      await db.execute(sql`alter table hashes_hidden rename to hashes`);
    }
    const log = lines.join('');
    assertClean(log);
    const entries = lines.map((line) => JSON.parse(line)).filter((entry) => entry.msg === 'request failed');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].route, '/v1/votes');
    assert.equal(entries[0].code, '42P01');
    assert.equal(entries[0].err, undefined);
  });

  test('a 404 logs and echoes neither the URL nor the IP', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/lookup/${SECRET_PHASH}?u=${encodeURIComponent(SECRET_URL)}`,
      headers: { 'x-forwarded-for': SECRET_IP },
    });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: 'not_found' });
    assertClean(lines.join(''));
    assertClean(res.body);
  });

  test('a body too large is refused without echoing it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/votes',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': SECRET_IP },
      payload: `{"hashVersion":1,"pad":"${SECRET_PHASH}${'x'.repeat(70_000)}"}`,
    });
    assert.equal(res.statusCode, 413);
    assert.deepEqual(res.json(), { error: 'too_large' });
    assertClean(lines.join(''));
  });

  test('the body limit is 64,000 bytes, the same as Caddy', async () => {
    const sized = (bytes: number) => {
      const shell = '{"hashVersion":1,"pad":""}';
      return `{"hashVersion":1,"pad":"${'x'.repeat(bytes - shell.length)}"}`;
    };
    const post = (payload: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/votes',
        headers: { 'content-type': 'application/json' },
        payload,
      });
    assert.equal(BODY_LIMIT_BYTES, 64_000);
    assert.equal((await post(sized(BODY_LIMIT_BYTES))).statusCode, 400); // parsed, then refused
    assert.equal((await post(sized(BODY_LIMIT_BYTES + 1))).statusCode, 413);
  });

  test('a bad JSON body is not echoed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/votes',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': SECRET_IP },
      payload: `{"phash":"${SECRET_PHASH}"`,
    });
    assert.equal(res.statusCode, 400);
    assertClean(lines.join(''));
    assertClean(res.body);
  });
});

describe('rate limiting', () => {
  const invalid = { hashVersion: 1, votes: [] };

  test('separates two clients by X-Forwarded-For', async () => {
    const limit = VOTES_RATE_LIMIT.max;
    for (let i = 0; i < limit; i++) {
      assert.equal((await send(invalid, '198.51.100.1')).statusCode, 400);
    }
    const over = await send(invalid, '198.51.100.1');
    assert.equal(over.statusCode, 429);
    assert.deepEqual(over.json(), { error: 'rate_limited' });
    assert.equal((await send(invalid, '198.51.100.2')).statusCode, 400);
  });

  test('trusts only the last hop, so a client can not choose its own address', async () => {
    const limit = VOTES_RATE_LIMIT.max;
    for (let i = 0; i < limit; i++) {
      await send(invalid, `10.0.0.${i % 250}, 198.51.100.3`);
    }
    const over = await send(invalid, '10.0.0.1, 198.51.100.3');
    assert.equal(over.statusCode, 429);
  });

  test('votes and embeddings each have their own limit', async () => {
    const limit = VOTES_RATE_LIMIT.max;
    for (let i = 0; i < limit; i++) await send(invalid, '198.51.100.4');
    assert.equal((await send(invalid, '198.51.100.4')).statusCode, 429);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: { 'x-forwarded-for': '198.51.100.4' },
      payload: { hashVersion: 1, modelVersion: 1, items: [] },
    });
    assert.equal(res.statusCode, 400);
  });

  test('/health is exempt', async () => {
    for (let i = 0; i < 200; i++) {
      assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
    }
  });
});
