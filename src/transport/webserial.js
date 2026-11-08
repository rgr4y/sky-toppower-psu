import { Transport } from './transport.js';

// Browser-only: wraps a navigator.serial port. Not unit-tested headless —
// navigator.serial has no meaningful Node/test-runner equivalent.
export class WebSerialTransport extends Transport {
  constructor(port) {
    super();
    this.port = port;
    this._open = false;
    this._dataCb = () => {};
    this._statusCb = () => {};
    this._reader = null;
  }

  async open(spec) {
    await this.port.open({ baudRate: spec.baud || 115200 });
    if (spec.rts) {
      try { await this.port.setSignals({ requestToSend: true }); } catch {}
    }
    this._open = true;
    this._statusCb('open');
    this._loop = this._readLoop();
  }

  async _readLoop() {
    try {
      this._reader = this.port.readable.getReader();
      for (;;) {
        const { value, done } = await this._reader.read();
        if (done) break;
        if (value) this._dataCb(new Uint8Array(value));
      }
    } catch (e) {
      this._statusCb('error', String(e));
    } finally {
      try { this._reader?.releaseLock(); } catch {}
    }
  }

  async write(u8) {
    const w = this.port.writable.getWriter();
    try {
      await w.write(u8);
    } finally {
      w.releaseLock();
    }
  }

  async close() {
    try { await this._reader?.cancel(); } catch {}
    await this._loop;   // the loop releases the reader lock in finally; port.close() rejects while it's held
    try { await this.port.close(); } catch (e) { console.warn('serial close:', e); }
    this._open = false;
    this._statusCb('closed');
  }

  onData(cb) { this._dataCb = cb; }
  onStatus(cb) { this._statusCb = cb; }

  get isOpen() { return this._open; }
}
