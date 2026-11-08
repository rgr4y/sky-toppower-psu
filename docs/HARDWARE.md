# Hardware notes — E22-CTR V1.0 controller board

From Rob's photo ([ControlBoardSwimHeader.jpg](photos/ControlBoardSwimHeader.jpg)) and reading of the chip marking he typed. Not datasheet-verified unless noted.

| Ref | Part | Note |
|---|---|---|
| U3 | **STM8S005K6T6C** (Rob read: `STM8S00 5K6T6C`, `MYS 522 RM`) | 32-pin LQFP 7x7, 16 MHz, 32 KB flash. Per search: ST DS8638 covers C6/K6, SWIM present. |
| Y1 | 16.000 MHz crystal | next to U3 |
| U7 | EG7500 | TL494-class PWM controller (analog control loop) INF |
| U6 | SGM8632 (read `SGS8632`), SOP-8 | dual rail-to-rail op-amp; likely CV/CC loop / sense amps INF |
| U1 | `2272C` (`T159M A017`), SOP-8 | dual op-amp, TLV2272-class INF |
| U2 | 74HC4052 (ST), SOP-16 | dual 4-channel analog mux; likely switches sense signals into the STM8 ADC INF |
| U8 | LM321 (marking `A63A`, TI code for LM321MF), SOT-23-5 | single op-amp; INF buffer for the temp sensor or a protection comparator |
| Q2 | small transistor beside the buzzer | buzzer driver INF |
| — | on-board buzzer | driven via Q2 INF |
| J1 | 8 pads, board edge | to main board |
| — | 4 unpopulated through-holes in a row, below C18/Q1 and above Y1 (Rob circled in [ControlBoardSwimHeader.jpg](photos/ControlBoardSwimHeader.jpg)) | SWIM header, confirmed order V / SWIM / GND / NRST (leftmost `V` silkscreen = 1). See SWIM section below |

Temperature sensor: no wired probe found anywhere (Rob looked). The STM8S005 has no internal temperature sensor, so it is an on-board part. Heat test (Rob): TEMP reacted most at the middle of the power board, right next to the heatsink, so it most likely is an SMD NTC there and tracks the power stage. Reads ~room temp idle, up a few degrees in operation.

CH340 / USB-C COM port: on the **front board**, in an isolated region fenced by a board gap (Rob, back view). Not a separate PCB. CH340 itself likely on the component side (guess). Isolator part and the UART path to the STM8 not identified.

## Power board (Rob's photo [PowerBoardCn1AuxSupply.jpg](photos/PowerBoardCn1AuxSupply.jpg), unverified reads)

- Buck stage near the bottom-left: U4 (SOT-23-6 IC), D3 (SMD Schottky), L2 `220` (22 µH?), C9/C11 electrolytics, plus an 8-pin IC by C8/C14. Plausibly the aux rail that APS (0x0004) reads as 13.4 V.
- **CN1**: two unpopulated pads, silkscreen `+` on one. Polarity mark suggests a DC output (fan?) rather than an NTC (non-polar). Unconfirmed: meter CN1 vs GND with the unit on; ~13 V would match the APS rail.
- **J4**: 2-pin yellow connector with red/black wires = **fan** (Rob). CN1 (`+` marked, unpopulated) is then probably the same fan/aux output footprint or a spare; unmetered.
- A ~20-pin flat flex cable runs from the board edge (J1 area) to the front panel.
- No external-NTC input located yet; the unit's TEMP reads 26–27 °C, so an on-board sensor exists somewhere (not found).

## Firmware dump (not attempted)

- Path: SWIM (ST-Link V2 + `stm8flash`/STVP).
- **LQFP32 pins, verified in DS8638 Rev 5** (Table 5 + Figure 4): NRST = 1, VSS = 4, VCAP = 5, VDD = 6, VDDIO = 7, PD1/SWIM = 26. Pin 1 is the corner pin with the package dot; numbering runs counter-clockwise (NRST, OSCIN, OSCOUT, VSS, VCAP, VDD, VDDIO, PF4 down the first side; 24-17 up the opposite side). Footnote 4: PD1 is input pull-up during and after reset.
- **ROP** (DS8638 §4 + Table 12): OPT0 at `0x4800`; `0xAA` = readout protection enabled. "Once the read-out protection is activated, any attempt to toggle its status triggers a global erase of the program and data memory." So: read option bytes only; never write OPT0 if it reads `0xAA`.
- **4-hole SWIM header, confirmed by Rob (rung out 2026-11-08): 1 = V, 2 = SWIM, 3 = GND, 4 = NRST** (same order as ST-Link V2's VDD/SWIM/GND/RST).
- **SWIM read attempt, 2026-11-08** (stm8flash `b2b5818`, clone ST-Link V2: serial `3030…31`, SWIM v7; V not wired, GND via output −). Link works: CLK regs at `0x50C0` read `03 00 00 E1 E1 00 18 FF…` (CKDIVR `0x18` = reset value, HSI), CPU regs at `0x7F00` show PC `0x006000`, SP `0x07FF`, CCR `0x28` (reset values), RAM at `0x0000` holds 7-segment patterns (`3F 06 5B 66 79…`). But option bytes (`0x4800`), flash (`0x8000`, vector table should start `0x82…`) and EEPROM (`0x4000`) all read `0x00`. Running firmware + zero vector table = **readout protection active** (inferred: OPT0 itself reads 0, so `0xAA` can't be seen directly). Firmware can't be dumped over SWIM; clearing ROP mass-erases it. Do not write option bytes.
- **RAM/IO dump** (`docs/dumps/*-20261107-211111.bin`: RAM 2 KB @0x0000, IO 2 KB @0x5000, CPU regs 256 B @0x7F00). SWIM connect resets the chip (CPU/CLK regs at reset values, PC `0x6000`), so the IO dump is reset values only; RAM survives reset, so it is a snapshot of the last running state. Findings (INF unless noted):
  - `0x0000-0x000F`: 7-segment display buffer (`0x3F`=0, `0x06`=1, `0x5B`=2, bit 7 = DP).
  - `0x0120-0x01A0`: arrays of uint32 BE values ~388,000 (e.g. 388190, 388194, 388258): likely per-task last-run timestamps in ms, ~6.5 min uptime.
  - `0x01C2` = 3200 (Umax 32.00 V), `0x01EA` = 10200 (Imax 10.200 A), matching registers `0x0014`/`0x0015`.
  - `0x0221`: BE uint16 table 100, 200 … 800 (step table? unknown).
  - Stack area near `0x07FF` holds flash-range words (`0x88E1`, `0x88ED`, `0x8B08`, `0xA560`, `0xDFB1`): candidate return addresses, i.e. code layout hints only.
  - Above ~`0x02F0` the RAM looks like power-up noise (unused).
  - Not found in that snapshot: SetI (1000), baud 19200, decimals `0x0233` (may be stored LE, scaled, or in EEPROM only).
- **SetU set/dump diff** (2026-11-08, `tools/setdump.py`, dumps `docs/dumps/ram-setu-{A-orig,B-321,C-247}.bin`): wrote SetU (reg `0x0030`) 2000 → 321 → 247 → restored 2000, output off, SWIM RAM dump after each. Workflow note: stm8flash leaves the MCU halted in SWIM mode (Modbus silent); `stm8flash -R` lets the firmware run again.
  - **`0x01C4` = SetU, BE uint16, raw register units (0.01 V)**: 2000 → 321 → 247. Next to `0x01C2` = Umax 3200. CONFIRMED.
  - `0x02CB`: last Modbus reply frame as sent (`01 03 02 01 41 79 E4` after reading SetU=321; CRC matches). CONFIRMED = TX buffer.
  - `0x029B`: BE copy of the last written SetU (0 → 321 → 247); INF last FC06 value / parsed request field.
  - Display buffer: V-SET digits at `0x000E` (with DP), `0x000D`, `0x0007` (3.21 → `CF 5B 06`, 2.47 → `DB 66 07`).
  - `0x0259`-`0x025A` changed non-linearly (`0615` → `1323` → `1522`): unknown (PWM/DAC derived value?).
  - `0x01B0`/`0x01B3`, `0x01A8`/`0x01AA` and the `0x0120`-`0x01A0` uint32 arrays change every dump: counters/timestamps.
- Read-out protection: ROP option byte (OPT0, `0x4800`), `0xAA` = enabled (confirmed in DS8638, see below). Toggling it mass-erases flash + EEPROM (DS8638 §4, confirmed).
- Safe first step: read option bytes only, flash untouched. See Isolation below: the control board is not mains-referenced per Rob's continuity checks.

## Sources

- ST product page: https://www.st.com/en/microcontrollers-microprocessors/stm8s005k6.html
- DS8638 (STM8S005C6/K6 datasheet) via https://www.st.com/en/microcontrollers/stm8s005k6.html
- RM0016 (STM8S reference manual): memory readout protection section — not read.

## Power switch

The front-panel switch switches **Live** on and off (confirmed by Rob). With it off, the whole unit is unpowered from mains: the flyback aux supply, the 5.1 V rail (CN1) and the STM8 all drop, and toggling it is a full cold boot (this is how the 19200 baud change was applied). Whether Neutral is also switched (double-pole) is unverified.

## Isolation (Rob, 2026-11-07, cold continuity checks)

Case is ground-referenced (earth). No continuity between L/N/G and output +/-, and none between L/N/G and any pin on the daughterboard (each pin tested). Large heatsink between the mains and low-voltage sides, big transformer on the mains side. So the STM8 control board sits on the isolated low-voltage side, not at mains potential. Caveats: continuity is a DC check, not an insulation/hipot rating; still unplug AC before touching the SWIM pads unless the unit has to be powered for the dump; GND of the control board vs output − unmeasured.

SWIM header GND is referenced to output − (Rob). So an ST-Link (USB, PC ground) ties output − to PC ground. The USB-C COM port likely already does the same if the CH340 shares that ground (unmeasured: continuity from the USB-C shell/GND to output −; an isolator in the COM path would break that).

Per Rob the USB region of the front board is isolated, so the COM port does NOT tie output − to PC ground. An ST-Link on the SWIM header would be the first PC-ground tie to output −. Options: an isolated ST-Link / USB isolator, or accept the tie with nothing else on the output.

## Front board, back view (Rob [FrontBoardBack.jpg](photos/FrontBoardBack.jpg), unverified reads)

- Two staggered rows of 9 solder pads (18 total) at bottom-left with tape over them: flat cable soldered/terminated here (to the power/controller board, ~18-20 conductors?).
- To the right, two rectangular regions, each with 4 through-holes (+ 2 extra pads), fenced by a bare-board outline and gap: the isolated region(s) around the two USB-C port footprints (COM + QC). Not a separate USB board (Rob). Pin function, isolator chip location: ?

Per Rob: the USB negative (GND) of the **data port** exists only inside the isolated region. So the COM port's ground is galvanically isolated from output − and the rest of the board; only the isolated UART crosses the gap. The QC port's ground region: not stated.

Per Rob: the QC port's negative is on the isolated (low-voltage/secondary) side and DOES leave the fenced region via the FPC header. Reading (to confirm): QC port ground = output −/secondary domain, carried to the controller board over the FPC; the fenced COM region is a separate ground island that only the isolated UART crosses.

Per Rob (re-reading [FrontBoardBack.jpg](photos/FrontBoardBack.jpg)): the two fenced rectangles are one per USB port, with an isolation gap between the COM and QC regions as well. So COM and QC grounds are separate islands; whether QC's island is also fenced from the secondary side (vs only from COM): ?

Per Rob: the QC USB negative tones (continuity) to CN1 negative. So CN1 is tied to the QC port's ground domain. Guess (to meter): the buck stage beside CN1 (U4/L2/D3) is the QC 18W supply, CN1 `+` its output, with the QC board's `+/-` meant to land on CN1, and APS (13.4 V) may be a different rail. Unmetered: CN1 `+` voltage, and CN1 − vs output −.

Per Rob: CN1's area is isolated from the buck-boost (output) region by a transformer. Supporting read of [PowerBoardCn1AuxSupply.jpg](photos/PowerBoardCn1AuxSupply.jpg): small yellow transformer above a PC817-style optocoupler (marked `…817C`, U2) and Schottky D3, i.e. an isolated flyback with opto feedback. INF: CN1/QC is its own isolated supply island, separate from output − and from the COM-port island. So at least: mains primary | main output/control (STM8, SWIM, output −) | QC island (CN1, QC USB −) | COM island (CH340, isolated UART). Not yet reconciled with "QC negative leaves its region via the FPC" (FPC carries QC power/ground only?).

## Aux/QC supply, IMG_9426 (Rob; reads unverified)

- **T1 `E22-T001`**: yellow transformer with an 8-pin controller (U1) on one side, optocoupler (U2, SOIC-4, 817-style) and Y-capacitor **CY1** (blue) bridging a visible pale isolation-gap outline. Looks like an isolated flyback with opto feedback.
- **D3 `GK SS510`** (5 A / 100 V Schottky, per marking) and **L2 `220`** with U3 (8-pin) and C8/C9/C1: a post-regulator/buck stage on the isolated secondary of T1. INF: this feeds CN1 (QC island).
- **T2 `E22-T002`**: a second transformer (with D10/D11 nearby), separate from T1. Role ? (gate drive / main stage?).
- CN1 pads sit at the left edge beside L2 (orientation reconciled with Rob: CN1 on the left).
- Unresolved: which rail is APS (0x0004, 13.4 V): T1 secondary, or another.

## Overview photo (Rob [DcRegion.jpg](photos/DcRegion.jpg); marking reads unverified)

- **U1** (8-pin DIP beside T1/C1) reads `DK125`: INF a primary-side flyback controller with integrated switch driving **T1 `E22-T001`**. Optocoupler U2, CY1 (Y-cap) and D5/D4 near it. T1 secondary → D3 → electrolytic → the **fan connector J4** (yellow 2-pin, beside T1). INF: this flyback secondary is the ~13.4 V `APS` rail.
- **U3** (8-pin SOIC near C8, marking looks like `LP62xx`, unread) + **L2 `220`** + D3/C1: a buck from that aux rail. INF: it feeds **CN1** (QC island). CN1 sits just left of the FFC, under L2.
- **RS1 / RS2 `R020`**: two 0.020 Ω sense resistors side by side, right side near the output caps: INF 0.010 Ω parallel shunt (100 mV at 10 A).
- **T2 `E22-T002`** at the top, near Q11/Q12 and the big toroid L1: role ? (gate drive for the main stage?).
- Output: red `+` and black `−` leads to the terminals; green/yellow earth wire to the case. Control daughterboard stands vertically in the middle with the buzzer (the controller board seen earlier).
- Meter plan (unit on, AC): CN1 `+`/`−`, J4 pins, `APS` rail. T1/U1 primary is mains-referenced even though the secondary islands are isolated.

**Measured (Rob):** CN1 = **5.1 V**. So the L2/U3 buck outputs ~5 V, not a QC-class 9/12 V. Open: 5.1 V is a plain USB-A/5 V rail level, so does the "18 W QC" port get its higher voltages from a separate converter, or is this buck only the QC port's logic/standard 5 V? Is the fan rail (J4) also ~13.4 V (matches `APS`)? Not measured yet.

Front switch (Rob, metered): switching off drops CN1, which decays slowly (about 1 V while draining) as the caps bleed down. Expected, since the switch cuts Live (see Power switch above).

USB-only power test (Rob: PSU fully off mains, USB-C COM cable in): the CH340 enumerates (USB serial port) — the COM island is powered from USB VBUS alone. Modbus read of 0x0005 at 19200 and 9600: no reply (expected: STM8 and its side of the isolator unpowered). Confirms the isolated COM island runs independent of the PSU rails; the STM8 does not run from USB.

## Powered from QC USB port, off mains (Rob 2026-11-07; reads from me)

Rob fed clean USB power into the front-panel **QC port** with the PSU off mains: display shows all 8s, then flashes **`E1`** (meaning ?, not in the manual's troubleshooting table). With the COM cable still attached (the OS-assigned serial port changed after reconnecting) the **STM8 answers Modbus at 19200** (9600 silent): so the STM8 runs from the 5 V path the QC port feeds, and the QC port can back-feed that rail (consistent with CN1 = 5.1 V).

Reads (all CRC-ok): PS 0x0002 (BEEP only), TEMP 24 (°C), **APS 0x004B = 75** (7.5 V at ×0.1; was 134 = 13.4 V on mains), 0x0005 = 0x0233, live 0 0 0 0, limits as before, SetU 1243 (12.43 V) / SetI 300 (0.300 A) / SetOCP 300 (0.300 A) retained (settings persist across power loss), output 0, switches LOCK 0 BEEP 1 OVP 1 OCP 0. So APS is not a fixed 13.4 V rail: it follows the supply state (7.5 V on 5 V USB). Likely an ADC read of the aux/input rail, ? which node. E1 likely a rail/low-power fault, unconfirmed.

## Rail/domain reconciliation (after QC-USB-powered test)

**Confirmed (Rob, 2026-11-08):** the front "QC" USB-C port is wired straight to the 5.1 V rail (CN1), with no separate controller in between. The QC handling is in U3 itself (below).

**Confirmed (Rob, 2026-11-08):** U3 (8-pin SOIC beside L2 `220`, power board) is the buck that makes the 5.1 V rail; D3 (`SS510`) is its catch diode (anode on 5.1 V −).

U3 marking read by Rob: **IP6525T** (Injoinic). Per the [IP6525T datasheet](IP6525T-datasheet.pdf): synchronous buck SoC with built-in power MOSFETs and fast-charge protocols on DP/DM (DCP/BC1.2/Apple/Samsung, QC2.0/QC3.0, Huawei FCP, Samsung AFC). VIN 9.6-32 V (UVLO 9.6 V rising), output 3-12 V set by the negotiated protocol, 18 W max (5 V @ 3.4 A, 9 V @ 2 A, 12 V @ 1.5 A), ~125 kHz, line compensation ~100 mV/A. ESOP8 pinout: 1 GND, 2 SW, 3 BST, 4 HLED/EN, 5 DM, 6 DP, 7 VIN, 8 VOUT (feedback), EPAD GND.

Consequences:
- The QC port is real QC: the D+/D- lines go to U3, and the "5.1 V rail" is U3's output, so it can rise to 9 V or 12 V when a QC device negotiates. Unverified: whether the STM8/display get their supply through a separate regulator from this rail, and what happens to them during a 9/12 V negotiation.
- **Measured (Rob, 2026-11-08):** with a QC device on the front port, CN1 = **9 V**. The rail follows the QC negotiation. Display stayed normal at 9 V (Modbus not checked), so the STM8/display almost certainly have their own regulator after this rail.
- U3 pin 7 (VIN) is where the ~13.4 V aux rail (`APS`) should be, which fits the 9.6 V minimum input.
- Anything added on this rail (e.g. an ESP32) must tolerate up to 12 V, or the QC port must stay unused.

Evidence: the STM8 (SWIM GND = output −) runs when only the QC USB port supplies 5 V; CN1 = 5.1 V and the QC USB negative tones to CN1 −. So the 5 V rail, QC port, STM8, display and SWIM header most likely share ONE ground (output −), and the QC port back-feeds that whole rail (mechanism: direct tie / diode-OR / through the L2 buck output ?). This likely supersedes the earlier four-island guess: the real barrier is mains primary | secondary (aux flyback T1 secondary, 5 V, STM8, QC port, output −) | COM-port island (CH340 + isolated UART). The "transformer isolation between CN1 and buck-boost" is then T1 isolating the aux from MAINS, not from output −. To confirm: unplugged, continuity CN1 − to the black output terminal. Potential use: STM8 can run from QC USB 5 V with AC unplugged (mains-free SWIM option). Risk: feeding the QC port while mains is on may fight the buck.

Per Rob (message read as: output − and CN1 − tone to each other): CN1 − has continuity to output −. Confirms the single-secondary picture: 5 V rail, QC port, STM8, SWIM GND and output − share one ground; the only barriers are the mains transformers/T1 and the COM island.
