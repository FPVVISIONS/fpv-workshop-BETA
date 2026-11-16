"""Shared layout for every printed part (mm).  Change a number here, re-run the generators.

Angles are math angles (counter-clockwise from +X, seen from above). The front of the
bottle (display side) is -90°.  `ROT` turns the whole internal layout (cell ring, stack,
screw bosses, rail gap) so that the cells straddle the display and the button, and a
gap between two cells faces the back, where the USB-C port is.
"""
import math

# ---- base ---------------------------------------------------------------------
OD, H = 90.0, 75.0
WALL, PLATE, LID_T = 3.0, 4.0, 3.0
BORE_R = OD / 2 - WALL                     # 42.0
OPENING_D = 58.0                           # top-plate opening for the 40x40 cold block

# ---- front features, as angles from the front (+ = toward the viewer's right) -------
DISPLAY_ANGLE, BUTTON_ANGLE = -12.5, 23.6
FRONT = -90.0
DISPLAY_Z = H - 19.75                      # centre height of display and button
# Chosen by scanning (found with a rotation/shift search using assembly_check.py): with the front cells
# slid 5 mm sideways, every rotation from -50° to -34° leaves >= 0.75 mm around each cell; -42° is the middle.
ROT = -42.0

# ---- components (nominal sizes) ---------------------------------------------------
CELL_D, CELL_L = 18.6, 65.2                # 18650, wrapped
RING_R = 30.8                              # cell centres from the axis (pocket walls must clear the 40 mm fan: 30.8-9.5 > 20)
# The two front cells slide sideways along their flat of the heatsink stack, away from the front,
# which opens room for the display frame and the button. Keys are local pocket angles (before ROT).
CELL_SHIFT = {0: 5.0, 90: 0.0, 180: 0.0, 270: -5.0}
TEC = 40.0
FAN_Z, FAN_H = 31.1, 10.0                  # stack (pads compressed), bottom to top: fan, heatsink, TEC, cold block
SINK_H, TEC_H, BLOCK_H = 20.0, 3.9, 10.0
STACK_TOP = FAN_Z + FAN_H + SINK_H + TEC_H + BLOCK_H     # 75.0: the block top sits flush with the plate top
# Clamp force for the Peltier: the stack rests on 4 silicone pads (6x6, 3.0 mm thick, ~30 Shore A) on feet at
# the bottom of the cradle. The block is left ~1.5 mm proud; seating the bottle compresses the pads to 1.5 mm.
PAD, PAD_COMPRESSED, FOOT_T, FOOT = 3.0, 1.5, 1.5, 9.0

# ---- display frame (flat pad + OLED pocket) -------------------------------------
FRAME_PLANE = 43.4                         # distance from the axis to the flat front face
FRAME_T, FRAME_W, FRAME_H = 6.0, 48.0, 42.0
OLED_PCB = (35.6, 34.0)                    # pocket for a 1.3" module, typically 35.4 x 33.5 (measure yours!)
OLED_DEPTH = 5.0                           # module is stuck in with double-sided foam tape


def pol(r, deg):
    return r * math.cos(math.radians(deg)), r * math.sin(math.radians(deg))


def cell_local_xy(a):
    """Centre of the pocket at local angle a (before ROT), including its sideways shift."""
    t = CELL_SHIFT[a]
    c, s_ = math.cos(math.radians(a)), math.sin(math.radians(a))
    return RING_R * c - t * s_, RING_R * s_ + t * c


def cell_xy(a, rot=None):
    """Global centre of the cell at local angle a."""
    r = math.radians(ROT if rot is None else rot)
    x, y = cell_local_xy(a)
    return x * math.cos(r) - y * math.sin(r), x * math.sin(r) + y * math.cos(r)
