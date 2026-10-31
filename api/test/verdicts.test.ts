import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { VERDICTS_PAGE_SIZE } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { runAggregate } from '../src/jobs/aggregate.js';
import { hexToSigned } from '../src/lib/phash.js';
import { openTestDb, reset, seedVotes } from './helpers.js';

const { db, client } = openTestDb();
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  await reset(db);
  app = await buildApp({ db, logLevel: 'silent' });
});
afterEach(() => app.close());
after(() => client.end());

const get = (query: string) => app.inject({ method: 'GET', url: `/v1/verdicts?${query}` });
const P = '1111111111111111';
const Q = 'eeeeeeeeeeeeeeee'; // far from P, so they stay separate pictures

async function publish(phash: string): Promise<void> {
  await seedVotes(db, phash, 5);
  await runAggregate(db);
}

describe('GET /v1/verdicts', () => {
  test('an empty list', async () => {
    const res = await get('hashVersion=1');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { seq: 0, add: [], remove: [], more: false });
    assert.equal((await get('hashVersion=1&since=7')).json().seq, 7);
  });

  test('add holds published roots, with the right seq', async () => {
    await publish(P);
    assert.deepEqual((await get('hashVersion=1')).json(), { seq: 1, add: [P], remove: [], more: false });
  });

  test('a hash with the top bit set comes back as its hex', async () => {
    const high = 'f123456789abcdef';
    await publish(high);
    assert.deepEqual((await get('hashVersion=1')).json().add, [high]);
  });

  test('pages with more, and the next page continues from the returned seq', async () => {
    const pageSize = VERDICTS_PAGE_SIZE;
    await db.execute(sql`
      with made as (
        insert into hashes (hash_version, phash, checked)
        select 1, n, true from generate_series(1::bigint, ${pageSize + 1}::bigint) n
        returning id, phash
      )
      insert into verdicts (hash_id, status, label, ai_weight, real_weight, vote_count, published, seq)
      select id, 'confirmed', 'ai', 5, 0, 5, true, nextval('verdict_seq') from made order by phash
    `);
    const first = (await get('hashVersion=1')).json();
    assert.equal(first.add.length, pageSize);
    assert.equal(first.seq, pageSize);
    assert.equal(first.more, true);
    const second = (await get(`hashVersion=1&since=${first.seq}`)).json();
    assert.equal(second.add.length, 1);
    assert.equal(second.seq, pageSize + 1);
    assert.equal(second.more, false);
    assert.ok(!first.add.includes(second.add[0]));
  });

  test('a flip shows in remove on a later page, and remove stays empty at since=0', async () => {
    await publish(P);
    await publish(Q);
    const before = (await get('hashVersion=1')).json();
    assert.deepEqual(before.add.sort(), [P, Q]);

    await db.execute(sql`
      update votes set label = 'real'
      where hash_id = (select id from hashes where phash = ${hexToSigned(P)})
    `);
    await runAggregate(db);

    const later = (await get(`hashVersion=1&since=${before.seq}`)).json();
    assert.deepEqual(later, { seq: before.seq + 1, add: [], remove: [P], more: false });

    const fresh = (await get('hashVersion=1')).json();
    assert.deepEqual(fresh.add, [Q]);
    assert.deepEqual(fresh.remove, []);
  });

  test('a real verdict never appears', async () => {
    await seedVotes(db, P, 5, { label: 'real' });
    await runAggregate(db);
    assert.deepEqual((await get('hashVersion=1')).json(), { seq: 0, add: [], remove: [], more: false });
  });

  test('sets Cache-Control and sends no x-ratelimit headers', async () => {
    await publish(P);
    const res = await get('hashVersion=1');
    assert.equal(res.headers['cache-control'], 'public, max-age=3600');
    const named = Object.keys(res.headers).filter((name) => name.startsWith('x-ratelimit'));
    assert.deepEqual(named, []);
  });

  test('a failure after the header is set still sends no Cache-Control', async () => {
    // Serializing a seq that isn't a number fails after the handler has set the header.
    const row = { phash: 1n, published: true, seq: 'not a number' };
    const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: async () => [row] };
    const failing = await buildApp({ db: { select: () => chain } as unknown as Db, logLevel: 'silent' });
    const res = await failing.inject({ method: 'GET', url: '/v1/verdicts?hashVersion=1' });
    assert.equal(res.statusCode, 500);
    assert.equal(res.headers['cache-control'], undefined);
    await failing.close();
  });

  test('a bad query is rejected', async () => {
    for (const query of [
      '',
      'hashVersion=2',
      'hashVersion=abc',
      'hashVersion=1&since=-1',
      'hashVersion=1&since=1.5',
      'hashVersion=1&since=abc',
      'hashVersion=1&url=x',
    ]) {
      assert.equal((await get(query)).statusCode, 400, query);
    }
  });

  test('other hash versions stay out of the list', async () => {
    await publish(P);
    await db.execute(sql`update hashes set hash_version = 2`);
    assert.deepEqual((await get('hashVersion=1')).json().add, []);
  });
});
