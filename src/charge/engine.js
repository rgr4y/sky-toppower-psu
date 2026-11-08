import { deriveJob } from './profiles.js';

export const OV_MARGIN = 1.03;
export const NO_LOAD_A = 0.05;
export const NO_LOAD_S = 3;
export const SETTLE_DWELL_S = 5;
export const CV_EPS = 0.02;

export function initState(job, env) {
  return { stage: 'IDLE', started: false, job, env, derived: deriveJob(job, env), reason: null, taperSinceS: null };
}

// Per-cell sane voltage bounds used to sanity-check an *initial* pack reading
// before committing to a charge. Deliberately conservative (narrower than the
// cell's absolute abuse limits) — the goal is to catch "wrong chemistry
// selected" / "wrong cell count" / dead-short-or-open-sensor mistakes, not to
// model true end-of-discharge or overcharge thresholds.
//   Li-ion/LiPo : 2.5 - 4.25 V/cell (below typical 2.5V UVLO, above 4.2V+margin)
//   LiFePO4     : 2.0 - 3.7  V/cell (below typical 2.0V cutoff, above 3.65V+margin)
//   Lead-acid   : 1.7 - 2.6  V/cell (below deep-discharge floor, above 2.4V+margin)
const CELL_V_BOUNDS = {
  liion: [2.5, 4.25],
  lifepo4: [2.0, 3.7],
  leadacid: [1.7, 2.6],
};

// preflight(): one-time sanity checks run only at IDLE->start, before the
// charge is allowed to begin (i.e. before any OUTPUT:true / CC entry).
// Returns a fault reason string, or null if safe to proceed. Pure — does
// not read/write mutable state.
//
// NOTE: hot-temp and start-of-charge overvoltage are deliberately folded in
// here (not left to guard(), which only runs once already inside an active
// stage) — otherwise a pack that's already hot or already above the OV
// threshold at the moment of start would get one live tick of OUTPUT:true
// and full charge current before guard() catches it on the *next* tick.
// That live tick on a hot/over-voltage pack is exactly the hazard we must
// not allow.
function preflight(d, inputs, job, effTemp) {
  // Fail-safe: refuse to start if Vin can't be verified at all. Silently
  // skipping the buck-only check when vin is missing/NaN would let a
  // boost-only wiring mistake through undetected.
  if (typeof inputs.vin !== 'number' || Number.isNaN(inputs.vin)) {
    return 'Vin unknown — cannot verify buck headroom, refusing to start';
  }
  if (d.absorbV > inputs.vin) {
    return `Absorb voltage ${d.absorbV.toFixed(2)}V exceeds Vin ${inputs.vin}V — buck-only supply cannot boost`;
  }
  if (typeof effTemp === 'number' && effTemp > d.tempC[1]) {
    return `Pack temp ${effTemp}C exceeds hot limit ${d.tempC[1]}C at start`;
  }
  // Pack-bounds check runs before the OV-at-start check: bounds is the
  // wider/coarser "sane at all" sanity check (catches wrong chemistry/cell
  // count), OV-at-start is the narrower "sane AND under the OV threshold"
  // check — ordering bounds first keeps grossly-wrong-voltage failures
  // reported as "pack/initial" rather than masked by "overvolt".
  const bounds = job && CELL_V_BOUNDS[job.chemistry];
  if (bounds && typeof inputs.v === 'number') {
    const [minCell, maxCell] = bounds;
    const minV = minCell * job.cells;
    const maxV = maxCell * job.cells;
    if (inputs.v < minV || inputs.v > maxV) {
      return `Initial pack voltage ${inputs.v}V outside sane range [${minV.toFixed(2)}, ${maxV.toFixed(2)}]V for ${job.chemistry}`;
    }
  }
  if (typeof inputs.v === 'number' && inputs.v > d.absorbV * OV_MARGIN) {
    return `Overvoltage at start: ${inputs.v}V exceeds ${(d.absorbV * OV_MARGIN).toFixed(2)}V (absorb x OV_MARGIN)`;
  }
  return null;
}

// guard(): per-tick safety checks while a charge is active (PRECHARGE/CC/CV/FLOAT).
// Returns a fault reason string, or null if safe to continue. Pure.
function guard(s, d, inputs, effTemp) {
  if (typeof effTemp === 'number' && effTemp > d.tempC[1]) {
    return `Pack temp ${effTemp}C exceeds hot limit ${d.tempC[1]}C`;
  }
  if (typeof inputs.v === 'number' && inputs.v > d.absorbV * OV_MARGIN) {
    return `Overvoltage: ${inputs.v}V exceeds ${(d.absorbV * OV_MARGIN).toFixed(2)}V (absorb x OV_MARGIN)`;
  }
  if ((s.stage === 'CC' || s.stage === 'PRECHARGE') && inputs.stageElapsedS > NO_LOAD_S && inputs.i < NO_LOAD_A) {
    return `No-load / open circuit: ${inputs.i}A after ${inputs.stageElapsedS}s in ${s.stage}`;
  }
  // FLOAT is an expected indefinite hold (e.g. lead-acid trickle
  // maintenance) — do not fault it purely for running past maxTotalS.
  // Hot/OV/stage-timeout guards above/below still apply in FLOAT.
  if (s.stage !== 'FLOAT' && typeof inputs.elapsedS === 'number' && inputs.elapsedS > d.maxTotalS) {
    return `Total charge time exceeded (${inputs.elapsedS}s > ${d.maxTotalS}s)`;
  }
  if (typeof inputs.stageElapsedS === 'number' && inputs.stageElapsedS > d.maxStageS) {
    return `Stage time exceeded (${inputs.stageElapsedS}s > ${d.maxStageS}s) in ${s.stage}`;
  }
  return null;
}

export function tick(state, inputs) {
  const writes = [], events = [];
  const s = { ...state };
  const d = s.derived;
  // Stale readings must NEVER drive temp decisions: a frozen last-known
  // value (hot or cold) would otherwise keep gating a healthy charge, or
  // worse, keep a genuinely-cooled-off fault condition masked. When stale,
  // temp guards are disabled entirely (effTemp undefined) — charge proceeds.
  const effTemp = inputs.packTempStale ? undefined : inputs.packTemp;
  const setStage = (stage) => { s.stage = stage; s.taperSinceS = null; };
  const fail = (reason) => { s.stage = 'FAULT'; s.reason = reason; writes.push({ type: 'OUTPUT', value: false }); return { state: s, writes, events }; };

  if (s.stage === 'IDLE' && s.started) {
    if (typeof effTemp === 'number' && effTemp < d.tempC[0]) {
      events.push({ kind: 'inhibit', msg: `Cold pack ${effTemp}C — charge inhibited (min ${d.tempC[0]}C)` });
      return { state: s, writes, events };
    }
    const pf = preflight(d, inputs, s.job, effTemp);
    if (pf) return fail(pf);
  }
  if (['PRECHARGE', 'CC', 'CV', 'FLOAT'].includes(s.stage)) {
    const g = guard(s, d, inputs, effTemp);
    if (g) return fail(g);
  }

  switch (s.stage) {
    case 'IDLE':
      if (s.started) {
        writes.push({ type: 'V', value: d.absorbV }, { type: 'I', value: d.chargeA }, { type: 'OUTPUT', value: true });
        setStage('CC');
        events.push({ kind: 'stage', msg: 'CC (bulk)' });
      }
      break;
    case 'CC':
      if (inputs.v >= d.absorbV - CV_EPS || inputs.cccv === 'CV') { setStage('CV'); events.push({ kind: 'stage', msg: 'CV (absorb)' }); }
      break;
    case 'CV': {
      if (inputs.i < d.taperA) {
        if (s.taperSinceS == null) s.taperSinceS = inputs.stageElapsedS;
        else if (inputs.stageElapsedS - s.taperSinceS >= SETTLE_DWELL_S) {
          if (d.floatV != null) { writes.push({ type: 'V', value: d.floatV }); setStage('FLOAT'); events.push({ kind: 'stage', msg: 'FLOAT' }); }
          else { writes.push({ type: 'OUTPUT', value: false }); setStage('DONE'); events.push({ kind: 'done', msg: 'Charge complete' }); }
        }
      } else { s.taperSinceS = null; }
      break;
    }
    case 'FLOAT':
      // Held indefinitely (correct for lead-acid trickle maintenance). Not
      // subject to the total-charge-time fault (see guard()); hot/OV/stage
      // guards remain active.
      break;
    default: break; // DONE / FAULT are terminal
  }
  return { state: s, writes, events };
}
