# Build it to look like the app (and work like it)

The bottle in the NEXA ONE app is a render: black matte ribbed body with a
waist, a sport cap with a spout, and a satin base holding a small blue display
and a round button. This guide turns that picture into real dimensions, a
printable base, and a build order. It builds on [BUILD-GUIDE.md](BUILD-GUIDE.md)
(electronics, firmware, safety).

![dimensions](design/bottle-dimensions.png)

> **Please read this first.** I measured the render and checked whether the
> parts fit inside it. Three things the picture doesn't show, and what I did
> about each:
>
> 1. **The base in the render is too short.** At any scale where it is wide
>    enough, it is about 54 mm tall. Four 18650 cells plus the Peltier stack need
>    about 73 mm. The drawing shows the base **19 mm taller** than the render
>    (dashed). Everything else is as rendered.
> 2. **The body is very slender.** At the scale that makes the base fit, the
>    full-height body holds about **970 ml** and the whole bottle is **384 mm**
>    tall. Option B below keeps every diameter and shortens the body 20 %.
> 3. **A Peltier under the bottle cools the bottom.** Cold water above 4 °C
>    stays at the bottom; the top stays warm. The vessel must be **thin
>    aluminium** so the cold climbs the walls (details in BUILD-GUIDE §0).

## 1. What the app promises, and what the hardware does

| In the app | In the bottle |
|---|---|
| Cooling on / off | Button short press, or the app. The same session is recorded either way |
| Target 5–15 °C, presets 6 / 10 / 14 | Whole-degree thermostat, ±0.2 °C hold band, same numbers |
| Phase: cooling / holding / off | Peltier power follows the gap; a snowflake shows while cooling |
| Battery %, charging, battery saver | 2S pack gauge, USB-C charging, saver = 60 % power |
| History: each cooling run with start/end/min temperature | Recorded in the bottle (16 runs), sent to the app when it reconnects |
| "Bottle display" screen: big temperature, snowflake, target, battery | The real OLED draws that same layout (`drawDisplay()` in the firmware) |
| Guide: hold 3 s, Bluetooth symbol blinks | Exactly that: the OLED shows only a blinking Bluetooth rune while pairing |

Differences you'll notice: the real bottle is slower than the app's simulator
(see §6), and the app's simulator tools (fake charger, drain battery) do nothing
on real hardware.

## 2. Choose your version

Same diameters and base in both; only the body height differs (scale 0.478 mm
per unit of the render).

| | **A: Faithful** | **B: Practical (recommended)** |
|---|---|---|
| Body height as rendered | 100 % (250 mm) | 80 % (200 mm) |
| Vessel volume | ≈ 970 ml | ≈ 765 ml |
| Total height with the 73 mm base | **386 mm** | **336 mm** |
| Fits a car cup holder (≈ Ø75) | no (base Ø86) | no (base Ø86) |
| Cool-down 24 → 8 °C, one TEC1-12706 | ≈ 2.3 h | ≈ 1.8 h |
| Filled to 500 ml | ≈ 1.2 h | ≈ 1.2 h |

Neither fits a cup holder, because the base has to hold the battery. If that
matters, drop to two cells (1S2P, 3.7 V) and a 30×30 Peltier. That is a
different, slower bottle and needs its own firmware limits.

Honest expectation: a single 40×40 Peltier is a **keep-it-cold** device. Fill
with cold water and it holds 8 °C for hours. Cooling a full bottle from room
temperature works, but takes about two hours and most of a charge.

## 3. Dimensions

| Part | Size (mm) | Notes |
|---|---|---|
| Spout | Ø18 | standard push-pull or bite spout |
| Cap | Ø61 × ≈ 50 | with fine vertical grip ribs |
| Body | Ø84 at both ends, **Ø74 at the waist** | waist is at mid-body |
| Ribs | 30 rings, 3.1 mm pitch, 0.5 mm deep | from 87 mm to 180 mm below the top of the body |
| Base | **Ø86 × 73** | render says 54, see §1 |
| Display window | 33.5 × 16.7, centred 19 mm below the top of the base | sits 9 mm left of the front centre line |
| Button | Ø8 | 17 mm right of centre, same height as the display |
| NEXA logo | ≈ 23 mm wide, 4.5 mm tall, tone-on-tone | on the body, ≈ 34 mm above the base |
| Intake | 36 slots, 2.4 × 3 mm, 9 mm above the bottom | the render's dotted row |
| Exhaust | 18 slits, 13 × 1.6 mm, at the top seam | the dark line between body and base |

`design/fit_check.py` recomputes all of this for any scale. Edit `K` or the
body-height factor and re-run it.

## 4. The exterior, part by part

**Base (printed).** `design/stl/base_shell.stl` and `base_lid.stl`
(regenerate with `design/base_shell.py`). It is a v0 shell: outer form, cold-block
opening (Ø58, so a 40×40 block passes), display window, button hole, USB-C slot,
intake slots, exhaust seam, four lid screw bosses. It has **no mounts for your
particular OLED, board or cell holders**; add those for the parts you bought.
Print in PETG or ASA (not PLA: it sits next to the heatsink), 0.2 mm layers, 4
walls, top plate on the bed, supports for the window. Print a 20 mm slice first
to check the vessel and the screws. Finish: sand 400 → 800, primer, then satin
black.

**Colours** (taken from the render): body `#1c1e23`–`#30343c`, base satin
`#17191d`–`#2a2e35`, display digits and accents `#35AFFF`. Satin, not gloss,
and no coloured parts apart from the display.

**Body sleeve.** Matte black, 3 mm wall, ribs and waist as in the table. Two
ways: print in **TPU 95A** (it can be done in vase mode with a ribbed profile),
or cast **silicone** in a printed mould. The sleeve slides over the aluminium
vessel and gives the look and a little insulation. It doesn't touch the water,
so it needn't be food-safe, but it shouldn't cover the vessel's top threads.

**Vessel.** Thin-wall aluminium bottle with a food-safe inner coating,
about **Ø72 mm inside**, flat bottom, standard neck. Buy the bottle and put the
sleeve over it; don't machine the vessel. The cap in the render is narrower
than the body (Ø61 on Ø84), so a standard wide-mouth cap (about Ø70) will look
slightly bigger than the picture. That is an acceptable difference.

**Display.** A **1.3″ 128×64 blue OLED** (SH1106, I²C). Its 29.4 × 14.7 mm
active area has the same 2:1 shape as the render's panel. Glue a 1 mm smoked
acrylic window over it from the inside; it hides the module's frame, so you
see a black panel with blue digits, as in the app. If your module is an SSD1306,
change one line in `nexa_one.ino` (marked).

**Button.** 8 mm momentary push button (stainless or black anodised) with a
power symbol engraved on the cap or on a sticker.

**Logo.** Laser-engrave or UV-print "NEXA" with wide letter-spacing, barely
darker or lighter than the sleeve. It should be hard to see in daylight.

## 5. Inside the base

From the top down (all in the Ø80 bore):

```
 vessel (rests on the 8 mm plate ring)
 ───────── gasket + foam seal
 Al block 40×40×10   ← through the Ø58 opening, touches the vessel bottom
 Peltier 40×40×3.9   ← cold side up (test it, see BUILD-GUIDE §4)
 heatsink 40×40×20
 fan 40×40×10        ← blows UP through the fins
 ───────── 4 × 18650 stand around the stack (N / E / S / W, r = 30.3 mm)
 electronics board, buck converter, charger → lid side
 lid with an intake grille, screwed to the 4 bosses
```

Air path: in through the lid grille and the low slots, up past the fan and the
fins, out of the top seam. The seam is also what makes the dark line in the
render.

**Tight spot:** the cells have only **0.4 mm** of clearance to the wall. Use bare
cells with heat-shrink, or a single flat 2S2P pack welded by a shop. If you
need holders, make the base Ø90 and set `OD` in `base_shell.py`.

## 6. Order of assembly

1. Print the base and the lid. Test-fit a 20 mm slice over the vessel bottom.
2. Fit the electronics on a bench first (BUILD-GUIDE §6, steps 1–3), then take
   them apart.
3. Mount the display window and the button in the base.
4. Stack: heatsink + fan on the bench, then Peltier, then block with paste.
5. Cell pack + BMS + fuse + master switch, then the board. Wire per BUILD-GUIDE §3.
6. Close the lid. Check that the fan turns and air comes out of the seam.
7. Seat the vessel, then the sleeve.
8. Flash the firmware (BUILD-GUIDE §5), then run the checks in §6 of that guide.

## 7. What I could not check

- **The STL is untested.** It is watertight, with the right size and the
  features in the right places (checked on screen), but I haven't printed it or
  built the stack in it. Expect to nudge hole sizes and add mounts.
- **The firmware display layout** (`drawDisplay()`) compiles against stub
  libraries, not the real U8g2 on a board. The coordinates are the render's,
  and font widths may need a small nudge (constants at the top of that block).
- **Cooling times** come from heat-capacity arithmetic and typical Peltier
  numbers, not from a measurement of your build.
- **Stratification** is why the guide says aluminium. Measure the top and bottom
  temperatures once, and don't trust the display sensor alone.
