import { ModbusPSU } from './base.js';

// SKY TOPPOWER STP2S / E22 register map. Source: vendor "POWER of ModBusV25"
// (docs/PROTOCOL.md). Reads + SetU write confirmed on hardware 2026-11-07.
const M = (addr, o = {}) => ({ addr, ...o });

export class STP2S extends ModbusPSU {
  static map = {
    output:    M(0x0001, { rw: 'rw' }),
    status:    M(0x0002),
    lock:      M(0x0002, { bit: 0 }), beep: M(0x0002, { bit: 1 }),
    ovp:       M(0x0002, { bit: 2 }), ocp:  M(0x0002, { bit: 3 }), opp: M(0x0002, { bit: 4 }),
    otp:       M(0x0002, { bit: 5 }), cc:   M(0x0002, { bit: 6 }), no:  M(0x0002, { bit: 7 }),
    temp:      M(0x0003, { signMag: true }),   // 26 → °C ×1 (panel TEMP display agrees)
    aux:       M(0x0004, { scale: 0.1 }),      // aux rail ×0.1 → 13.4 V (Rob: internal aux PSU; unmetered)
    decimals:  M(0x0005),
    vout:      M(0x0010, { unit: 'V' }),
    iout:      M(0x0011, { unit: 'A' }),
    pout:      M(0x0012, { unit: 'W', words: 2 }),
    vmax:      M(0x0014, { unit: 'V' }),
    imax:      M(0x0015, { unit: 'A' }),
    pmax:      M(0x0016, { unit: 'W', words: 2 }),
    setOVP:    M(0x0020, { unit: 'V', rw: 'rw' }),
    setOCP:    M(0x0021, { unit: 'A', rw: 'rw' }),
    setOPP:    M(0x0022, { unit: 'W', words: 2 }), // 32-bit: FC06 can't write it
    setV:      M(0x0030, { unit: 'V', rw: 'rw' }),
    setI:      M(0x0031, { unit: 'A', rw: 'rw' }),
    lockSw:    M(0x0040, { rw: 'rw' }), beepSw: M(0x0041, { rw: 'rw' }),
    ovpSw:     M(0x0042, { rw: 'rw' }), ocpSw:  M(0x0043, { rw: 'rw' }),
    oppSw:     M(0x0044, { rw: 'rw' }), noSw:   M(0x0045, { rw: 'rw' }),
    address:   M(0x9999, { rw: 'rw' }),
  };

  // Reg 0x0005 nibbles: V=bits 8-11, A=4-7, W=0-3 (device read 0x0233 → 0.01 V, 0.001 A, 0.001 W; Umax 3200→32.00 V confirms V nibble).
  async decimalsFor(unit) {
    if (this._dec === undefined) this._dec = await this.readRaw('decimals');
    const shift = { V: 8, A: 4, W: 0 }[unit];
    return (this._dec >> shift) & 0xF;
  }

  // Never write past what the unit reports (vmax/imax), fail loud if unknown.
  async setVoltage(v) { await this._clamped('setV', 'vmax', v); }
  async setCurrent(a) { await this._clamped('setI', 'imax', a); }
  async _clamped(w, lim, x) {
    const max = this.cache[lim] ?? (await this.read(lim));
    if (!(x >= 0 && x <= max)) throw new RangeError(`${w}=${x} outside 0..${max}`);
    return this.write(w, x);
  }
  setOutput(on) { return this.write('output', on); }

  live() { return this.readMany(['vout', 'iout', 'pout']); } // 0x10-0x13 = exactly 4 words
}
