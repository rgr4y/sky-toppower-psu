// Modbus RTU framing. Pure functions, no I/O. Shared by every register map.
export function crc16(u8) {
  let c = 0xFFFF;
  for (const b of u8) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >> 1) ^ 0xA001 : c >> 1;
  }
  return c; // send low byte first
}

function withCrc(body) {
  const out = new Uint8Array(body.length + 2);
  out.set(body);
  const c = crc16(body);
  out[body.length] = c & 0xFF;
  out[body.length + 1] = c >> 8;
  return out;
}

export const readFrame = (slave, addr, count) =>
  withCrc([slave, 0x03, addr >> 8, addr & 0xFF, count >> 8, count & 0xFF]);

export const writeFrame = (slave, addr, value) =>
  withCrc([slave, 0x06, addr >> 8, addr & 0xFF, (value >> 8) & 0xFF, value & 0xFF]);

export const crcOk = (f) => f.length > 2 && crc16(f.subarray(0, -2)) === (f[f.length - 2] | (f[f.length - 1] << 8));

// Length of the first complete response frame at the head of `buf`, or 0 if
// more bytes are needed. FC03 = 5+n, FC06 echo = 8, exception (fc|0x80) = 5.
export function frameLength(buf) {
  if (buf.length < 2) return 0;
  const fc = buf[1];
  let n;
  if (fc & 0x80) n = 5;
  else if (fc === 0x03) { if (buf.length < 3) return 0; n = 5 + buf[2]; }
  else if (fc === 0x06) n = 8;
  else return -1; // unknown FC: caller resyncs
  return buf.length >= n ? n : 0;
}

// Vendor error codes (STP2S sheet): 04/05 differ from standard Modbus.
export const EXC = { 1: 'function code', 2: 'data address', 3: 'data length', 4: 'frame', 5: 'data range' };

export class ModbusError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}

// Decode a validated response for the request (slave, fc). Returns words[] for
// FC03, {addr,value} for FC06. Throws ModbusError on exception / mismatch.
export function parseResponse(f, slave, fc) {
  if (!crcOk(f)) throw new ModbusError('crc', 'bad CRC');
  if (f[0] !== slave) throw new ModbusError('slave', `slave ${f[0]} != ${slave}`);
  if (f[1] === (fc | 0x80)) throw new ModbusError(f[2], `exception ${f[2]}: ${EXC[f[2]] ?? 'unknown'}`);
  if (f[1] !== fc) throw new ModbusError('fc', `fc ${f[1]} != ${fc}`);
  if (fc === 0x03) {
    const w = [];
    for (let i = 0; i < f[2]; i += 2) w.push((f[3 + i] << 8) | f[4 + i]);
    return w;
  }
  return { addr: (f[2] << 8) | f[3], value: (f[4] << 8) | f[5] };
}
