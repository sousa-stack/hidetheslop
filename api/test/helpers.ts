import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { hashes, votes } from '../src/db/schema.js';
import { hexToSigned } from '../src/lib/phash.js';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL, or use scripts/test-local.sh.');
  // These tests wipe every table.
  if (!new URL(url).pathname.slice(1).includes('test')) {
    throw new Error('Refusing to run: the database name must contain "test".');
  }
  return url;
}

export function openTestDb() {
  return createDb(testDatabaseUrl());
}

type TestDb = ReturnType<typeof openTestDb>['db'];

export async function reset(db: TestDb): Promise<void> {
  await db.execute(sql`truncate hashes, votes, verdicts, embeddings, blocked_hashes cascade`);
  await db.execute(sql`alter sequence verdict_seq restart`);
}

export const token = (): string => randomBytes(16).toString('hex');

// A phash `n` bits away from `base`: flips the lowest n bits, which all sit in one band.
export function flip(base: string, n: number): string {
  const mask = (1n << BigInt(n)) - 1n;
  return (BigInt(`0x${base}`) ^ mask).toString(16).padStart(16, '0');
}

// A phash that differs from `base` at exactly these bit positions, 0 being the lowest.
export function flipBits(base: string, positions: readonly number[]): string {
  const mask = positions.reduce((m, p) => m | (1n << BigInt(p)), 0n);
  return (BigInt(`0x${base}`) ^ mask).toString(16).padStart(16, '0');
}

// `ageDays` counts from the database's own date, which can differ from UTC by a day.
export async function addHash(db: TestDb, phash: string, ageDays = 0): Promise<string> {
  const [row] = await db
    .insert(hashes)
    .values({
      hashVersion: 1,
      phash: hexToSigned(phash),
      firstSeen: sql`current_date - ${ageDays}::integer`,
    })
    .onConflictDoNothing()
    .returning({ id: hashes.id });
  if (row) return row.id;
  const [existing] = await db
    .select({ id: hashes.id })
    .from(hashes)
    .where(sql`${hashes.phash} = ${hexToSigned(phash)}`);
  if (!existing) throw new Error('hash vanished');
  return existing.id;
}

interface SeedOptions {
  label?: 'ai' | 'real';
  source?: 'rated' | 'hid';
  ageDays?: number;
}

// `count` votes on one exact hash, from different tokens. Returns the tokens.
export async function seedVotes(db: TestDb, phash: string, count: number, options: SeedOptions = {}) {
  const hashId = await addHash(db, phash, options.ageDays);
  const tokens = Array.from({ length: count }, token);
  if (count > 0) {
    await db.insert(votes).values(
      tokens.map((t) => ({
        hashId,
        token: t,
        label: options.label ?? 'ai',
        source: options.source ?? 'rated',
      })),
    );
  }
  return tokens;
}

export function vote(phash: string, overrides: Record<string, unknown> = {}) {
  return { phash, token: token(), label: 'ai', source: 'rated', ...overrides };
}

export const vectorBase64 = (bytes = 512): string => Buffer.alloc(bytes, 7).toString('base64');
