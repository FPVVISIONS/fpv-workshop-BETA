"""Parametric 3D-printable base for the NEXA ONE bottle  (v1).

    pip install trimesh manifold3d numpy
    python3 base_shell.py [outdir]      # → base_shell.stl, base_lid.stl

The satin base from the app's render, as a hollow printed shell:
  • display window + a flat pad with a pocket for a 1.3" 128×64 OLED module (stuck in with foam tape)
  • the round button with a flat boss for its nut
  • USB-C opening at the back, intake slots all round (except at the USB-C), exhaust seam at the top
  • a 4-post cradle under the top plate that holds the heatsink + fan stack
  • four lid screw bosses
Sizes live in layout.py. Orientation: +Z up, display toward -Y.  Units: mm.
"""
import math
import sys

import numpy as np
import trimesh
from trimesh.creation import box, cylinder
from trimesh.transformations import rotation_matrix, translation_matrix

import layout as L

OD, H, WALL, PLATE, LID_T = L.OD, L.H, L.WALL, L.PLATE, L.LID_T
EDGE_R = 4.0
DISPLAY = (35.0, 17.5)                 # visible window, as rendered
BUTTON_D, BUTTON_BOSS_D = 8.2, 14.0
USBC = (9.8, 3.8)                      # receptacle shell is 8.94 x 3.26
USB_Z = 10.5
SEAM_H, SEAM_Z = 1.6, H - 9.0
SLOTS_BOTTOM = 36
BOSS_R = 39.0
CRADLE = dict(inner=40.8, wall=1.6, arm=8.0, z0=L.FAN_Z - L.PAD_COMPRESSED - L.FOOT_T, z1=H - PLATE)
SEGMENTS = 96


def rz(deg):
    return rotation_matrix(math.radians(deg), (0, 0, 1))


def tz(x=0, y=0, z=0):
    return translation_matrix((x, y, z))


def outer_solid():
    r = OD / 2
    pts = [(0, 0)]
    for a in np.linspace(-90, 0, 9):
        pts.append((r - EDGE_R + EDGE_R * math.cos(math.radians(a)), EDGE_R + EDGE_R * math.sin(math.radians(a))))
    pts += [(r, H - 1.5), (r - 1.5, H), (0, H)]
    return trimesh.creation.revolve(np.array(pts, dtype=float), sections=SEGMENTS)


def clip_cylinder(r=OD / 2 - 0.4):
    c = cylinder(radius=r, height=H, sections=SEGMENTS)
    c.apply_transform(tz(z=H / 2))
    return c


def radial_box(size, z, angle_from_front, radius):
    """Box whose long axis points outward at an angle from the front (0° = -Y)."""
    b = box(extents=size)
    b.apply_transform(tz(0, -radius, z))
    b.apply_transform(rz(angle_from_front))
    return b


def rounded_rect_cutter(w, h, depth, r):
    parts = [box(extents=(w - 2 * r, depth, h)), box(extents=(w, depth, h - 2 * r))]
    for sx in (-1, 1):
        for sz in (-1, 1):
            c = cylinder(radius=r, height=depth, sections=32)
            c.apply_transform(rotation_matrix(math.radians(90), (1, 0, 0)))
            c.apply_transform(tz(sx * (w / 2 - r), 0, sz * (h / 2 - r)))
            parts.append(c)
    m = parts[0]
    for q in parts[1:]:
        m = m.union(q, engine='manifold')
    m.apply_transform(tz(0, depth / 2, 0))                 # starts at y=0, extends +Y
    return m


def front_frame(m, z, angle_from_front, radial_origin):
    """Place a part built along +Y (y=0 at its start) so it starts at `radial_origin` on the front axis, then rotate."""
    m = m.copy()
    m.apply_transform(tz(0, -radial_origin, z))
    m.apply_transform(rz(angle_from_front))
    return m


# ---- display frame, button boss, stack cradle ------------------------------------
def display_pieces():
    """(solid to add, cutters). Frame = flat pad; pocket opens to the back; M2 retainer bosses."""
    zc = L.DISPLAY_Z
    plane, t = L.FRAME_PLANE, L.FRAME_T
    frame = box(extents=(L.FRAME_W, t, L.FRAME_H))
    frame.apply_transform(tz(0, -(plane - t / 2), zc))
    solid = frame
    solid.apply_transform(rz(L.DISPLAY_ANGLE))
    solid = solid.intersection(clip_cylinder(), engine='manifold')

    cuts = []
    back = plane - t                                           # 37.4
    over = 0.5                                                 # cutter starts a little behind the frame back (keeps clear of the cradle arms)
    pocket = box(extents=(L.OLED_PCB[0], L.OLED_DEPTH + over, L.OLED_PCB[1]))
    pocket.apply_transform(tz(0, -(back - over + (L.OLED_DEPTH + over) / 2), zc))
    pocket.apply_transform(rz(L.DISPLAY_ANGLE))
    cuts.append(pocket)
    win = rounded_rect_cutter(DISPLAY[0], DISPLAY[1], 12.0, 1.6)   # through the lip and the wall
    cuts.append(front_frame(win, zc, L.DISPLAY_ANGLE, OD / 2 - 1.0))
    return solid, cuts


def button_pieces():
    boss = cylinder(radius=BUTTON_BOSS_D / 2, height=9.0, sections=48)        # flat-ended boss for the nut
    boss.apply_transform(rotation_matrix(math.radians(90), (1, 0, 0)))
    boss.apply_transform(tz(0, 9.0 / 2, 0))
    boss = front_frame(boss, L.DISPLAY_Z, L.BUTTON_ANGLE, 44.5)               # r 35.5 … 44.5
    boss = boss.intersection(clip_cylinder(), engine='manifold')
    hole = cylinder(radius=BUTTON_D / 2, height=14.0, sections=48)
    hole.apply_transform(rotation_matrix(math.radians(90), (1, 0, 0)))
    hole.apply_transform(tz(0, 7.0, 0))
    hole = front_frame(hole, L.DISPLAY_Z, L.BUTTON_ANGLE, OD / 2 + 1.0)       # from outside to r≈32
    return boss, hole


def stack_cradle():
    """Four L-shaped corner cradles under the top plate that hold the 40x40 heatsink+fan stack."""
    c = CRADLE
    ih = c['inner'] / 2
    height = c['z1'] - c['z0']
    parts = []
    for k in range(4):
        a = box(extents=(c['wall'], c['arm'], height))
        a.apply_transform(tz(ih + c['wall'] / 2, ih + c['arm'] / 2, c['z0'] + height / 2))
        b = box(extents=(c['arm'], c['wall'], height))
        b.apply_transform(tz(ih + c['arm'] / 2, ih + c['wall'] / 2, c['z0'] + height / 2))
        corner = box(extents=(c['wall'], c['wall'], height))
        corner.apply_transform(tz(ih + c['wall'] / 2, ih + c['wall'] / 2, c['z0'] + height / 2))
        foot = box(extents=(L.FOOT, L.FOOT, L.FOOT_T))               # shelf the silicone pad sits on
        foot.apply_transform(tz(ih - L.FOOT / 2 + c['wall'] + 0.4, ih - L.FOOT / 2 + c['wall'] + 0.4, c['z0'] + L.FOOT_T / 2))
        for p in (a, b, corner, foot):
            p.apply_transform(rz(k * 90))
            parts.append(p)
    cradle = parts[0]
    for p in parts[1:]:
        cradle = cradle.union(p, engine='manifold')
    cradle.apply_transform(rz(L.ROT))
    cuts = []                                                  # zip-tie windows through each arm
    for k in range(4):
        for z in (c['z0'] + 6.0, c['z0'] + 24.0):
            for along in (1, 2):
                s = box(extents=(c['wall'] + 1.0, 3.2, 1.4)) if along == 1 else box(extents=(3.2, c['wall'] + 1.0, 1.4))
                pos = (ih + c['wall'] / 2, ih + 4.5, z) if along == 1 else (ih + 4.5, ih + c['wall'] / 2, z)
                s.apply_transform(tz(*pos))
                s.apply_transform(rz(k * 90 + L.ROT))
                cuts.append(s)
    return cradle, cuts


def build_shell():
    shell = outer_solid()
    cav = cylinder(radius=L.BORE_R, height=H - PLATE, sections=SEGMENTS)
    cav.apply_transform(tz(z=(H - PLATE) / 2 - 0.01))
    shell = shell.difference(cav, engine='manifold')

    d_solid, d_cuts = display_pieces()
    b_boss, b_hole = button_pieces()
    cradle, cradle_cuts = stack_cradle()
    for a in (d_solid, b_boss, cradle):
        shell = shell.union(a, engine='manifold')
    for k in range(4):                                         # lid screw bosses, between the cells
        x, y = L.pol(BOSS_R, L.ROT + 45 + 90 * k)
        b = cylinder(radius=3.6, height=12.0, sections=40)
        b.apply_transform(tz(x, y, LID_T + 6.0))
        shell = shell.union(b, engine='manifold')

    cuts = list(d_cuts) + cradle_cuts + [b_hole]
    hole = cylinder(radius=L.OPENING_D / 2, height=PLATE + 2, sections=SEGMENTS)
    hole.apply_transform(tz(z=H - PLATE / 2))
    cuts.append(hole)
    usb = rounded_rect_cutter(USBC[0], USBC[1], WALL + 4, 1.2)
    cuts.append(front_frame(usb, USB_Z, 180, OD / 2 - 1.0))
    for i in range(SLOTS_BOTTOM):                              # intake slots, none beside the USB-C
        ang = i * 360.0 / SLOTS_BOTTOM
        if abs(ang - 180.0) < 22:
            continue
        cuts.append(radial_box((2.4, WALL + 4, 3.0), 9.0, ang, OD / 2 - 1.0))
    for i in range(18):                                        # exhaust seam
        cuts.append(radial_box((13.0, WALL + 4, SEAM_H), SEAM_Z, i * 20.0 + 10.0, OD / 2 - 1.0))
    shell = shell.difference(trimesh.util.concatenate(cuts), engine='manifold')

    pilots = []
    for k in range(4):
        x, y = L.pol(BOSS_R, L.ROT + 45 + 90 * k)
        p = cylinder(radius=1.3, height=10.0, sections=24)
        p.apply_transform(tz(x, y, LID_T + 5.0 - 0.01))
        pilots.append(p)
    return shell.difference(trimesh.util.concatenate(pilots), engine='manifold')


def build_lid():
    lid = cylinder(radius=L.BORE_R - 0.3, height=LID_T, sections=SEGMENTS)
    lid.apply_transform(tz(z=LID_T / 2))
    cuts = []
    for k in range(4):
        x, y = L.pol(BOSS_R, L.ROT + 45 + 90 * k)
        h = cylinder(radius=1.7, height=LID_T + 2, sections=24)
        h.apply_transform(tz(x, y, LID_T / 2))
        cuts.append(h)
    for gx in (-12, -4, 4, 12):                                # fan intake grille
        cuts.append(box(extents=(4.0, 26.0, LID_T + 2)).apply_translation((gx, 0, LID_T / 2)))
    for k in range(8):                                         # zip-tie slots, pairs 6 mm apart
        ang = 22.5 + 45 * k
        for r in (20.0, 26.0):
            s = box(extents=(1.6, 3.4, LID_T + 2))
            s.apply_transform(tz(r, 0, LID_T / 2))
            s.apply_transform(rz(ang))
            cuts.append(s)
    return lid.difference(trimesh.util.concatenate(cuts), engine='manifold')


def stl_safe(m):
    """True if the mesh is still a closed solid after being saved as a 32-bit STL
    (two vertices that collapse into one would leave a pinched edge)."""
    from collections import Counter
    pts = np.asarray(m.vertices, dtype=np.float32)
    _, inv = np.unique(pts.view(np.uint32).reshape(-1, 3), axis=0, return_inverse=True)
    f = inv.ravel()[np.asarray(m.faces)]
    e = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    return all(v == 2 for v in Counter(map(tuple, e)).values())


def report(name, m):
    print(f"{name}: watertight={m.is_watertight} volume={m.volume / 1000:.1f} cm³ "
          f"bbox={np.round(m.bounds[1] - m.bounds[0], 1).tolist()} mm  faces={len(m.faces)}  STL-safe={stl_safe(m)}")


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    for name, m in (('base_shell', build_shell()), ('base_lid', build_lid())):
        m.export(f'{out}/{name}.stl')
        report(name, m)
