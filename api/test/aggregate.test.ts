import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { hashes, verdicts, votes } from '../src/db/schema.js';
import { AGGREGATE_LOCK_KEY, runAggregate, updateVerdicts } from '../src/jobs/aggregate.js';
import { hexToSigned } from '../src/lib/phash.js';
import { addHash, flip, openTestDb, reset, seedVotes, testDatabaseUrl } from './helpers.js';

const { db, client } = openTestDb();

beforeEach(() => reset(db));
after(() => client.end());

const A = '0000000000000000';
// Far from A and from each other, so they stay separate pictures.
const B = '00000000ffffffff';
const C = 'ffffffff00000000';
const D = 'ffffffffffffffff';

async function hashRow(phash: string) {
  const [row] = await db.select().from(hashes).where(eq(hashes.phash, hexToSigned(phash)));
  assert.ok(row, `no hash ${phash}`);
  return row;
}

async function verdictOf(phash: string) {
  const [row] = await db
    .select({ verdict: verdicts })
    .from(verdicts)
    .innerJoin(hashes, eq(verdicts.hashId, hashes.id))
    .where(eq(hashes.phash, hexToSigned(phash)));
  return row?.verdict;
}

describe('verdicts', () => {
  test('4 votes stay pending, 5 confirm', async () => {
    await seedVotes(db, A, 4);
    await runAggregate(db);
    assert.equal((await verdictOf(A))?.status, 'pending');
    assert.equal((await verdictOf(A))?.label, null);
    assert.equal((await verdictOf(A))?.published, false);
    assert.equal((await verdictOf(A))?.seq, null);

    await seedVotes(db, A, 1);
    await runAggregate(db);
    const v = await verdictOf(A);
    assert.equal(v?.status, 'confirmed');
    assert.equal(v?.label, 'ai');
    assert.equal(v?.published, true);
    assert.equal(v?.voteCount, 5);
    assert.equal(v?.seq, 1);
  });

  test('exactly 80% confirms, for both labels', async () => {
    await seedVotes(db, A, 4, { label: 'ai' });
    await seedVotes(db, A, 1, { label: 'real' });
    await seedVotes(db, B, 4, { label: 'real' });
    await seedVotes(db, B, 1, { label: 'ai' });
    await runAggregate(db);
    assert.equal((await verdictOf(A))?.status, 'confirmed');
    assert.equal((await verdictOf(A))?.label, 'ai');
    assert.equal((await verdictOf(B))?.status, 'confirmed');
    assert.equal((await verdictOf(B))?.label, 'real');
  });

  test('just under 80% is disputed', async () => {
    await seedVotes(db, A, 7, { label: 'ai' });
    await seedVotes(db, A, 2, { label: 'real' }); // 77.8%
    await seedVotes(db, B, 7, { label: 'real' });
    await seedVotes(db, B, 2, { label: 'ai' });
    await runAggregate(db);
    for (const phash of [A, B]) {
      const v = await verdictOf(phash);
      assert.equal(v?.status, 'disputed');
      assert.equal(v?.label, null);
      assert.equal(v?.published, false);
    }
  });

  test('an even split is disputed', async () => {
    await seedVotes(db, A, 3, { label: 'ai' });
    await seedVotes(db, A, 3, { label: 'real' });
    await runAggregate(db);
    assert.equal((await verdictOf(A))?.status, 'disputed');
  });

  test('hid votes weigh 0.5, and still count as votes', async () => {
    await seedVotes(db, A, 4, { label: 'ai', source: 'hid' });
    await seedVotes(db, A, 1, { label: 'real', source: 'hid' });
    await runAggregate(db);
    const v = await verdictOf(A);
    assert.equal(v?.aiWeight, 2);
    assert.equal(v?.realWeight, 0.5);
    assert.equal(v?.voteCount, 5);
    assert.equal(v?.status, 'confirmed');
  });

  test('the weight decides, not the count: 4 rated ai against 2 hid real confirms', async () => {
    await seedVotes(db, A, 4, { label: 'ai', source: 'rated' });
    await seedVotes(db, A, 2, { label: 'real', source: 'hid' });
    await runAggregate(db);
    const v = await verdictOf(A);
    assert.equal(v?.aiWeight, 4);
    assert.equal(v?.realWeight, 1);
    assert.equal(v?.status, 'confirmed'); // 67% by count, 80% by weight
  });

  test('real confirmed is not published and takes no seq', async () => {
    await seedVotes(db, A, 5, { label: 'real' });
    await runAggregate(db);
    const v = await verdictOf(A);
    assert.equal(v?.status, 'confirmed');
    assert.equal(v?.label, 'real');
    assert.equal(v?.published, false);
    assert.equal(v?.seq, null);
  });

  test('a vote flip unpublishes and bumps seq', async () => {
    await seedVotes(db, A, 5);
    await runAggregate(db);
    assert.equal((await verdictOf(A))?.seq, 1);
    await db.update(votes).set({ label: 'real' });
    await runAggregate(db);
    const v = await verdictOf(A);
    assert.equal(v?.published, false);
    assert.equal(v?.seq, 2);
    assert.equal(v?.status, 'confirmed');
    assert.equal(v?.label, 'real');
  });

  test('a second run changes nothing, including seq', async () => {
    await seedVotes(db, A, 5);
    await seedVotes(db, B, 5, { label: 'real' });
    await seedVotes(db, C, 2);
    await runAggregate(db);
    const snapshot = await db.select().from(verdicts).orderBy(verdicts.hashId);
    const before = await db.execute(sql`select xmin::text as xmin, hash_id from verdicts order by hash_id`);
    await runAggregate(db);
    assert.deepEqual(await db.select().from(verdicts).orderBy(verdicts.hashId), snapshot);
    // Not even a rewrite of the same values, and no sequence number used up.
    const afterRun = await db.execute(sql`select xmin::text as xmin, hash_id from verdicts order by hash_id`);
    assert.deepEqual([...afterRun], [...before]);
    await seedVotes(db, D, 5);
    await runAggregate(db);
    assert.equal((await verdictOf(D))?.seq, 2);
  });
});

describe('merging near-duplicates', () => {
  test('merges within 3 bits, and counts votes across the picture', async () => {
    const near = flip(A, 3);
    await seedVotes(db, A, 3);
    await seedVotes(db, near, 2);
    await runAggregate(db);
    const child = await hashRow(near);
    assert.equal(child.canonicalId, (await hashRow(A)).id);
    assert.equal(child.checked, true);
    assert.equal(await verdictOf(near), undefined);
    assert.equal((await verdictOf(A))?.voteCount, 5);
    assert.equal((await verdictOf(A))?.status, 'confirmed');
  });

  test('does not merge at 4 bits', async () => {
    const far = flip(A, 4);
    await seedVotes(db, A, 1);
    await seedVotes(db, far, 1);
    await runAggregate(db);
    assert.equal((await hashRow(far)).canonicalId, null);
    assert.equal((await hashRow(far)).checked, true);
    assert.ok(await verdictOf(far));
  });

  test('merges across a run, into an existing root', async () => {
    await seedVotes(db, A, 1);
    await runAggregate(db);
    const near = flip(A, 1);
    await seedVotes(db, near, 1);
    await runAggregate(db);
    assert.equal((await hashRow(near)).canonicalId, (await hashRow(A)).id);
  });

  test('hashes with the top bit set merge too', async () => {
    const near = flip(D, 2);
    await seedVotes(db, D, 1);
    await seedVotes(db, near, 1);
    await runAggregate(db);
    const rows = await db.select().from(hashes).where(sql`${hashes.canonicalId} is not null`);
    assert.equal(rows.length, 1);
  });

  test('different hash versions never merge', async () => {
    const near = flip(A, 1);
    await seedVotes(db, A, 1);
    await seedVotes(db, near, 1);
    await db.update(hashes).set({ hashVersion: 2 }).where(eq(hashes.phash, hexToSigned(near)));
    await runAggregate(db);
    assert.equal((await hashRow(near)).canonicalId, null);
  });

  test('no chaining: A~B~C keeps C separate when C is 4 or more bits from A', async () => {
    const middle = '0000000000000007'; // 3 bits from A
    const end = '000000000000003f'; // 3 bits from the middle, 6 from A
    await seedVotes(db, A, 1);
    await seedVotes(db, middle, 1);
    await seedVotes(db, end, 1);
    await runAggregate(db);
    assert.equal((await hashRow(middle)).canonicalId, (await hashRow(A)).id);
    assert.equal((await hashRow(end)).canonicalId, null);
  });

  test('joins the oldest root when two are in range', async () => {
    const older = '0000000000000f00';
    const newer = '0000000000000000';
    await seedVotes(db, older, 1, { ageDays: 10 });
    await seedVotes(db, newer, 1, { ageDays: 5 }); // 4 bits from older: its own root
    await runAggregate(db);
    const between = '0000000000000300'; // 2 bits from each
    await seedVotes(db, between, 1);
    await runAggregate(db);
    assert.equal((await hashRow(between)).canonicalId, (await hashRow(older)).id);
  });
});

describe('the run itself', () => {
  test('returns early when another run holds the lock, and changes nothing', async () => {
    await seedVotes(db, A, 5);
    const other = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      await other`select pg_advisory_lock(${AGGREGATE_LOCK_KEY}::bigint)`;
      assert.equal(await runAggregate(db), false);
      assert.equal((await hashRow(A)).checked, false);
      assert.equal(await verdictOf(A), undefined);
    } finally {
      await other.end();
    }
    assert.equal(await runAggregate(db), true);
    assert.ok(await verdictOf(A));
  });

  test('an unchecked hash with 5 votes gets no verdict row', async () => {
    // Stands in for a hash committed after the merge step of a run.
    await seedVotes(db, A, 5);
    await updateVerdicts(db);
    assert.equal(await verdictOf(A), undefined);
  });
});

describe('expiry', () => {
  test('a lone hash expires at 91 days and not at 89', async () => {
    await seedVotes(db, A, 2, { ageDays: 91 });
    await seedVotes(db, B, 2, { ageDays: 89 });
    await runAggregate(db);
    assert.equal((await db.select().from(hashes).where(eq(hashes.phash, 0n))).length, 0);
    assert.equal((await db.select().from(votes)).length, 2);
    assert.ok(await verdictOf(B));
  });

  test('a lone hash survives at exactly 90 days', async () => {
    await seedVotes(db, A, 2, { ageDays: 90 });
    await runAggregate(db);
    assert.ok(await verdictOf(A));
  });

  test('a confirmed picture does not expire', async () => {
    await seedVotes(db, A, 5, { ageDays: 400 });
    await runAggregate(db);
    assert.equal((await verdictOf(A))?.status, 'confirmed');
  });

  test('votes across the picture count: 3 on a root and 2 on a child keep both', async () => {
    const near = flip(A, 1);
    await seedVotes(db, A, 3, { ageDays: 100 });
    await seedVotes(db, near, 2, { ageDays: 100 });
    await runAggregate(db);
    assert.equal((await db.select().from(hashes)).length, 2);
  });

  test('a child goes with its root, along with votes and the verdict', async () => {
    const near = flip(A, 1);
    await seedVotes(db, A, 1, { ageDays: 100 });
    await seedVotes(db, near, 1);
    await runAggregate(db);
    assert.equal((await db.select().from(hashes)).length, 0);
    assert.equal((await db.select().from(votes)).length, 0);
    assert.equal((await db.select().from(verdicts)).length, 0);
  });

  test('a young child does not save an old root under the threshold', async () => {
    const near = flip(A, 1);
    await seedVotes(db, A, 2, { ageDays: 91 });
    await seedVotes(db, near, 2);
    await runAggregate(db);
    assert.equal((await db.select().from(hashes)).length, 0);
  });

  test('an old hash with no votes at all is checked, then expired in the same run', async () => {
    const id = await addHash(db, A, 100);
    await runAggregate(db);
    assert.equal((await db.select().from(hashes).where(eq(hashes.id, id))).length, 0);
  });
});
