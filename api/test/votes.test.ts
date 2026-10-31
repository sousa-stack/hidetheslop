import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/client.js';
import { embeddings, hashes, votes } from '../src/db/schema.js';
import { runAggregate } from '../src/jobs/aggregate.js';
import { hexToSigned } from '../src/lib/phash.js';
import { addHash, flip, openTestDb, reset, seedVotes, token, vote } from './helpers.js';

const { db, client } = openTestDb();
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  await reset(db);
  app = await buildApp({ db, logLevel: 'silent' });
});
afterEach(() => app.close());
after(() => client.end());

const post = (payload: object) => app.inject({ method: 'POST', url: '/v1/votes', payload });
const P = 'aaaaaaaaaaaaaaaa';

describe('POST /v1/votes', () => {
  test('accepts a vote and stores it', async () => {
    const v = vote(P);
    const res = await post({ hashVersion: 1, votes: [v] });
    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.json(), { accepted: 1, needEmbedding: [] });
    const rows = await db.select().from(votes);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.token, v.token);
    assert.equal(rows[0]?.label, 'ai');
    assert.equal(rows[0]?.source, 'rated');
    const [hash] = await db.select().from(hashes);
    assert.equal(hash?.phash, hexToSigned(P));
    assert.equal(hash?.checked, false);
  });

  test('the same token replaces its vote', async () => {
    const t = token();
    await post({ hashVersion: 1, votes: [vote(P, { token: t })] });
    const res = await post({
      hashVersion: 1,
      votes: [vote(P, { token: t, label: 'real', source: 'hid' })],
    });
    assert.equal(res.statusCode, 202);
    const rows = await db.select().from(votes);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.label, 'real');
    assert.equal(rows[0]?.source, 'hid');
  });

  test('the same phash and token twice in one batch keeps the last vote', async () => {
    const t = token();
    const res = await post({
      hashVersion: 1,
      votes: [vote(P, { token: t, label: 'ai' }), vote(P, { token: t, label: 'real' })],
    });
    assert.equal(res.statusCode, 202);
    assert.equal(res.json().accepted, 1);
    const rows = await db.select().from(votes);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.label, 'real');
  });

  test('two tokens for one phash in a batch are rejected, and nothing is stored', async () => {
    const res = await post({ hashVersion: 1, votes: [vote(P), vote(P)] });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: 'invalid_request' });
    assert.equal((await db.select().from(hashes)).length, 0);
  });

  test('takes 50 votes and rejects 51', async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => vote(i.toString(16).padStart(16, '0')));
    assert.equal((await post({ hashVersion: 1, votes: many(50) })).statusCode, 202);
    assert.equal((await post({ hashVersion: 1, votes: many(51) })).statusCode, 400);
  });

  test('an empty batch is rejected', async () => {
    assert.equal((await post({ hashVersion: 1, votes: [] })).statusCode, 400);
  });

  test('bad hex is rejected', async () => {
    for (const phash of ['AAAAAAAAAAAAAAAA', 'zzzzzzzzzzzzzzzz', 'abc', `${P}0`]) {
      assert.equal((await post({ hashVersion: 1, votes: [vote(phash)] })).statusCode, 400, phash);
    }
    for (const t of ['ABCD', '0'.repeat(31), 'g'.repeat(32)]) {
      assert.equal((await post({ hashVersion: 1, votes: [vote(P, { token: t })] })).statusCode, 400, t);
    }
  });

  test('a bad label or source is rejected', async () => {
    assert.equal((await post({ hashVersion: 1, votes: [vote(P, { label: 'slop' })] })).statusCode, 400);
    assert.equal((await post({ hashVersion: 1, votes: [vote(P, { source: 'auto' })] })).statusCode, 400);
  });

  test('hashVersion 2 is rejected', async () => {
    assert.equal((await post({ hashVersion: 2, votes: [vote(P)] })).statusCode, 400);
  });

  test('an extra url or key field is rejected, on a vote and at the top level', async () => {
    for (const extra of [{ url: 'https://example.com/a.jpg' }, { key: 'https://example.com/a' }]) {
      const onVote = await post({ hashVersion: 1, votes: [vote(P, extra)] });
      assert.equal(onVote.statusCode, 400);
      const onTop = await post({ hashVersion: 1, votes: [vote(P)], ...extra });
      assert.equal(onTop.statusCode, 400);
    }
    assert.equal((await db.select().from(votes)).length, 0);
  });

  test('a hash with the top bit set is stored and read back', async () => {
    const high = 'ffffffffffffffff';
    assert.equal((await post({ hashVersion: 1, votes: [vote(high)] })).statusCode, 202);
    await seedVotes(db, high, 2);
    const res = await post({ hashVersion: 1, votes: [vote(high)] });
    assert.deepEqual(res.json().needEmbedding, [high]);
  });

  test('a deadlock racing the aggregate job answers 503, so the client retries', async () => {
    const failing = {
      transaction() {
        throw new DrizzleQueryError('insert', [], Object.assign(new Error('deadlock'), { code: '40P01' }));
      },
    };
    const raced = await buildApp({ db: failing as unknown as Db, logLevel: 'silent' });
    const res = await raced.inject({
      method: 'POST',
      url: '/v1/votes',
      payload: { hashVersion: 1, votes: [vote(P)] },
    });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { error: 'unavailable' });
    await raced.close();
  });
});

describe('the embedding gate', () => {
  const need = async (phash: string) =>
    (await post({ hashVersion: 1, votes: [vote(phash)] })).json().needEmbedding;

  test('needEmbedding is empty at 2 votes and has the hash at 3', async () => {
    assert.deepEqual(await need(P), []);
    assert.deepEqual(await need(P), []);
    assert.deepEqual(await need(P), [P]);
  });

  test('lists only hashes from this request', async () => {
    const elsewhere = '5555555555555555';
    await seedVotes(db, elsewhere, 3);
    assert.deepEqual(await need(P), []);
  });

  test('stays empty for 3 votes spread across merged hashes', async () => {
    const near1 = flip(P, 1);
    const near2 = flip(P, 2);
    await seedVotes(db, P, 1);
    await seedVotes(db, near1, 1);
    await seedVotes(db, near2, 0);
    await runAggregate(db);
    const merged = await db.select().from(hashes).where(sql`${hashes.canonicalId} is not null`);
    assert.equal(merged.length, 2);
    assert.deepEqual(await need(near2), []);
  });

  test('stays empty once any hash in the picture has an embedding', async () => {
    const near = flip(P, 1);
    await seedVotes(db, P, 2);
    await seedVotes(db, near, 2);
    await runAggregate(db);
    const rootId = await addHash(db, P);
    await db.insert(embeddings).values({ hashId: rootId, modelVersion: 1, vector: Buffer.alloc(512) });
    // Three votes on the merged hash, with the embedding on its root.
    assert.deepEqual(await need(near), []);
    const [child] = await db.select().from(hashes).where(eq(hashes.phash, hexToSigned(near)));
    assert.equal(child?.canonicalId, rootId);
  });
});
