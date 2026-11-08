import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFrame, writeFrame, crc16, frameLength, parseResponse, ModbusError } from '../../src/modbus/rtu.js';

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const bytes = (s) => Uint8Array.from(s.split(' ').map((h) => parseInt(h, 16)));

// Vectors from vendor sheet (docs/PROTOCOL.md).
test('vendor example frames', () => {
  assert.equal(hex(readFrame(1, 0x10, 1)), '01 03 00 10 00 01 85 cf');
  assert.equal(hex(readFrame(1, 0x11, 1)), '01 03 00 11 00 01 d4 0f');
  assert.equal(hex(writeFrame(1, 1, 1)), '01 06 00 01 00 01 19 ca');
  assert.equal(hex(writeFrame(1, 1, 0)), '01 06 00 01 00 00 d8 0a');
});

test('vendor read response 1.00V (sheet CRC FD AF is a typo; wire CRC is B9 AF)', () => {
  const r = bytes('01 03 02 00 64 b9 af');
  assert.equal(frameLength(r), 7);
  assert.deepEqual(parseResponse(r, 1, 3), [0x64]);
});

test('exception + bad crc', () => {
  const body = Uint8Array.from([1, 0x83, 2]);
  const c = crc16(body);
  const ex = Uint8Array.from([...body, c & 255, c >> 8]);
  assert.equal(frameLength(ex), 5);
  assert.throws(() => parseResponse(ex, 1, 3), (e) => e instanceof ModbusError && e.code === 2);
  assert.throws(() => parseResponse(bytes('01 03 02 00 64 00 00'), 1, 3), /CRC/);
});

test('frameLength waits for more bytes', () => {
  assert.equal(frameLength(bytes('01 03 02 00')), 0);
});
