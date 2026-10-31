import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { openTestDb, testDatabaseUrl } from './helpers.js';

const { db, client } = openTestDb();
after(() => client.end());

test('200 when the database answers', async () => {
  const app = await buildApp({ db, logLevel: 'silent' });
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok' });
  await app.close();
});

test('503 with a broken database, without leaking the error', async () => {
  const dead = new URL(testDatabaseUrl());
  dead.hostname = '127.0.0.1';
  dead.port = '1'; // nothing listens here
  const broken = createDb(dead.href);
  const lines: string[] = [];
  const app = await buildApp({ db: broken.db, logStream: { write: (line) => void lines.push(line) } });

  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { status: 'unavailable' });

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0] ?? '{}');
  assert.equal(entry.msg, 'database unreachable');
  assert.ok(!lines[0]?.includes('127.0.0.1'));
  assert.ok(!lines[0]?.includes(dead.pathname.slice(1)));

  await app.close();
  await broken.client.end({ timeout: 1 });
});
