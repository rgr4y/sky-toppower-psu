import { ModbusClient } from '../modbus/client.js';

// Generic register-map-driven PSU. A subclass supplies `static map` (+ options);
// everything else (queueing, scaling, caching, grouped polling) lives here.
//
// map entry: { addr, words=1, rw='r'|'rw', unit?:'V'|'A'|'W'|string, scale?:number,
//              signMag?:true, bit?:n (bool view of one bit) }
//   scale   fixed multiplier (e.g. 0.1); wins over decimals-register scaling
//   unit    'V'|'A'|'W' → scaled by decimals() when the subclass provides one
export class ModbusPSU {
  static map = {};
  static maxWords = 4;      // per FC03 read
  constructor(transport, opts = {}) {
    this.client = new ModbusClient(transport, opts);
    this.cache = {};
  }

  // Trace annotator for TracedTransport: names the registers a frame touches, one word each.
  //   TX 01 03 00 10 00 04 … → "read vout iout pout"   TX 01 06 00 30 … → "write setV"
  // An RX chunk that starts a reply (slave + fc of the last request) gets the request's names;
  // an exception reply (fc | 0x80) gets "exception"; continuation chunks get nothing.
  static traceLabeler() {
    const byAddr = new Map();
    for (const [name, d] of Object.entries(this.map)) if (d.bit === undefined && !byAddr.has(d.addr)) byAddr.set(d.addr, { name, words: d.words ?? 1 });
    const names = (addr, n) => {
      const out = [];
      for (let a = addr; a < addr + n;) {
        const r = byAddr.get(a);
        out.push(r ? r.name : '0x' + a.toString(16).padStart(4, '0'));
        a += r ? r.words : 1;
      }
      return out.join(' ');
    };
    let last = null; // { slave, fc, label }
    return (dir, u8) => {
      if (dir === 'TX') {
        if (u8.length < 6) return '';
        const fc = u8[1], addr = (u8[2] << 8) | u8[3];
        const label = fc === 3 ? names(addr, (u8[4] << 8) | u8[5]) : fc === 6 ? names(addr, 1) : '';
        last = { slave: u8[0], fc, label };
        return label && (fc === 3 ? 'read ' : 'write ') + label;
      }
      if (!last || u8.length < 2 || u8[0] !== last.slave) return '';
      if (u8[1] === (last.fc | 0x80)) return 'exception ' + last.label;
      return u8[1] === last.fc ? last.label : '';
    };
  }

  // Subclass hook: decimals for 'V'|'A'|'W'. Default: unscaled.
  async decimalsFor(unit) { return 0; }

  _def(name) {
    const d = this.constructor.map[name];
    if (!d) throw new Error(`unknown register ${name}`);
    return d;
  }

  async _factor(d) {
    if (d.scale) return 1 / d.scale; // divisor: raw/10 is exact, raw*0.1 is not
    if (d.unit === 'V' || d.unit === 'A' || d.unit === 'W') return 10 ** (await this.decimalsFor(d.unit));
    return 1;
  }

  _raw(d, words) {
    let v = words.reduce((a, w) => a * 65536 + w, 0); // big-endian word order
    if (d.signMag && words.length === 1 && v & 0x8000) v = -(v & 0x7FFF);
    if (d.bit !== undefined) return !!((v >> d.bit) & 1);
    return v;
  }

  async readRaw(name) {
    const d = this._def(name);
    return this._raw(d, await this.client.readRegs(d.addr, d.words ?? 1));
  }

  async _scaled(d, raw) { return typeof raw === 'number' ? raw / (await this._factor(d)) : raw; }

  async read(name) {
    return (this.cache[name] = await this._scaled(this._def(name), await this.readRaw(name)));
  }

  // value as the device will store it (after scaling + rounding)
  async quantize(name, value) {
    const f = await this._factor(this._def(name));
    return Math.round(value * f) / f;
  }

  async write(name, value) {
    const d = this._def(name);
    if (d.rw !== 'rw') throw new Error(`${name} is read-only`);
    if ((d.words ?? 1) !== 1) throw new Error(`${name}: multi-word write unsupported (FC06 only)`); // ponytail: FC10 if a unit supports it
    const raw = typeof value === 'boolean' ? +value : Math.round(value * (await this._factor(d)));
    return this.client.writeReg(d.addr, raw);
  }

  // Read several named registers, merging address-contiguous ones into ≤maxWords reads.
  async readMany(names) {
    const defs = names.map((n) => [n, this._def(n)]).sort((a, b) => a[1].addr - b[1].addr);
    const max = this.constructor.maxWords;
    const out = {};
    for (let i = 0; i < defs.length;) {
      let j = i, end = defs[i][1].addr + (defs[i][1].words ?? 1);
      while (j + 1 < defs.length && defs[j + 1][1].addr === end && end - defs[i][1].addr + (defs[j + 1][1].words ?? 1) <= max) {
        j++; end += defs[j][1].words ?? 1;
      }
      const start = defs[i][1].addr;
      const words = await this.client.readRegs(start, end - start);
      for (let k = i; k <= j; k++) {
        const [n, d] = defs[k];
        const o = d.addr - start;
        out[n] = await this._scaled(d, this._raw(d, words.slice(o, o + (d.words ?? 1))));
      }
      i = j + 1;
    }
    Object.assign(this.cache, out);
    return out;
  }
}
