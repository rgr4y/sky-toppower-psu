import { debug } from './debug.js';

// Settings toggles + serial trace view, shared by the panel and diag page. Binds by id if present:
//   #traceToggle  on-page ASCII trace of every serial byte (TX/RX)
//   #debugToggle  console debug logging (also captures serial traffic to the console)
//   #traceLog (pre) #traceClear #traceCopy #traceSave
//   Clicking #traceLog moves it into a near-full-page modal (<dialog>) with an autoscroll box; X puts it back.
//   In the Electron app (window.electronAPI) it moves into its own window instead, so the panel stays usable.
// state: { trace: bool, get(): TracedTransport|null }. Returns the sink for TracedTransport.
export function bindTraceUI(doc, state) {
  const el = (id) => doc.getElementById(id);
  const log = el('traceLog');
  const apply = () => { const t = state.get(); if (t) t.enabled = state.trace || debug.on; };

  // "Hide reads": drop Modbus FC 0x03 requests and every RX chunk after them (replies can arrive
  // split) until the next TX, except exception replies. Writes, write replies, and stray bytes stay.
  // Only filters the on-page log; Copy/Save still get every line.
  let quiet = false, inRead = false;
  const isNoise = ({ dir, bytes } = {}) => {
    if (!bytes) return false;
    if (dir === 'TX') return (inRead = bytes[1] === 0x03);
    return inRead && bytes[1] !== 0x83;
  };

  const sink = (line, raw) => {
    if (debug.on) console.debug('[serial] ' + line);
    if (isNoise(raw) && quiet) return;
    if (!state.trace || !log) return;
    log.textContent += line + '\n';
    const lines = log.textContent.split('\n');
    if (lines.length > 600) log.textContent = lines.slice(-500).join('\n');
    if (auto) log.scrollTop = log.scrollHeight;
  };

  let auto = true;
  // Electron app: the trace lives in its own window, tied to #traceToggle (on opens it, closing it
  // turns trace off); the in-page <pre> stays hidden while it's home in Settings.
  const electron = !!doc.defaultView?.electronAPI;
  let openPop = null, closePop = null;
  if (electron && log) log.hidden = true;
  if (log && doc.createElement('dialog').showModal) bindModal();
  function bindModal() {
    const style = doc.createElement('style');
    style.textContent = `
      dialog.trace-modal{ width:96vw; height:92vh; max-width:none; max-height:none; padding:0; border:1px solid #30363d; border-radius:10px; background:#0d1117; color:#c9d1d9; }
      dialog.trace-modal::backdrop{ background:#000a; }
      dialog.trace-modal[open]{ display:flex; flex-direction:column; }
      dialog.trace-modal header{ display:flex; align-items:center; gap:14px; padding:8px 12px; font:13px system-ui,sans-serif; border-bottom:1px solid #30363d; }
      dialog.trace-modal header b{ flex:1; }
      dialog.trace-modal header button{ font-size:18px; line-height:1; padding:2px 10px; background:none; color:inherit; border:1px solid #30363d; border-radius:6px; cursor:pointer; }
      dialog.trace-modal pre{ flex:1; height:auto !important; margin:0 !important; border-radius:0 0 10px 10px !important; }`;
    doc.head.appendChild(style);
    const dlg = doc.createElement('dialog');
    dlg.className = 'trace-modal';
    dlg.setAttribute('aria-label', 'Serial trace');
    dlg.innerHTML = '<header><b>Serial trace</b><label><input type="checkbox" class="quiet"> Hide reads</label><label><input type="checkbox" class="auto" checked> Autoscroll</label><button type="button" aria-label="Close">✕</button></header>';
    doc.body.appendChild(dlg);
    const [box, qbox, x] = [dlg.querySelector('input.auto'), dlg.querySelector('input.quiet'), dlg.querySelector('button')];
    box.onchange = () => { auto = box.checked; if (auto) log.scrollTop = log.scrollHeight; };
    qbox.onchange = () => { quiet = qbox.checked; };
    const home = doc.createComment('traceLog');
    log.addEventListener('click', () => {
      if (dlg.open) return;
      if (electron) { popOut(); return; }
      log.replaceWith(home); dlg.appendChild(log);
      dlg.showModal(); log.focus();
      if (auto) log.scrollTop = log.scrollHeight;
    });
    x.onclick = () => dlg.close();
    dlg.addEventListener('close', () => { home.replaceWith(log); if (auto) log.scrollTop = log.scrollHeight; }); // also covers Esc

    // Same-origin about:blank popup: the opener can move the live <pre> into it, and sink() keeps
    // writing to it there. Closing the popup (or reloading/closing the panel) puts it back.
    let pop = null;
    function popOut() {
      const win = doc.defaultView;
      if (pop && !pop.closed) { pop.focus(); return; }
      pop = win.open('about:blank', 'stp2s-trace', 'popup,width=900,height=700');
      if (!pop) return;
      const pd = pop.document;
      pd.title = 'Serial trace';
      pd.head.innerHTML = `<link rel="stylesheet" href="${new URL('/styles.css', win.location.href)}"><style>
        html,body{ height:100%; margin:0; padding:0; background:#0d1117; color:#c9d1d9; }
        body{ display:flex; flex-direction:column; }
        header{ display:flex; align-items:center; gap:14px; padding:8px 12px; font:13px system-ui,sans-serif; border-bottom:1px solid #30363d; }
        header b{ flex:1; }
        pre.tracelog{ flex:1; height:auto; margin:0; border:0; border-radius:0; }</style>`;
      pd.body.innerHTML = `<header><b>Serial trace</b><label><input type="checkbox" class="quiet"${quiet ? ' checked' : ''}> Hide reads</label><label><input type="checkbox" class="auto"${auto ? ' checked' : ''}> Autoscroll</label></header>`;
      const [pbox, pq] = [pd.querySelector('input.auto'), pd.querySelector('input.quiet')];
      pbox.onchange = () => { auto = box.checked = pbox.checked; if (auto) log.scrollTop = log.scrollHeight; };
      pq.onchange = () => { quiet = qbox.checked = pq.checked; };
      log.hidden = false;
      log.replaceWith(home); pd.body.appendChild(log);
      if (auto) log.scrollTop = log.scrollHeight;
      const back = () => {
        if (home.isConnected) home.replaceWith(log);
        pop = null; log.hidden = true;
        const t = el('traceToggle');
        state.trace = false; if (t) t.checked = false; apply();
      };
      pop.addEventListener('pagehide', back);
      win.addEventListener('pagehide', () => { pop?.close(); }, { once: true });
    }
    openPop = popOut; closePop = () => pop?.close();
  }

  const tt = el('traceToggle');
  if (tt) {
    tt.checked = state.trace;
    tt.onchange = () => { state.trace = tt.checked; apply(); if (electron) (tt.checked ? openPop : closePop)?.(); };
    if (electron) {
      tt.closest('.field')?.querySelector('small')?.replaceChildren('every TX/RX byte, hex + ASCII, in its own window');
      if (state.trace) openPop?.(); // ?trace=1
    }
  }
  const dt = el('debugToggle');
  if (dt) { dt.checked = debug.on; dt.onchange = () => { debug.set(dt.checked); apply(); }; }

  const text = () => (state.get()?.lines.join('\n') ?? log?.textContent ?? '');
  if (el('traceClear')) el('traceClear').onclick = () => { state.get()?.clear(); if (log) log.textContent = ''; };
  const flash = (b, msg) => { const t = b.textContent; b.textContent = msg; setTimeout(() => { b.textContent = t; }, 1200); };
  const cp = el('traceCopy');
  if (cp) cp.onclick = () => navigator.clipboard?.writeText(text()).then(() => flash(cp, 'Copied'), () => flash(cp, 'Failed'));
  if (el('traceSave')) el('traceSave').onclick = () => {
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(new Blob([text() + '\n'], { type: 'text/plain' }));
    a.download = 'stp2s-serial-trace.txt'; a.click(); URL.revokeObjectURL(a.href);
  };
  return { sink, apply };
}
