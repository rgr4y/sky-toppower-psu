// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Resolves once the PSU's serial port is granted; waits for it to be plugged in.
  requestPsuPort: () => ipcRenderer.invoke('serial:request-psu-port'),
});

// Frameless transparent window (main.js): mark the page so styles.scss drops the page
// background, and keep the window height fitted to the content.
window.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  root.classList.add('electron');
  // The logs view is a viewport-sized modal, so it can't size the window; main.js swaps to a
  // big window while it's open. (The serial trace pops out to its own window: src/ui/trace-ui.js.)
  let last = '';
  const fit = () => {
    const body = getComputedStyle(document.body);
    const size = {
      // --panel-w (styles.scss) + body side padding: the window is as wide as the panel column.
      width: parseFloat(getComputedStyle(root).getPropertyValue('--panel-w')) + parseFloat(body.paddingLeft) + parseFloat(body.paddingRight),
      // body, not root.scrollHeight: the root never reports less than the window, so it could only grow.
      height: Math.ceil(document.body.getBoundingClientRect().height),
      big: !!document.querySelector('#logs.active'),
    };
    const key = JSON.stringify(size);
    if (key === last) return; // class mutations are frequent (status pills etc.); only send changes
    last = key;
    ipcRenderer.send('win:fit', size);
  };
  new ResizeObserver(fit).observe(document.body);
  new MutationObserver(fit).observe(document.body, { subtree: true, attributeFilter: ['class'] });
});
