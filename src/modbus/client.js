import { readFrame, writeFrame, frameLength, parseResponse, ModbusError } from './rtu.js';

// Serialized request/response over a Transport (transport/*.js). One request in
// flight; ≥3.5-char idle gap before each TX. Resyncs on timeout/garbage.
export class ModbusClient {
  constructor(transport, { slave = 1, baud = 9600, timeoutMs = 500 } = {}) {
    this.t = transport;
    this.slave = slave;
    this.timeoutMs = timeoutMs;
    this.gapMs = Math.max(2, Math.ceil((3.5 * 11 * 1000) / baud)); // 11 bits/char, 8N1+start
    this._buf = [];
    this._wait = null;
    this._chain = Promise.resolve();
    this._lastRx = 0;
    transport.onData((u8) => { this._buf.push(...u8); this._lastRx = Date.now(); this._pump(); });
  }

  _pump() {
    if (!this._wait) { this._buf.length = 0; return; } // unsolicited bytes: drop
    const n = frameLength(this._buf);
    if (n === 0) return;
    const w = this._wait; this._wait = null; clearTimeout(w.timer);
    if (n < 0) { this._buf.length = 0; return w.rej(new ModbusError('frame', 'unknown function code')); }
    const f = Uint8Array.from(this._buf.splice(0, n));
    this._buf.length = 0;
    try { w.res(parseResponse(f, this.slave, w.fc)); } catch (e) { w.rej(e); }
  }

  _txrx(frame, fc) {
    const run = async () => {
      const idle = Date.now() - this._lastRx;
      if (idle < this.gapMs) await new Promise((r) => setTimeout(r, this.gapMs - idle));
      this._buf.length = 0;
      const p = new Promise((res, rej) => {
        const timer = setTimeout(() => { this._wait = null; rej(new ModbusError('timeout', 'no response')); }, this.timeoutMs);
        this._wait = { fc, res, rej, timer };
      });
      // A failed TX must drop its wait: the stale timer would otherwise null the *next* request's
      // _wait and reject an orphaned promise (unhandled rejection).
      try { await this.t.write(frame); } catch (e) { clearTimeout(this._wait.timer); this._wait = null; throw e; }
      return p;
    };
    const out = this._chain.then(run);
    this._chain = out.catch(() => {}); // keep the queue alive after failures
    return out;
  }

  readRegs(addr, count) {
    if (count < 1 || count > 4) throw new RangeError('STP2S: FC03 max 4 words'); // vendor limit
    return this._txrx(readFrame(this.slave, addr, count), 0x03);
  }
  writeReg(addr, value) { return this._txrx(writeFrame(this.slave, addr, value & 0xFFFF), 0x06); }
}
