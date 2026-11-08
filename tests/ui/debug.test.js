import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debug } from '../../src/ui/debug.js';

test('debug.log silent when off, prints with [stp2s] prefix when on, set() persists no crash without localStorage', () => {
  const seen = []; const orig = console.debug; console.debug = (...a) => seen.push(a);
  try {
    debug.on = false; debug.log('x'); assert.deepEqual(seen, []);
    debug.set(true); assert.equal(debug.on, true);
    debug.log('link', 'ok'); assert.deepEqual(seen.at(-1), ['[stp2s]', 'link', 'ok']);
    debug.set(false); const n = seen.length; debug.log('y'); assert.equal(seen.length, n);
  } finally { console.debug = orig; }
});
