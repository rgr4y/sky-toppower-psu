export function parseTempLine(line) {
  const s = line.trim();
  if (!s) return null;
  if (s[0] === '{') { try { const o = JSON.parse(s); return sane(o); } catch { return null; } }
  if (s.includes('=')) {
    const o = {};
    for (const pair of s.split(',')) {
      const [k, v] = pair.split('=');
      if (k && v !== undefined && v.trim() !== '' && Number.isFinite(Number(v))) o[k.trim()] = Number(v);
    }
    return Object.keys(o).length ? o : null;
  }
  // A bare number is the pack temperature — matches single-probe firmware that
  // just prints Celsius + newline (no channel name).
  const n = Number(s);
  if (Number.isFinite(n)) return { pack: n };
  return null;
}
function sane(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return Object.keys(out).length ? out : null;
}

export class TempReader {
  constructor({ staleMs = 4000 } = {}) { this.staleMs = staleMs; this.buf = ''; this.cb = () => {}; this.seen = new Map(); this._dec = new TextDecoder(); }
  onReading(cb) { this.cb = cb; }
  push(chunk) { this.pushAt(chunk, this._now()); }
  pushAt(chunk, t) {
    this.buf += (typeof chunk === 'string') ? chunk : this._dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
      const channels = parseTempLine(line);
      if (channels) { for (const k of Object.keys(channels)) this.seen.set(k, { v: channels[k], t }); this.cb({ channels, t }); }
    }
  }
  latest(channel) { return this.seen.get(channel)?.v; }
  isStale(channel, now) { const e = this.seen.get(channel); return !e || (now - e.t) > this.staleMs; }
  _now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
}
