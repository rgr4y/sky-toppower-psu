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

test('deriveJob: per-cell absorb/float overrides, capped at the chemistry maximum', () => {
  const env = { deviceImax: 10, clampV: 32, clampA: 10 };
  const d = deriveJob({ chemistry: 'lifepo4', cells: 4, capacityAh: 100, chargeA: 5, absorbCellV: 3.55, floatCellV: 3.35 }, env);
  assert.equal(d.absorbV.toFixed(2), '14.20'); assert.equal(d.floatV.toFixed(2), '13.40'); assert.equal(d.cellCapped, false);
  const hot = deriveJob({ chemistry: 'lifepo4', cells: 4, capacityAh: 100, chargeA: 5, absorbCellV: 3.9 }, env);
  assert.equal(hot.absorbV.toFixed(2), '14.60'); assert.equal(hot.cellCapped, true);
  const dflt = deriveJob({ chemistry: 'liion', cells: 4, capacityAh: 10, chargeA: 2, floatCellV: 4.0 }, env);
  assert.equal(dflt.absorbV.toFixed(2), '16.80'); assert.equal(dflt.floatV, null, 'Li-ion has no float stage');
});

test('safety: pack voltage window (engine preflight bounds), C-rate max', async () => {
  const { overCRate } = await import('../../src/charge/profiles.js');
  const { packVBounds } = await import('../../src/charge/engine.js');
  const r = packVBounds('leadacid', 1);
  assert.ok(13.35 > r.hi, '12 V battery on a 1S lead-acid job is out of range');
  const r4 = packVBounds('lifepo4', 4);
  assert.ok(13.3 >= r4.lo && 13.3 <= r4.hi, '4S LiFePO4 at rest fits');
  assert.ok(26.6 > r4.hi, '8S pack on a 4S job does not');
  assert.equal(overCRate('liion', 1, 1), null, '1C Li-ion is fine');
  assert.deepEqual(overCRate('liion', 6, 1), { c: 6, max: 1 });
  assert.ok(overCRate('leadacid', 6, 6), '1C lead-acid is over 0.3C');
});

test('deriveJob: charge current capped at 300 W at absorb', () => {
  const d = deriveJob({ chemistry: 'lifepo4', cells: 8, capacityAh: 100, chargeA: 10 }, { deviceImax: 10.2, clampV: 32, clampA: 10.2 });
  assert.equal(d.chargeA, 10, '8S LiFePO4 at 10 A is 292 W: under the cap, untouched');
  // 7S Li-ion at 4.25 V/cell: 29.75 V × 10.2 A = 303 W, so current drops to 300 / 29.75 ≈ 10.08 A.
  const h = deriveJob({ chemistry: 'liion', cells: 7, capacityAh: 100, chargeA: 10.2, absorbCellV: 4.25 }, { deviceImax: 10.2, clampV: 32, clampA: 10.2 });
  assert.equal(h.maxW.toFixed(1), '300.0');
  assert.equal(h.chargeA.toFixed(2), '10.08');
});
