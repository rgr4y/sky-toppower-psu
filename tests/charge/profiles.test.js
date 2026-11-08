import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveJob } from '../../src/charge/profiles.js';

test('deriveJob: absorb capped at clampV, wantV keeps the profile target', () => {
  const env = { deviceImax: 10, clampV: 32, clampA: 10 };
  const ok = deriveJob({ chemistry: 'liion', cells: 4, capacityAh: 10, chargeA: 2 }, env);
  assert.equal(ok.absorbV.toFixed(2), '16.80'); assert.equal(ok.wantV, ok.absorbV);
  const cap = deriveJob({ chemistry: 'liion', cells: 8, capacityAh: 10, chargeA: 2 }, env);
  assert.equal(cap.absorbV, 32); assert.equal(cap.wantV.toFixed(2), '33.60');
});
