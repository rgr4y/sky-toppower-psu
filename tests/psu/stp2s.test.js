import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoopbackTransport } from '../../src/transport/loopback.js';
import { STP2S } from '../../src/psu/stp2s.js';
import { crc16 } from '../../src/modbus/rtu.js';

// Fake device on the far end of a loopback: Modbus RTU slave 1, FC03/06 only.
function fakeDevice(regs) {
  const [host, dev] = LoopbackTransport.pair();
  const log = [];
  const send = (b) => { const c = crc16(Uint8Array.from(b)); dev.write(Uint8Array.from([...b, c & 255, c >> 8])); };
  dev.onData((f) => {
    log.push([...f]);
    const [, fc, ah, al, bh, bl] = f; const addr = (ah << 8) | al, n = (bh << 8) | bl;
    if (fc === 3) {
      if (n > 4) return send([1, 0x83, 3]);
      const out = [1, 3, n * 2];
      for (let i = 0; i < n; i++) { const v = regs[addr + i] ?? 0; out.push(v >> 8, v & 255); }
      send(out);
    } else if (fc === 6) { regs[addr] = n; send([...f.subarray(0, 6)]); }
  });
  return { host, dev, regs, log };
}

async function setup(regs) {
  const d = fakeDevice(regs);
  await d.host.open(); await d.dev.open();
  return { d, psu: new STP2S(d.host, { baud: 115200, timeoutMs: 100 }) }; // fast gap for tests
}

test('live read: one 4-word FC03, scaled by decimals reg', async () => {
  const { d, psu } = await setup({ 5: 0x0232, 0x10: 1234, 0x11: 5678, 0x12: 0, 0x13: 700 });
  const v = await psu.live();
  assert.equal(v.vout, 12.34); assert.equal(v.iout, 5.678); assert.equal(v.pout, 7);
  assert.equal(d.log.filter((f) => f[1] === 3 && f[3] === 0x10).length, 1); // single merged read
});

test('write setV scales by decimals; clamps to vmax', async () => {
  const { d, psu } = await setup({ 5: 0x0222, 0x14: 3200, 0x15: 1000 });
  await psu.setVoltage(5);
  assert.equal(d.regs[0x30], 500);
  await assert.rejects(psu.setVoltage(33), RangeError);
  assert.equal(d.regs[0x30], 500); // untouched
});

test('output switch + status bits + sign-magnitude temp', async () => {
  const { d, psu } = await setup({ 2: 0b01000100, 3: 0x8005 });
  await psu.setOutput(true); assert.equal(d.regs[1], 1);
  assert.equal(await psu.read('ocp'), false); assert.equal(await psu.read('ovp'), true); assert.equal(await psu.read('cc'), true);
  assert.equal(await psu.read('temp'), -5);
});

test('exception surfaces as error; queue survives', async () => {
  const { psu } = await setup({ 5: 0x0222 });
  await assert.rejects(psu.client.readRegs(0x10, 4).then(() => psu.client.readRegs(0, 5)), RangeError);
  assert.deepEqual(await psu.client.readRegs(5, 1), [0x0222]);
});

test('no response → timeout, next request still works', async () => {
  const [host] = LoopbackTransport.pair();
  await host.open();
  const psu = new STP2S(host, { baud: 115200, timeoutMs: 30 });
  await assert.rejects(psu.client.readRegs(5, 1), (e) => e.code === 'timeout');
  await assert.rejects(psu.client.readRegs(5, 1), (e) => e.code === 'timeout');
});

test('read-only / multiword writes refused', async () => {
  const { psu } = await setup({});
  await assert.rejects(psu.write('vout', 1), /read-only/);
  await assert.rejects(psu.write('setOPP', 1), /read-only|multi-word/);
});

test('real-device values (0x0233): limits, 32-bit Pmax via two words', async () => {
  const { psu } = await setup({ 5: 0x0233, 0x14: 3200, 0x15: 10200, 0x16: 4, 0x17: 64256 });
  const v = await psu.readMany(['vmax', 'imax', 'pmax']);
  assert.equal(v.vmax, 32); assert.equal(v.imax, 10.2); assert.ok(Math.abs(v.pmax - 326.4) < 1e-9);
});

test('TX failure drops its pending wait (stale timer must not hit the next request)', async () => {
  const { d, psu } = await setup({ 5: 0x0222 });
  const write = d.host.write.bind(d.host);
  d.host.write = async () => { d.host.write = write; throw new Error('port gone'); };
  await assert.rejects(psu.client.readRegs(5, 1), /port gone/);
  assert.equal(psu.client._wait, null);
  assert.deepEqual(await psu.client.readRegs(5, 1), [0x0222]);
});

test('traceLabeler: one name per register, multi-word regs once, replies inherit request', () => {
  const lab = STP2S.traceLabeler();
  const f = (...b) => Uint8Array.from(b);
  assert.equal(lab('TX', f(1, 3, 0x00, 0x10, 0x00, 0x04, 0, 0)), 'read vout iout pout');
  assert.equal(lab('RX', f(1, 3, 8, 0, 0)), 'vout iout pout');
  assert.equal(lab('RX', f(0x12, 0x34)), '');                       // continuation chunk
  assert.equal(lab('TX', f(1, 6, 0x00, 0x43, 0x00, 0x01, 0, 0)), 'write ocpSw');
  assert.equal(lab('RX', f(1, 0x86, 2, 0, 0)), 'exception ocpSw');
  assert.equal(lab('TX', f(1, 3, 0x00, 0x02, 0x00, 0x01, 0, 0)), 'read status'); // bit views don't shadow the word
  assert.equal(lab('TX', f(1, 3, 0x00, 0x06, 0x00, 0x01, 0, 0)), 'read 0x0006');
});
