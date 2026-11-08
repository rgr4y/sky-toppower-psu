import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initState, tick, SETTLE_DWELL_S } from '../../src/charge/engine.js';

const job = { chemistry: 'lifepo4', cells: 4, capacityAh: 180, chargeA: 1 };
const env = { deviceImax: 10, clampV: 32, clampA: 10 };
const started = () => { const s = initState(job, env); s.started = true; return s; };
const step = (s, inputs) => tick(s, { elapsedS: inputs.stageElapsedS, ...inputs }).state;

test('CC: a stale CV flag right after output-on does not jump to CV (live LiFePO4 charge, 2026-11-08)', () => {
  let s = step(started(), { v: 13.0, i: 0, cccv: 'CV', stageElapsedS: 0 });
  assert.equal(s.stage, 'CC');
  // First polls after OUTPUT on still carry the output-off status: CC bit clear => 'CV'.
  s = step(s, { v: 13.0, i: 0, cccv: 'CV', stageElapsedS: 0.5 });
  s = step(s, { v: 13.3, i: 0.98, cccv: 'CV', stageElapsedS: 1.5 });
  assert.equal(s.stage, 'CC');
  s = step(s, { v: 13.34, i: 0.987, cccv: 'CC', stageElapsedS: 3 });
  s = step(s, { v: 13.34, i: 0.987, cccv: 'CC', stageElapsedS: 30 });
  assert.equal(s.stage, 'CC');
});

test('CC -> CV once the unit reports CV for the settle dwell, or voltage reaches absorb', () => {
  let s = step(started(), { v: 13.0, i: 0, stageElapsedS: 0 });
  s = step(s, { v: 14.2, i: 0.9, cccv: 'CV', stageElapsedS: 100 });
  assert.equal(s.stage, 'CC');
  s = step(s, { v: 14.2, i: 0.8, cccv: 'CV', stageElapsedS: 100 + SETTLE_DWELL_S });
  assert.equal(s.stage, 'CV');

  let t = step(started(), { v: 13.0, i: 0, stageElapsedS: 0 });
  t = step(t, { v: 14.6, i: 0.9, cccv: 'CC', stageElapsedS: 50 });
  assert.equal(t.stage, 'CV');
});
