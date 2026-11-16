# Start here: build your NEXA ONE

One guide, in the order you'll do things: what to buy, what to print, how to wire
it, how to flash and configure it, how to test it on the bench, and how to put it
together. The theory and the reasons behind each choice are in
[BUILD-GUIDE.md](BUILD-GUIDE.md); the print settings are in
[PRINTING-GUIDE.md](PRINTING-GUIDE.md).

> **What you're building:** the bottle from the app. A black ribbed bottle with a
> display and a button in the base, a Peltier cooler under the water, a battery,
> and Bluetooth. **It keeps cold water cold for hours and cools room-temperature
> water to about 12–15 °C in 40–90 minutes.** It is not a 15-minute chiller (see
> [COOLING-SPEED.md](COOLING-SPEED.md)).

## 1. The board

**ESP32-C3 SuperMini**, 22.5 × 18 mm, USB-C. Search for exactly that name.
It has Bluetooth 5, a USB-C port for flashing, and breaks out every pin the
firmware uses.

> **Don't buy the Seeed XIAO ESP32-C3** even though it looks similar. It doesn't
> break out GPIO0 and GPIO1, which the firmware uses for the battery and charger
> sensing. (An earlier version of my guide said it would work. That was wrong.)
> Buy two SuperMinis; they're cheap and you'll be glad of a spare.

## 2. Shopping list (about $90–120)

| # | Part | What to look for | Qty |
|---|---|---|---|
| 1 | Microcontroller | ESP32-C3 SuperMini (see above) | 1–2 |
| 2 | Peltier | **TEC1-12706**, 40 × 40 × 3.9 mm. Not 12705 or 12710 | 1 |
| 3 | Heatsink + fan | **40 × 40 mm aluminium heatsink, 20 mm tall, with a 40 × 40 × 10 mm 5 V fan** (they're sold as a set, "40 mm heatsink with fan"). The fan must be **5 V** | 1 |
| 4 | Cold block | Aluminium block **40 × 40 × 10 mm**, flat on both sides | 1 |
| 5 | Thermal paste | Any non-conductive paste | 1 |
| 6 | Cells | **18650, flat-top, unprotected, 65 mm long**, at least 3000 mAh and 15 A continuous (for example Samsung 30Q or LG HG2), from a reputable seller, all from the same batch. **Protected 69 mm cells won't fit** | 4 |
| 7 | Battery protection | **2S BMS with balancing, at least 10 A**, a "common port" type (charger and load share the P+ / P− pads) | 1 |
| 8 | Charger | **2S (8.4 V) USB-C charging module with balancing**, 1–2 A. Anything that outputs 8.4 V constant-current / constant-voltage for a 2S pack works, for example the IP2326-based modules | 1 |
| 9 | 5 V regulator | **MP1584EN buck module** (adjustable) | 1 |
| 10 | MOSFETs | **IRLB8721PBF**, logic-level, TO-220 | 2 |
| 11 | Optocoupler | **PC817** (charger detect) | 1 |
| 12 | Diode | **1N5819** Schottky (protects the buck when you flash over USB) | 1 |
| 13 | Temperature probes | **DS18B20, waterproof stainless probe, 3-wire**, 1 m cable | 2 |
| 14 | Display | **1.3″ 128 × 64 OLED, I²C, 4-pin, blue (SH1106)**. Its PCB should be about 35.4 × 33.5 mm | 1 |
| 15 | Button | **8 mm panel-mount momentary push button**, metal | 1 |
| 16 | Fuse | PTC resettable fuse, **7–8 A hold**, or a 7.5 A mini blade fuse | 1 |
| 17 | Pack connector | **XT30** male + female pair (your storage disconnect) | 1 |
| 18 | Resistors | 330 kΩ and 100 kΩ (1 %); 2.2 kΩ; 2 × 4.7 kΩ; 2 × 100 Ω; 2 × 100 kΩ; plus 2 × 100 nF caps and one 470 µF 16 V cap | 1 set |
| 19 | Perfboard | About 40 × 30 mm | 1 |
| 20 | Silicone pads | Silicone rubber sheet, **3 mm thick, 30–40 Shore A**. You cut four 6 × 6 mm squares | 1 |
| 21 | Wire | 18 AWG silicone wire (pack and Peltier), 26–28 AWG (signals), heat-shrink, Kapton tape | |
| 22 | Hardware | 4 × M3 × 8 self-tapping screws, 2.5 mm zip ties (about 20), 1 mm double-sided foam tape (VHB), food-safe neutral-cure silicone sealant, nickel strip (if you weld the pack) | |
| 23 | Vessel | **Aluminium bottle with a food-safe inner coating, 73 mm outside diameter**, flat bottom, with a sport cap | 1 |
| 24 | Filament | TPU 95A about 320 g (sleeve), PETG or ASA about 120 g | |

**Tools:** soldering iron, multimeter (you need one), side cutters, a spot welder
or a shop that builds battery packs.

## 3. Print

Files are in `design/stl/`. Print the two test pieces first, then the base,
lid, cell cage and sleeve. Settings and order are in
[PRINTING-GUIDE.md](PRINTING-GUIDE.md).

## 4. Wiring

### Power

```
 4 × 18650 (2S2P) ── XT30 ──► BMS (B+, B-mid, B-)
                              BMS P+ ──► fuse ──► "+" rail
                              BMS P− ───────────► "−" rail (GND)
 USB-C charger module (8.4 V out) ──► BMS P+ and P−  (the same pads as the load)

 "+" rail ─┬──► Peltier red wire
           ├──► MP1584 buck IN+   (IN− to GND)
           │        buck OUT = 5.0 V ──┬──► 1N5819 ──► SuperMini "5V" pin
           │                           └──► fan red wire
           └──► 330 kΩ ─┬─ 100 kΩ ─ GND        ──► GPIO0   (and 100 nF from GPIO0 to GND)

 Peltier black wire ──► MOSFET 1 drain      MOSFET 1 source ──► GND
 Fan black wire ─────► MOSFET 2 drain       MOSFET 2 source ──► GND
 GPIO3 ─ 100 Ω ─► MOSFET 1 gate   (and 100 kΩ from the gate to GND)
 GPIO4 ─ 100 Ω ─► MOSFET 2 gate   (and 100 kΩ from the gate to GND)
 470 µF across buck OUT+ / GND
```

**Set the buck to 5.0 V with a multimeter before you connect anything to it.**
Power it from a bench supply or the pack, adjust the little trimmer until the
output reads 5.00 V, and only then wire the SuperMini and the fan. The SuperMini
dies above about 6 V.

### Signals

| SuperMini pin | Goes to |
|---|---|
| **GPIO3** | MOSFET 1 gate (Peltier), through 100 Ω |
| **GPIO4** | MOSFET 2 gate (fan), through 100 Ω |
| **GPIO5** | DS18B20 **water** probe, data (yellow), 4.7 kΩ to 3V3 |
| **GPIO10** | DS18B20 **heatsink** probe, data (yellow), 4.7 kΩ to 3V3 |
| **GPIO0** | battery divider midpoint (330 kΩ / 100 kΩ), 100 nF to GND |
| **GPIO1** | PC817 pin 4 (collector). See below |
| **GPIO20** | button, other side to GND |
| **GPIO6** | OLED **SDA** |
| **GPIO7** | OLED **SCL** |
| **3V3** | OLED VCC, both DS18B20 red wires |
| **GND** | OLED GND, DS18B20 black wires, button, PC817 pin 3 |
| **5V** | from the 1N5819 (stripe toward the SuperMini) |

Check the GPIO numbers on the SuperMini's silkscreen. A few clones print them
differently. Leave GPIO2, 8 and 9 unconnected: they are the chip's boot pins.

**Charger detect (PC817):** charger module's input voltage pad → **2.2 kΩ** →
PC817 pin 1; PC817 pin 2 → the charger's ground pad. PC817 pin 3 → GND, pin 4 →
GPIO1. This is safe with any charger, even one that negotiates 9–20 V. **Never
connect a charger's USB voltage straight to a GPIO.**

**DS18B20 wires:** red = 3V3, black = GND, yellow = data. Each probe gets its own
4.7 kΩ between data and 3V3.

**All grounds meet at one point**: the BMS P− pad. Keep the Peltier's current
path (rail → Peltier → MOSFET → P−) out of the sensor wiring.

### The battery pack (2S2P)

Build the pack so cells stand in the four pockets of the cell cage. The two
**front** pockets (the ones nearest the display) are one parallel pair; the two
**back** pockets are the other. Put the two pairs in series, then connect:

| Pack node | Goes to BMS |
|---|---|
| back pair negative | B− |
| back pair positive, front pair negative | B-mid (the balance wire) |
| front pair positive | B+ (through the XT30) |

**Do not solder directly to the cells.** Spot-weld nickel strip, or have a shop
build the pack with flexible links. Before you join cells in parallel, charge
them to within 0.1 V of each other. Cells are live the moment they are
connected: tape every exposed end.

## 5. Flash the firmware and configure it

**Do this on the bench, before the electronics go into the bottle.** The
SuperMini's USB port isn't reachable once the base is closed.

1. Install **Arduino IDE 2**.
2. *File → Preferences → Additional boards manager URLs*, add
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. *Tools → Board → Boards Manager*: install **esp32 by Espressif Systems**
   (version 3.x).
4. *Tools → Manage Libraries*, install: **NimBLE-Arduino** (h2zero, version
   2.x), **OneWire**, **DallasTemperature**, **U8g2**.
5. Open `firmware/nexa_one/nexa_one.ino`. The folder must stay named
   `nexa_one`, and `config.h` and `nexa_core.h` must stay beside it.
6. *Tools:* Board **ESP32C3 Dev Module**, **USB CDC On Boot: Enabled**, Flash
   Size 4MB, Upload Speed 921600.
7. Plug the SuperMini in with USB. If no port appears, hold **BOOT**, tap
   **RESET**, release BOOT, and pick the new port.
8. **Upload.** When it finishes, tap RESET.

> I could only check the sketch for syntax against stand-in libraries. I haven't
> compiled it with the real ones. If the compiler stops on a NimBLE line, you
> probably have the wrong library version (use 2.x). Send me the error and I'll
> fix it.

### Settings in `config.h`

| Setting | What it does |
|---|---|
| `OLED_SH1106` / `OLED_SSD1306` | pick your display chip. Wrong choice = garbled or shifted picture |
| `PIN_*` | the pins. Change only if you wire differently |
| `BATT_R_TOP_K`, `BATT_R_BOTTOM_K` | your battery divider resistors |
| `CHARGE_ACTIVE_LOW` | `true` for the PC817 circuit above |
| `DEVICE_NAME` | the name the app sees |
| `SERIAL_LOG` | one status line per second on USB |

The safety limits (heatsink limit 52–62 °C, trip 65 °C, battery cut-off 3 %)
are in `nexa_core.h`. Don't raise them.

### Serial monitor

Open the Serial Monitor at **115200 baud**. You'll see a line every second:

```
[nexa] water=22.3C heatsink=23.1C batt=61% (7.58V raw 7.58V cal 1.000) charging=0 cooling=0 phase=0 target=8 saver=0 tec=0% fan=0 ble=0 paired=0
```

Commands you can type: `status`, `calib 7.62`, `target 10`, `pair`, `help`.

**Calibrate the battery** (once): with the pack connected, measure its voltage at
the BMS B+ and B− with your multimeter, and type `calib <that voltage>`, for
example `calib 7.62`. The factor is saved and survives a factory reset.

## 6. Bench test (before you close it up)

Do these in order and stop at the first one that fails.

1. **Board only (USB, no pack):** the serial line appears. `water` and
   `heatsink` show room temperature, not `nan`. The OLED shows the temperature.
2. **Button:** a short press sets `cooling=1`. A 3-second hold makes the OLED
   show only a blinking Bluetooth symbol.
3. **Pack:** connect the XT30. `batt=` matches the multimeter after `calib`.
4. **Fan:** press the button; the fan spins.
5. **Peltier, 30 seconds, dry:** with the **heatsink and fan fitted** and the
   Peltier clamped between the block and the heatsink, press the button. The
   block gets cold within seconds and `heatsink` rises slowly. Stop if `heatsink`
   passes 55 °C.
6. **Charging:** plug in USB-C. The OLED shows a filling battery and `charging=1`.
7. **Bluetooth:** with a phone app like **nRF Connect**, find **NEXA ONE**.
   Read the characteristic `8b6f0002-…`; write `02 0A` to `8b6f0003-…` and the
   target on the OLED becomes 10.
8. **Cooling test:** stand the block in a small cup of 200 ml of room-temperature
   water, with the water probe taped to the cup's side. Press the button and watch
   `water=` fall. Expect about **12 °C in 30–40 minutes**. If it stalls above 15 °C,
   check the paste and the clamp.

## 7. Assemble

1. **Pads on the cradle:** stick one 6 × 6 mm silicone pad on each of the four feet
   at the bottom of the stack cradle (inside the base, under the top plate).
2. **Button and display:** screw the button in with its nut against the flat boss.
   Stick the OLED into its pocket with foam tape, pins pointing into the base;
   solder its four wires.
3. **The stack:** paste on both sides of the Peltier, **cold side up** (test which
   side is cold with 3 V for one second). Heatsink + fan at the bottom, Peltier,
   then the cold block on top. Slide it into the cradle from below, **block
   1–1.5 mm above the top plate**, and loosely tie it with zip ties through the
   arm slots.
4. **Probes:** water probe taped to the vessel's side (aluminium tape, foam over it);
   heatsink probe pushed between the fins.
5. **Cells:** the pack goes into the cage, the cage onto the lid. The lid's zip-tie
   slots (16 of them, in pairs) are for the control board and the other modules.
6. **Electronics:** zip-tie the control board, buck module, BMS and charger board
   to the lid in the middle (the round area inside the cage). Keep the top 14 mm
   clear for airflow. The charger board's USB-C port must reach the **USB-C hole**
   at the back, through the gap in the cell cage's rail.
7. **Close:** check every wire, then lid on with the four M3 screws.
8. **Vessel:** run a bead of silicone around the block's edge, seat the bottle on
   the top plate (this squeezes the pads and clamps the Peltier), then slide the
   sleeve down over it onto the base, with a bead of silicone at the joint.

## 8. Using it

| Action | What happens |
|---|---|
| Short press | cooling on / off |
| Hold 3 s | pairing mode: the display shows a blinking Bluetooth symbol for 2 minutes |
| Hold 10 s | factory reset (forgets the phone, target and history; keeps the battery calibration) |
| Plug in USB-C | charging screen. A full charge takes about 3 hours |

**Realistic targets:** the heatsink that fits the base holds about 8–9 °C at
best, so choose **10 °C or higher**. Fill with cold water for best results.

**The app:** the APK I built talks to a *simulated* bottle. For your real bottle,
the app must be rebuilt from its source project with the Bluetooth connection
code in `app-integration/`. See BUILD-GUIDE §7. Everything on the bottle side
(the Bluetooth protocol) is done and tested against that code.

## 9. If something doesn't work

| Symptom | Likely cause |
|---|---|
| `water=nan` or `SENSOR ERROR` | A DS18B20 isn't reading: check the 4.7 kΩ pull-up and its data wire |
| OLED blank or garbled | Wrong chip in `config.h`, or SDA/SCL swapped |
| `batt=` far from the meter | Run `calib`. Check the 330 kΩ / 100 kΩ resistors are 1 % |
| Peltier does nothing | Gate resistor, the 100 kΩ pull-down, GND shared? Is `tec=` above 0? |
| Cooling stops, `HOT` on the display | Heatsink too hot: no airflow, or the fan isn't spinning |
| Cold side barely cold | Peltier upside down, too little paste, too little clamp force |
| `charging=0` while plugged in | PC817 wiring; `CHARGE_ACTIVE_LOW` |
| App can't find the bottle | Hold the button 3 s; allow "Nearby devices" on the phone |
| Resets when the Peltier starts | Weak 5 V: add the 470 µF cap, check the buck, keep grounds at one point |

## 10. What I verified, and what I didn't

**Checked:** every printed part is a clean solid, and a script placed all of them
together with the real components at their nominal sizes (cells, fan, heatsink,
Peltier, block, display module, button) and found no collisions; the firmware's
thermostat, safety limits and Bluetooth packets (62 checks); the sketch's syntax;
the app's Bluetooth code against the firmware's packets.

**Not checked:** nothing has been printed or powered. The sketch hasn't been
compiled with the real libraries or run on a board. Module sizes vary: measure
your OLED, button and BMS against the guide before you print. Cooling times come
from a simulation, not a measurement.
