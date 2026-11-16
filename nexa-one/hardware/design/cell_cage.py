"""Printed cradle for 4 x 18650 (2S2P) that stands on the lid, inside the base.

    python3 cell_cage.py [outdir]      # → cell_cage.stl

Four upright pockets on the N/E/S/W axes (r = 30.3 mm from the centre) leave the
middle free for the 40x40 Peltier stack. A thin arc rail at r = 31.5 ties the
pockets together without touching the heatsink corners (28.3 mm out).
The rail is open between the two back pockets. Pockets are slotted on the side facing the centre so you can reach the nickel
strip tabs and wire the pack. Orientation: +Z up; print as drawn.
"""
import math
import sys

import numpy as np
import trimesh

import layout as L
from trimesh.creation import box, cylinder
from trimesh.transformations import rotation_matrix, translation_matrix

CELL_D = 18.6
POCKET_ID = CELL_D + 0.4          # 19.0 — wrapped cell plus clearance
POCKET_WALL = 1.0
RING_R = L.RING_R                 # cell centres from the axis
POCKET_H = 38.0                   # cells stand 65 mm, the cradle holds the lower 38 mm
FLOOR = 2.0                       # underside of each pocket; cells sit on it
RAIL_W, RAIL_H = 2.4, 14.0
RAIL_R = L.RING_R + 1.2           # arc rail tying the pockets together
SLOT_W = 9.0                      # opening on the inner side of each pocket for the strip tabs
SEG = 64
GAP_ANGLE = 135.0                 # local angle of the rail gap: faces the back after the layout rotation
GAP_W = 20.0                      # a charger board up to ~18 mm wide passes through here


def build():
    parts = []
    for a in (0, 90, 180, 270):
        x, y = L.cell_local_xy(a)
        outer = cylinder(radius=POCKET_ID / 2 + POCKET_WALL, height=POCKET_H, sections=SEG)
        outer.apply_transform(translation_matrix((x, y, POCKET_H / 2)))
        parts.append(outer)
    body = parts[0]
    for q in parts[1:]:
        body = body.union(q, engine='manifold')

    # arc rail tying the pockets together (a thin tube section, full circle is fine)
    rail = cylinder(radius=RAIL_R + RAIL_W / 2, height=RAIL_H, sections=128)
    rail.apply_transform(translation_matrix((0, 0, RAIL_H / 2)))
    hole = cylinder(radius=RAIL_R - RAIL_W / 2, height=RAIL_H + 2, sections=128)
    hole.apply_transform(translation_matrix((0, 0, RAIL_H / 2)))
    rail = rail.difference(hole, engine='manifold')
    body = body.union(rail, engine='manifold')

    # bores for the cells, closed by the floor
    for a in (0, 90, 180, 270):
        x, y = L.cell_local_xy(a)
        bore = cylinder(radius=POCKET_ID / 2, height=POCKET_H, sections=SEG)
        bore.apply_transform(translation_matrix((x, y, FLOOR + POCKET_H / 2)))
        body = body.difference(bore, engine='manifold')
        # strip-tab slot on the side facing the centre
        slot = box(extents=(POCKET_WALL + 2.2, SLOT_W, POCKET_H - FLOOR - 6))
        slot.apply_transform(translation_matrix((-(POCKET_ID / 2 + POCKET_WALL / 2), 0, FLOOR + 3 + (POCKET_H - FLOOR - 6) / 2)))
        slot.apply_transform(rotation_matrix(math.radians(a), (0, 0, 1)))
        slot.apply_transform(translation_matrix((x, y, 0)))
        body = body.difference(slot, engine='manifold')
    # gap in the rail between the two back pockets, for the charger board to reach the USB-C port
    gap = box(extents=(GAP_W, 10.0, RAIL_H + 4))
    gap.apply_transform(translation_matrix((0, RAIL_R, RAIL_H / 2)))
    gap.apply_transform(rotation_matrix(math.radians(GAP_ANGLE - 90.0), (0, 0, 1)))
    body = body.difference(gap, engine='manifold')
    body.apply_transform(rotation_matrix(math.radians(L.ROT), (0, 0, 1)))        # same rotation as the base layout
    return body


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    m = build()
    m.export(f'{out}/cell_cage.stl')
    print(f"cell_cage: watertight={m.is_watertight} volume={m.volume / 1000:.1f} cm³ "
          f"bbox={np.round(m.bounds[1] - m.bounds[0], 1).tolist()} mm")
    # clearance to the base wall (inner radius 42) and to the heatsink corner (28.3)
    far = np.linalg.norm(m.vertices[:, :2], axis=1).max()
    print(f"outermost point r={far:.2f} mm (inner wall 42.0 → {42.0 - far:.2f} mm clear)")
    inner_rail = RAIL_R - RAIL_W / 2
    print(f"rail inner edge r={inner_rail:.2f} mm vs heatsink corner 28.28 → {inner_rail - 28.28:.2f} mm clear")
