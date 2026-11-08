# PROGRESS

## 2026-11-07 — Project bootstrap + protocol research

**Outcome**
- Protocol found in vendor docs: Modbus RTU, 9600 8N1, slave 1, FC03/FC06 only. See `docs/PROTOCOL.md`.
- XY esphome/web bones copied; XY register specifics replaced with TODO skeleton.

**Changed files:** everything (new repo)

**Verification**
- Vendor example CRCs recomputed (CRC-16/MODBUS): all match.
- Not run: ESPHome config validation, any PSU/serial access (by instruction).

**Follow-up**
- Probe per `docs/NEXT_STEPS.md`.

## 2026-11-07 — WebSerial Modbus stack (PC control)

**Outcome**
- JS stack: `modbus/rtu.js` (frames) → `modbus/client.js` (queue/timeouts) → `psu/base.js` (map-driven) → `psu/stp2s.js` (map). Transport layer copied from dps150 (WebSerial + loopback). Minimal `src/index.html` panel.
- Did not reuse the XY C++ lib (Arduino-only); XY repo untouched. ESPHome parked.
- Vendor sheet typo: read-response CRC printed `FD AF`, real is `B9 AF`. Corrected earlier claim in `docs/PROTOCOL.md`.

**Verification**
- `npm test`: 12/12 pass (CRC vendor vectors, fake-device loopback: scaling, clamp, bits, timeout, queue recovery).
- Not run: browser panel, any hardware.

**Follow-up**
- Probe on hardware (NEXT_STEPS): confirm decimals nibble order, scales, 0x0004 meaning.
- Daemon transport (dps150 `seriald`) not ported; add if WebSerial single-tab ownership bites.

## 2026-11-07 — Hardware confirmation

**Outcome**
- Live unit answers at 9600 8N1 slave 1. Reads, SetU/SetI writes and output on/off confirmed; decimals reg 0x0233 → 0.01 V / 0.001 A / 0.001 W, limits 32 V / 10.2 A / 326.4 W. Details in `docs/PROTOCOL.md`.
- Float fix in `psu/base.js`: divide by 10^dec instead of multiplying by 10^-dec (10200 → 10.200000000000001 before).

**Verification**
- `npm test` 13/13. `tools/probe.py` (FC03-only) + two inline write sessions on hardware, setpoints restored, output left off.
- Not run: browser panel against the device.

**Follow-up**
- OCP ON at 0.500 A confirmed by Rob (panel shows 3.33 V / 0.500 A): expect trips on loads >0.5 A. Scales confirmed.
- Compare SetU/SetI against front-panel display, load test, CC/CV bit polarity, TEMP/APS units.

## 2026-11-07 — Session close: protocol + hardware teardown

**Outcome**
- Protocol confirmed on the live unit: Modbus RTU, slave 1, 9600 default (now 19200 via panel BPS; menu offers only 9600/19200; front-switch power cycle applies it). Scales, limits, 32-bit P, CV/CC (bit6), OCP trip (bit3), BEEP bit, output on/off, setpoint writes. Details: `docs/PROTOCOL.md`.
- Controller identified: STM8S005K6T6C (LQFP32), 4-hole row likely SWIM (V/SWIM/GND/NRST?, untraced), SWIM GND = output −. Details: `docs/HARDWARE.md`.
- Power: flyback T1 aux → 5.1 V rail (CN1); QC USB port back-feeds that rail and runs the STM8 with no mains; COM port (CH340) is an isolated island that powers from USB alone. Front switch gates the aux rail (acts as cold boot).
- Host exe static look: no buzzer trigger/duration register in the vendor UI; beep is only the 0x0041 enable.

**Changed files:** `src/` (rtu, client, base, stp2s, transports, panel), `tests/`, `tools/probe.py`, `docs/PROTOCOL.md`, `docs/HARDWARE.md`, `README.md`

**Verification**
- `npm test` 13/13. Hardware: FC03 reads, FC06 writes (SetU, output, beep switch), output on with load (CV/CC/OCP), baud 9600→19200, USB-only reads. Setpoints/beep restored; output left off.
- Not run: browser panel against the device, exception replies, OVP/OPP/OTP trips, NO power-up test (0x0045), firmware dump, register scan.

**Follow-up**
- Untested/inferred: `E1` meaning, what `APS` measures (13.4 V mains, 7.5 V on USB), CN1 − vs output − continuity, ST-Link option-byte read for ROP (do not touch ROP without RM0016).
- Vendor sheet typo: read-response CRC `FD AF` is really `B9 AF`.

## 2026-11-07 — Web control finished + validation checklist

**Outcome**
- `src/ui/controller.js` (polling, write gating, clamps, readback verify, link-lost) + full panel in `src/index.html`: live V/A/W, CV/CC, trip chips, temp/aux, limits, set V/A, OVP/OCP values, OVP/OCP/OPP/lock/beep/NO switches, connect/disconnect, USB-unplug handling, raw log.
- `docs/VALIDATION.md`: automated, smoke, hardware-done, browser+device steps for Rob, gaps, safety invariants.
- Doc fix: SetI/SetOCP 300 = 0.300 A (I had written 3.000 A in PROTOCOL.md); the test caught it and the OCP trip is consistent with 0.3 A.

**Verification**
- `npm test` 20/20. Panel script `node --check`, all ids present, headless Chrome loads clean.
- Not run: the panel against the device (needs the WebSerial port picker click): VALIDATION.md section D.

**Follow-up**
- Run VALIDATION.md D on the bench; tick items. OVP/OCP write range and trip behaviours still unknown.

## 2026-11-07 — Ported the shared panel (correction)

**Outcome**
- I had written my own minimal panel instead of porting the shared D3806/DPS-150 UI. Fixed: `src/index.html` is now the dps150 panel (ported), with `src/backend.js` + `src/ui/panel-bridge.js` mapping its post()/onUpdate() seams onto `PanelController`/`STP2S`. Charger-only UI hidden; no presets/brightness/OPP-write (no registers). My minimal page moved to `src/diag.html`.
- XY's `esphome/web/panel.html` (ESPHome REST/SSE flavour of the same UI) stays parked in `esphome/`.

**Verification**
- `npm test` 24/24. Ported page + diag page load in headless Chrome with no console errors, all assets 200.
- Not run: the panel against the device (VALIDATION.md D).

**Follow-up**
- Optional: `styles.scss` needs `sass` to rebuild (not installed); `styles.css` copied prebuilt.
- Optional: drop unused `charge/` and `transport/daemon.js` / `select.js` if the charger/daemon never come over.

## 2026-11-07 — Serial trace + console debug toggles

**Outcome**
- `TracedTransport` (`src/transport/tap.js`): every TX/RX chunk as `HH:MM:SS.mmm TX 01 03 ... |ascii|  nB`; off by default.
- Settings → Debug in the panel (and on `diag.html`): "Console debug logging" (`[stp2s]` link/post/write logs + `[serial]` bytes in the console, persisted, `?debug=1`) and "Serial trace" (on-page pane with Clear/Copy/Save, `?trace=1`).

**Verification**
- `npm test` 29/29. Headless Chrome: both pages load; `?debug=1` prints the debug-on line; toggles present.
- Not run: the toggles against live traffic (VALIDATION.md 14a-c).

## 2026-11-08 — Fix: panel writes never reached the device

**Root cause:** `PanelController` stored `setTimeout` on the instance and called it as `this._st(...)`. Browsers throw `TypeError: Illegal invocation` for that (Node doesn't, so the tests passed). `start()` threw right after the first slow poll, so connect failed, `bridge` was never set, and `DPSBackend.post()` silently dropped every panel action: no live polling, no serial writes, output toggle dead. Reproduced in headless Chrome before the fix.

**Fix:** wrap timers (`(...a) => setTimeoutFn(...a)`), plus a regression test that fails if a timer is invoked with a receiver. Setpoints are now optimistic and debounced: the panel is updated at once, writes are coalesced (150 ms, last value wins), run off the UI path, and the controller's readback corrects the panel on a mismatch; polls don't clobber a pending value. Output toggle tells the panel only after the device confirms.

**Verification:** `npm test` 34/34; headless Chrome repro of the Illegal-invocation throw (before). Not run: the fixed panel against the device (VALIDATION.md D 1-8).

## 2026-11-08 — make dev

**Outcome:** `make dev` = build `src/styles.css` from `styles.scss` (sass), then `sass --watch` + `serve src -l 8150` together (Ctrl-C kills both). `make serve` builds css first. sass + serve added as devDependencies; the unused Tailwind scripts renamed `tw:*`.

**Verification:** ran `make dev`: server 200 on :8150; appending a rule to `styles.scss` appeared in `styles.css` within 3 s, removing it removed it; processes and port cleaned up. No live-reload (reload the browser).

## 2026-11-08 — Polish round, cleanup, OCP toggle

**Outcome**
- Removed the Tailwind scaffolding, which nothing used. `src/charge/`, `transport/{select,daemon}.js` and `proto/wire.js` stay because `index.html` loads them; the HANDOFF was wrong to list them as unused.
- Fixed bugs:
  - `ModbusClient` left a stale timeout armed after a failed send. It killed the next request's wait.
  - `PanelBridge` called its injected timers and `warn` as methods, the same Illegal invocation class as `a1cf3bf`.
  - `backend.js` disconnected the PSU when any other serial device was unplugged.
- UI pass:
  - 3-decimal current and 32 V / 10 A stepper limits.
  - Keyboard-operable steppers, focus outlines, aria labels and text contrast, and a layout that fits a 375px phone.
  - Connect help names the CH340 and the COM port, and Reconnect closes a still-open port first.
  - The trace keeps its scroll position.
- The external temp-probe UI is commented out (no way to attach a probe). The charger and daemon code is kept.
- New OCP enable toggle (register `0x0043`) in the Protection section. It follows the device readback only and is disabled while the link is down.

**Commits:** `997cb01` cleanup, `91547de` code polish, `e76fbe1` UI polish, `1185122` OCP toggle.

**Verification**
- `npm test` passes 37/37, including regression tests for both bridge/client bugs and for the OCP switch.
- Headless Chrome: the page loads with no console errors. With a stubbed backend, the OCP pill sends nothing while the link is down and only flips when the echo arrives.
- **Nothing has been run against the device yet**, including the `a1cf3bf` fix from the previous session.

**Follow-up**
- Bench pass: `docs/VALIDATION.md` section D, plus the OCP toggle (flip it, then check the front panel and read back `0x0043`).
- Protection trip bits (OVP/OCP/OPP/OTP) are never sent to the panel, so the fault card never shows a trip.
- U-IN always reads `--.-`; either feed it or remove it.
- Leftover hidden D3806/ESP code in `index.html` (diagnostics, calibration, mode switch, M1–M6).

## 2026-11-08 — Trace labels and modal, U-IN, charger fixes

**Outcome**
- The serial trace and console debug label each frame with its register names, e.g. `read vout iout pout` and `write ocpSw`. A reply carries the names of its request, or `exception`.
- Clicking the trace log opens it in a near-full-page `<dialog>` with an Autoscroll checkbox (on by default). ✕ or Esc closes it.
- U-IN shows APS (`0x0004`, the aux rail) for display only. It is kept out of the charger's Vin.
- The TEMP label was lost in the UI rebuild and has been restored. It was not a caching issue: the dev server already sends `no-store`.
- Charger:
  - The Vin gate and buck-headroom warning are removed. They came from the D3806, which has an external-input buck; the STP2S has a fixed internal rail. Before this, Start could never enable.
  - The PSU/Charger mode switch is back as a panel-local toggle. It is refused while a charge is running, and the bridge no longer forces PSU mode on link-up.
  - If the absorb voltage gets capped (by OVP or by the PSU max of 32.00 V from `0x0014`), a toast explains it. The Absorb row shows a "capped" tag.

**Commits:** `c909702` `dc59bd7` `714118d` `07dc4dc` `a0c9a3e` `0d67a53` `d7a4654`

**Verification**
- `npm test` passes 39/39.
- Headless Chrome, no console errors:
  - The trace modal opens, closes and puts the log back.
  - The mode toggle shows charger mode.
  - 8S Li-ion triggers the cap toast.
- None of this has been run on the device. No charge has been started.

**Follow-up**
- Run the bench pass (`docs/VALIDATION.md` section D).
- Run a real charge on a sacrificial pack.

## 2026-11-08 — Protection UI, reconnect fix, OVP lockout

**Outcome**
- Protection toggles:
  - OVP/OCP/OPP enable toggles, one shared handler (regs `0x0042`-`0x0044`).
  - A brief "OVP turns on OCP" link was reverted: Rob's bench check showed the front OCP key/lamp covers OCP only.
- Face pills OVP/OCP/OPP next to CV/CC: grey = off, blue = armed, red blinking = tripped (PS `0x0002` bits 2-4). Hovering or focusing a pill shows an instant tooltip with state and limit.
- OVP/OTP trip:
  - A full-page modal `<dialog>` blocks the app until a fresh read shows the flag clear, i.e. after a power cycle and reconnect.
  - It has its own Reconnect button, and Esc can't close it.
- OVP guard in the controller, which all writes go through. While OVP is armed, three writes are refused:
  - a voltage setpoint above OVP
  - an OVP limit below the setpoint
  - turning OVP on while the setpoint is above OVP
- Refused or failed writes now show as a toast.
- Reconnect fixes:
  - Auto-reconnect (and connect on page load) reuses a CH340 the page already has permission for (`navigator.serial.getPorts()`); before, it always skipped.
  - `controller.start()` tolerates 3 failures instead of 1.
  - `WebSerialTransport.close()` waits for the read loop to release its lock before closing the port.
- Config fields no longer get overwritten mid-edit by the ~2 s re-read of the limits (the OVP field was losing its input).
- Absorb-cap toast only shows in the charge view or while charging.
- U-IN is hidden in charger mode.
- PROTOCOL notes:
  - The front panel tops out at 32.00 V.
  - The front OCP key/lamp covers OCP only.
  - An OVP trip needs a power cycle.

**Commits:** `13dd2f1` … `4433581` (`git log 1108f35..4433581`).

**Verification**
- `npm test` passes 43/43, including new tests for the start retries, the OVP guard, the switch mapping and the trip bits.
- Headless Chrome, no console errors: pills, tooltip, trip overlay (survives a real Esc, closes when the flag clears), the editor surviving a poll update (the old code fails that check), and the panel's toast.
- On the device, Rob: the trip overlay works.
- Not run on the device: the reconnect fixes and the OVP guard.

**Follow-up**
- ~~Does the PSU stop answering Modbus while OVP-locked?~~ No: it keeps answering and reports the flag (Rob).
- OTP trip (bit 5) untested, tabled (Rob, 2026-11-08). Threshold is fixed/unknown, so it needs a slow heat test with a TEMP-readout stop limit of ~70 °C (manual gives no OTP value; fan starts at 60 °C internal, so OTP is above that).

## 2026-11-08 — SWIM: ROP confirmed, RAM mapping

**Outcome**
- `stm8flash` is built from source into `tmp/` (gitignored). `tmp/1.sh` reads the option bytes, `tmp/2.sh` does a guarded dump.
- The SWIM link works; header order is V/SWIM/GND/NRST.
- Flash, EEPROM and option bytes read back all `0x00`, so readout protection is on and the firmware can't be dumped. RAM is readable.
- Mapping by setting values and diffing RAM dumps (`tools/setdump.py`):
  - SetU is at RAM `0x01C4` (BE, 0.01 V)
  - Modbus TX buffer at `0x02CB`
  - V-SET display digits at `0x000E`/`0x000D`/`0x0007`
- After a SWIM read, the MCU stays halted until `stm8flash -R`.

**Verification:** three dumps tracked SetU 2000 → 321 → 247; the setpoint was restored to 2000 and the output stayed off throughout. Dumps are in `docs/dumps/`; notes are in `docs/HARDWARE.md`.

**Follow-up**
- OPP write test, next time the unit is on mains. Output off: two FC06 writes to `0x0022`/`0x0023` with readback, and try FC16. Then restore 326.4 W.
- Map SetI, OVP and OCP in RAM with the same set/dump diff if needed.
