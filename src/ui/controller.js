// Panel logic with no DOM: owns polling, write gating, readback verify, link state.
// index.html binds it to elements; tests drive it against a fake device.
import { debug } from './debug.js';

export const STATUS_BITS = ['lock', 'beep', 'ovp', 'ocp', 'opp', 'otp', 'cc', 'no']; // PS reg 0x0002 bit0..7
// ponytail: OVP default is 38.4 V on a 32 V unit (menu sheet), so allow 1.2x; real range ? (exception 05 expected beyond it)
const PROT_HEADROOM = 1.2;
const SWITCHES = ['lockSw', 'beepSw', 'ovpSw', 'ocpSw', 'oppSw', 'noSw'];
const FAST_MS = 400, SLOW_EVERY = 5, LOST_AFTER = 3;
// The unit acks a write before applying it (output ON reads back 0 for ~0.5 s), so readback
// verify re-reads until the value matches and only reports a mismatch after this long.
const VERIFY_TIMEOUT_MS = 2000, VERIFY_EVERY_MS = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class PanelController {
  constructor(psu, { onUpdate = () => {}, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, verifyTimeoutMs = VERIFY_TIMEOUT_MS } = {}) {
    this.psu = psu;
    this.verifyTimeoutMs = verifyTimeoutMs;
    this.onUpdate = onUpdate;
    // Wrap, don't store: browsers throw "Illegal invocation" when setTimeout is called as a method (this._st(...)).
    this._st = (...a) => setTimeoutFn(...a);
    this._ct = (...a) => clearTimeoutFn(...a);
    this.writesEnabled = false;
    this.state = { link: 'idle', errors: 0, lastError: null };
    this._tick = 0;
    this._timer = null;
    this._running = false;
  }

  _set(patch) {
    if ('link' in patch && patch.link !== this.state.link) debug.log('link', this.state.link, '->', patch.link);
    Object.assign(this.state, patch); this.onUpdate(this.state, patch);
  }

  async start() {
    this._running = true;
    // Same tolerance as polling (LOST_AFTER): one lost frame right after the port opens, or a
    // PSU still booting, must not fail the whole connect.
    for (;;) {
      try {
        const lim = await this.psu.readMany(['vmax', 'imax', 'pmax']);
        this._set({ link: 'ok', limits: lim, errors: 0 });
        await this.pollSlow();
        break;
      } catch (e) {
        this._fail(e);
        if (!this._running || this.state.errors >= LOST_AFTER) return;
      }
    }
    this._loop();
  }

  stop() { this._running = false; this._ct(this._timer); this._set({ link: 'idle' }); }

  _loop() {
    if (!this._running) return;
    this._timer = this._st(async () => {
      await this.poll();
      this._loop();
    }, FAST_MS);
  }

  _fail(e) {
    debug.log('poll/start error', e.message);
    const errors = this.state.errors + 1;
    this._set({ errors, lastError: e.message, link: errors >= LOST_AFTER ? 'lost' : this.state.link });
  }

  async poll() {
    if (!this._running) return;
    try {
      const a = await this.psu.readMany(['output', 'status', 'temp', 'aux']); // one 4-word read
      const live = await this.psu.live();
      const bits = Object.fromEntries(STATUS_BITS.map((n, i) => [n, !!((a.status >> i) & 1)]));
      this._set({ link: 'ok', errors: 0, output: !!a.output, temp: a.temp, aux: a.aux, bits, ...live, mode: bits.cc ? 'CC' : 'CV' });
      if (++this._tick % SLOW_EVERY === 0) await this.pollSlow();
    } catch (e) { this._fail(e); }
  }

  async pollSlow() {
    const s = await this.psu.readMany(['setV', 'setI', 'setOVP', 'setOCP', 'setOPP', ...SWITCHES]);
    this._set({ set: s });
  }

  // --- writes ---------------------------------------------------------
  _guard() { if (!this.writesEnabled) throw new Error('writes disabled'); }

  // Re-read until matches(value) or verifyTimeoutMs passes; returns the last value read.
  async _readBack(read, matches) {
    const until = Date.now() + this.verifyTimeoutMs;
    for (;;) {
      const rb = await read();
      if (matches(rb) || Date.now() >= until) return rb;
      await sleep(VERIFY_EVERY_MS);
    }
  }

  // write, then read back and confirm; surfaces mismatch instead of trusting the echo
  async _write(name, value, doWrite) {
    debug.log('write', name, value);
    await doWrite();
    const want = await this.psu.quantize(name, value);
    const rb = await this._readBack(() => this.psu.read(name), (v) => Math.abs(v - want) <= 1e-6);
    await this.pollSlow();
    if (Math.abs(rb - want) > 1e-6) throw new Error(`${name}: wrote ${want}, device reads ${rb}`);
    return rb;
  }

  // With OVP armed the voltage setpoint must stay <= the OVP limit, else turning the output on trips
  // OVP, which latches until a power cycle. Uses the switch/setpoint state from the last slow poll.
  // ponytail: state can lag a front-panel change by one slow poll (~2 s); re-read first if that bites.
  _ovpCheck(setV, setOVP, armed, msg) {
    if (armed && setV > setOVP + 1e-9) throw new RangeError(msg(setV.toFixed(2), setOVP.toFixed(2)));
  }

  async setVoltage(v) {
    this._guard();
    const s = this.state.set || {};
    this._ovpCheck(v, s.setOVP, !!s.ovpSw, (u, o) => `Voltage ${u} V is above the OVP limit ${o} V. Raise OVP first, or turn OVP off.`);
    return this._write('setV', v, () => this.psu.setVoltage(v));
  }
  async setCurrent(a) { this._guard(); return this._write('setI', a, () => this.psu.setCurrent(a)); }

  async setOVP(v) {
    this._guard();
    const max = this.state.limits.vmax * PROT_HEADROOM;
    if (!(v > 0 && v <= max)) throw new RangeError(`OVP ${v} outside 0..${max.toFixed(1)}`);
    const s = this.state.set || {};
    this._ovpCheck(s.setV, v, !!s.ovpSw, (u, o) => `OVP ${o} V would be below the voltage setpoint ${u} V. Lower the voltage first, or turn OVP off.`);
    return this._write('setOVP', v, () => this.psu.write('setOVP', v));
  }
  async setOCP(a) {
    this._guard();
    const max = this.state.limits.imax * PROT_HEADROOM;
    if (!(a > 0 && a <= max)) throw new RangeError(`OCP ${a} outside 0..${max.toFixed(2)}`);
    return this._write('setOCP', a, () => this.psu.write('setOCP', a));
  }
  // SetOPP (0x0022-23) is 32-bit; FC06 can't write it atomically → read-only here.

  // Output ON is gated; OFF never is.
  async setOutput(on) {
    if (on) this._guard();
    debug.log('output', on);
    await this.psu.setOutput(on);
    const rb = await this._readBack(() => this.psu.readRaw('output'), (v) => !!v === on);
    if (!!rb !== on) throw new Error(`output: wrote ${on}, device reads ${rb}`);
    return on;
  }

  async setSwitch(name, on) {
    this._guard();
    if (!SWITCHES.includes(name)) throw new Error(`not a switch: ${name}`);
    if (name === 'ovpSw' && on) {
      const s = this.state.set || {};
      this._ovpCheck(s.setV, s.setOVP, true, (u, o) => `Can't turn OVP on: voltage setpoint ${u} V is above the OVP limit ${o} V. Lower the voltage or raise OVP first.`);
    }
    debug.log('switch', name, on);
    await this.psu.write(name, on);
    const rb = await this._readBack(() => this.psu.readRaw(name), (v) => !!v === on);
    if (!!rb !== on) throw new Error(`${name}: wrote ${on}, device reads ${rb}`);
    await this.pollSlow();
    return on;
  }
}
