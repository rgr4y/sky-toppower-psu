import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoopbackTransport } from '../../src/transport/loopback.js';
import { STP2S } from '../../src/psu/stp2s.js';
import { PanelController } from '../../src/ui/controller.js';
import { crc16 } from '../../src/modbus/rtu.js';

// Fake STP2S slave: FC03/06, max 4 words, optional "stuck" regs that ignore writes, optional mute,
// optional lag: a write only shows up in reads after `lag` FC03 replies (the real unit applies late).
function device(regs, { stuck = [], mute = false, dropFirst = 0, lag = 0 } = {}) {
  const [host, dev] = LoopbackTransport.pair();
  const send = (b) => { const c = crc16(Uint8Array.from(b)); dev.write(Uint8Array.from([...b, c & 255, c >> 8])); };
  const writes = [];
  let pending = [];
  dev.onData((f) => {
    if (mute || dropFirst-- > 0) return;
    const fc = f[1], addr = (f[2] << 8) | f[3], n = (f[4] << 8) | f[5];
    if (fc === 3) {
      pending = pending.filter((p) => { if (p.left-- > 0) return true; regs[p.addr] = p.n; return false; });
      if (n > 4) return send([1, 0x83, 3]);
      const o = [1, 3, n * 2]; for (let i = 0; i < n; i++) { const v = regs[addr + i] ?? 0; o.push(v >> 8, v & 255); } send(o);
    } else if (fc === 6) {
      writes.push([addr, n]);
      if (stuck.includes(addr)) {} else if (lag) pending.push({ addr, n, left: lag }); else regs[addr] = n;
      send([...f.subarray(0, 6)]);
    }
  });
  return { host, dev, regs, writes };
}

const BASE = { 5: 0x0233, 0x14: 3200, 0x15: 10200, 0x16: 4, 0x17: 64256, 0x20: 3840, 0x21: 300, 0x22: 4, 0x23: 64256, 0x30: 1243, 0x31: 300, 2: 0x0002, 3: 24, 4: 134 };

async function setup(extra = {}, opts) {
  const d = device({ ...BASE, ...extra }, opts);
  await d.host.open(); await d.dev.open();
  const psu = new STP2S(d.host, { baud: 115200, timeoutMs: 80 });
  const updates = [];
  const c = new PanelController(psu, { onUpdate: (s, p) => updates.push(p), setTimeoutFn: () => 0, clearTimeoutFn: () => {}, verifyTimeoutMs: 300 });
  return { d, psu, c, updates };
}

test('start + poll: scaled live values, bits, mode, aux/temp', async () => {
  const { c } = await setup({ 1: 1, 0x10: 365, 0x11: 100, 0x12: 0, 0x13: 365, 2: 0x0042 });
  await c.start();
  await c.poll();
  const s = c.state;
  assert.equal(s.link, 'ok'); assert.equal(s.limits.vmax, 32); assert.equal(s.limits.imax, 10.2);
  assert.equal(s.vout, 3.65); assert.equal(s.iout, 0.1); assert.equal(s.pout, 0.365);
  assert.equal(s.mode, 'CC'); assert.equal(s.bits.cc, true); assert.equal(s.bits.beep, true); assert.equal(s.bits.ocp, false);
  assert.equal(s.output, true); assert.equal(s.temp, 24); assert.equal(s.aux, 13.4);
  assert.equal(s.set.setV, 12.43); assert.equal(s.set.setI, 0.3); assert.equal(s.set.setOCP, 0.3);
});

test('writes gated; output OFF is not', async () => {
  const { d, c } = await setup({ 1: 1 });
  await c.start();
  await assert.rejects(c.setVoltage(5), /writes disabled/);
  await assert.rejects(c.setOutput(true), /writes disabled/);
  assert.equal(d.writes.length, 0);
  await c.setOutput(false);
  assert.equal(d.regs[1], 0);
});

test('setVoltage: clamped to vmax, readback verified, rounds to device resolution', async () => {
  const { d, c } = await setup();
  await c.start(); c.writesEnabled = true;
  assert.equal(await c.setVoltage(5), 5); assert.equal(d.regs[0x30], 500);
  assert.equal(await c.setVoltage(5.004), 5); // quantized, no false mismatch
  await assert.rejects(c.setVoltage(33), RangeError);
  assert.equal(d.regs[0x30], 500);
});

test('readback mismatch surfaces (device ignores the write)', async () => {
  const { c } = await setup({}, { stuck: [0x30] });
  await c.start(); c.writesEnabled = true;
  await assert.rejects(c.setVoltage(5), /device reads 12\.43/);
});

test('readback waits out a device that applies writes late (output, setpoint, switch)', async () => {
  const { d, c } = await setup({ 1: 0 }, { lag: 2 });
  await c.start(); c.writesEnabled = true;
  assert.equal(await c.setOutput(true), true); assert.equal(d.regs[1], 1);
  assert.equal(await c.setVoltage(5), 5); assert.equal(d.regs[0x30], 500);
  assert.equal(await c.setSwitch('beepSw', true), true); assert.equal(d.regs[0x41], 1);
});

test('OVP/OCP limits (1.2x) enforced; OPP not exposed', async () => {
  const { d, c } = await setup();
  await c.start(); c.writesEnabled = true;
  await c.setOVP(38.4); assert.equal(d.regs[0x20], 3840);
  await assert.rejects(c.setOVP(39), RangeError);
  await c.setOCP(2); assert.equal(d.regs[0x21], 2000);
  await assert.rejects(c.setOCP(13), RangeError);
  assert.equal(c.setOPP, undefined);
});

test('switch writes: only known names, verified', async () => {
  const { d, c } = await setup();
  await c.start(); c.writesEnabled = true;
  await c.setSwitch('beepSw', true); assert.equal(d.regs[0x41], 1);
  await c.setSwitch('ocpSw', true); assert.equal(d.regs[0x43], 1);
  assert.equal(c.state.set.ocpSw, 1);
  await assert.rejects(c.setSwitch('setV', true), /not a switch/);
  await assert.rejects(c.setSwitch('address', true), /not a switch/); // 0x9999 never written from the UI
});

test('link lost after repeated failures, recovers', async () => {
  const { c, d } = await setup();
  await c.start();
  d.dev.onData(() => {}); // device goes mute
  for (let i = 0; i < 3; i++) await c.poll();
  assert.equal(c.state.link, 'lost'); assert.match(c.state.lastError, /no response/);
  // revive
  const [host2] = [d.host];
  d.dev.onData((f) => {
    const addr = (f[2] << 8) | f[3], n = (f[4] << 8) | f[5], o = [1, 3, n * 2];
    for (let i = 0; i < n; i++) { const v = d.regs[addr + i] ?? 0; o.push(v >> 8, v & 255); }
    const x = crc16(Uint8Array.from(o)); d.dev.write(Uint8Array.from([...o, x & 255, x >> 8]));
  });
  await c.poll();
  assert.equal(c.state.link, 'ok'); assert.equal(c.state.errors, 0);
});

test('default timers are called unbound (browsers throw "Illegal invocation" otherwise)', async () => {
  // Strict-mode functions get this=undefined when called bare; a method call would pass the controller.
  const calls = [];
  const strictTimer = function (fn, ms) { calls.push(this); return 0; };
  const { psu } = await setup();
  const c = new PanelController(psu, { setTimeoutFn: strictTimer, clearTimeoutFn: function () { calls.push(this); } });
  await c.start(); c.stop();
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((t) => t === undefined), 'timer invoked with a receiver');
});

test('start retries like polling: dropped replies right after open still connect; a mute PSU ends lost', async () => {
  const ok = await setup({}, { dropFirst: 2 });
  await ok.c.start(); ok.c.stop();
  assert.equal(ok.c.state.errors, 0); assert.ok(ok.c.state.limits.vmax === 32);
  const mute = await setup({}, { mute: true });
  await mute.c.start();
  assert.equal(mute.c.state.link, 'lost'); assert.equal(mute.c.state.errors, 3);
});

test('OVP armed: voltage above OVP refused; OVP below voltage refused; arming OVP refused when V > OVP', async () => {
  // setV 12.43 V, OVP 38.40 V (BASE); arm OVP via reg 0x42
  const { d, c } = await setup({ 0x42: 1 });
  await c.start(); c.writesEnabled = true;
  await assert.rejects(c.setVoltage(38.5), /above the OVP limit 38.40 V/);
  await assert.rejects(c.setOVP(10), /below the voltage setpoint 12.43 V/);
  assert.equal(d.writes.length, 0);
  await c.setVoltage(30);                       // under OVP: fine
  assert.equal(d.regs[0x30], 3000);
  await c.setSwitch('ovpSw', false);            // OVP off: no constraint
  await c.setOVP(10);
  await assert.rejects(c.setSwitch('ovpSw', true), /Can't turn OVP on: voltage setpoint 30.00 V is above the OVP limit 10.00 V/);
  assert.equal(d.regs[0x42], 0);
});
