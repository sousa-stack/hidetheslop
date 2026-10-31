import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexToSigned, signedToHex } from '../src/lib/phash.js';

test('round-trips ordinary values, zero and small values with their padding', () => {
  for (const hex of ['0000000000000000', '0000000000000001', '00f0000000000abc', '7fffffffffffffff']) {
    assert.equal(signedToHex(hexToSigned(hex)), hex);
  }
});

test('round-trips a value with the top bit set, as a negative bigint', () => {
  for (const hex of ['8000000000000000', 'ffffffffffffffff', 'deadbeefdeadbeef']) {
    const signed = hexToSigned(hex);
    assert.ok(signed < 0n);
    assert.ok(signed >= -(2n ** 63n));
    assert.equal(signedToHex(signed), hex);
  }
});
