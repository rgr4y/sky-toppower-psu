// Console debug logging flag. Off by default. Persisted in localStorage when available,
// ?debug=1 forces it on. Everything uses debug.log(); nothing prints while off.
const KEY = 'stp2s.debug';
const read = () => { try { return globalThis.localStorage?.getItem(KEY) === '1'; } catch { return false; } };
const write = (v) => { try { globalThis.localStorage?.setItem(KEY, v ? '1' : '0'); } catch {} };

export const debug = {
  on: read(),
  set(v) { this.on = !!v; write(this.on); if (this.on) console.debug('[stp2s] debug logging ON'); },
  log(...a) { if (this.on) console.debug('[stp2s]', ...a); },
};
