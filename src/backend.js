// WebSerial backend for the shared panel (src/index.html). Same seam as the dps150 backend:
// the panel calls window.DPSBackend.{attach,connect,post,disconnect,...}.
import { WebSerialTransport } from './transport/webserial.js';
import { TracedTransport } from './transport/tap.js';
import { bindTraceUI } from './ui/trace-ui.js';
import { debug } from './ui/debug.js';
import { STP2S } from './psu/stp2s.js';
import { PanelController } from './ui/controller.js';
import { PanelBridge } from './ui/panel-bridge.js';

const BAUD = 19200;      // unit was set to 19200 via panel BPS (menu offers 9600/19200); override: ?baud=9600
const SLAVE = 1;         // ?slave=N to override
const CH340 = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
const q = new URLSearchParams(location.search);

let panel = null, port = null, transport = null, ctl = null, bridge = null, userClosed = false;

// Flags (Settings → Debug): serial trace (on-page ASCII) and console debug logging. Both off by default;
// ?trace=1 / ?debug=1 start them on, the toggles flip them live.
if (q.get('debug') === '1') debug.set(true);
const trace = { trace: q.get('trace') === '1', get: () => transport };
const traceUI = bindTraceUI(document, trace);

function setCap(obj, max) {
  const stepper = document.querySelector('.stepper[data-obj="' + obj + '"]');
  if (stepper && isFinite(max) && max > 0) stepper.setAttribute('data-max', max.toFixed(2));
}

window.DPSBackend = {
  attach(b) { panel = b; },

  async connect(opts = {}) {
    let p;
    if (opts.auto) {
      // No click available (boot, auto-reconnect): reuse a CH340 this origin was already granted.
      // ponytail: first granted CH340 wins; pick by serial/location if a second adapter ever matters.
      const ports = (await navigator.serial?.getPorts?.()) || [];
      p = ports.find((x) => { const i = x.getInfo(); return i.usbVendorId === CH340.usbVendorId && i.usbProductId === CH340.usbProductId; });
      if (!p) return { mode: 'webserial', skipped: true };   // never granted: the Connect click opens the picker
    } else {
      if (!('serial' in navigator)) { alert('WebSerial not available. Use Chrome/Edge in a secure browser context.'); return { mode: 'webserial', skipped: true }; }
      p = await navigator.serial.requestPort({ filters: [CH340] });
    }
    const baud = +(q.get('baud') || BAUD), slave = +(q.get('slave') || SLAVE);
    const t = new TracedTransport(new WebSerialTransport(p), { enabled: trace.trace || debug.on, sink: traceUI.sink, annotate: STP2S.traceLabeler() });
    await t.open({ baud });
    const psu = new STP2S(t, { slave, baud });
    const c = new PanelController(psu);
    // Refused/failed writes reach the user as a toast (bridge prefixes 'domain/obj: ', drop it there).
    const warn = (m) => { console.warn(m); panel?.toast?.(String(m).replace(/^[\w/]+: /, '')); };
    const b = new PanelBridge(c, { ...panel, setCap }, warn);
    c.onUpdate = (s, p) => b.onState(s, p);
    c.writesEnabled = true;   // this panel posts deliberate user actions; clamps + readback verify stay on
    userClosed = false;
    try {
      await c.start();
      if (c.state.link !== 'ok') throw new Error('no valid reply from the PSU (check baud/slave, use the COM port)');
    } catch (e) { c.stop(); try { await t.close(); } catch {} throw e; }
    ctl = c; bridge = b; transport = t; port = p; traceUI.apply();
    debug.log('connected', { baud, slave });
    t.onStatus((state) => {
      if (state === 'closed' || state === 'error') { ctl?.stop(); ctl = bridge = transport = null; panel?.setLink(false); }
    });
    return { mode: 'webserial', skipped: false };
  },

  post(domain, obj, action, value) { if (bridge) return bridge.post(domain, obj, action, value); },
  setTrace(on) { trace.trace = !!on; traceUI.apply(); },
  setDebug(on) { debug.set(on); traceUI.apply(); },
  isConnected() { return !!ctl; },
  isDaemon() { return false; },
  async shutdownServer() { return false; },
  async writePresets() { throw new Error('STP2S has no memory-slot registers'); },

  async disconnect(opts) {
    debug.log('disconnect', opts || {});
    const c = ctl, t = transport;
    ctl = bridge = transport = null; userClosed = true;
    try {
      if (c && opts && opts.turnOff) await c.setOutput(false);
      c?.stop();
      await t?.close();
    } catch (e) { console.warn('disconnect:', e); }
    panel?.setLink(false);
  },
};
// Fires for any serial device unplugged; only tear down if it was ours.
navigator.serial?.addEventListener('disconnect', (e) => { if (!userClosed && e.target === port) window.DPSBackend.disconnect(); });
