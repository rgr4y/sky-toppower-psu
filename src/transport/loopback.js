import { Transport } from './transport.js';

class LoopbackEnd extends Transport {
  constructor() { super(); this._open = false; this._dataCb = () => {}; this._statusCb = () => {}; this.peer = null; }
  async open() { this._open = true; this._statusCb('open'); }
  async close() { this._open = false; this._statusCb('closed'); }
  async write(u8) { if (this.peer && this.peer._open) this.peer._dataCb(Uint8Array.from(u8)); }
  onData(cb) { this._dataCb = cb; }
  onStatus(cb) { this._statusCb = cb; }
  get isOpen() { return this._open; }
}

export class LoopbackTransport {
  static pair() {
    const a = new LoopbackEnd(); const b = new LoopbackEnd();
    a.peer = b; b.peer = a; return [a, b];
  }
}
