# Next steps

## 1. First safe probe (read-only) — NOT yet run

Link: **9600 baud, 8N1, no flow control**, slave **0x01**, the selected serial port. PSU output off, no load. Close any other holder of the port first.

Frames (all FC03; CRCs recomputed locally):

| Purpose | Frame |
|---|---|
| decimals (0x0005) — do this first | `01 03 00 05 00 01 94 0B` |
| live U,I,P(hi,lo) (0x0010, 4 words) | `01 03 00 10 00 04 45 CC` |
| status/temp/aux/decimals (0x0002, 4 words) | `01 03 00 02 00 04 E5 C9` |
| Umax, Imax, Pmax (0x0014, 4 words) | `01 03 00 14 00 04 04 0D` |
| protection setpoints (0x0020, 4 words) | `01 03 00 20 00 04 45 C3` |
| SetU, SetI (0x0030, 2 words) | `01 03 00 30 00 02 C4 04` |

Or: `make serve`, Connect in the panel, leave "enable writes" off. The panel only issues reads (vmax/imax, decimals, live, status) until you tick it.

Probe (send one frame, wait ≥50 ms idle first, 500 ms read timeout):

```sh
python3 -I - <<'PY'
import serial,time
s=serial.Serial(input("Serial port: "),9600,8,'N',1,timeout=0.5)
time.sleep(0.1); s.reset_input_buffer()
s.write(bytes.fromhex('01 03 00 05 00 01 94 0B')); print(s.read(32).hex(' '))
PY
```

Expect `01 03 02 xx xx CRC`. Exception reply = `01 83 NN CRC`. No reply → check BPS/ADDR in panel menu (hold button 1), then try 0x9999 read only if address unknown (`01 03 99 99 00 01 …` — compute CRC first).

Compare every readback to the front panel (SetU/SetI vs display) to fix scales. Writes (0x0001, 0x0030, 0x0031) come only after reads match; first write test with no load and V set low.

## 2. ESPHome integration (DEFERRED — PC control via WebSerial first; see src/)

- `esphome/sky-toppower-psu.yaml` skeleton already uses `modbus_controller`: 9600 8N1, FC03 holding reads, FC06 for number/switch.
- Open questions: (a) Does ESPHome split reads >4 words, or will 0x0010–0x0013 plus extra sensors in one batch get exception 03? Keep poll ranges ≤4 words or use multiple controllers/skip_updates. (b) `bitmask` switch on 0x0001 may read-modify-write; use a plain number/`write_lambda` writing 0/1. (c) Scale: derive from 0x0005 in a lambda instead of fixed `multiply`.
- Hardware: USB-C COM is CH340 over USB. ESP32 can't be a USB host to CH340 on C3 cheaply, so options: (1) tap the PSU's internal MCU UART/CH340 TX/RX pads (check logic level, 3.3 V vs 5 V — unmeasured); (2) ESP32-S3 USB host + CH34x driver (ESPHome support: ?). Needs opening the case — decide with Rob.
- Port from XY yaml only after basics work: soft-start (likely unneeded: no boost stage?), charge engine (needs temp input; PSU has TEMP reg 0x0003), profiles.
- Panel: strip XY-only cards (Vin, ext NTC, charge engine) or port the entity ids.

## 3. XY repo web changes picked up (task 2)

Recent `esphome/` commits touch only two files:

- `esphome/web/panel.html` — 0e5274c (footer firmware build date/time), 65e9c47 (Settings view, per-stage charge current), a2e0dcd, 962c392, 1a78569, 40abc91, 88005cb
- `esphome/xy-sk120.yaml` — e7af496, 65e9c47, 82bc2bf, a2e0dcd, b0f6aef, 2ba7bb1, 962c392, 916223d

Copied at working-tree state (`esphome/` clean in XY): `web/panel.html`, `web/panel_handler.h`, `web/gen_panel.py`, `common.yaml`, `web.yaml`, `Makefile`, `.gitignore`; plus `build-css.sh`, `tailwind.config.js`, `package.json`, `package-lock.json`, `data/css/input.css`, `LICENSE`, `.gitignore`. Skipped: PlatformIO firmware/`lib`/`src`, `data/` UI, `old/`, `test/`, vendor PDFs, `secrets.yaml`.

## 4. Unknown

See "Gaps" in PROTOCOL.md. Biggest: scales, TTL access for ESP32, whether doc V25 matches this unit's firmware (menu VER). Optional: disassemble the V20 exe (REA) or sniff the Windows app for ground truth.
