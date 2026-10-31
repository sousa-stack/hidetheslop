import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  real,
  smallint,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// Random ids and no vote timestamp, so stored rows don't show which votes arrived
// together. Sequential ids would put one person's batch in a neat run.

export const voteLabel = pgEnum('vote_label', ['ai', 'real']);
export const voteSource = pgEnum('vote_source', ['rated', 'hid']);
export const verdictStatus = pgEnum('verdict_status', ['pending', 'confirmed', 'disputed']);

export const verdictSeq = pgSequence('verdict_seq');

// Drizzle has no built-in bytea.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const hashes = pgTable(
  'hashes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hashVersion: smallint('hash_version').notNull(),
    phash: bigint('phash', { mode: 'bigint' }).notNull(),
    canonicalId: uuid('canonical_id').references((): AnyPgColumn => hashes.id, { onDelete: 'cascade' }),
    // Near-duplicate check done. Only checked hashes can be roots or get verdicts.
    checked: boolean('checked').notNull().default(false),
    firstSeen: date('first_seen', { mode: 'string' }).notNull().default(sql`current_date`),
    // Hashes within 3 bits must share at least one of these four bands.
    band0: integer('band0').generatedAlwaysAs(sql`((phash >> 48) & 65535)::integer`),
    band1: integer('band1').generatedAlwaysAs(sql`((phash >> 32) & 65535)::integer`),
    band2: integer('band2').generatedAlwaysAs(sql`((phash >> 16) & 65535)::integer`),
    band3: integer('band3').generatedAlwaysAs(sql`(phash & 65535)::integer`),
  },
  (t) => [
    unique('hashes_version_phash_unique').on(t.hashVersion, t.phash),
    index('hashes_band0_idx').on(t.hashVersion, t.band0),
    index('hashes_band1_idx').on(t.hashVersion, t.band1),
    index('hashes_band2_idx').on(t.hashVersion, t.band2),
    index('hashes_band3_idx').on(t.hashVersion, t.band3),
    index('hashes_canonical_id_idx').on(t.canonicalId),
    index('hashes_unchecked_idx').on(t.firstSeen, t.phash).where(sql`not checked`),
  ],
);

// Votes stay as long as their hash does: tokens can't be linked to each other, and
// keeping them stops double voting and lets verdicts be recounted.
export const votes = pgTable(
  'votes',
  {
    hashId: uuid('hash_id')
      .notNull()
      .references(() => hashes.id, { onDelete: 'cascade' }),
    token: char('token', { length: 32 }).notNull(),
    label: voteLabel('label').notNull(),
    source: voteSource('source').notNull(),
  },
  (t) => [primaryKey({ columns: [t.hashId, t.token] })],
);

// Roots only: a hash merged into another has no verdict of its own.
export const verdicts = pgTable(
  'verdicts',
  {
    hashId: uuid('hash_id')
      .primaryKey()
      .references(() => hashes.id, { onDelete: 'cascade' }),
    status: verdictStatus('status').notNull(),
    label: voteLabel('label'),
    aiWeight: real('ai_weight').notNull(),
    realWeight: real('real_weight').notNull(),
    voteCount: integer('vote_count').notNull(),
    published: boolean('published').notNull().default(false),
    seq: bigint('seq', { mode: 'number' }),
  },
  (t) => [index('verdicts_seq_idx').on(t.seq)],
);

export const embeddings = pgTable(
  'embeddings',
  {
    hashId: uuid('hash_id')
      .notNull()
      .references(() => hashes.id, { onDelete: 'cascade' }),
    modelVersion: smallint('model_version').notNull(),
    vector: bytea('vector').notNull(), // exactly 512 bytes, checked by the route
  },
  (t) => [primaryKey({ columns: [t.hashId, t.modelVersion] })],
);
