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

test('the migrations made the four tables, and nothing else', async () => {
  const tables = new Set((await columns()).map((column) => column.table_name));
  assert.deepEqual([...tables].sort(), ['embeddings', 'hashes', 'verdicts', 'votes']);
});

test('no column is named like an IP, a URL, a user, an email or a voter', async () => {
  const banned = /ip|url|user|email|voter/i;
  const found = [...(await columns())].filter((column) => banned.test(column.column_name));
  assert.deepEqual(found, []);
});

test('votes has no date or time column', async () => {
  const dated = [...(await columns())].filter(
    (column) =>
      column.table_name === 'votes' &&
      /date|time|interval/i.test(`${column.data_type} ${column.column_name}`),
  );
  assert.deepEqual(dated, []);
});
