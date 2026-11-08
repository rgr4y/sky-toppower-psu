import { app, BrowserWindow, ipcMain, net, protocol, screen, shell } from 'electron';
import fs from 'node:fs';
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

const BIG_SIZE = { width: 1100, height: 760 }; // logs view is a viewport-sized modal; give it room
let panelPos = null; // where the panel sat before the logs view moved the window
let mainWin = null; // only the panel window is auto-fitted; the serial-trace popup sizes itself

// Panel position persists across launches (size is content-driven, so only x/y). Electron keeps
// nothing on its own. Saved on every move rather than on close, so killed dev runs keep it too.
const posFile = () => path.join(app.getPath('userData'), 'window-pos.json');
function loadPos() {
  try {
    const { x, y } = JSON.parse(fs.readFileSync(posFile(), 'utf8'));
    // Drop it if that spot is no longer on any display (monitor unplugged).
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      x >= a.x && y >= a.y && x < a.x + a.width - 50 && y < a.y + a.height - 50);
    return onScreen ? { x, y } : {};
  } catch {
    return {};
  }
}
function savePos(win) {
  const [x, y] = panelPos ?? win.getPosition(); // while the logs view has it moved, keep the panel's spot
  try { fs.writeFileSync(posFile(), JSON.stringify({ x, y })); } catch (err) { console.warn('window-pos save failed:', err.message); }
}

const createWindow = () => {
  const mainWindow = (mainWin = new BrowserWindow({
    ...loadPos(),
    // Frameless + transparent: only the floating panel shows. Width = --panel-w in styles.scss
    // + body side padding; height follows the content via 'win:fit' from preload.js.
    width: 784, // placeholder until preload.js reports --panel-w
    height: 860,
    frame: false,
    transparent: true,
    hasShadow: false, // macOS traces the window shadow from alpha (incl. the CSS box-shadow haze) -> stray outline; .psu draws its own
    resizable: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }));

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

  // Serial-trace popup (src/ui/trace-ui.js): a normal framed window, not a copy of the panel's
  // frameless/transparent one. No parent, so it moves independently of the panel.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 900, height: 700, frame: true, transparent: false, hasShadow: true, resizable: true,
        backgroundColor: '#0d1117', title: 'Serial trace',
      } };
    }
    if (url.startsWith('https://')) shell.openExternal(url); // links (topbar byline) open in the default browser
    return { action: 'deny' };
  });

  mainWindow.on('moved', () => savePos(mainWindow));
  mainWindow.loadURL('app://psu/');

  // Dev: reload the page when anything in src/ changes (pair with `npm run watch:css`; see `make app-dev`).
  // main.js / preload.js changes still need a restart: type `rs` in the forge terminal.
  if (!app.isPackaged) {
    let timer;
    const watcher = fs.watch(SRC_DIR, { recursive: true }, () => {
      clearTimeout(timer); // editors and sass write in bursts
      timer = setTimeout(() => mainWindow.webContents.reloadIgnoringCache(), 150);
    });
    mainWindow.on('closed', () => watcher.close());
  }
};

ipcMain.on('win:fit', (event, { width, height, big }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win !== mainWin) return;
  if (big) {
    if (panelPos) return;
    panelPos = win.getPosition();
    win.setContentSize(BIG_SIZE.width, BIG_SIZE.height);
    win.center();
    return;
  }
  // height is CSS px; window size is DIP, so scale both by the page zoom (Cmd +/-/0).
  // Zooming reflows the body, which re-triggers the preload ResizeObserver, so this re-runs.
  const zoom = win.webContents.getZoomFactor();
  if (panelPos) {
    win.setPosition(...panelPos);
    panelPos = null;
  }
  // Cap at the display's work area (taller content scrolls, see styles.scss), and nudge the
  // window up/left so a view that grew (e.g. Configuration) doesn't hang off the bottom.
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const w = Math.min(Math.round(width * zoom), area.width);
  const h = Math.min(Math.ceil(height * zoom), area.height);
  win.setContentSize(w, h);
  const [x, y] = win.getPosition();
  const [ow, oh] = win.getSize();
  const nx = Math.max(area.x, Math.min(x, area.x + area.width - ow));
  const ny = Math.max(area.y, Math.min(y, area.y + area.height - oh));
  if (nx !== x || ny !== y) win.setPosition(nx, ny);
});

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

// macOS About panel reads the bundle's Info.plist, which in dev is Electron's own version.
// app.getVersion() is package.json's version in both dev and packaged builds.
app.setAboutPanelOptions({ applicationVersion: app.getVersion(), version: app.getVersion() });

// Packaged builds get assets/icon.* from forge.config.js (packagerConfig.icon). In dev the stock
// Electron.app icon shows, so set the dock icon (the macOS About panel follows it). assets/ isn't
// packaged, hence dev-only.
const DEV_ICON = path.join(import.meta.dirname, 'assets', 'icon.png');

app.whenReady().then(() => {
  if (!app.isPackaged && process.platform === 'darwin') app.dock.setIcon(DEV_ICON);
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
