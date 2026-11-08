import { app, BrowserWindow, ipcMain, net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC_DIR = path.join(import.meta.dirname, 'src');
const CH340 = { usbVendorId: 0x1a86, usbProductId: 0x7523 }; // the STP2S COM port, same as src/backend.js

// src/ is the same static site `npm run serve` hosts, and it uses root-absolute URLs
// ('/backend.js', '/styles.css', history.pushState('/panel')). Under file:// those resolve
// against the filesystem root, so src/ is served from a privileged custom scheme instead:
// https://www.electronjs.org/docs/latest/api/protocol#protocolhandlescheme-handler
// `secure` makes it a secure context, which WebSerial requires.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveSrc(request) {
  const { pathname } = new URL(request.url);
  // Same rewrites as src/serve.json: the panel's routes all render index.html.
  const isPanelRoute = pathname === '/' || pathname === '/panel' || pathname.startsWith('/panel/');
  const filePath = path.join(SRC_DIR, isPanelRoute ? 'index.html' : decodeURIComponent(pathname));
  const relative = path.relative(SRC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return new Response('Not found', { status: 404 });
  }
  return net.fetch(pathToFileURL(filePath).toString());
}

const isAppOrigin = (origin) => origin?.startsWith('app://');
const isCh340 = (port) =>
  Number(port.vendorId) === CH340.usbVendorId && Number(port.productId) === CH340.usbProductId;

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const { session } = mainWindow.webContents;

  // WebSerial: Electron has no port picker; navigator.serial.requestPort() waits until this
  // handler calls back. Pick the CH340, or, if it isn't plugged in yet, keep the request open
  // and pick it when it appears.
  // https://www.electronjs.org/docs/latest/tutorial/devices#web-serial-api
  session.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    const port = portList.find(isCh340);
    if (port) {
      callback(port.portId);
      return;
    }
    const onAdded = (event, addedPort) => {
      if (!isCh340(addedPort)) return;
      session.off('serial-port-added', onAdded);
      callback(addedPort.portId);
    };
    session.on('serial-port-added', onAdded);
  });

  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return permission === 'serial' && isAppOrigin(details.securityOrigin);
  });

  session.setDevicePermissionHandler((details) => {
    return details.deviceType === 'serial' && isAppOrigin(details.origin);
  });

  mainWindow.loadURL('app://psu/');
};

// The CH340 reports no USB serial number, so Chromium can't keep a lasting grant for it
// (setDevicePermissionHandler is never asked) and every plug-in needs requestPort(), which
// needs a user gesture. executeJavaScript's userGesture flag supplies one, so the panel can
// connect without a click. Resolves once the port is granted (see select-serial-port above).
ipcMain.handle('serial:request-psu-port', (event) =>
  event.sender.executeJavaScript(
    `navigator.serial.requestPort({ filters: [${JSON.stringify(CH340)}] }).then(() => true)`,
    true,
  ),
);

app.whenReady().then(() => {
  protocol.handle('app', serveSrc);
  createWindow();

  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
