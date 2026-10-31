import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { AGGREGATE_BOOT_DELAY_MS } from '../src/config.js';
import { scheduleAggregate } from '../src/jobs/aggregate.js';

const MINUTE = 60_000;

beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }));
afterEach(() => mock.timers.reset());

test('runs once soon after startup, long before the first interval', () => {
  const run = mock.fn();
  const stop = scheduleAggregate(run, 60);
  mock.timers.tick(AGGREGATE_BOOT_DELAY_MS - 1);
  assert.equal(run.mock.callCount(), 0);
  mock.timers.tick(1);
  assert.equal(run.mock.callCount(), 1);
  stop();
});

test('then runs on the interval', () => {
  const run = mock.fn();
  const stop = scheduleAggregate(run, 60);
  mock.timers.tick(60 * MINUTE);
  assert.equal(run.mock.callCount(), 2); // the startup run, then the first interval
  mock.timers.tick(60 * MINUTE);
  assert.equal(run.mock.callCount(), 3);
  stop();
});

test('an interval of 0 turns off the startup run too', () => {
  const run = mock.fn();
  const stop = scheduleAggregate(run, 0);
  mock.timers.tick(24 * 60 * MINUTE);
  assert.equal(run.mock.callCount(), 0);
  stop();
});

test('stopping cancels a startup run that has not happened yet', () => {
  const run = mock.fn();
  const stop = scheduleAggregate(run, 60);
  stop();
  mock.timers.tick(120 * MINUTE);
  assert.equal(run.mock.callCount(), 0);
});
