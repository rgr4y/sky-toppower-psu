import { Transport } from './transport.js';

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const asc = (u8) => [...u8].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
const ts = (ms) => { const d = new Date(ms); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };

// One line per chunk, hexdump style: "12:00:00.123 TX 01 03 00 05 00 01 94 0b  |........|"
// Optional label (e.g. register names) is appended after the byte count.
export function formatTrace(dir, u8, at = Date.now(), label = '') {
  return `${ts(at)} ${dir} ${hex(u8).padEnd(23 * 3 - 1)}  |${asc(u8)}|  ${u8.length}B${label ? '  ' + label : ''}`;
}

// Wraps any Transport; when `enabled`, reports every byte in either direction.
// Off by default, toggle at runtime: t.enabled = true. Sink gets formatted lines (and raw {dir,bytes,at}).
export class TracedTransport extends Transport {
  // annotate(dir, u8) → short label for the line, or '' (see ModbusPSU.traceLabeler)
  constructor(inner, { enabled = false, sink = () => {}, max = 2000, annotate = () => '' } = {}) {
    super();
    this.inner = inner; this.enabled = enabled; this.sink = sink; this.annotate = annotate;
    this.lines = []; this.max = max;
    this._data = () => {};
    inner.onData((u8) => { this._log('RX', u8); this._data(u8); });
  }
  _log(dir, u8) {
    if (!this.enabled) return;
    const at = Date.now();
    const line = formatTrace(dir, u8, at, this.annotate(dir, u8));
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.shift();
    this.sink(line, { dir, bytes: Uint8Array.from(u8), at });
  }
  async write(u8) { this._log('TX', u8); return this.inner.write(u8); }
  async open(spec) { return this.inner.open(spec); }
  async close() { return this.inner.close(); }
  onData(cb) { this._data = cb; }
  onStatus(cb) { this.inner.onStatus(cb); }
  get isOpen() { return this.inner.isOpen; }
  clear() { this.lines.length = 0; }
}
