# SKY TOPPOWER STP2S / E22 bench PSU — PC control

32V 10A SKY TOPPOWER bench supply. PC control over its USB-C COM port (CH340, Modbus RTU 19200 8N1 as currently set; 9600 is the other menu option; slave 1) from the browser via WebSerial. The interface is adapted from a shared bench-supply panel.

**Status:** protocol confirmed on hardware (reads, writes, output, CV/CC, OCP trip, baud). Hardware teardown notes in [docs/HARDWARE.md](docs/HARDWARE.md). The panel runs against the device in both the browser and Electron.

- Protocol: [docs/PROTOCOL.md](docs/PROTOCOL.md) · Plan: [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md)
- Vendor docs/software: `vendor/` (excluded from version control)

## Desktop app

The primary way to run the panel is the Electron app ([Electron Forge](https://www.electronforge.io/)):

```sh
npm install
npm start          # build the CSS, then launch the app (same as `make` / `make app`)
npm run package    # build the .app into out/            (make package)
npm run make       # zip + dmg installers into out/make/ (make dist)
```

The app connects by itself: it waits for the STP2S COM port (CH340) and connects when it is plugged in, with no port picker. `main.js` is the Electron main process (serves `src/` and picks the serial port), `preload.js` exposes the one call the panel uses for that, `forge.config.js` is the Forge build config.

## Browser

The same panel still runs in Chrome/Edge over WebSerial, with a Connect button and the browser's port picker:

```sh
make dev     # compile styles.scss, then watch+recompile on change and serve src/ on :8150 (reload the browser after edits)
make serve   # one-shot css build + serve (Chrome/Edge WebSerial); /diag.html for diagnostics; ?baud=9600&slave=1 to override
npm test     # node --test, no hardware
```

## Layout

- `src/modbus/rtu.js` — CRC, FC03/06 frames, response parsing (pure)
- `src/modbus/client.js` — serialized request/response over a Transport, 3.5-char gap, timeouts
- `src/psu/base.js` — `ModbusPSU`: register-map-driven read/write/scale/grouped poll
- `src/psu/stp2s.js` — `STP2S extends ModbusPSU`: the register map. New model = new subclass.
- `src/transport/` — `Transport` interface, WebSerial, loopback (from dps150)
- `src/ui/controller.js` — DOM-free panel logic: polling, write gating, clamps, readback verify, link state (tested)
- `main.js`, `preload.js`, `forge.config.js` — Electron app (see Desktop app above)
- `src/index.html` — the shared D3806/DPS-150 panel (adapted from a shared bench-supply interface: V/A/W readouts + sparklines, steppers, protection, connect modal), driven by `src/backend.js` (WebSerial) and `src/ui/panel-bridge.js` (panel keys ↔ controller). Charger-only features hidden (PSU mode). `styles.css` is built from `styles.scss` (sass; `make dev` rebuilds on change).
- `src/transport/tap.js` — `TracedTransport`: wraps any transport, logs every TX/RX byte as hex + ASCII when enabled (off by default)
- `src/ui/debug.js`, `src/ui/trace-ui.js` — Settings → Debug toggles: console debug logging (`[stp2s]`, `[serial]`; also `?debug=1`) and the on-page serial trace (`?trace=1`)
- `src/diag.html` — minimal diagnostics page: write-enable checkbox, lock/beep/NO/OVP/OCP/OPP switches
- `docs/VALIDATION.md` — checklist: what is verified, what the browser+device pass still needs
- `esphome/` — parked skeleton from the XY repo (XY panel + TODO yaml). Not maintained; ESPHome deferred.
- `src/charge/`, `src/transport/{select,daemon}.js`, `src/proto/wire.js` — dps150 charger/daemon code. Unused by the STP2S, but `src/index.html` still imports them statically, so they stay until the panel drops those imports.

## Notes

- The XY-SK120 C++ lib (`XY-SKxxx`, Arduino/ModbusMaster) is ESP32-only, so it isn't reused; `base.js` mirrors its split (transport/client, register map, cache). XY repo untouched.
- Scales: `decimalsFor()` reads nibbles V=bits 8–11, A=4–7, W=0–3 of reg `0x0005` (device 0x0233 → 0.01 V, 0.001 A, 0.001 W; hardware-confirmed).
- FC03 reads cap at 4 words (vendor); `readMany` merges contiguous registers within that.
