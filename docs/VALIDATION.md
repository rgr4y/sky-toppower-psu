# Validation checklist

Legend: ✅ done (evidence) · ☐ to do · ⚠ known gap. Last updated 2026-11-07.

## A. Automated (no hardware) — `npm test`

- ✅ 34/34 pass (adds optimistic-setpoint/debounce/resync bridge tests, unbound-timer regression test; earlier 29: adds traced-transport format/toggle/ring-cap tests and the debug flag; also the panel-bridge: state→panel keys, post routing, unsupported ignored, failed write reported, OFF bypasses the queue): CRC vs vendor frames, exception parsing, framing, queue/timeout recovery, register scaling, 32-bit P, sign-magnitude temp, merged reads, panel controller (poll, gating, clamps, readback verify, link-lost/recover).
- ✅ Fake device enforces the vendor limits: FC03 max 4 words, FC06 single word.

## B. Panel static/smoke (no WebSerial)

- ✅ Inline module script passes `node --check`; every element id the script uses exists.
- ✅ `/` (ported panel) and `/diag.html` load in headless Chrome with no console errors; backend, styles, charge and transport assets all 200; connect overlay shows with STP2S title.
- ⚠ Not exercised: any real `navigator.serial` flow (needs a human click for the port picker).

## C. Hardware, confirmed earlier today (see PROTOCOL.md / HARDWARE.md)

- ✅ Modbus RTU, slave 1, 9600 → 19200 (panel BPS + front-switch power cycle); menu offers only 9600/19200.
- ✅ Reads: decimals 0x0233, limits 32 V / 10.2 A / 326.4 W, live V/I/P (32-bit P low word 0x0013), status bits (BEEP, CC=bit6, OCP trip=bit3), TEMP °C, switches.
- ✅ Writes (FC06 echo + readback): SetU, SetI, OUTPUT on/off, BEEP switch. Output ON with a load: CV→CC→OCP trip, output forced off.
- ✅ STM8 runs from QC USB 5 V with no mains and answers Modbus.

## D. Browser + device — TO DO by Rob (`make serve`, Chrome/Edge, the development server)

Two pages: `/` = the shared D3806/DPS-150 panel ported to the STP2S (`src/index.html` + `src/backend.js`); `/diag.html` = minimal diagnostics page with a write-enable checkbox and the lock/beep/NO/OVP/OCP/OPP switches the main panel lacks.
Setup: COM cable (not QC) in, unit powered, baud 19200, slave 1 (override with `?baud=9600&slave=N`). Start with nothing on the output.

**Main panel (`/`)**

| # | Step | Expect | ☐ |
|---|---|---|---|
| 1 | Click Connect, pick the CH340 | overlay closes, link dot live, PSU mode; V/A/W readouts and sparklines move | ☐ |
| 2 | Idle 30 s | V/A/W ≈ 0, temp ≈ 24-27 °C, no "link lost" modal | ☐ |
| 3 | Steppers: scroll V quickly 5.00 → 5.20 | display follows each step immediately; serial trace shows ONE write (last value) ~150 ms after you stop, then a readback; device shows 5.20 |\n| 3a | Steppers: set V up to 5.00 | device display shows 5.00 V; stepper max = 32 (cap from vmax); set A max 10.2 | ☐ |
| 4 | Type/step V above 32 | refused (console warns `outside 0..32`), device unchanged | ☐ |
| 5 | Output toggle ON (no load) | readout ~5.00 V, CV; toggle OFF: output off, V decays | ☐ |
| 6 | Load pulling more than set A | CC indicator, A ≈ set A, W matches the device display | ☐ |
| 7 | Protection card: OVP 36.0, OCP 2.0 | device values change (check `diag.html` or panel menu); OPP is read-only: edits ignored with a console warning | ☐ |
| 8 | Trip OCP with a load (OCP switch on in `diag.html`) | output turns off on the device; panel shows output OFF | ☐ |
| 9 | Preset row, M1-M6 sync, brightness, display-test, reboot | hidden (no STP2S register) | ☐ |
| 10 | ⏏ disconnect; reconnect | works without page reload; "turn off + disconnect" option turns output off first | ☐ |
| 11 | Unplug USB while connected | overlay returns, no console error; replug and Connect works | ☐ |
| 12 | Wrong baud (`?baud=9600`) | Connect fails with "no valid reply", port released | ☐ |
| 13 | Two tabs | second tab's Connect fails with a clear message | ☐ |
| 14 | Narrow window | usable, no horizontal scroll | ☐ |
| 14a | Settings → Debug: tick "Serial trace", connect, wait | lines like `12:00:00.123 TX 01 03 00 10 00 04 45 cc  \|........\|  8B` and matching `RX` reply (hex + ASCII, newest at bottom); untick stops new lines; Clear/Copy/Save work | ☐ |
| 14b | Tick "Console debug logging", open DevTools console (F12) | `[stp2s]` lines for link, post, write, output; `[serial]` lines for every TX/RX byte; both stop when unticked; setting survives reload (or `?debug=1`) | ☐ |
| 14c | Trace off + debug off | console and trace pane silent during normal use | ☐ |

**Diagnostics page (`/diag.html`)**

| # | Step | Expect | ☐ |
|---|---|---|---|
| 15 | Connect; writes unchecked | all Set/switch/On controls disabled, Output OFF enabled | ☐ |
| 16 | Tick enable writes: Set V 5, Set A 0.5 | ok in log; matches device | ☐ |
| 17 | OCP switch on, trip it | OCP TRIP chip red | ☐ |
| 18 | BEEP / lock toggles | follow device; restore lock | ☐ |
| 19 | NO on, power-cycle with the front switch (low V, no load) | output comes on by itself; set NO off after. Confirms polarity 1 = YES | ☐ |

## E. Hardware gaps — not validated

- ⚠ OVP / OPP / OTP trip behaviour (bits 2/4/5 inferred by analogy to OCP).
- ⚠ Exception replies from the device (codes 01-05 documented, never provoked).
- ⚠ OVP/OCP write range: UI allows up to 1.2 × vmax/imax (OVP default 38.4 V is above vmax). Device may reject sooner (exception 05 expected); unknown.
- ⚠ SetOPP (0x0022-23) is read-only in the UI: 32-bit, FC06 only. Two-write behaviour untested.
- ⚠ Slave address (0x9999) not exposed: a wrong write could lock you out until the panel menu fixes it.
- ⚠ `APS` meaning (13.4 V on mains, 7.5 V on USB), `E1` code, `TEMP` display toggle effect on serial reads.
- ⚠ Firmware dump / ROP, register scan: not attempted (see HARDWARE.md).
- ⚠ Firefox/Safari: no WebSerial; Chrome/Edge only.

## F. Safety invariants (enforced in code + tests)

- ✅ `/diag.html`: writes gated by a checkbox that resets on disconnect; Output OFF never gated. `/`: no gate (the shared panel posts deliberate actions), but clamps, readback verify, and OFF-bypasses-queue still apply.
- ✅ SetV/SetI clamped to the device's reported vmax/imax; non-switch registers cannot be written via `setSwitch`; `0x9999` never written.
- ✅ Every write is read back and compared (after rounding to device resolution); a mismatch is surfaced as an error.
- ✅ Link loss (3 failed polls) shown; Output OFF still attempted when asked.
