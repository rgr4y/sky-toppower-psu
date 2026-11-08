export const PROFILES = {
  liion:    { name: 'Li-ion/LiPo', absorbV: 4.20, floatV: null, taperC: 0.05, tempC: [0, 45],   tempComp: 0,  precharge: { belowV: 3.0, a: 0.1 } },
  lifepo4:  { name: 'LiFePO4',     absorbV: 3.65, floatV: 3.40, taperC: 0.05, tempC: [0, 55],   tempComp: 0,  precharge: { belowV: 2.5, a: 0.1 } },
  leadacid: { name: 'Lead-acid/AGM', absorbV: 2.40, floatV: 2.25, taperC: 0.02, tempC: [-10, 50], tempComp: -4, precharge: null },
};

// Taper current is capped at this fraction of the actual charge current, so a
// device-/supply-limited charge still has taperA < chargeA (CV can't terminate
// on the first tick). Only bites when the charge current is low relative to
// capacity (undersized supply); a well-sized charge keeps the profile taper.
export const TAPER_MAX_FRAC = 0.2;

export function deriveJob(job, env) {
  const p = PROFILES[job.chemistry];
  if (!p) throw new Error(`unknown chemistry: ${job.chemistry}`);
  const { cells, capacityAh, cRate } = job;
  const { packTemp, deviceImax, clampV, clampA, safetyFactor = 1.5 } = env;
  const comp = (perCell) => (p.tempComp && typeof packTemp === 'number')
    ? perCell + (p.tempComp / 1000) * (packTemp - 25) : perCell;

  const wantV = comp(p.absorbV) * cells;          // profile target before the clamp
  const absorbV = Math.min(wantV, clampV);
  const floatV = p.floatV == null ? null : Math.min(comp(p.floatV) * cells, clampV);
  // Charge current is user-set (job.chargeA); cRate*capacity is the fallback when
  // only a C-rate is given (keeps older callers/tests working). The requested
  // value is clamped to what the device + safety-clamp can actually deliver.
  const requestedA = (job.chargeA != null ? job.chargeA : (cRate || 0) * capacityAh);
  const chargeA = Math.min(requestedA, deviceImax, clampA);
  // Taper (CV → float / done) must stay meaningfully below the ACTUAL charge
  // current, else a device-/supply-limited charge terminates CV instantly. Cap
  // the profile's absolute taper at a fraction of the real charge current.
  const taperA = Math.min(p.taperC * capacityAh, chargeA * TAPER_MAX_FRAC);
  const hours = chargeA > 0 ? (capacityAh / chargeA) : 0;
  const maxTotalS = hours * 3600 * safetyFactor;
  const maxStageS = maxTotalS; // per-stage ceiling defaults to total; tighten in Task 11 if needed
  return { absorbV, wantV, floatV, chargeA, requestedA, taperA, maxStageS, maxTotalS, tempC: [...p.tempC], precharge: p.precharge ? { belowV: p.precharge.belowV * cells, a: p.precharge.a * capacityAh } : null };
}
