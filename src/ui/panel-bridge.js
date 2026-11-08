import { debug } from './debug.js';

// Adapter between the shared D3806/DPS-150 panel (src/index.html) and PanelController.
// The panel talks through two seams: post(domain, obj, action, value) and
// onUpdate('domain/object_id', {value}). This file maps those onto STP2S state. No DOM here.
//
// Numeric setpoints are optimistic: the panel is told the new value immediately, writes are
// debounced (last value wins while the user scrolls), run off the UI path, and the device's
// readback (done by the controller) corrects the panel if the device took something else.

const SETPOINTS = {            // panel obj → { controller method, state.set key }
  set_voltage:     { fn: 'setVoltage', key: 'setV' },
  set_current:     { fn: 'setCurrent', key: 'setI' },
  cfg_max_voltage: { fn: 'setOVP', key: 'setOVP' },
  cfg_max_current: { fn: 'setOCP', key: 'setOCP' },
};

const SWITCHES = { ovp_enable: 'ovpSw', ocp_enable: 'ocpSw', opp_enable: 'oppSw' }; // panel switch obj → controller switch register

export class PanelBridge {
  // api: { onUpdate(key, data), setLink(bool), setCap(obj, max) }
  constructor(controller, api, warn = console.warn, { debounceMs = 150, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
    this.ctl = controller;
    this.api = api;
    // Wrap, don't store: injected globals called as this.x(...) throw "Illegal invocation" in browsers.
    this.warn = (...a) => warn(...a);
    this._link = null;
    this._chain = Promise.resolve(); // serialize device writes: one at a time
    this._debounce = debounceMs;
    this._st = (...a) => setTimeoutFn(...a);
    this._ct = (...a) => clearTimeoutFn(...a);
    this._pend = new Map();          // obj → { timer, token, resolve }
    this._token = 0;
  }

  // controller.onUpdate(state, patch) → panel keys. Only keys present in patch are sent.
  onState(state, patch) {
    const u = this.api.onUpdate;
    if ('link' in patch) {
      const live = state.link === 'ok';
      if (live !== this._link) { this._link = live; this.api.setLink(live); }
    }
    if ('vout' in patch) u('sensor/output_voltage', { value: patch.vout });
    if ('iout' in patch) u('sensor/output_current', { value: patch.iout });
    if ('pout' in patch) u('sensor/output_power', { value: patch.pout });
    if ('temp' in patch) u('sensor/ntc_onboard', { value: patch.temp });
    if ('aux' in patch) u('sensor/aux_voltage', { value: patch.aux }); // APS reg 0x0004: aux rail, not the buck input
    if ('mode' in patch) u('binary_sensor/cc_mode', { value: patch.mode === 'CC' });
    if ('output' in patch) u('switch/output_enable', { value: patch.output });
    if (patch.bits) for (const k of ['ovp', 'ocp', 'opp', 'otp']) u(`binary_sensor/${k}_trip`, { value: patch.bits[k] }); // PS trip flags
    if (patch.limits) { this.api.setCap('set_voltage', patch.limits.vmax); this.api.setCap('set_current', patch.limits.imax); }
    if (patch.set) {
      const s = patch.set;
      const send = (obj, v) => { if (!this._pend.has(obj)) u('number/' + obj, { value: v }); }; // don't clobber a value the user is still setting
      send('set_voltage', s.setV); send('set_current', s.setI);
      send('cfg_max_voltage', s.setOVP); send('cfg_max_current', s.setOCP);
      u('number/cfg_max_power', { value: s.setOPP });
      for (const [obj, reg] of Object.entries(SWITCHES)) if (reg in s) u('switch/' + obj, { value: !!s[reg] });
    }
  }

  // push the device's current value for a setpoint back to the panel (after a write settles or fails)
  _resync(obj) {
    const v = this.ctl.state?.set?.[SETPOINTS[obj].key];
    if (v !== undefined) this.api.onUpdate('number/' + obj, { value: v });
  }

  _setpoint(obj, value) {
    const v = +value;
    if (!Number.isFinite(v)) { this.warn(`number/${obj}: not a number`); return Promise.resolve(); }
    this.api.onUpdate('number/' + obj, { value: v });           // optimistic: reflect now
    const prev = this._pend.get(obj);
    if (prev) { this._ct(prev.timer); prev.resolve(); }          // superseded by the newer value
    const token = ++this._token;
    return new Promise((resolve) => {
      const timer = this._st(() => {
        const job = () => this.ctl[SETPOINTS[obj].fn](v);
        this._chain = this._chain.then(job, job).then(() => {}, (e) => { this.warn(`number/${obj}: ${e.message}`); })
          .then(() => {
            if (this._pend.get(obj)?.token === token) { this._pend.delete(obj); this._resync(obj); } // newer value pending? leave it
            resolve();
          });
      }, this._debounce);
      this._pend.set(obj, { timer, token, resolve });
    });
  }

  // Panel post() → controller. Unsupported objs are ignored (no STP2S register / read-only).
  post(domain, obj, action, value) {
    debug.log('post', domain, obj, action, value);
    const ctl = this.ctl;
    if (domain === 'number' && SETPOINTS[obj]) return this._setpoint(obj, value);
    if (domain === 'number' && obj === 'cfg_max_power') this.warn('OPP is read-only (32-bit register)');
    if (domain === 'switch' && obj === 'output_enable') {
      const on = action === 'turn_on';
      const job = async () => {
        try { await ctl.setOutput(on); this.api.onUpdate('switch/output_enable', { value: on }); }
        catch (e) { this.warn(`switch/output_enable: ${e.message}`); if (ctl.state?.output !== undefined) this.api.onUpdate('switch/output_enable', { value: ctl.state.output }); }
      };
      // OFF must never wait behind a stuck queue: run it immediately.
      if (!on) return job();
      return (this._chain = this._chain.then(job, job));
    }
    if (domain === 'switch' && SWITCHES[obj]) {
      const on = action === 'turn_on', reg = SWITCHES[obj];
      const job = async () => {
        try { await ctl.setSwitch(reg, on); this.api.onUpdate('switch/' + obj, { value: on }); }
        catch (e) { this.warn(`switch/${obj}: ${e.message}`); const v = ctl.state?.set?.[reg]; if (v !== undefined) this.api.onUpdate('switch/' + obj, { value: !!v }); }
      };
      return (this._chain = this._chain.then(job, job));
    }
    return Promise.resolve();
  }
}
