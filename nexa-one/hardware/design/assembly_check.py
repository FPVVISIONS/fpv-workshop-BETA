"""Does everything fit together?  Places every printed part and every real component
(cells, fan, heatsink, Peltier, cold block, OLED, button) and reports overlapping volume.

    python3 assembly_check.py stl        # needs the STLs from the generators in ./stl

An overlap of more than 1 mm³ is a collision. Touching surfaces are fine.
Nominal sizes: 18650 Ø18.6×65.2, 40×40 fan/heatsink/TEC/block, 36×35×4 OLED, Ø8 button.
"""
import itertools
import math
import sys

import numpy as np
import trimesh
from trimesh.creation import box, cylinder
from trimesh.transformations import rotation_matrix, translation_matrix

import layout as L

stl = sys.argv[1] if len(sys.argv) > 1 else 'stl'


def rz(deg):
    return rotation_matrix(math.radians(deg), (0, 0, 1))


def tz(x=0, y=0, z=0):
    return translation_matrix((x, y, z))


def load(name):
    return trimesh.load(f'{stl}/{name}.stl')


parts = {}
parts['base shell'] = load('base_shell')
parts['lid'] = load('base_lid')
cage = load('cell_cage'); cage.apply_translation((0, 0, L.LID_T)); parts['cell cage'] = cage

for k, a in enumerate((0, 90, 180, 270)):                  # the four cells
    x, y = L.cell_xy(a)
    c = cylinder(radius=L.CELL_D / 2, height=L.CELL_L, sections=48)
    c.apply_transform(tz(x, y, L.LID_T + 2.0 + L.CELL_L / 2))
    parts[f'cell {k + 1}'] = c

for name, z0, h in (('fan', L.FAN_Z, L.FAN_H), ('heatsink', L.FAN_Z + L.FAN_H, L.SINK_H),
                    ('Peltier', L.FAN_Z + L.FAN_H + L.SINK_H, L.TEC_H),
                    ('cold block', L.FAN_Z + L.FAN_H + L.SINK_H + L.TEC_H, L.BLOCK_H)):
    b = box(extents=(L.TEC, L.TEC, h)); b.apply_transform(tz(0, 0, z0 + h / 2)); b.apply_transform(rz(L.ROT))
    parts[name] = b

ih = 40.8 / 2                                              # silicone clamp pads on the cradle feet (compressed 1.5 mm)
for k in range(4):
    pad = box(extents=(6.0, 6.0, L.PAD_COMPRESSED)); pad.apply_transform(tz(ih - 6.0 / 2, ih - 6.0 / 2, L.FAN_Z - L.PAD_COMPRESSED / 2))
    pad.apply_transform(rz(90 * k + L.ROT)); parts[f'clamp pad {k + 1}'] = pad

def front(m, z, angle, y):
    m = m.copy(); m.apply_transform(tz(0, y, z)); m.apply_transform(rz(angle)); return m

parts['OLED module'] = front(box(extents=(L.OLED_PCB[0], 4.0, L.OLED_PCB[1])), L.DISPLAY_Z, L.DISPLAY_ANGLE, -(L.FRAME_PLANE - L.FRAME_T + L.OLED_DEPTH - 2.0))
btn = cylinder(radius=4.0, height=14.0, sections=32); btn.apply_transform(rotation_matrix(math.radians(90), (1, 0, 0)))
parts['button body'] = front(btn, L.DISPLAY_Z, L.BUTTON_ANGLE, -(L.OD / 2 - 7.0))
nut = cylinder(radius=6.0, height=3.0, sections=32); nut.apply_transform(rotation_matrix(math.radians(90), (1, 0, 0)))
parts['button nut'] = front(nut, L.DISPLAY_Z, L.BUTTON_ANGLE, -(35.5 - 1.8))

# pairs where contact is expected or irrelevant (printed parts vs the lid they sit on, the stack stacked on itself, …)
SKIP = {frozenset(p) for p in (('fan', 'heatsink'), ('heatsink', 'Peltier'), ('Peltier', 'cold block'),
                               ('cell 1', 'cell 2'), ('cell 2', 'cell 3'), ('cell 3', 'cell 4'), ('cell 1', 'cell 4'), ('button body', 'button nut'))}

bad, checked = [], 0
for (a, ma), (b, mb) in itertools.combinations(parts.items(), 2):
    if frozenset((a, b)) in SKIP:
        continue
    checked += 1
    # quick reject on bounding boxes
    if np.any(ma.bounds[1] < mb.bounds[0] - 0.01) or np.any(mb.bounds[1] < ma.bounds[0] - 0.01):
        continue
    try:
        v = ma.intersection(mb, engine='manifold').volume
    except Exception:
        v = 0.0
    if v > 1.0:
        bad.append((a, b, v))

print(f'{len(parts)} parts, {checked} pairs checked')
if bad:
    print('COLLISIONS:')
    for a, b, v in sorted(bad, key=lambda t: -t[2]):
        print(f'  {a:24} × {b:24} {v:8.1f} mm³')
else:
    print('no collisions (touching surfaces only)')

# closest approach of the cells to the base inside, where it is tightest
cells = [parts[f'cell {k}'] for k in range(1, 5)]
print('cell top to underside of the top plate: %.1f mm' % ((L.H - L.PLATE) - max(c.bounds[1][2] for c in cells)))
sys.exit(1 if bad else 0)
