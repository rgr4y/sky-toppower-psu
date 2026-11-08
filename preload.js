// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Resolves once the PSU's serial port is granted; waits for it to be plugged in.
  requestPsuPort: () => ipcRenderer.invoke('serial:request-psu-port'),
});
