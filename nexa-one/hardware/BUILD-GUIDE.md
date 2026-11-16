# Build your own NEXA ONE — a Peltier-cooled smart bottle

This guide turns the NEXA ONE app's bottle into real hardware: a stainless
bottle whose base holds a **Peltier (thermoelectric) cooler**, a battery, and an
**ESP32-C3** microcontroller that talks to the app over **Bluetooth LE**.

The firmware (`firmware/`) and the app code (`app-integration/`) in this folder
match the app's built-in simulator exactly. The same controls (cooling on/off,
target 5–15 °C, battery saver) and the same data (water temperature, battery,
cooling phase, session history) work with the real bottle.

> **Making it look like the app?** Read **[APPEARANCE-GUIDE.md](APPEARANCE-GUIDE.md)** next.
> It turns the app's bottle render into real dimensions, with a printable base
> (`design/`). Two findings change this guide: the render's base is too short to
> hold the battery, and the vessel should be aluminium.

> ⚠️ **This is a DIY prototype, not a certified product.** It combines lithium
> batteries, high currents, water, and food contact. Read
> [Safety](#1-safety-read-first) before you start, and don't sell or give one
> away without proper testing and certification.

---

## 0. How it works

```
          ┌───────────────┐
          │   lid / cap   │
          │               │   500 ml water
          │  ░░ water ░░  │◄─ thin-wall aluminium inner vessel
          │  ░░░░░░░░░░░  │   wrapped in 8–10 mm closed-cell foam
          │  ░░░░░░░░░░░  │
   probe ─┼─►●  ░░░░░░░░  │   DS18B20 #1 on the vessel wall (water temp)
          ├───────────────┤◄─ flat bottom
          │ ▓▓ Al block ▓▓│   cold side ── heat flows DOWN ──┐
          │ ▒▒ PELTIER ▒▒ │   TEC1-12706, 40×40 mm            │
          │ ███heatsink███│◄─ DS18B20 #2 (hot-side safety)    │
          │   ( fan )     │   40 mm fan pushes the heat out ◄─┘
          │ [ESP32][BMS]  │   battery 2S2P 18650, USB-C, button, OLED
          └──vents──vents─┘
```

A Peltier module is a solid-state heat pump. With current flowing through it,
one face gets cold and the other gets hot. The cold face pulls heat out of the
water through an aluminium block. The hot face dumps that heat, **plus all
the electrical power you put in**, into a heatsink and fan.

**Key design rule:** you **cannot cool through a vacuum-insulated (double-wall)
flask.** The vacuum blocks heat both ways. Use a **single-wall** vessel
with a flat bottom, and insulate its sides instead.

> **Use thin aluminium, not stainless, and here is why.** The Peltier sits under
> the bottle, so it cools the *bottom*. Above 4 °C cold water is denser, so it
> stays down there while the warm water floats on top, and the first sips
> (taken from the top) stay warm. Aluminium conducts heat about 15× better than
> stainless, so the cold climbs the walls; the chilled water along the wall
> sinks and warm water rises through the middle, which mixes the bottle. Shaking
> it once before drinking helps too. This is physics reasoning, not a test of
> your build: measure a full bottle with a thermometer at the top and the
> bottom after 60 minutes.

## 0.1 What to realistically expect

> **Correction.** An earlier version of this section said a full bottle cools
> 24 → 8 °C in 60–90 minutes. That was too optimistic: it assumed more heat
> could leave through the small base heatsink than it really can. The numbers
> below come from a simulation, `design/cooldown_sim.py`, and the whole story is
> in [COOLING-SPEED.md](COOLING-SPEED.md).

A Peltier moves heat, it doesn't destroy it. For every watt of cooling the hot
side must shed that watt **plus** all the electrical power (about 2–3× more),
so the **heatsink sets the speed**, not the Peltier. With the 40 mm heatsink
that fits the base (about 1 K/W), a bottle starting at 24 °C reaches:

| Water, 24 °C start | → 15 °C | → 12 °C | → 10 °C | → 8 °C |
|---|---|---|---|---|
| 250 ml | 19 min | 32 min | 47 min | 100 min |
| 500 ml | 36 min | 59 min | 87 min | 188 min |
| 770 ml | 53 min | 89 min | 131 min | 283 min |

(with the water stirred or shaken; without stirring about 30 % longer, and
8 °C is never reached). The coldest this hardware can hold in 24 °C air is
**about 8–9 °C**, so treat targets below 10 °C as "best effort".

| | Value |
|---|---|
| Heat to remove, 500 ml, 24 → 8 °C | 0.5 kg × 4186 J/kg·K × 16 K ≈ **36 kJ (10 Wh)** |
| Peltier at ~3 A | ≈ 22–25 W in, heat out of the heatsink ≈ 35 W |
| Battery 2S2P 18650 (7.2 V × 6 Ah) | **~43 Wh**: enough for one cool-down plus hours of holding |
| Holding cold water cold (good insulation) | ~3–6 W average → many hours |
| USB-C charging (15–18 W PD) | **~3 hours** |

**Best use:** fill it with cold water and let the bottle **keep** it cold. That is
where a Peltier bottle shines. Cooling warm water from scratch works to about
12–15 °C in under an hour, but not fast.

---|---|
| Heat to remove, 24 °C → 8 °C | 0.5 kg × 4186 J/kg·K × 16 K ≈ **33.5 kJ (9.3 Wh)** |
| Peltier at ~7.4 V | ~3 A → **~22 W** in, ~8 W of heat pumped |
| Cool-down 24 → 8 °C | **~60–90 min** (the app's simulator is faster; its numbers are for the demo) |
| Battery 2S2P 18650 (7.2 V × 6 Ah) | **~43 Wh** ≈ one full cool-down + 1–2 h of holding |
| Holding cold water cold (good insulation) | ~3–6 W average → many hours |
| USB-C charging (15–18 W PD) | **~3 hours** |

**Best use:** fill it with cold water and let the bottle **keep** it cold. That
is where a Peltier bottle shines. Cooling warm water from scratch works, but it
uses most of a charge.

---

## 1. Safety (read first)

- **Never run the Peltier without its heatsink and fan.** The hot side passes
  100 °C within seconds and destroys the module. The firmware stops cooling at
  65 °C on the heatsink and refuses to start if the heatsink sensor is missing,
  but don't rely on software alone during assembly.
- **Lithium cells:** use genuine cells (Samsung 30Q, LG MJ1, Molicel P26A …),
  a **2S BMS with balancing**, a **fuse** (7.5 A) right at the pack, and a
  **master switch** for storage and transport. Never solder directly onto cells;
  use a spot-welded pack or a holder rated for 5 A+.
- **Water and electronics:** the cold side drops below the dew point, so
  **condensation will form**. Seal around the Peltier with foam gasket and
  silicone, keep the electronics *beside* the stack (not under it), and coat the
  boards (conformal coating or clear nail polish on non-connector areas).
- **Food contact:** water may touch only **food-safe aluminium (with its inner
  coating), 304/316 stainless steel** and **food-grade silicone**. No sensors, glue, or 3D-printed parts in the water.
- **Heat & plastics:** print the base in **PETG or ASA**, not PLA (PLA warps
  near the heatsink).

---

## 2. Parts list (≈ $70–90)

| # | Part | Example / notes | ≈ $ |
|---|---|---|---|
| 1 | Microcontroller | **ESP32-C3 SuperMini** (or Seeed XIAO ESP32-C3), BLE 5 | 3–6 |
| 2 | Peltier module | **TEC1-12706**, 40×40 mm (run at ~7.4 V, not 12 V, for better efficiency) | 3 |
| 3 | Cold block | Aluminium 40×40×10 mm (between Peltier and vessel bottom) | 3 |
| 4 | Heatsink + fan | 40×40×20 mm+ aluminium heatsink + 40 mm **5 V** fan (0.1–0.2 A) | 6 |
| 5 | Thermal paste | Any non-conductive CPU paste | 2 |
| 6 | Peltier switch | **IRLB8721** logic-level MOSFET (TO-220) + small heatsink tab | 1 |
| 7 | Fan switch | **AO3400** MOSFET (SOT-23) + 1N4148 diode | 1 |
| 8 | (Optional, better) smoothing | 33 µH 5 A inductor + 470 µF 16 V low-ESR cap + **SS54** Schottky | 3 |
| 9 | Temperature sensors | 2 × **DS18B20 waterproof (stainless probe)** + 2 × 4.7 kΩ | 4 |
| 10 | Battery | 4 × 18650 as **2S2P** (≈ 7.2 V, 6 Ah) | 16–24 |
| 11 | Protection | **2S BMS with balance**, 10 A+ (e.g., HX-2S-JH20) + 7.5 A fuse | 3 |
| 12 | Charger | **2S USB-C PD charger board** with balance (IP2326-based, 15 W) | 4 |
| 13 | 5 V supply | **MP1584EN** buck module, set to 5.0 V (ESP32 + fan + OLED) | 2 |
| 14 | Display | **1.3″ 128×64 blue OLED** (SH1106, I²C). Its 2:1 panel matches the bottle in the app; the firmware draws the same screen | 4 |
| 15 | Button | 12 mm momentary push button (metal, waterproof if possible) | 2 |
| 16 | Master switch | Small slide switch rated 5 A+ | 1 |
| 17 | Resistors | 220 kΩ + 100 kΩ (battery sense), 10 kΩ + 20 kΩ (USB sense), 100 Ω + 100 kΩ (MOSFET gates), 100 nF caps | 1 |
| 18 | Vessel | **Thin-wall aluminium** bottle with a food-safe inner coating, flat bottom, **Ø73 mm outside** (see [APPEARANCE-GUIDE.md](APPEARANCE-GUIDE.md)) + sport cap | 10–18 |
| 19 | Body sleeve | **TPU 95A**, printed (the app's ribbed, waisted body; also the insulation). About 320 g of filament, see [PRINTING-GUIDE.md](PRINTING-GUIDE.md) | 10 |
| 20 | Base, lid, cell cage | Printed in PETG/ASA (`design/stl/`): vents, USB-C hole, button, OLED window | 3 |
| 21 | Silicone sealant | Food-safe, flexible (bottle to base, cold-block gasket) | 4 |

---

## 3. Wiring

```
                    ┌──────────── 2S2P pack 6.4–8.4 V ───────────┐
 USB-C ─► 2S PD     │  BMS ── FUSE 7.5A ── MASTER SW ── VBAT+     │
          charger ──┘                                    │        │
                                                         ├──► MP1584 buck ─► 5V ─┬─► ESP32-C3 "5V"
                                                         │                       ├─► fan (+)
                                                         │                       └─► (OLED via ESP 3V3)
                                                         ├──► TEC (+) red wire
                                                         │      TEC (−) black ──► IRLB8721 drain
                                                         │                         source ─► GND
                                                         └──► 220k ─┬─ 100k ─ GND   (battery sense)
                                                                    └─► GPIO0  (+100 nF to GND)

 ESP32-C3 pin   →  connects to
 ────────────────────────────────────────────────────────────────────────
 GPIO3          →  100 Ω → IRLB8721 gate   (100 kΩ gate → GND)     Peltier PWM
 GPIO4          →  100 Ω → AO3400 gate     (100 kΩ gate → GND)     fan on/off
                   fan (−) → AO3400 drain; 1N4148 across the fan (band to +)
 GPIO5          ←  DS18B20 #1 data (water)    + 4.7 kΩ to 3V3
 GPIO10         ←  DS18B20 #2 data (heatsink) + 4.7 kΩ to 3V3
 GPIO0          ←  battery divider midpoint (max 2.63 V at 8.4 V)
 GPIO1          ←  USB-C VBUS → 10 kΩ → GPIO1 → 20 kΩ → GND   (charging detect)
 GPIO20         ←  button → GND  (internal pull-up)
 GPIO6 / GPIO7  ↔  OLED SDA / SCL;  OLED VCC → 3V3, GND → GND
 DS18B20 VCC    →  3V3,  GND → GND
 All grounds (pack −, buck −, MOSFET sources, ESP32 GND) meet at ONE point.
```

GPIO 2, 8 and 9 are the ESP32-C3's boot ("strapping") pins, so they're left
unused on purpose.

**Optional smoothing (recommended once the basic build works):** place the
33 µH inductor in series between the MOSFET drain and the Peltier (−). Put the
470 µF capacitor across the Peltier and the SS54 diode from the drain node back
to VBAT+. Together they form a simple buck stage, so the Peltier sees smooth
DC instead of 25 kHz pulses: ~10–20 % more cooling per watt and a longer
module life.

---

## 4. Mechanical assembly

1. **Dry fit first.** Vessel bottom → paste → aluminium block → paste →
   Peltier (**cold side up**) → paste → heatsink. Manufacturers differ on which
   face is cold, so **test it**: connect 3–5 V for 1–2 seconds only (red to +)
   and feel both faces, then mark the cold one.
2. **Clamp evenly.** Use 2–4 **nylon** M3 screws with spring washers through the
   heatsink into the base frame. Tighten in a cross pattern, finger-tight plus
   a quarter turn. **Over-tightening cracks the Peltier.**
3. **Insulate.** The printed TPU sleeve covers the vessel sides (if you skip the sleeve, wrap 8–10 mm closed-cell foam). Seal the gap
   around the aluminium block with a foam gasket and food-safe silicone (this
   keeps humid air, and condensation, away from the cold parts).
4. **Water sensor.** Fix DS18B20 #1 to the **outside** of the vessel wall, about
   one-third up from the bottom and away from the cold block. Use thermal
   paste and aluminium tape under the foam. Never put a sensor inside the water.
5. **Heatsink sensor.** Fix DS18B20 #2 between the heatsink fins with thermal
   paste or a dab of thermal epoxy.
6. **Airflow.** The fan must pull fresh air in through one side of the base and
   push it out across the heatsink through the other. Hot air must not
   recirculate.
7. **Electronics bay.** Place the board, BMS, charger and buck **beside** the
   heatsink, not below the cold stack. Mount the OLED behind a window and the
   button and USB-C port in the base wall.

---

## 5. Firmware

The code is in `firmware/nexa_one/`. All the decision-making (thermostat,
safety cut-offs, battery %, button gestures, session log, Bluetooth packets)
lives in `nexa_core.h`. It is **unit-tested on a PC**:

```bash
cd firmware/test
g++ -std=c++17 -Wall -Wextra -I../nexa_one test_core.cpp -o test_core && ./test_core fixtures.json
# → 53 passed, 0 failed
```

**Flash it:**

1. Install **Arduino IDE 2**. Under *Boards Manager*, install **"esp32 by
   Espressif Systems" 3.x**.
2. *Library Manager*: install **NimBLE-Arduino 2.x**, **OneWire**,
   **DallasTemperature**, **U8g2**.
3. Open `firmware/nexa_one/nexa_one.ino`. Select board **"ESP32C3 Dev Module"**
   (or your XIAO/SuperMini) and set *USB CDC On Boot* → **Enabled**.
4. Connect USB and click **Upload**. If it won't upload, hold **BOOT**, tap
   **RESET**, then release BOOT.

> The `.ino` file has been syntax-checked, but not compiled against the real
> ESP32 libraries or run on hardware. Expect to fix small API differences if
> your library versions differ from the ones above.

**What the button does** (this matches the in-app connection guide):

| Press | Action |
|---|---|
| Short press | Cooling on / off |
| Hold **3 s** | Pairing mode: the Bluetooth icon blinks for 2 minutes |
| Hold **10 s** | Factory reset (forgets the phone, target and saved sessions) |

On first boot the bottle is automatically in pairing mode. Once a phone has
connected, it advertises whenever it's on, so the app reconnects by itself.

**How it controls temperature** (same rules as the app's simulator):

- Water more than 0.2 °C above the target → **cooling**. Power rises with the
  gap, from 45 % to 100 %.
- Within ±0.2 °C → **holding**, gentle power (≤ 35 %).
- Below the target → holding with the Peltier idle (the water drifts back up).
- **Battery saver** → 60 % power. Power ramps up gently (soft start) to protect
  the Peltier and the battery.
- **Safety stops:** heatsink ≥ 65 °C (restarts only below 45 °C), missing or
  broken sensor, or battery ≤ 3 % when not charging. The fan keeps running
  30 s after the Peltier stops, and the whole time during an overheat.

---

## 6. Test before you seal it up

1. **Electronics only (no Peltier wired):** open the Serial Monitor. Check the
   OLED shows the water temperature, both sensors read room temperature,
   and the battery % looks right.
2. **Bluetooth:** install **nRF Connect** on your phone. You should see
   **"NEXA ONE"**. Read characteristic `8b6f0002-…`: you get 12 bytes, and byte 3–4
   ÷ 10 = water °C. Write `02 0A` to `8b6f0003-…`, and the target on the OLED changes
   to 10.
3. **Peltier, dry, 30 seconds:** heatsink and fan fitted, no water. Short-press
   the button and feel the cold block get cold within seconds. Watch the
   heatsink temperature: it should stay well under 50 °C.
4. **Full test:** fill with room-temperature water, set the target to 8 °C, and
   time it. Log the heatsink temperature during the first 30 minutes.

---

## 7. Connect it to the app

The APK you have now runs the app's **simulator**. Android's WebView has no
Web Bluetooth, so talking to a real bottle needs a native Bluetooth plugin
**compiled into the app**. That means rebuilding the app from its **source
project**; a built APK can't be patched this way. The code is ready:

1. In the app's source project:
   ```bash
   npm i @capacitor-community/bluetooth-le
   npx cap sync android
   ```
2. Copy `app-integration/nexa-protocol.js` and `app-integration/ble-transport.js`
   into `src/`.
3. Find where the app creates its simulator (the class with
   `kind = "simulator"`; in the built bundle it's `new LV`) and switch to the
   real bottle:
   ```js
   import { BleBottle } from './ble-transport.js';
   const store = useRealBottle ? new BleBottle() : new SimulatorBottle();
   ```
   `BleBottle` has the same methods and snapshot shape as the simulator, so
   the screens work unchanged. Hide the simulator-only tools in Settings when
   `store.kind !== 'simulator'`, and rename the button
   "התחברות במצב הדגמה" → "התחברות לבקבוק".
4. Android permissions: the plugin adds `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT`.
   We initialise it with `androidNeverForLocation: true`, so Android 12+ asks
   only for **"Nearby devices"** (exactly what step 3 of the in-app guide
   says). Follow the plugin's README to add
   `android:usesPermissionFlags="neverForLocation"` to `BLUETOOTH_SCAN` in
   `AndroidManifest.xml`.
5. Build in Android Studio and install. The first **Connect** shows Android's
   device picker; choose **NEXA ONE**. After that the app reconnects by
   itself, reconnects after drops, and pulls the sessions recorded while the
   phone was away (cooling started with the bottle's button).

**Verify the app side without hardware:**

```bash
cd app-integration
node test-protocol.mjs ../firmware/test/fixtures.json                 # app ↔ firmware bytes match
node --import ./test/register.mjs test/test-transport.mjs             # BleBottle vs. a fake bottle
```

### Bluetooth protocol v1 (for reference)

| Characteristic | UUID | Access | Content |
|---|---|---|---|
| Service | `8b6f0001-6e65-7861-a1b2-00004e455841` | | |
| State | `8b6f0002-…` | read, notify (1 s) | 12 B: ver, flags (cooling/charging/saver/overheat/sensor/pairing), phase, water×10 (i16), target, battery %, health %, heatsink×10 (i16), pending sessions, reserved |
| Control | `8b6f0003-…` | write | `01 on` cooling · `02 °C` target · `03 on` saver · `10` send sessions · `11 n` ack n · `20` identify |
| Sessions | `8b6f0004-…` | notify | 20 B per session (uptime start/end, start/end/min temp, target, battery start/end, who started/ended, seq), then `FF` + bottle uptime + count |

Every packet is ≤ 20 bytes, so the default BLE MTU works on every phone. The
bottle has no clock: it stamps sessions with its uptime, and the app converts
them to real times using the uptime the bottle sends in the end marker.

---

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Cold side barely cools, heatsink very hot | Peltier upside down, poor paste contact, or the fan isn't moving air |
| Cooling stops after a few minutes, OLED shows "HOT!" | Heatsink too small or airflow recirculating; add a bigger heatsink |
| OLED shows "SENS" | A DS18B20 isn't detected: check the 4.7 kΩ pull-up and the data wire |
| Battery % jumps when cooling starts | Normal voltage sag; the firmware only lets % move one way while (dis)charging |
| Water on the electronics | Condensation: improve the foam seal around the cold block |
| App can't find the bottle | Hold the button 3 s (icon must blink) and allow "Nearby devices" |
| ESP32 resets when the Peltier starts | Ground loop or weak 5 V: use one star ground and add 470 µF at the buck output |

## 9. Going further

- **Deep sleep** between uses (wake on button press) for weeks of standby.
- **BLE bonding** (encrypted pairing) before letting anyone else use your bottle.
- **Over-the-air updates** via the ESP32's OTA support.
- **A custom PCB** combining charger, BMS, MOSFETs and the C3 module, so the
  base gets much smaller.
