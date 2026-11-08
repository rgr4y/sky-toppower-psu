# SKY TOPPOWER STP2S / E22 — serial protocol

**Hardware-confirmed 2026-11-07** (Rob's unit, `tools/probe.py` FC03 reads + one SetU write/restore, output off): see "Hardware confirmation" below. Earlier items without that tag remain doc-only.

Status key: **V-doc** = stated in vendor document (primary source, no source code exists); **V-crc** = vendor example frame, CRC recomputed locally and matches; **INF** = inferred; **?** = unknown. Nothing is verified on hardware (port not opened, per brief).

## Sources

| Source | Path | Notes |
|---|---|---|
| Protocol sheet "POWER of ModBusV25" (English) | `vendor/STP2S Series Power Supply Host Computer Installation Program/POWER of ModBusV25.pdf-English(1).pdf` | Register table + examples. Primary. Text layer is garbled; table read from the rendered page. |
| Host-software guide V25 | `vendor/STP2S .../power of ModBusVxxHelpV25.pdf-English(1).pdf` | CH341SER driver, COM select, 9600 default shown in UI. |
| User manual E22xxxx | `vendor/E22xxxx Series Digital Programmable DC Power Supply.docx` | §10: "Modbus RTU"; points to protocol doc "ModBusVxx"; addr/baud must match host. |
| Menu sheet | `vendor/17899726466444b4e3dd89bdca6a16b0a62f458de675c.docx` | Menu: ADDR default 0001, BPS default 9600, OVP default 38.4 (32V model). |
| Host program (not analysed) | `vendor/STP2S .../Installation Program for power with ModBusV20.exe` | Windows VB6 app (MSCOMM32.OCX). Ground truth candidate; not disassembled, not run. |
| Manufacturer site (cited by manual, not fetched) | https://www.skytoppower.com → SUPPORT → DOCUMENT | |

Web/GitHub search (sigrok, python, HA, ESPHome; terms SKY TOPPOWER, STP2S, E22, register addresses): **no project found**. The only hits were other brands' docs (RDTech DPS, Korad/Tenma, XY-SK60). Not the same register map. Examples seen: https://github.com/syssi/esphome-dps (RD DPS, different map). No same-OEM rebadge identified.

## Is it Modbus RTU? Yes (V-doc, V-crc)

Doc says "MODBUS RTU mode"; CRC-16/MODBUS (poly 0xA001, init 0xFFFF, low byte first) reproduces the four request CRCs (`85 CF`, `D4 0F`, `19 CA`, `D8 0A`) and the exception CRCs; the sheet's normal read-response CRC (`FD AF`) is wrong (computed `B9 AF`).

## Link

| Item | Value | Status |
|---|---|---|
| Baud | 9600 default; changeable via panel menu BPS | V-doc. Other allowed rates: ? |
| Framing | 8N1 | V-doc |
| Slave ID | 0x01 default; 1–250 via panel menu or reg 0x9999 | V-doc |
| Function codes | 0x03 read (max 4 words / 8 bytes), 0x06 write single word. Nothing else (no 0x10, 0x04). | V-doc |
| Checksum | CRC-16/MODBUS | V-doc + V-crc |
| Frame gap | ≥3.5 char idle before frame. Doc sentence about start-of-frame constraints is truncated. | V-doc (partial) |
| Exception | Func|0x80, then 1 error byte, CRC. Codes: 01 func, 02 address, 03 read length, 04 frame, 05 data range. (04/05 differ from standard Modbus.) | V-doc |
| Broadcast addr 0 | ? | |
| Transport | USB-C "COM" = CH340 (1a86:7523), data-only; QC port is charge-only | V-doc (manual §2.2) + Rob's enumeration |

## Register map (all 16-bit unless noted) — V-doc

| Addr | R/W | Name | Note |
|---|---|---|---|
| 0x0001 | R/W | OUTPUT | 0 off / 1 on |
| 0x0002 | R | PS | status bits: 0 LOCK, 1 BEEP, 2 OVP, 3 OCP, 4 OPP, 5 OTP, 6 CC/CV, 7 NO |
| 0x0003 | R | TEMP | BIT15=1 → below zero. Unit/scale ? |
| 0x0004 | R | APS | "auxiliary power value". Meaning/unit ? |
| 0x0005 | R | decimals | nibbles for V,A,W; example `0x0222` = 0.00V, 0.00A, 0.00W. Nibble order INF (V high?). |
| 0x0010 | R | U | voltage readback |
| 0x0011 | R | I | current readback |
| 0x0012–13 | R | P | 32-bit, 0x0012 = upper 16 |
| 0x0014 | R | Umax | max voltage |
| 0x0015 | R | Imax | max current |
| 0x0016–17 | R | Pmax | 32-bit, 0x0016 upper |
| 0x0020 | R/W | SetOVP | |
| 0x0021 | R/W | SetOCP | |
| 0x0022–23 | R/W | SetOPP | 32-bit, 0x0022 upper |
| 0x0030 | R/W | SetU | |
| 0x0031 | R/W | SetI | |
| 0x0040 | R/W | LOCK | 0/1 |
| 0x0041 | R/W | BEEP | 0/1 |
| 0x0042 | R/W | OVP switch | 0/1 |
| 0x0043 | R/W | OCP switch | 0/1 |
| 0x0044 | R/W | OPP switch | 0/1 |
| 0x0045 | R/W | NO switch | "normally open" = output on at power-up (menu "ON"?) INF |
| 0x9999 | R/W | Adder | slave address 1–250 |

Table caveat: 0x0003–0x0004 rows carry only "Temperature" / "Auxiliary Power" notes; names read from the rendered table. 0x0006–0x000F, 0x0018–0x001F, 0x0024–0x002F, 0x0032–0x003F: undocumented.

## Scaling

- Only verified datum: read of 0x0010 → `00 64` documented as "1.00V" (V-doc, V-crc frame; value is doc text, not a capture). With `0x0222`, that is ×0.01 for V.
- Per-quantity scale for 32V/10A (A ×0.001? W ×0.01?) is **?**. Read 0x0005 first; INF that it encodes it.
- Menu shows OVP default 38.4 → at least one setting has 0.1 V resolution on the panel; register scale ?.
- Temperature unit/scale ?; sign convention: INF sign-magnitude (bit15), not two's complement.

## Examples (V-crc, slave 1)

| Frame | Meaning |
|---|---|
| `01 03 00 10 00 01 85 CF` | read U |
| `01 03 00 11 00 01 D4 0F` | read I |
| `01 06 00 01 00 01 19 CA` | output on |
| `01 06 00 01 00 00 D8 0A` | output off |
| `01 03 02 00 64 B9 AF` | response, value 0x0064. Sheet prints `FD AF`: CRC low byte is a doc typo (computed B9). Sheet exception examples `80 F0`, `C3 A1` do match. |

## Gaps

- Baud values supported and any register for BPS (none documented).
- Is 0x0001 write echo-only (FC06 echo) and does it honour the front-panel LOCK?
- Setpoint write clamping vs Umax/Imax; behaviour when OVP < SetU.
- Doc is V25; bundled exe is "V20". Register differences between versions: ?
- Whether the internal MCU UART is exposed as TTL on a header (for ESP32 wiring) vs only via CH340.
- ESPHome `modbus_controller` batching vs the 4-word read cap: ? (see NEXT_STEPS).

## Hardware confirmation (2026-11-07, 9600 8N1, slave 1)

Output off, no load assumed. Raw replies all CRC-valid; slave 1 at 9600 answered first try.

| Reg | Raw | Decoded | Verdict |
|---|---|---|---|
| 0x0005 | 0x0233 | V 2 dec, A 3 dec, W 3 dec | confirmed: V nibble = bits 8-11 (Umax 3200 → 32.00 V) |
| 0x0014/15 | 3200 / 10200 | 32.00 V / 10.200 A | confirmed vs 32V10A spec; front panel also stops at 32.00 V (Rob, 2026-11-08) |
| 0x0016-17 | 0x0004FB00 = 326400 | 326.400 W | confirmed (32 × 10.2); upper word first |
| 0x0020 SetOVP | 3840 | 38.40 V | matches menu default 38.4 |
| 0x0021 SetOCP | 500 | 0.500 A | scale ok; OCP switch ON confirmed by Rob on panel |
| 0x0022-23 SetOPP | 0x0004FB00 | 326.4 W | |
| 0x0030/31 SetU/SetI | 333 / 500 | 3.33 V / 0.500 A | confirmed: Rob reports panel shows 3.33 V / 0.500 A |
| 0x0002 PS | 0x0002 | BEEP only | matches 0x0041=1 |
| 0x0003 TEMP | 26 | 26 °C | confirmed: panel TEMP display (menu item 13) shows 26 °C (Rob) |
| 0x0004 APS | 134 | 13.4 V (×0.1) | plausible: Rob reads it as the internal aux rail (12 V-class, 13.4 V); not measured with a meter |
| 0x0010-13 live | 0 0 0 0 | output off | |
| 0x0001 OUTPUT | 0 | off | |
| 0x0040-43 | 0,1,1,1 | LOCK off, BEEP on, OVP on, **OCP on** | OCP on at 0.5 A: expect trip with a load > 0.5 A |

Write: `01 06 00 30 01 4E 08 61` (SetU 3.34 V) echoed exactly, readback 334; restored to 333. FC06 echo = request frame confirmed. 

Output-on test (Rob: nothing connected, safe): wrote SetU=500 (5.00 V), SetI=1000 (1.000 A), OUTPUT=1; echoes were exact request frames (ON/OFF frames identical to the vendor examples). Live read 0x0010x4 = `500 0 0 0` → 5.00 V, 0 A, 0 W, stable over 3 reads; readbacks SetU 500, SetI 1000, OUTPUT 1. OFF echoed; vout decayed (455 on first read after off); setpoints restored to 333/500. PS (0x0002) stayed 0x0002 with output on: bit6 CC/CV = 0. Confirmed by Rob: CV light lit with output on and PS=0x0002 → bit6=0 means CV; bit6=1 = CC now confirmed (below). Not tested: exceptions, baud change, protection trips, load behaviour.

CC test (Rob: load attached, CC light lit; reads only from me): PS = 0x0042 (BEEP + bit6) → **bit6=1 = CC confirmed**, 0 = CV. Rob had changed panel setpoints: SetU 1243 (12.43 V), SetI 100 (0.100 A), SetOCP 100, OCP switch 0x0043 = 0 (off). Live 0x0010x4 = `365 100 0 365` → 3.65 V, 0.100 A, P = 0x0000016D = 0.365 W (= 3.65 × 0.100, confirms W 3-decimal scale and 32-bit P with the low word at 0x0013). Output reg 1 = 1. Load ≈ 36.5 Ω (V sagged to 3.65 V at the 0.1 A limit).

OCP trip (Rob: load attached, OCP tripped; reads only from me): PS = 0x000A (BEEP + **bit3 OCP = trip flag, confirmed**). OUTPUT reg 0x0001 = 0 (device forced output off), live 0x0010x4 = 0 0 0 0, TEMP 27, APS 134. Panel settings at that moment: SetU 1243, SetI 300 (0.300 A; I earlier wrote 3.000 A, wrong: A has 3 decimals), SetOCP 300 (0.300 A), OCP switch 0x0043 = 1. Consistent with the trip: 12.43 V into the ~36.5 Ω load is about 0.34 A, above the 0.3 A limit. Trip flag is set with output off, so it latches until cleared; how it clears (front panel, OUTPUT=1 write, or OCP switch toggle) is **?**. OVP/OPP/OTP bits 2/4/5 inferred by analogy, untested. OTP: menu "TEMP" only toggles the temperature display on the front panel (Rob, 2026-11-08), despite the manual saying OTP trips above the TEMP setting; the OTP threshold is fixed and unknown (manual gives no value; fan starts above 60 °C internal, so OTP is higher than that). OVP trip (Rob, 2026-11-08): only a power cycle makes the unit usable again (manual: "OVP/OTP requires power cycle to reset"); the unit keeps answering Modbus while OVP-locked and reports the trip flag (Rob, 2026-11-08), so the trip overlay is driven by a live read.

## Host exe static strings (2026-11-07)

`vendor/.../Installation Program for power with ModBusV20.exe` (sha256 `1e1b640c…fedf`, PE32 VB6, source path `VBDigittalPowerRS485ModbusV20_20260114`). Static string extraction only: not run, not disassembled (register constants not extracted).

- Baud choices in the UI: **9600, 19200** only; framing label `N,8,1`; settings persisted in `Init.ini` (PortSetting/SerialPort/BaudRate). Other bauds in menu BPS: ?
- Error strings = the sheet's codes: function code, data address, read data length, framing, data range, write data length.
- UI "Enable" group has exactly five switches: **NO, BEEP, LOCK, OVP, OCP** (+ OTP indicator). No buzzer trigger or duration control, so no evidence of an undocumented beep register. OPP switch (0x0044) is in the sheet but not in this UI; the front-panel menu does have OVP, OCP and OPP on/off (Rob, 2026-11-08). Front OCP key/lamp covers OCP only (0x0043); OVP/OPP are independent of it (Rob bench check, 2026-11-08).
- State line shows `°C` and `V` next to the CV/CC/OTP lights (screenshot in the help PDF: `024 °C 13.0 V`), supporting TEMP = °C and APS = volts (vendor-labelled, so upgrade from INF; the 13.0 vs our 13.4 is just a different unit/time).
- Host sends a `SetPowerAddr` command (slave address change) and has a timer-driven raw Modbus sender ("SendSet" area).

## Baud change (2026-11-07)

Panel menu BPS (item 4) changed by Rob to 19200 → unit answers `01 03 02 02 33 F9 31` at **19200 8N1**, silent at 9600 (confirmed twice). First attempt at 19200 right after an earlier change attempt returned garbage at 19200/38400/57600 and a valid reply only at 9600, so the earlier change had not taken effect (cause: per Rob, a power cycle was needed; the earlier attempt had no power cycle). No baud register is documented; BPS persists across the menu exit. Baud change **takes effect only after a power cycle** (Rob), and persists across it (19200 still answers after the cycle, 9600 silent). Other rates: ?. Unit currently at **19200**: pass it to the panel's baud field and `tools/probe.py <port> 19200`.

Per Rob: panel BPS offers only **19200 and 9600**; a baud change needs a **cold boot**. Switch registers now (19200, reads): LOCK 0, BEEP 1, OVP 1, OCP 0, OPP 0, **NO 0**; output 0.

NO switch (0x0045): sheet calls it "Power Supply Normally Open Setting"; the menu sheet's item 2 "ON: Power-on voltage output, default OFF" is INF the same flag, i.e. output state at power-up, not the live output switch (0x0001). Untested: write 0x0045=1, cold boot, see if output comes on by itself.

TEMP confirmed: panel menu item 13 "TEMP" (display on/off, no register in the map) shows 26 °C, matching reg 0x0003 = 26 → °C ×1. Does 0x0003 read the same with the display toggle off? Earlier reads (27 at the OCP trip) suggest yes, but the toggle state then is unknown.

Per Rob: with TEMP display on, the panel shows temperature **in place of the watts readout** and doesn't alternate. Serial read with TEMP display on (output off): reg 0x0003 = 27, still readable. Whether 0x0012-13 (P) keeps updating over serial while the display shows temp: untested (needs output on with a load).

Correction: the "cold boot" for the baud change was the front-panel power switch (Rob), not an AC unplug. The switch cuts the aux/5 V path and resets the STM8; baud is applied at boot. (Earlier note "needs a cold boot" stands; "AC unplug" does not.)

NO (0x0045) upgraded: manual §6.3 "Set Power-On Default Output Status": menu item "NO": OFF = no output after power-on; YES = automatic DC output at power-up. Confirms it is the power-up output state (0x0001 is the live output). Register value polarity (1 = YES) still untested.
