import { Transport } from './transport.js';
import { encode, decode, b64FromBytes, bytesFromB64 } from '../proto/wire.js';

// Browser-side WS client talking the wire protocol to the seriald daemon.
// Ctor takes an injectable WebSocket impl so tests can run over a real
// in-process `ws` socket instead of a browser WebSocket global.
export class DaemonTransport extends Transport {
  constructor(url, id, { WebSocketImpl } = {}) {
    super();
    this.url = url;
    this.id = id;
    this.WS = WebSocketImpl || globalThis.WebSocket;
    this.ws = null;
    this._open = false;
    this._dataCb = () => {};
    this._statusCb = () => {};
    this._readyPromise = null;
  }

  _addMessageListener(fn) {
    // Browser WebSocket and `ws`'s WebSocket both support addEventListener,
    // but guard with .on(...) for any injected impl that only offers the
    // Node EventEmitter-style API (no addEventListener).
    if (typeof this.ws.addEventListener === 'function') {
      this.ws.addEventListener('message', fn);
    } else {
      this.ws.on('message', (data) => fn({ data }));
    }
  }

  _removeMessageListener(fn) {
    if (typeof this.ws.removeEventListener === 'function') {
      this.ws.removeEventListener('message', fn);
    } else if (typeof this.ws.off === 'function') {
      this.ws.off('message', fn);
    }
  }

  _ready() {
    if (this.ws && this.ws.readyState === 1) return Promise.resolve();
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = new Promise((resolve, reject) => {
      this.ws = new this.WS(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      // Permanent routing listener: dispatches `data`/`status` frames for
      // this transport's id. Installed separately from any one-shot
      // handshake listener (e.g. in open()) so neither clobbers the other.
      this._addMessageListener((ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString();
        const m = decode(raw);
        if (!m || m.id !== this.id) return;
        if (m.t === 'data') this._dataCb(bytesFromB64(m.b64));
        else if (m.t === 'status') this._statusCb(m.state, m.msg);
      });
    });
    return this._readyPromise;
  }

  async open(spec) {
    await this._ready();
    // PortManager.resolve() needs a `path` or `match` to find a device.
    // Callers with a real device selection always supply one of those; if
    // neither is given (e.g. a generic contract-test spec like `{id}`),
    // fall back to using the transport id as the path so resolution still
    // succeeds without overriding an explicit match-based lookup.
    const openSpec = { id: this.id, ...spec };
    if (!openSpec.path && !openSpec.match) openSpec.path = this.id;
    await new Promise((resolve, reject) => {
      // Guard against double-settle / leaked listeners: the daemon can only
      // ever send ONE of {opened, error, status:error} for this open attempt,
      // but be defensive anyway (same pattern as the probe in select.js).
      let settled = false;
      const onMsg = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString();
        const m = decode(raw);
        if (!m || m.id !== this.id) return;
        if (m.t === 'opened') {
          if (settled) return;
          settled = true;
          this._removeMessageListener(onMsg);
          resolve();
        } else if (m.t === 'error' || (m.t === 'status' && m.state === 'error')) {
          // Daemon-side open failure (e.g. PortManager found no matching
          // device, or the underlying port errored while opening). Without
          // this, open() would hang forever — this transport's contribution
          // to Rob's busy/zombie-port hangs.
          if (settled) return;
          settled = true;
          this._removeMessageListener(onMsg);
          reject(new Error(m.msg || 'daemon open failed'));
        }
      };
      this._addMessageListener(onMsg);
      this.ws.send(encode({ t: 'open', ...openSpec }));
    });
    this._open = true;
  }

  async write(u8) {
    this.ws.send(encode({ t: 'write', id: this.id, b64: b64FromBytes(u8) }));
  }

  async close() {
    if (this.ws) this.ws.send(encode({ t: 'close', id: this.id }));
    this._open = false;
    if (this.ws) this.ws.close();
    this.ws = null;
    this._readyPromise = null;
  }

  onData(cb) { this._dataCb = cb; }
  onStatus(cb) { this._statusCb = cb; }

  get isOpen() { return this._open; }
}
