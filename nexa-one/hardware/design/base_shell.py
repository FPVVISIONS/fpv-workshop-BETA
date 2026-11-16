"""Parametric 3D-printable base for the NEXA ONE bottle  (shell v0).

    pip install trimesh manifold3d numpy
    python3 base_shell.py [outdir]        # → base_shell.stl, base_lid.stl

What it is: the satin-finish base from the app's render, as a hollow printed
shell with the display window, the round button, the USB-C slot, the dotted air
intake and the dark seam at the top that doubles as the hot-air exhaust.
What it is NOT: finished CAD. There are no mounting posts for your particular
OLED, board or cell holders; add those for the parts you bought. Print one
ring first (set --test-ring) to check the vessel and the clamp fit.

Orientation: +Z up. The display faces -Y (front).  Units: mm.
"""
import math
import sys

import numpy as np
import trimesh
from trimesh.creation import box, cylinder
from trimesh.transformations import rotation_matrix, translation_matrix

# ---- sizes (from fit_check.py, K = 0.5 mm per render unit) -------------------
OD = 90.0            # outer diameter (render × 0.5; wide enough for the cell cage)
H = 75.0             # height (the render says 57 mm; see APPEARANCE-GUIDE.md)
WALL = 3.0
PLATE = 4.0          # top plate the vessel stands on
LID_T = 3.0
EDGE_R = 4.0         # rounded bottom edge
VESSEL_HOLE = 58.0   # opening for the 40x40 cold block (diagonal 56.6 mm) + gasket
DISPLAY = (35.0, 17.5)   # window, as rendered
DISPLAY_Z_FROM_TOP = 19.75
FRAME_PLANE = 43.4       # flat face the screen sits behind: distance from the axis (outer wall is at 45)
FRAME_T = 2.2            # frame thickness behind that plane
FRAME_W, FRAME_H = 46.0, 28.0
DISPLAY_ANGLE = -12.5    # degrees from the front, toward the viewer's left
BUTTON_D = 8.2
BUTTON_ANGLE = 23.6
USBC = (9.4, 3.4)
SEAM_H = 1.6             # exhaust slit height
SEAM_Z = H - 9.0
SLOTS_BOTTOM = 36        # intake slots around the lower wall
SEGMENTS = 96
BOSS_R = 39.0           # screw bosses on the diagonals; inner wall radius is 42


def revolve_profile(pts, sections=SEGMENTS):
    return trimesh.creation.revolve(np.array(pts, dtype=float), sections=sections)


def outer_solid():
    r = OD / 2
    pts = [(0, 0)]
    for a in np.linspace(-90, 0, 9):            # rounded bottom edge
        pts.append((r - EDGE_R + EDGE_R * math.cos(math.radians(a)), EDGE_R + EDGE_R * math.sin(math.radians(a))))
    pts += [(r, H - 1.5), (r - 1.5, H), (0, H)]
    return revolve_profile(pts)


def radial_box(size, z, angle_deg, radius):
    """A cutter box whose long axis points outward at angle (0° = front, -Y)."""
    sx, sy, sz = size                          # sx tangential, sy radial depth, sz height
    b = box(extents=(sx, sy, sz))
    b.apply_transform(translation_matrix((0, -radius, z)))
    b.apply_transform(rotation_matrix(math.radians(angle_deg), (0, 0, 1)))
    return b


def rounded_rect_cutter(w, h, depth, r):
    """Rounded-rectangle window cutter, depth along +Y, built from primitives."""
    parts = [box(extents=(w - 2 * r, depth, h)), box(extents=(w, depth, h - 2 * r))]
    for sx in (-1, 1):
        for sz in (-1, 1):
            c = cylinder(radius=r, height=depth, sections=32)
            c.apply_transform(rotation_matrix(math.radians(90), (1, 0, 0)))   # axis → Y
            c.apply_transform(translation_matrix((sx * (w / 2 - r), 0, sz * (h / 2 - r))))
            parts.append(c)
    m = parts[0]
    for q in parts[1:]:
        m = m.union(q, engine='manifold')
    m.apply_transform(translation_matrix((0, depth / 2, 0)))       # starts at y=0, extends +Y
    return m


def place_front_cutter(cutter, z, angle_deg):
    c = cutter.copy()
    c.apply_transform(translation_matrix((0, -(OD / 2) + 1.0, z)))       # starts inside the wall
    c.apply_transform(rotation_matrix(math.radians(angle_deg), (0, 0, 1)))
    return c


def display_frame():
    """Flat pad behind the display window: the module and its 1 mm acrylic sit on a
    flat face instead of the curved wall. Trimmed to the outer cylinder so nothing pokes out."""
    f = box(extents=(FRAME_W, FRAME_T, FRAME_H))
    f.apply_transform(translation_matrix((0, -(FRAME_PLANE - FRAME_T / 2), H - DISPLAY_Z_FROM_TOP)))
    f.apply_transform(rotation_matrix(math.radians(DISPLAY_ANGLE), (0, 0, 1)))
    cyl = cylinder(radius=OD / 2 - 0.4, height=H + 2, sections=SEGMENTS)
    cyl.apply_transform(translation_matrix((0, 0, H / 2)))
    return f.intersection(cyl, engine='manifold')


def build_shell():
    shell = outer_solid()
    cav = cylinder(radius=OD / 2 - WALL, height=H - PLATE, sections=SEGMENTS)
    cav.apply_transform(translation_matrix((0, 0, (H - PLATE) / 2 - 0.01)))   # open at the bottom
    shell = shell.difference(cav, engine='manifold')
    shell = shell.union(display_frame(), engine='manifold')
    cuts = []

    # cold-block opening in the top plate
    hole = cylinder(radius=VESSEL_HOLE / 2, height=PLATE + 2, sections=SEGMENTS)
    hole.apply_transform(translation_matrix((0, 0, H - PLATE / 2)))
    cuts.append(hole)

    # display window + round button on the front, as placed in the render
    win = rounded_rect_cutter(DISPLAY[0], DISPLAY[1], WALL + 4, 1.6)
    cuts.append(place_front_cutter(win, H - DISPLAY_Z_FROM_TOP, DISPLAY_ANGLE))
    btn = cylinder(radius=BUTTON_D / 2, height=WALL + 4, sections=48)
    btn.apply_transform(rotation_matrix(math.radians(90), (1, 0, 0)))
    btn.apply_transform(translation_matrix((0, (WALL + 4) / 2, 0)))
    cuts.append(place_front_cutter(btn, H - DISPLAY_Z_FROM_TOP, BUTTON_ANGLE))

    # USB-C at the back
    usb = rounded_rect_cutter(USBC[0], USBC[1], WALL + 4, 1.2)
    cuts.append(place_front_cutter(usb, 30.0, 180))

    # intake: a ring of small slots low on the wall (the render's dotted row)
    for i in range(SLOTS_BOTTOM):
        cuts.append(radial_box((2.4, WALL + 4, 3.0), 9.0, i * 360.0 / SLOTS_BOTTOM, OD / 2 - 1.0))
    # exhaust: the dark seam under the vessel, cut as 18 slits with bridges between
    for i in range(18):
        cuts.append(radial_box((13.0, WALL + 4, SEAM_H), SEAM_Z, i * 20.0 + 10.0, OD / 2 - 1.0))

    shell = shell.difference(trimesh.util.concatenate(cuts), engine='manifold')

    # four M3 screw bosses on the diagonals (cells sit on the axes, so these are clear of them)
    bosses = []
    for a in (45, 135, 225, 315):
        x, y = BOSS_R * math.cos(math.radians(a)), BOSS_R * math.sin(math.radians(a))
        b = cylinder(radius=3.6, height=12.0, sections=40)
        b.apply_transform(translation_matrix((x, y, LID_T + 6.0)))      # starts on top of the lid
        bosses.append(b)
    boss_u = trimesh.util.concatenate(bosses)
    shell = shell.union(boss_u, engine='manifold')
    pilots = []
    for a in (45, 135, 225, 315):
        x, y = BOSS_R * math.cos(math.radians(a)), BOSS_R * math.sin(math.radians(a))
        p = cylinder(radius=1.3, height=10.0, sections=24)     # M3 self-tapping pilot
        p.apply_transform(translation_matrix((x, y, LID_T + 5.0 - 0.01)))
        pilots.append(p)
    shell = shell.difference(trimesh.util.concatenate(pilots), engine='manifold')
    return shell


def build_lid():
    lid = cylinder(radius=OD / 2 - WALL - 0.3, height=LID_T, sections=SEGMENTS)
    lid.apply_transform(translation_matrix((0, 0, LID_T / 2)))
    cuts = []
    for a in (45, 135, 225, 315):
        x, y = BOSS_R * math.cos(math.radians(a)), BOSS_R * math.sin(math.radians(a))
        h = cylinder(radius=1.7, height=LID_T + 2, sections=24)
        h.apply_transform(translation_matrix((x, y, LID_T / 2)))
        cuts.append(h)
    # air intake grille in the middle for the fan (4 x 14 mm slots in a 2x? pattern)
    for gx in (-12, -4, 4, 12):
        cuts.append(box(extents=(4.0, 26.0, LID_T + 2)).apply_translation((gx, 0, LID_T / 2)))
    return lid.difference(trimesh.util.concatenate(cuts), engine='manifold')


def report(name, m):
    print(f"{name}: watertight={m.is_watertight} volume={m.volume / 1000:.1f} cm³ "
          f"bbox={np.round(m.bounds[1] - m.bounds[0], 1).tolist()} mm  faces={len(m.faces)}")


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    shell, lid = build_shell(), build_lid()
    shell.export(f'{out}/base_shell.stl')
    lid.export(f'{out}/base_lid.stl')
    report('base_shell', shell)
    report('base_lid', lid)
