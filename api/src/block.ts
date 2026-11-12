// Takes a picture off the crowd's list, or puts it back, by its hash. Run on the droplet:
//
//   docker compose exec -T api node dist/block.js block <phash> [--note "..."]
//   docker compose exec -T api node dist/block.js unblock <phash>
//   docker compose exec -T api node dist/block.js list
//
// A command rather than an admin route, so there's no secret to leak or guess. It goes
// through the same Drizzle code and aggregate job as the server, and imports nothing that
// starts the server or its timers. Errors never repeat an argument: whatever was typed
// stays in the shell's history and nowhere else.
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { BLOCK_MAX_BITS } from './config.js';
import { createDb, failureCode, type Db } from './db/client.js';
import { blockedHashes } from './db/schema.js';
import { loadEnv } from './env.js';
import { runAggregate } from './jobs/aggregate.js';
import { hexToSigned, signedToHex } from './lib/phash.js';

const HASH_VERSION = 1;
// The extension's hash always has its top bit 0, so anything else is a typo.
const PHASH = /^[0-7][0-9a-f]{15}$/;
const NOTE_MAX = 80;

export const USAGE = 'usage: node dist/block.js block <phash> [--note "..."] | unblock <phash> | list';

// About a minute, which outlasts an hourly run holding the lock.
export const RETRY = { tries: 30, waitMs: 2000 };

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

export interface Options {
  db: Db;
  io: Io;
  minVotes: number;
  retry?: { tries: number; waitMs: number };
}

type Command =
  | { kind: 'block'; phash: bigint; note: string | null }
  | { kind: 'unblock'; phash: bigint }
  | { kind: 'list' };

// Returns the command, or a message that says what's wrong without repeating it.
export function parse(args: readonly string[]): Command | string {
  const [command, phash, flag, note, ...extra] = args;
  if (command === 'list') return args.length === 1 ? { kind: 'list' } : USAGE;
  if (command !== 'block' && command !== 'unblock') return USAGE;
  if (phash === undefined || extra.length > 0) return USAGE;
  if (!PHASH.test(phash)) return 'the hash must be 16 lowercase hex digits, starting with 0 to 7';
  if (command === 'unblock') return flag === undefined ? { kind: 'unblock', phash: hexToSigned(phash) } : USAGE;
  if (flag === undefined) return { kind: 'block', phash: hexToSigned(phash), note: null };
  if (flag !== '--note' || note === undefined) return USAGE;
  if (note.length > NOTE_MAX) return `the note can be at most ${NOTE_MAX} characters`;
  // The server never stores an address, so a note can't hold one either.
  if (/:\/\/|http/i.test(note)) return "the note can't hold a web address";
  if (/[\u0000-\u001f\u007f]/.test(note)) return "the note can't hold a line break or control character";
  return { kind: 'block', phash: hexToSigned(phash), note: note || null };
}

// A run that started before the block was committed can't see it, and false means the
// hourly run holds the lock, so this waits for that run to finish and goes again.
export async function aggregateSoon(db: Db, minVotes: number, retry = RETRY): Promise<boolean> {
  for (let i = 0; i < retry.tries; i++) {
    if (i > 0) await sleep(retry.waitMs);
    if (await runAggregate(db, minVotes)) return true;
  }
  return false;
}

// Published pictures with the root or a merged hash within BLOCK_MAX_BITS of `phash`.
async function publishedNear(db: Db, phash: bigint): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    select count(distinct v.hash_id)::integer as n
    from verdicts v
    join hashes member on member.id = v.hash_id or member.canonical_id = v.hash_id
    where v.published
      and member.hash_version = ${HASH_VERSION}
      and bit_count((member.phash # ${phash}::bigint)::bit(64)) <= ${BLOCK_MAX_BITS}
  `);
  return row?.n ?? 0;
}

const pictures = (n: number): string => `${n} ${n === 1 ? 'picture' : 'pictures'}`;

async function block(db: Db, io: Io, phash: bigint, note: string | null, minVotes: number, retry = RETRY) {
  const added = await db
    .insert(blockedHashes)
    .values({ hashVersion: HASH_VERSION, phash, note })
    .onConflictDoNothing()
    .returning({ id: blockedHashes.id });
  io.out(added.length ? 'blocked' : 'already blocked');
  const before = await publishedNear(db, phash);
  if (!(await aggregateSoon(db, minVotes, retry))) {
    io.out('saved; it takes effect at the next run');
    return;
  }
  const taken = before - (await publishedNear(db, phash));
  io.out(
    taken > 0
      ? `the job ran: ${pictures(taken)} taken off the list, and /v1/verdicts sends the remove now`
      : `the job ran: nothing within ${BLOCK_MAX_BITS} bits was on the list`,
  );
}

async function unblock(db: Db, io: Io, phash: bigint, minVotes: number, retry = RETRY) {
  const removed = await db
    .delete(blockedHashes)
    .where(and(eq(blockedHashes.hashVersion, HASH_VERSION), eq(blockedHashes.phash, phash)))
    .returning({ id: blockedHashes.id });
  io.out(removed.length ? 'unblocked' : "that hash wasn't blocked");
  const before = await publishedNear(db, phash);
  if (!(await aggregateSoon(db, minVotes, retry))) {
    io.out('saved; it takes effect at the next run');
    return;
  }
  const back = (await publishedNear(db, phash)) - before;
  io.out(
    back > 0
      ? `the job ran: ${pictures(back)} back on the list, and /v1/verdicts sends the add now`
      : 'the job ran: nothing went back on the list',
  );
}

// In hash order, which says nothing about when each was blocked. `holds back` counts the
// pictures the votes would publish without this block. Plain SQL with aliases, because
// Drizzle leaves an outer column unqualified inside a subquery, where it would name the
// inner table's column instead.
async function list(db: Db, io: Io) {
  const rows = await db.execute<{ phash: string; note: string | null; holds: number; nearest: number | null }>(sql`
    select b.phash::text as phash, b.note,
           (select count(distinct v.hash_id)::integer
            from verdicts v
            join hashes m on m.id = v.hash_id or m.canonical_id = v.hash_id
            where v.status = 'confirmed' and v.label = 'ai'
              and m.hash_version = b.hash_version
              and bit_count((m.phash # b.phash)::bit(64)) <= ${BLOCK_MAX_BITS}) as holds,
           (select min(bit_count((m.phash # b.phash)::bit(64)))::integer
            from verdicts v
            join hashes m on m.id = v.hash_id or m.canonical_id = v.hash_id
            where v.published and m.hash_version = b.hash_version) as nearest
    from blocked_hashes b
    where b.hash_version = ${HASH_VERSION}
    order by b.phash
  `);
  if (!rows.length) {
    io.out('nothing blocked');
    return;
  }
  for (const row of rows) {
    const nearest = row.nearest === null ? 'nothing published' : `nearest published ${row.nearest} bits away`;
    const note = row.note ? `  "${row.note}"` : '';
    io.out(`${signedToHex(BigInt(row.phash))}  holds back ${pictures(row.holds)}, ${nearest}${note}`);
  }
}

// Returns the exit code: 0 done, 1 failed, 2 not understood.
export async function run(args: readonly string[], { db, io, minVotes, retry = RETRY }: Options): Promise<number> {
  const command = parse(args);
  if (typeof command === 'string') {
    io.err(command);
    return 2;
  }
  try {
    if (command.kind === 'block') await block(db, io, command.phash, command.note, minVotes, retry);
    else if (command.kind === 'unblock') await unblock(db, io, command.phash, minVotes, retry);
    else await list(db, io);
    return 0;
  } catch (err) {
    // Drizzle puts the query's values in the message, so only the SQLSTATE.
    io.err(`failed: ${failureCode(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const io: Io = { out: (line) => console.log(line), err: (line) => console.error(line) };
  const parsed = parse(args);
  if (typeof parsed === 'string') {
    io.err(parsed);
    process.exitCode = 2;
  } else {
    // The same threshold as the server, or this run could publish what the server wouldn't.
    const env = loadEnv();
    const { db, client } = createDb(env.DATABASE_URL);
    try {
      process.exitCode = await run(args, { db, io, minVotes: env.CONFIRM_MIN_VOTES });
    } finally {
      // An open client keeps the process alive.
      await client.end({ timeout: 5 });
    }
  }
}
