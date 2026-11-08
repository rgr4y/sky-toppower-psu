import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoopbackTransport } from '../../src/transport/loopback.js';
import { TracedTransport, formatTrace } from '../../src/transport/tap.js';

test('formatTrace: hex + printable ascii + length', () => {
  const l = formatTrace('TX', Uint8Array.from([0x01, 0x03, 0x41, 0x7f, 0x20, 0x7e]), Date.UTC(2026, 0, 1, 12, 0, 0, 7));
  assert.match(l, /^\d\d:\d\d:\d\d\.007 TX 01 03 41 7f 20 7e +\|\.\.A\. ~\|  6B$/);
});

test('off by default: nothing logged, data still flows both ways', async () => {
  const [a, b] = LoopbackTransport.pair(); await a.open(); await b.open();
  const lines = [];
  const t = new TracedTransport(a, { sink: (l) => lines.push(l) });
  const rx = []; t.onData((u) => rx.push([...u]));
  b.onData(() => {});
  await t.write(Uint8Array.from([1, 2]));
  await b.write(Uint8Array.from([9, 8]));
  assert.deepEqual(rx, [[9, 8]]); assert.deepEqual(lines, []);
});

test('on: TX and RX both logged, runtime toggle, ring cap, clear', async () => {
  const [a, b] = LoopbackTransport.pair(); await a.open(); await b.open();
  const lines = [];
  const t = new TracedTransport(a, { sink: (l, r) => lines.push([l, r.dir, [...r.bytes]]), max: 3 });
  t.onData(() => {}); b.onData(() => {});
  t.enabled = true;
  await t.write(Uint8Array.from([0x48, 0x69]));          // "Hi"
  await b.write(Uint8Array.from([0x4f, 0x4b]));          // "OK"
  assert.equal(lines.length, 2);
  assert.deepEqual([lines[0][1], lines[0][2]], ['TX', [0x48, 0x69]]);
  assert.deepEqual([lines[1][1], lines[1][2]], ['RX', [0x4f, 0x4b]]);
  assert.match(lines[0][0], /\|Hi\|/); assert.match(lines[1][0], /\|OK\|/);
  t.enabled = false; await t.write(Uint8Array.from([1])); assert.equal(lines.length, 2);
  t.enabled = true; for (let i = 0; i < 5; i++) await t.write(Uint8Array.from([i]));
  assert.equal(t.lines.length, 3); t.clear(); assert.equal(t.lines.length, 0);
});

test('delegates open/close/isOpen/onStatus', async () => {
  const [a] = LoopbackTransport.pair();
  const t = new TracedTransport(a); const st = [];
  t.onStatus((s) => st.push(s));
  await t.open(); assert.equal(t.isOpen, true); await t.close(); assert.equal(t.isOpen, false);
  assert.deepEqual(st, ['open', 'closed']);
});
