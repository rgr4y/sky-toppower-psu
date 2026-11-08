import { DaemonTransport } from './daemon.js';
import { WebSerialTransport } from './webserial.js';

// Probes the daemon WS at `url`; resolves to daemon mode if it connects
// within `probeMs`, else falls back to webserial (browser-only) mode.
//
// Lives in its own module (not transport.js) to avoid an import cycle:
// daemon.js and webserial.js both import Transport from transport.js, so
// transport.js cannot also import them without `Transport` being accessed
// before its class declaration is initialized (ReferenceError under ESM's
// hoisted import evaluation).
export async function selectTransport({ url, probeMs = 500, WebSocketImpl } = {}) {
  const WS = WebSocketImpl || globalThis.WebSocket;
  const reachable = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const ws = new WS(url);
      const timer = setTimeout(() => { try { ws.close(); } catch {} finish(false); }, probeMs);
      ws.onopen = () => { clearTimeout(timer); try { ws.close(); } catch {} finish(true); };
      ws.onerror = () => { clearTimeout(timer); finish(false); };
    } catch { finish(false); }
  });
  if (reachable) {
    return { mode: 'daemon', makeDaemon: (id) => new DaemonTransport(url, id, { WebSocketImpl: WS }), pickWebSerial: null };
  }
  return {
    mode: 'webserial',
    makeDaemon: null,
    pickWebSerial: async (filters) => new WebSerialTransport(await navigator.serial.requestPort({ filters })),
  };
}
