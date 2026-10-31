import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { embeddings, hashes } from '../src/db/schema.js';
import { runAggregate } from '../src/jobs/aggregate.js';
import { flip, openTestDb, reset, seedVotes, token, vectorBase64 } from './helpers.js';

const { db, client } = openTestDb();
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  await reset(db);
  app = await buildApp({ db, logLevel: 'silent' });
});
afterEach(() => app.close());
after(() => client.end());

const P = 'aaaaaaaaaaaaaaaa';
const post = (items: object[], modelVersion: number = 1) =>
  app.inject({ method: 'POST', url: '/v1/embeddings', payload: { hashVersion: 1, modelVersion, items } });
const stored = () => db.select().from(embeddings);

describe('POST /v1/embeddings', () => {
  test('stored at 3 votes on the hash', async () => {
    const [voter] = await seedVotes(db, P, 3);
    const res = await post([{ phash: P, token: voter, vector: vectorBase64() }]);
    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.json(), { accepted: 1 });
    const rows = await stored();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.modelVersion, 1);
    assert.equal(rows[0]?.vector.length, 512);
    assert.deepEqual(rows[0]?.vector, Buffer.alloc(512, 7));
  });

  test('skipped with 2 votes, and the response looks the same', async () => {
    const [voter] = await seedVotes(db, P, 2);
    const res = await post([{ phash: P, token: voter, vector: vectorBase64() }]);
    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.json(), { accepted: 1 });
    assert.equal((await stored()).length, 0);
  });

  test('skipped when the votes only reach 3 across merged hashes', async () => {
    // The gate counts the exact hash, so near-identical copies can't add up to open it.
    const near = flip(P, 1);
    const [onRoot] = await seedVotes(db, P, 2);
    const [onChild] = await seedVotes(db, near, 1);
    await runAggregate(db);
    const merged = await db.select().from(hashes).where(sql`${hashes.canonicalId} is not null`);
    assert.equal(merged.length, 1);
    await post([{ phash: P, token: onRoot, vector: vectorBase64() }]);
    await post([{ phash: near, token: onChild, vector: vectorBase64() }]);
    assert.equal((await stored()).length, 0);
  });

  test('skipped for a token that did not vote', async () => {
    await seedVotes(db, P, 3);
    const res = await post([{ phash: P, token: token(), vector: vectorBase64() }]);
    assert.equal(res.statusCode, 202);
    assert.equal((await stored()).length, 0);
  });

  test('skipped for an unknown hash', async () => {
    const res = await post([{ phash: P, token: token(), vector: vectorBase64() }]);
    assert.equal(res.statusCode, 202);
    assert.equal((await stored()).length, 0);
  });

  test('skipped for a second embedding, on the same hash or elsewhere in the picture', async () => {
    const near = flip(P, 1);
    const [first, second] = await seedVotes(db, P, 3);
    const nearVoters = await seedVotes(db, near, 3);
    await runAggregate(db);
    await post([{ phash: P, token: first, vector: vectorBase64() }]);
    await post([{ phash: P, token: second, vector: Buffer.alloc(512, 9).toString('base64') }]);
    await post([{ phash: near, token: nearVoters[0], vector: vectorBase64() }]);
    const rows = await stored();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.vector, Buffer.alloc(512, 7));
  });

  test('several items in one request are each judged', async () => {
    const other = 'bbbbbbbbbbbbbbbb';
    const [a] = await seedVotes(db, P, 3);
    const [b] = await seedVotes(db, other, 2);
    const res = await post([
      { phash: P, token: a, vector: vectorBase64() },
      { phash: other, token: b, vector: vectorBase64() },
    ]);
    assert.deepEqual(res.json(), { accepted: 2 });
    assert.equal((await stored()).length, 1);
  });

  test('511 bytes and 513 bytes are rejected', async () => {
    const [voter] = await seedVotes(db, P, 3);
    for (const bytes of [511, 513]) {
      const res = await post([{ phash: P, token: voter, vector: vectorBase64(bytes) }]);
      assert.equal(res.statusCode, 400, String(bytes));
    }
    assert.equal((await stored()).length, 0);
  });

  test('bad and non-canonical base64 are rejected', async () => {
    const [voter] = await seedVotes(db, P, 3);
    const good = vectorBase64();
    // The last digit before the padding has two unused bits. Same bytes, different text.
    const unusedBits = `${good.slice(0, -2)}d=`;
    assert.deepEqual(Buffer.from(unusedBits, 'base64'), Buffer.from(good, 'base64'));
    const bad = [
      '!'.repeat(684),
      good.replaceAll('=', ''),
      `${good}\n`,
      good.replaceAll('B', '-'),
      unusedBits,
    ];
    for (const vector of bad) {
      const res = await post([{ phash: P, token: voter, vector }]);
      assert.equal(res.statusCode, 400, vector.slice(-8));
    }
  });

  test('a wrong modelVersion is rejected', async () => {
    const [voter] = await seedVotes(db, P, 3);
    const res = await post([{ phash: P, token: voter, vector: vectorBase64() }], 2);
    assert.equal(res.statusCode, 400);
    assert.equal((await stored()).length, 0);
  });

  test('a full batch fits under the body limit', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      phash: i.toString(16).padStart(16, '0'),
      token: token(),
      vector: vectorBase64(),
    }));
    assert.equal((await post(items)).statusCode, 202);
  });

  test('more than 50 items, and extra fields, are rejected', async () => {
    const item = { phash: P, token: token(), vector: vectorBase64() };
    assert.equal((await post(Array.from({ length: 51 }, () => item))).statusCode, 400);
    assert.equal((await post([{ ...item, url: 'https://example.com/a.jpg' }])).statusCode, 400);
  });
});
