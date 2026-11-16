const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prune } = require('../position-store.js');
const ttl = 7 * 24 * 60 * 60 * 1000;
const now = 2_000_000_000_000;
test('legacy numbers and objects receive one grace period without losing resume information', () => {
  const result = prune({ numeric: 42, object: { time: 60, duration: 100 } }, now, ttl);
  assert.deepEqual(result.numeric, { time: 42, updatedAt: now });
  assert.deepEqual(result.object, { time: 60, duration: 100, updatedAt: now });
  const reread = prune(JSON.parse(JSON.stringify(result)), now + ttl - 1, ttl);
  assert.equal(reread.numeric.updatedAt, now);
  assert.equal(reread.object.updatedAt, now);
  assert.deepEqual(Object.keys(prune(reread, now + ttl + 1, ttl)), []);
});
test('fresh and boundary entries survive while expired and invalid entries are removed', () => {
  const result = prune({
    fresh: { time: 0, updatedAt: now }, boundary: { time: 1, updatedAt: now - ttl },
    expired: { time: 2, updatedAt: now - ttl - 1 },
    invalidTime: { time: -1 }, invalidDate: { time: 1, updatedAt: 'yesterday' },
    empty: null, nonfinite: Infinity,
  }, now, ttl);
  assert.deepEqual(Object.keys(result), ['fresh', 'boundary']);
});
