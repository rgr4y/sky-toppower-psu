import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PanelBridge } from '../../src/ui/panel-bridge.js';

function rig() {
  const ups = [], calls = [], link = [], caps = [], warns = [];
  const ctl = new Proxy({}, { get: (_, k) => (...a) => { calls.push([k, ...a]); return Promise.resolve(); } });
  const b = new PanelBridge(ctl, { onUpdate: (k, d) => ups.push([k, d.value]), setLink: (v) => link.push(v), setMode: () => {}, setCap: (o, m) => caps.push([o, m]) }, (m) => warns.push(m), { debounceMs: 0 });
  return { b, ups, calls, link, caps, warns };
}

test('state → panel keys', () => {
  const { b, ups, caps, link } = rig();
  b.onState({ link: 'ok' }, { link: 'ok', vout: 5, iout: 0.1, pout: 0.5, temp: 24, aux: 13.4, mode: 'CC', output: true,
    limits: { vmax: 32, imax: 10.2 }, set: { setV: 12.43, setI: 0.3, setOVP: 38.4, setOCP: 0.3, setOPP: 326.4 } });
  assert.deepEqual(Object.fromEntries(ups), {
    'sensor/output_voltage': 5, 'sensor/output_current': 0.1, 'sensor/output_power': 0.5, 'sensor/ntc_onboard': 24, 'sensor/aux_voltage': 13.4,
    'binary_sensor/cc_mode': true, 'switch/output_enable': true, 'number/set_voltage': 12.43, 'number/set_current': 0.3,
    'number/cfg_max_voltage': 38.4, 'number/cfg_max_current': 0.3, 'number/cfg_max_power': 326.4 });
  assert.deepEqual(caps, [['set_voltage', 32], ['set_current', 10.2]]);
  assert.deepEqual(link, [true]);
});

test('link flips reported once per change', () => {
  const { b, link } = rig();
  b.onState({ link: 'ok' }, { link: 'ok' }); b.onState({ link: 'ok' }, { link: 'ok' });
  b.onState({ link: 'lost' }, { link: 'lost' });
  assert.deepEqual(link, [true, false]);
});

test('post routes to controller; unsupported ignored; OPP warns', async () => {
  const { b, calls, warns } = rig();
  await b.post('number', 'set_voltage', 'set', '5.5');
  await b.post('number', 'set_current', 'set', 1);
  await b.post('number', 'cfg_max_voltage', 'set', 36);
  await b.post('number', 'cfg_max_current', 'set', 2);
  await b.post('switch', 'output_enable', 'turn_on');
  await b.post('switch', 'output_enable', 'turn_off');
  await b.post('number', 'led_brightness', 'set', 5);
  await b.post('switch', 'bench_psu_mode', 'turn_on');
  await b.post('number', 'cfg_max_power', 'set', 100);
  assert.deepEqual(calls, [['setVoltage', 5.5], ['setCurrent', 1], ['setOVP', 36], ['setOCP', 2], ['setOutput', true], ['setOutput', false]]);
  assert.match(warns[0], /OPP is read-only/);
});

test('failed write is reported, queue continues, OFF skips the queue', async () => {
  const warns = [], order = [];
  let release;
  const ctl = {
    setVoltage: () => new Promise((_, rej) => { release = () => rej(new Error('boom')); }),
    setCurrent: async () => { order.push('I'); },
    setOutput: async (on) => { order.push(on ? 'on' : 'off'); },
  };
  const b = new PanelBridge(ctl, { onUpdate() {}, setLink() {}, setMode() {}, setCap() {} }, (m) => warns.push(m), { debounceMs: 0 });
  const p1 = b.post('number', 'set_voltage', 'set', 5);   // stuck
  const p2 = b.post('number', 'set_current', 'set', 1);   // queued behind p1
  await b.post('switch', 'output_enable', 'turn_off');   // must not wait
  assert.deepEqual(order, ['off']);
  await new Promise((r) => setTimeout(r, 5)); // let the (0 ms) debounce fire so setVoltage is in flight
  release(); await p1; await p2;
  assert.deepEqual(order, ['off', 'I']);
  assert.match(warns.join(), /boom/);
});

test('optimistic echo is immediate; debounce coalesces a scroll into one write of the last value', async () => {
  const ups = [], writes = [];
  const ctl = { state: { set: { setV: 5 } }, setVoltage: async (v) => { writes.push(v); ctl.state.set.setV = v; } };
  const b = new PanelBridge(ctl, { onUpdate: (k, d) => ups.push([k, d.value]), setLink() {}, setMode() {}, setCap() {} }, () => {}, { debounceMs: 20 });
  const ps = [6, 7, 8, 9].map((v) => b.post('number', 'set_voltage', 'set', v));
  assert.deepEqual(ups.map((u) => u[1]), [6, 7, 8, 9]);         // panel reflects each step at once, before any write
  assert.deepEqual(writes, []);
  await Promise.all(ps);
  assert.deepEqual(writes, [9]);                                  // one write, last value
  assert.deepEqual(ups.at(-1), ['number/set_voltage', 9]);        // resynced from device state
});

test('poll update does not clobber a pending setpoint; applies after it settles', async () => {
  const ups = [];
  let release;
  const ctl = { state: { set: { setV: 5 } }, setVoltage: () => new Promise((r) => { release = () => { ctl.state.set.setV = 12; r(); }; }) };
  const b = new PanelBridge(ctl, { onUpdate: (k, d) => ups.push([k, d.value]), setLink() {}, setMode() {}, setCap() {} }, () => {}, { debounceMs: 0 });
  const p = b.post('number', 'set_voltage', 'set', 12);
  await new Promise((r) => setTimeout(r, 5));
  b.onState({}, { set: { setV: 5, setI: 1, setOVP: 38, setOCP: 1, setOPP: 300 } });   // stale poll while write in flight
  assert.equal(ups.filter((u) => u[0] === 'number/set_voltage' && u[1] === 5).length, 0);
  assert.ok(ups.some((u) => u[0] === 'number/set_current'));                          // other keys still flow
  release(); await p;
  assert.deepEqual(ups.at(-1), ['number/set_voltage', 12]);
});

test('device took a different value: panel is corrected from device state, warning raised', async () => {
  const ups = [], warns = [];
  const ctl = { state: { set: { setV: 12.43 } }, setVoltage: async () => { throw new Error('setV: wrote 5, device reads 12.43'); } };
  const b = new PanelBridge(ctl, { onUpdate: (k, d) => ups.push([k, d.value]), setLink() {}, setMode() {}, setCap() {} }, (m) => warns.push(m), { debounceMs: 0 });
  await b.post('number', 'set_voltage', 'set', 5);
  assert.deepEqual(ups[0], ['number/set_voltage', 5]);            // optimistic
  assert.deepEqual(ups.at(-1), ['number/set_voltage', 12.43]);    // corrected
  assert.match(warns[0], /device reads 12\.43/);
});

test('output: panel told after the device confirms; failure resyncs to device state', async () => {
  const ups = [];
  const ok = { state: { output: false }, setOutput: async () => {} };
  const b1 = new PanelBridge(ok, { onUpdate: (k, d) => ups.push([k, d.value]), setLink() {}, setMode() {}, setCap() {} }, () => {}, { debounceMs: 0 });
  await b1.post('switch', 'output_enable', 'turn_on');
  assert.deepEqual(ups.at(-1), ['switch/output_enable', true]);
  const bad = { state: { output: false }, setOutput: async () => { throw new Error('nope'); } };
  const b2 = new PanelBridge(bad, { onUpdate: (k, d) => ups.push([k, d.value]), setLink() {}, setMode() {}, setCap() {} }, () => {}, { debounceMs: 0 });
  await b2.post('switch', 'output_enable', 'turn_on');
  assert.deepEqual(ups.at(-1), ['switch/output_enable', false]);
});

test('injected timers + warn are called unbound (browsers throw "Illegal invocation" otherwise)', async () => {
  const recv = [];
  const strict = function () { recv.push(this); return 0; };
  const ctl = { setVoltage: () => Promise.reject(new Error('x')), state: {} };
  const b = new PanelBridge(ctl, { onUpdate() {}, setLink() {}, setMode() {}, setCap() {} }, strict, {
    setTimeoutFn: function (fn) { recv.push(this); fn(); return 1; }, clearTimeoutFn: strict });
  b.post('number', 'set_voltage', 'set', 5); await b.post('number', 'set_voltage', 'set', 6);
  assert.equal(recv.length, 5, String(recv.length)); // 2x set, 1x clear, 2x warn
  assert.ok(recv.every((t) => t === undefined), 'called with a receiver');
});

test('OCP switch: state → panel, panel → setSwitch(ocpSw)', async () => {
  const { b, ups, calls } = rig();
  b.onState({}, { set: { setV: 1, setI: 0.1, setOVP: 2, setOCP: 0.3, setOPP: 3, ocpSw: 1 } });
  assert.deepEqual(ups.find(([k]) => k === 'switch/ocp_enable'), ['switch/ocp_enable', true]);
  await b.post('switch', 'ocp_enable', 'turn_off');
  assert.deepEqual(calls.at(-1), ['setSwitch', 'ocpSw', false]);
  assert.deepEqual(ups.at(-1), ['switch/ocp_enable', false]);
});

test('OVP/OPP switches map to ovpSw/oppSw both ways', async () => {
  const { b, ups, calls } = rig();
  b.onState({}, { set: { ovpSw: 1, oppSw: 0 } });
  assert.deepEqual(ups.filter(([k]) => k.startsWith('switch/')), [['switch/ovp_enable', true], ['switch/opp_enable', false]]);
  await b.post('switch', 'opp_enable', 'turn_on');
  assert.deepEqual(calls.at(-1), ['setSwitch', 'oppSw', true]);
  await b.post('switch', 'ovp_enable', 'turn_off');
  assert.deepEqual(calls.at(-1), ['setSwitch', 'ovpSw', false]);
});

test('protection trip bits → binary_sensor/*_trip', () => {
  const { b, ups } = rig();
  b.onState({}, { bits: { ovp: false, ocp: true, opp: false, otp: false, cc: true } });
  assert.deepEqual(ups, [['binary_sensor/ovp_trip', false], ['binary_sensor/ocp_trip', true], ['binary_sensor/opp_trip', false], ['binary_sensor/otp_trip', false]]);
});
