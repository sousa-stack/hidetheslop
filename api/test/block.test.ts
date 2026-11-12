import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { buildApp } from '../src/app.js';
import { parse, run, USAGE, type Io } from '../src/block.js';
import { BLOCK_MAX_BITS } from '../src/config.js';
import { blockedHashes, hashes, verdicts, votes } from '../src/db/schema.js';
import { AGGREGATE_LOCK_KEY, runAggregate } from '../src/jobs/aggregate.js';
import { hexToSigned } from '../src/lib/phash.js';
import { flip, flipBits, openTestDb, reset, seedVotes, testDatabaseUrl } from './helpers.js';

const { db, client } = openTestDb();
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  await reset(db);
  app = await buildApp({ db, logLevel: 'silent' });
});
afterEach(() => app.close());
after(() => client.end());

const A = '0000000000000000';
const B = '00000000ffffffff'; // far from A, so a separate picture
const FAST = { tries: 3, waitMs: 20 };

function capture(): Io & { lines: string[] } {
  const lines: string[] = [];
  return { lines, out: (line) => void lines.push(line), err: (line) => void lines.push(`! ${line}`) };
}

async function cli(args: string[], retry = FAST) {
  const io = capture();
  const code = await run(args, { db, io, minVotes: 5, retry });
  return { code, lines: io.lines };
}

async function verdictOf(phash: string) {
  const [row] = await db
    .select({ verdict: verdicts })
    .from(verdicts)
    .innerJoin(hashes, eq(verdicts.hashId, hashes.id))
    .where(eq(hashes.phash, hexToSigned(phash)));
  return row?.verdict;
}

const list = async (since: number) =>
  (await app.inject({ method: 'GET', url: `/v1/verdicts?hashVersion=1&since=${since}` })).json();

async function publish(phash: string): Promise<void> {
  await seedVotes(db, phash, 5);
  await runAggregate(db);
}

describe('blocking', () => {
  test('a published picture is unpublished, takes a new seq, and goes out in remove', async () => {
    await publish(A);
    assert.equal((await verdictOf(A))?.seq, 1);
    const { code, lines } = await cli(['block', A]);
    assert.equal(code, 0);
    assert.deepEqual(lines, ['blocked', 'the job ran: 1 picture taken off the list, and /v1/verdicts sends the remove now']);
    const v = await verdictOf(A);
    assert.equal(v?.published, false);
    assert.equal(v?.seq, 2);
    // What the crowd said is still there to see.
    assert.equal(v?.status, 'confirmed');
    assert.equal(v?.label, 'ai');
    assert.equal(v?.voteCount, 5);
    assert.deepEqual(await list(1), { seq: 2, add: [], remove: [A], more: false });
    assert.deepEqual(await list(0), { seq: 2, add: [], remove: [], more: false });
  });

  test('reaches a hash merged into the picture, not just the root', async () => {
    const child = flip(A, 3);
    await seedVotes(db, A, 3);
    await seedVotes(db, child, 2);
    await runAggregate(db);
    assert.equal((await verdictOf(A))?.published, true);
    // 6 bits from the child and 9 from the root.
    const nearChild = flipBits(child, [3, 4, 5, 6, 7, 8]);
    await cli(['block', nearChild]);
    assert.equal((await verdictOf(A))?.published, false);
  });

  test(`a copy exactly ${BLOCK_MAX_BITS} bits away, with flips in all four bands, is blocked`, async () => {
    await publish(A);
    // 2 + 2 + 1 + 1: no band is shared, which is why the job scans instead of using bands.
    const copy = flipBits(A, [48, 49, 32, 33, 16, 0]);
    await cli(['block', copy]);
    assert.equal((await verdictOf(A))?.published, false);
  });

  test('7 bits away, also spread over all four bands, is not blocked', async () => {
    await publish(A);
    const other = flipBits(A, [48, 49, 32, 33, 16, 0, 1]);
    const { lines } = await cli(['block', other]);
    assert.deepEqual(lines, ['blocked', `the job ran: nothing within ${BLOCK_MAX_BITS} bits was on the list`]);
    const v = await verdictOf(A);
    assert.equal(v?.published, true);
    assert.equal(v?.seq, 1);
  });

  test('a block before any votes holds when the votes arrive', async () => {
    await cli(['block', A, '--note', 'reported before anyone voted']);
    await publish(A);
    const v = await verdictOf(A);
    assert.equal(v?.status, 'confirmed');
    assert.equal(v?.label, 'ai');
    assert.equal(v?.published, false);
    assert.equal(v?.seq, null);
    assert.deepEqual(await list(0), { seq: 0, add: [], remove: [], more: false });
  });

  test('blocking twice keeps one row', async () => {
    await cli(['block', A]);
    const { code, lines } = await cli(['block', A, '--note', 'again']);
    assert.equal(code, 0);
    assert.equal(lines[0], 'already blocked');
    const rows = await db.select().from(blockedHashes);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.note, null);
  });

  test('other pictures are untouched', async () => {
    await publish(A);
    await publish(B);
    await cli(['block', A]);
    assert.equal((await verdictOf(B))?.published, true);
    assert.equal((await verdictOf(B))?.seq, 2);
  });
});

describe('unblocking', () => {
  test('republishes only the pictures whose votes still say ai', async () => {
    await publish(A);
    await publish(B);
    await cli(['block', A]);
    await cli(['block', B]);
    const [bId] = await db.select({ id: hashes.id }).from(hashes).where(eq(hashes.phash, hexToSigned(B)));
    assert.ok(bId);
    await db.update(votes).set({ label: 'real' }).where(eq(votes.hashId, bId.id));
    const seqBefore = (await verdictOf(B))?.seq;

    assert.deepEqual((await cli(['unblock', A])).lines, [
      'unblocked',
      'the job ran: 1 picture back on the list, and /v1/verdicts sends the add now',
    ]);
    assert.deepEqual((await cli(['unblock', B])).lines, ['unblocked', 'the job ran: nothing went back on the list']);

    const a = await verdictOf(A);
    assert.equal(a?.published, true);
    assert.equal(a?.seq, 5);
    const b = await verdictOf(B);
    assert.equal(b?.published, false);
    assert.equal(b?.label, 'real');
    assert.equal(b?.seq, seqBefore);
    assert.deepEqual(await list(4), { seq: 5, add: [A], remove: [], more: false });
    assert.equal((await db.select().from(blockedHashes)).length, 0);
  });

  test("a hash that wasn't blocked says so", async () => {
    assert.deepEqual((await cli(['unblock', A])).lines, ["that hash wasn't blocked", 'the job ran: nothing went back on the list']);
  });
});

describe('the aggregate lock', () => {
  test("while another run holds it, the block is saved and the CLI doesn't claim a remove", async () => {
    await publish(A);
    const other = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      await other`select pg_advisory_lock(${AGGREGATE_LOCK_KEY}::bigint)`;
      const { code, lines } = await cli(['block', A]);
      assert.equal(code, 0);
      assert.deepEqual(lines, ['blocked', 'saved; it takes effect at the next run']);
      assert.equal((await verdictOf(A))?.published, true);
    } finally {
      await other.end();
    }
    await runAggregate(db);
    assert.equal((await verdictOf(A))?.published, false);
  });

  test('it retries, and goes through once the other run lets go', async () => {
    await publish(A);
    const other = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      await other`select pg_advisory_lock(${AGGREGATE_LOCK_KEY}::bigint)`;
      const pending = cli(['block', A], { tries: 50, waitMs: 20 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal((await verdictOf(A))?.published, true);
      await other`select pg_advisory_unlock(${AGGREGATE_LOCK_KEY}::bigint)`;
      const { lines } = await pending;
      assert.equal(lines[1], 'the job ran: 1 picture taken off the list, and /v1/verdicts sends the remove now');
    } finally {
      await other.end();
    }
    assert.equal((await verdictOf(A))?.published, false);
  });
});

describe('list', () => {
  test('says when nothing is blocked', async () => {
    assert.deepEqual((await cli(['list'])).lines, ['nothing blocked']);
  });

  test('shows each block in hash order, what it holds back and the nearest published picture', async () => {
    await publish(A);
    const far = 'ffffffff00000000'.replace(/^f/, '7'); // 31 bits from A, top bit 0
    await publish(B);
    await cli(['block', B, '--note', 'forged, reported by email']);
    await cli(['block', far]);
    assert.deepEqual((await cli(['list'])).lines, [
      '00000000ffffffff  holds back 1 picture, nearest published 32 bits away  "forged, reported by email"',
      '7fffffff00000000  holds back 0 pictures, nearest published 31 bits away',
    ]);
  });
});

describe('what the CLI accepts', () => {
  const NOT_ECHOED = 'c0ffeec0ffeec0f'; // part of every bad value below

  test('a hash must be 16 lowercase hex digits with the top bit 0', () => {
    for (const bad of [`${NOT_ECHOED}F`, `${NOT_ECHOED}`, `${NOT_ECHOED}00`, `8${NOT_ECHOED}`, `f${NOT_ECHOED}`, `${NOT_ECHOED}g`, ` 0${NOT_ECHOED}`]) {
      const result = parse(['block', bad]);
      assert.equal(typeof result, 'string', bad);
      assert.ok(!String(result).includes(NOT_ECHOED));
    }
    assert.equal(typeof parse(['block', `7${NOT_ECHOED}`]), 'object');
    assert.equal(typeof parse(['unblock', `0${NOT_ECHOED}`]), 'object');
  });

  test('a note is at most 80 characters, and never holds an address', () => {
    const hash = `0${NOT_ECHOED}`;
    assert.equal(typeof parse(['block', hash, '--note', 'x'.repeat(80)]), 'object');
    for (const note of [
      'x'.repeat(81),
      `https://facebook.com/${NOT_ECHOED}`,
      `see facebook.com/${NOT_ECHOED}?ref=http`,
      `ftp://${NOT_ECHOED}`,
      `HTTP ${NOT_ECHOED}`,
      `two\nlines ${NOT_ECHOED}`,
    ]) {
      const result = parse(['block', hash, '--note', note]);
      assert.equal(typeof result, 'string', note);
      assert.ok(!String(result).includes(NOT_ECHOED) && !String(result).includes('facebook'));
    }
  });

  test('anything else is the usage line', () => {
    const hash = `0${NOT_ECHOED}`;
    for (const args of [[], ['blok', hash], ['list', hash], ['block'], ['block', hash, '--nite', 'x'], ['block', hash, '--note'], ['unblock', hash, '--note', 'x'], ['block', hash, '--note', 'x', 'y']]) {
      assert.equal(parse(args), USAGE, args.join(' '));
    }
  });
});

// The real process, as Kevin runs it: it exits by itself, and nothing it was given comes
// back out, whether it's accepted, refused or the database fails.
describe('the command itself', () => {
  const SECRET_HASH = '0c0ffeec0ffeec0f';
  const SECRET_NOTE = 'reported by someone at https://example.com/private';
  const script = fileURLToPath(new URL('../src/block.ts', import.meta.url));

  function exec(args: string[], databaseUrl = testDatabaseUrl()) {
    return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
        env: { PATH: process.env.PATH ?? '', DATABASE_URL: databaseUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('the command did not exit'));
      }, 30_000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
    });
  }

  function assertClean(output: string): void {
    const signed = BigInt.asIntN(64, BigInt(`0x${SECRET_HASH}`)).toString();
    for (const secret of [SECRET_HASH, signed, 'example.com', 'reported by someone']) {
      assert.ok(!output.includes(secret), `the output holds ${secret}`);
    }
  }

  test('block and unblock exit on their own and print no value', async () => {
    await publish(SECRET_HASH);
    const blocked = await exec(['block', SECRET_HASH, '--note', 'from an email']);
    assert.equal(blocked.code, 0, blocked.output);
    assert.equal(
      blocked.output,
      'blocked\nthe job ran: 1 picture taken off the list, and /v1/verdicts sends the remove now\n',
    );
    const unblocked = await exec(['unblock', SECRET_HASH]);
    assert.equal(unblocked.code, 0, unblocked.output);
    assertClean(blocked.output + unblocked.output);
  });

  test('a refused note or hash is not echoed', async () => {
    const note = await exec(['block', SECRET_HASH, '--note', SECRET_NOTE]);
    assert.equal(note.code, 2);
    assertClean(note.output);
    const hash = await exec(['block', `${SECRET_HASH.slice(1)}X`]);
    assert.equal(hash.code, 2);
    assert.ok(!hash.output.includes(SECRET_HASH.slice(1)));
    assert.equal((await db.select().from(blockedHashes)).length, 0);
  });

  test('a database failure prints only its SQLSTATE', async () => {
    await db.execute(sql`alter table blocked_hashes rename to blocked_hidden`);
    try {
      const failed = await exec(['block', SECRET_HASH, '--note', 'from an email']);
      assert.equal(failed.code, 1);
      assert.equal(failed.output, 'failed: 42P01\n');
      assertClean(failed.output);
    } finally {
      await db.execute(sql`alter table blocked_hidden rename to blocked_hashes`);
    }
  });

  test('a database it cannot reach prints no address or password', async () => {
    const failed = await exec(['list'], 'postgres://someone:hunter2secret@127.0.0.1:1/nowhere_test');
    assert.equal(failed.code, 1);
    assert.ok(!failed.output.includes('hunter2secret') && !failed.output.includes('someone'), failed.output);
  });
});
