// Charge estimates: battery % from resting voltage, Ah delivered, time remaining.
//
// Resting-voltage tables are per cell, ascending, [volts, percent], and only valid with no current
// flowing after the pack has rested (charging current lifts terminal voltage). So the panel reads
// the % at rest (output off), takes it as the starting point at START, then adds Ah delivered.
// Sources (published charts agree at the ends, differ mid-curve; treat as approximate):
//   LiFePO4: Rob's 180 Ah pack BMS "Cell N% Cap. Voltage" table (10 % steps, 3.10-3.40 V) with
//            "Cell minimal Voltage" 2.50 V as 0 %. Flat 3.20-3.34 V across 20-90 %, so mid-range %
//            from voltage is coarse (~10 mV per 10 %).
//            Published generic charts sit ~20 mV lower mid-curve (e.g. 13.0 V/4S = 30 %).
//   AGM:     12 V chart / 6 — 12.8 V 100 %, 12.6 V 75 %, 12.3 V 50 %, 12.0 V 25 %, 11.8 V 0 %.
//   Li-ion:  common NMC/LCO single-cell table, 4.20 V 100 % .. 3.27 V 0 %.
export const REST_SOC = {
  lifepo4: [[2.5, 0], [3.1, 10], [3.2, 20], [3.25, 30], [3.27, 40], [3.29, 50], [3.3, 60], [3.31, 70], [3.32, 80], [3.34, 90], [3.4, 100]],
  leadacid: [[1.967, 0], [2.0, 25], [2.05, 50], [2.1, 75], [2.133, 100]],
  liion: [[3.27, 0], [3.61, 5], [3.69, 10], [3.71, 15], [3.73, 20], [3.75, 25], [3.77, 30], [3.79, 35], [3.8, 40], [3.82, 45], [3.84, 50],
    [3.85, 55], [3.87, 60], [3.91, 65], [3.95, 70], [3.98, 75], [4.02, 80], [4.08, 85], [4.11, 90], [4.15, 95], [4.2, 100]],
};

// Per-cell slack outside the table before a reading is treated as "not this pack" (wrong cell
// count/chemistry, or nothing connected) rather than clamped to 0/100 %.
const OUT_OF_RANGE_V = 0.25;

// Resting pack voltage -> percent (0-100), or null when the voltage doesn't fit the job's pack.
export function socFromRestV(chemistry, cells, packV) {
  const table = REST_SOC[chemistry];
  if (!table || !(cells > 0) || !(packV > 0)) return null;
  const v = packV / cells;
  const lo = table[0], hi = table[table.length - 1];
  if (v < lo[0] - OUT_OF_RANGE_V || v > hi[0] + OUT_OF_RANGE_V) return null;
  if (v <= lo[0]) return lo[1];
  if (v >= hi[0]) return hi[1];
  for (let k = 1; k < table.length; k++) {
    const [v1, p1] = table[k];
    if (v <= v1) {
      const [v0, p0] = table[k - 1];
      return p0 + ((v - v0) / (v1 - v0)) * (p1 - p0);
    }
  }
  return hi[1];
}

const CV_FIT_WINDOW_S = 600; // fit the last 10 min of CV
const CV_FIT_MIN_SPAN_S = 120; // need 2 min of decay before trusting the fit

// Tracks one charge: Ah in (trapezoid integral of current), % now, and time remaining.
export class ChargeEstimate {
  // derived: deriveJob() output (chargeA, taperA); soc0: % at START from resting voltage, or null.
  constructor({ capacityAh, derived, soc0 = null }) {
    this.capacityAh = capacityAh;
    this.chargeA = derived.chargeA;
    this.taperA = derived.taperA;
    this.soc0 = soc0;
    this.ahIn = 0;
    this.last = null; // { t, i }
    this.cv = []; // [{ t, i }] while in CV
  }

  // t in seconds (monotonic), i in amps, stage = engine stage.
  sample(t, i, stage) {
    if (typeof i !== 'number' || !(t >= 0)) return;
    if (this.last && t > this.last.t) this.ahIn += ((this.last.i + i) / 2) * (t - this.last.t) / 3600;
    this.last = { t, i };
    if (stage === 'CV') {
      this.cv.push({ t, i });
      while (this.cv.length && t - this.cv[0].t > CV_FIT_WINDOW_S) this.cv.shift();
    } else {
      this.cv.length = 0;
    }
  }

  // Percent now (soc0 + Ah in), or null without a starting point.
  soc() {
    if (this.soc0 == null || !(this.capacityAh > 0)) return null;
    return Math.min(100, this.soc0 + (this.ahIn / this.capacityAh) * 100);
  }

  // { seconds, bound } or null. bound: 'est' (best guess) or 'max' (upper bound).
  //   CV: current decays ~exponentially, i(t) = i0 e^(-t/tau); least-squares fit of ln(i) over the
  //       window gives tau, and the time to reach the taper current is tau * ln(i / taperA).
  //   CC with a starting %: remaining Ah / charge current. ponytail: ignores the slower CV tail, so
  //       it runs short near the end; the CV fit takes over once CV starts.
  //   CC without one: (capacity - Ah in) / current, i.e. as if the pack started empty: an upper bound.
  eta(stage) {
    if (stage === 'CV') return this.cvEta();
    if (stage !== 'CC' && stage !== 'PRECHARGE') return null;
    if (!(this.chargeA > 0)) return null;
    const soc = this.soc();
    if (soc != null) return { seconds: ((100 - soc) / 100) * this.capacityAh / this.chargeA * 3600, bound: 'est' };
    return { seconds: Math.max(0, this.capacityAh - this.ahIn) / this.chargeA * 3600, bound: 'max' };
  }

  cvEta() {
    const pts = this.cv.filter((p) => p.i > 0);
    if (pts.length < 3 || pts[pts.length - 1].t - pts[0].t < CV_FIT_MIN_SPAN_S) return null;
    const iNow = pts[pts.length - 1].i;
    if (iNow <= this.taperA) return { seconds: 0, bound: 'est' };
    const n = pts.length;
    const mt = pts.reduce((a, p) => a + p.t, 0) / n;
    const my = pts.reduce((a, p) => a + Math.log(p.i), 0) / n;
    let sxy = 0, sxx = 0;
    for (const p of pts) { sxy += (p.t - mt) * (Math.log(p.i) - my); sxx += (p.t - mt) ** 2; }
    const slope = sxy / sxx;
    if (!(slope < 0)) return null; // not decaying (yet): no estimate
    return { seconds: (-1 / slope) * Math.log(iNow / this.taperA), bound: 'est' };
  }
}
