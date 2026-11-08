import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socFromRestV, ChargeEstimate, defaultSocPoints, socTableFromPoints } from '../../src/charge/estimate.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('socFromRestV: interpolates the per-cell table, rejects voltages that do not fit the pack', () => {
  assert.equal(socFromRestV('lifepo4', 4, 13.6), 100);
  near(socFromRestV('lifepo4', 4, 13.2), 60, 0.01, 'LiFePO4 13.2 V = 3.30 V/cell (BMS table)');
  near(socFromRestV('lifepo4', 4, 13.12), 45, 0.01, 'LiFePO4 3.28 V/cell, between 40 and 50');
  near(socFromRestV('lifepo4', 4, 12.4), 10, 0.01, 'LiFePO4 3.10 V/cell');
  near(socFromRestV('leadacid', 6, 12.3), 50, 0.01, 'AGM 12.3 V');
  assert.equal(socFromRestV('liion', 4, 16.8), 100);
  assert.equal(socFromRestV('lifepo4', 4, 0), null, 'nothing connected');
  assert.equal(socFromRestV('lifepo4', 4, 26.4), null, '8S pack on a 4S job');
  assert.equal(socFromRestV('nope', 4, 13), null);
});

test('ChargeEstimate: Ah in and % now from a starting %', () => {
  const e = new ChargeEstimate({ capacityAh: 100, derived: { chargeA: 10, taperA: 2 }, soc0: 40 });
  for (let t = 0; t <= 3600; t += 10) e.sample(t, 10, 'CC'); // 1 h at 10 A
  near(e.ahIn, 10, 1e-9, 'Ah in');
  near(e.soc(), 50, 1e-9, '% now');
  near(e.eta('CC').seconds, 5 * 3600, 1e-6, 'CC ETA: 50 Ah left at 10 A');
  assert.equal(e.eta('CC').bound, 'est');
});

test('ChargeEstimate: no starting % gives an upper bound in CC', () => {
  const e = new ChargeEstimate({ capacityAh: 180, derived: { chargeA: 1, taperA: 0.2 } });
  e.sample(0, 1, 'CC'); e.sample(3600, 1, 'CC');
  assert.equal(e.soc(), null);
  assert.deepEqual(e.eta('CC'), { seconds: 179 * 3600, bound: 'max' });
});

test('ChargeEstimate: CV ETA from an exponential current decay', () => {
  const tau = 1800, i0 = 5, taperA = 0.5;
  const e = new ChargeEstimate({ capacityAh: 50, derived: { chargeA: 5, taperA } });
  for (let t = 0; t <= 300; t += 5) e.sample(t, i0 * Math.exp(-t / tau), 'CV');
  const iNow = i0 * Math.exp(-300 / tau);
  near(e.eta('CV').seconds, tau * Math.log(iNow / taperA), 1, 'CV ETA');
  const flat = new ChargeEstimate({ capacityAh: 50, derived: { chargeA: 5, taperA } });
  for (let t = 0; t <= 300; t += 5) flat.sample(t, 3, 'CV');
  assert.equal(flat.eta('CV'), null, 'no decay, no estimate');
  const early = new ChargeEstimate({ capacityAh: 50, derived: { chargeA: 5, taperA } });
  for (let t = 0; t <= 60; t += 5) early.sample(t, i0 * Math.exp(-t / tau), 'CV');
  assert.equal(early.eta('CV'), null, 'under 2 min of CV');
});

test('11-point curve: LiFePO4 default is the BMS table; custom tables validate and drive socFromRestV', () => {
  assert.deepEqual(defaultSocPoints('lifepo4'), [2.5, 3.1, 3.2, 3.25, 3.27, 3.29, 3.3, 3.31, 3.32, 3.34, 3.4]);
  assert.equal(defaultSocPoints('leadacid').length, 11);
  assert.equal(socTableFromPoints([1, 2, 3]), null, 'wrong length');
  assert.equal(socTableFromPoints([2.5, 3.1, 3.2, 3.2, 3.27, 3.29, 3.3, 3.31, 3.32, 3.34, 3.4]), null, 'not ascending');
  const custom = socTableFromPoints([2.5, 3.0, 3.1, 3.15, 3.2, 3.25, 3.28, 3.3, 3.32, 3.35, 3.45]);
  near(socFromRestV('lifepo4', 4, 13.0, custom), 50, 0.01, '3.25 V/cell on the custom curve');
});
