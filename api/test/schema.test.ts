import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { openTestDb } from './helpers.js';

const { db, client } = openTestDb();
after(() => client.end());

interface Column extends Record<string, unknown> {
  table_name: string;
  column_name: string;
  data_type: string;
}

const columns = () =>
  db.execute<Column>(sql`
    select table_name, column_name, data_type from information_schema.columns
    where table_schema = 'public'
  `);

test('the migrations made the five tables, and nothing else', async () => {
  const tables = new Set((await columns()).map((column) => column.table_name));
  assert.deepEqual([...tables].sort(), ['blocked_hashes', 'embeddings', 'hashes', 'verdicts', 'votes']);
});

test('no column is named like an IP, a URL, a user, an email or a voter', async () => {
  const banned = /ip|url|user|email|voter/i;
  const found = [...(await columns())].filter((column) => banned.test(column.column_name));
  assert.deepEqual(found, []);
});

test('votes and blocked_hashes have no date or time column', async () => {
  const dated = [...(await columns())].filter(
    (column) =>
      (column.table_name === 'votes' || column.table_name === 'blocked_hashes') &&
      /date|time|interval/i.test(`${column.data_type} ${column.column_name}`),
  );
  assert.deepEqual(dated, []);
});

// backup.sh clusters each table on these, so dumps don't keep rows in arrival order. That
// only mixes rows up if the index really starts with a random id.
test('the indexes backup.sh clusters on exist and start with a random uuid', async () => {
  const expected = [
    ['votes', 'votes_hash_id_token_pk', 'hash_id'],
    ['hashes', 'hashes_pkey', 'id'],
    ['embeddings', 'embeddings_hash_id_model_version_pk', 'hash_id'],
    ['verdicts', 'verdicts_pkey', 'hash_id'],
  ];
  for (const [table, index, column] of expected) {
    const [row] = await db.execute<{ first_column: string; data_type: string }>(sql`
      select a.attname as first_column, format_type(a.atttypid, a.atttypmod) as data_type
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where c.relname = ${index} and i.indrelid = ${table}::regclass and i.indisprimary
    `);
    assert.deepEqual(row, { first_column: column, data_type: 'uuid' });
  }
  const [id] = await db.execute<{ column_default: string }>(sql`
    select column_default from information_schema.columns
    where table_name = 'hashes' and column_name = 'id'
  `);
  assert.equal(id?.column_default, 'gen_random_uuid()');
});

test('blocked_hashes has a random id, one row per hash, and only these columns', async () => {
  const blocked = [...(await columns())]
    .filter((column) => column.table_name === 'blocked_hashes')
    .map((column) => column.column_name)
    .sort();
  assert.deepEqual(blocked, ['hash_version', 'id', 'note', 'phash']);
  const [id] = await db.execute<{ column_default: string }>(sql`
    select column_default from information_schema.columns
    where table_name = 'blocked_hashes' and column_name = 'id'
  `);
  assert.equal(id?.column_default, 'gen_random_uuid()');
  const [unique] = await db.execute<{ n: number }>(sql`
    select count(*)::integer as n from pg_constraint
    where conname = 'blocked_hashes_version_phash_unique' and contype = 'u'
  `);
  assert.equal(unique?.n, 1);
});
