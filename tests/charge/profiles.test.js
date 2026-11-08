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

test('deriveJob: max watts at absorb, average over the nominal→absorb CC ramp', () => {
  const d = deriveJob({ chemistry: 'lifepo4', cells: 4, capacityAh: 180, chargeA: 5 }, { deviceImax: 10, clampV: 32, clampA: 10 });
  assert.equal(d.maxW.toFixed(1), '73.0');   // 14.6 V × 5 A
  assert.equal(d.avgW.toFixed(1), '68.5');   // (12.8 + 14.6) / 2 × 5 A
});
