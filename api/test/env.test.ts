import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadEnv } from '../src/env.js';

const DATABASE_URL = 'postgres://someone:hunter2@db:5432/hidetheslop';

test('the aggregate interval stops at 35,000 minutes, where setInterval is still safe', () => {
  const env = loadEnv({ DATABASE_URL, AGGREGATE_INTERVAL_MINUTES: '35000' });
  assert.equal(env.AGGREGATE_INTERVAL_MINUTES, 35000);
  assert.ok(env.AGGREGATE_INTERVAL_MINUTES * 60_000 <= 2 ** 31 - 1);
  assert.throws(
    () => loadEnv({ DATABASE_URL, AGGREGATE_INTERVAL_MINUTES: '35001' }),
    /AGGREGATE_INTERVAL_MINUTES/,
  );
});

test('the vote threshold defaults to 5 and stays between 2 and 100', () => {
  assert.equal(loadEnv({ DATABASE_URL }).CONFIRM_MIN_VOTES, 5);
  assert.equal(loadEnv({ DATABASE_URL, CONFIRM_MIN_VOTES: '2' }).CONFIRM_MIN_VOTES, 2);
  assert.equal(loadEnv({ DATABASE_URL, CONFIRM_MIN_VOTES: '100' }).CONFIRM_MIN_VOTES, 100);
  for (const bad of ['1', '101', '2.5', 'many']) {
    assert.throws(() => loadEnv({ DATABASE_URL, CONFIRM_MIN_VOTES: bad }), /CONFIRM_MIN_VOTES/);
  }
});

test('an error names the field and never repeats the database password', () => {
  assert.throws(
    () => loadEnv({ DATABASE_URL, PORT: 'not a port' }),
    (err: Error) => err.message.includes('PORT') && !err.message.includes('hunter2'),
  );
});
