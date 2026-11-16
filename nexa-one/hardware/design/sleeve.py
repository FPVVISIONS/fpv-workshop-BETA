"""Printable TPU body sleeve with the app's waist and grip ribs.

    python3 sleeve.py [outdir]     # → sleeve_B_210.stl (practical) and sleeve_A_262.stl (faithful)

Outline = the left edge of the body path in nexa-guide-bottle.svg, radius ×0.5.
Bore is straight (a standard Ø73 aluminium bottle); the wall is thick at the ends
and 2.95 mm at the waist. Version B squeezes the body height to 80 % (radii are
unchanged). Print standing up, in TPU 95A. Orientation: +Z up; the bottom
(z = 0) sits on the base.
"""
import math
import os
import re
import sys

import numpy as np
import trimesh

K = 0.5                               # mm per render unit (same as fit_check.py)
VESSEL_OD = 73.0
BORE_D = VESSEL_OD - 0.4              # slight interference; TPU stretches
SHOULDER_WALL = 3.0
RIB_DEPTH = 0.5
RIB_Z0, RIB_Z1 = 372, 566             # render y range of the ribs (30 ribs, 6.4 units apart)
SECTIONS = 120

SRC = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'nexa-guide-bottle.svg')


def body_outline():
    """Left edge of the render's body as (y, half_width) samples, from the SVG path."""
    svg = open(SRC, encoding='utf-8').read()
    d = re.search(r'<path d="([^"]+)"[^>]*fill="url\(#gb-body\)"', svg).group(1)
    nums = lambda t: [float(v) for v in re.findall(r'-?\d+\.?\d*', t)]
    segs = re.findall(r'[MLCZ][^MLCZ]*', d)
    pts, cur = [], None
    for sg in segs:
        cmd, v = sg[0], nums(sg[1:])
        if cmd == 'M':
            cur = (v[0], v[1]); pts.append(cur)
        elif cmd == 'C':
            p0 = cur
            for i in range(0, len(v), 6):
                p1, p2, p3 = (v[i], v[i + 1]), (v[i + 2], v[i + 3]), (v[i + 4], v[i + 5])
                for t in np.linspace(0, 1, 41)[1:]:
                    x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
                    y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
                    pts.append((x, y))
                p0 = p3
            cur = p0
        elif cmd == 'L':
            cur = (v[0], v[1]); pts.append(cur)
        else:
            break
        if cmd == 'L' and cur[0] > 180:     # reached the right-hand side
            break
    left = [(y, 180 - x) for x, y in pts if x <= 180]
    left.sort()
    ys = np.array([p[0] for p in left]); hw = np.array([p[1] for p in left])
    return ys, hw


def build(height_scale=1.0):
    ys, hw = body_outline()
    y_top, y_bot = ys.min(), 714.0
    z_of = lambda y: (y_bot - y) * K * height_scale
    z_top = z_of(y_top)
    pitch = 6.4 * K * height_scale
    rib0, rib1 = z_of(RIB_Z1), z_of(RIB_Z0)               # rib zone in mm from the bottom

    zs = list(np.concatenate([np.linspace(0, rib0 - 3 * pitch, 6, endpoint=False),
                              np.arange(rib0 - 3 * pitch, rib1 + 3 * pitch, pitch / 8.0),
                              np.linspace(rib1 + 3 * pitch, z_of(250) - 1, 10, endpoint=False),
                              np.linspace(z_of(250) - 1, z_top, 56)]))     # dense through the shoulder dome
    zs = sorted(set(round(z, 3) for z in zs if 0 <= z <= z_top)) + [z_top]
    z_arr = np.array(sorted(set(zs)))
    base_r = np.interp(z_arr, [z_of(y) for y in ys[::-1]], (hw * K)[::-1])

    def ribs(z):
        if z < rib0 or z > rib1:
            return 0.0
        w = min(1.0, (z - rib0) / (1.5 * pitch), (rib1 - z) / (1.5 * pitch))   # fade in/out
        w = math.sin(min(1.0, w) * math.pi / 2) ** 2
        return RIB_DEPTH * w * (0.5 * (1 + math.cos(2 * math.pi * (z - rib0) / pitch))) ** 1.6

    outer = [(float(r + ribs(z)), float(z)) for r, z in zip(base_r, z_arr)]
    bore_r = BORE_D / 2
    top_open = outer[-1][0] - SHOULDER_WALL            # top opening radius
    shoulder_start = z_of(234)                          # where the shoulder dome begins (render y=234)
    inner = [(top_open, z_top)]
    for r, z in reversed(outer):
        if z <= z_top - 0.01 and z >= shoulder_start:
            inner.append((max(bore_r, r - SHOULDER_WALL), z))
    inner.append((bore_r, shoulder_start - 0.01)); inner.append((bore_r, 0.0))
    ring = [(bore_r, 0.0)] + outer + inner[:1] + inner[1:]
    ring.append(ring[0])
    m = trimesh.creation.revolve(np.array(ring), sections=SECTIONS)
    straight = [r for r, z in outer if z < shoulder_start - 2]          # below the shoulder dome
    return m, dict(height=z_top, waist_r=min(straight), waist_wall=min(straight) - bore_r, outer=outer, ring=ring)


def report(name, m, info):
    mass = m.volume / 1000 * 1.21
    print(f"{name}: watertight={m.is_watertight} volume={m.volume / 1000:.0f} cm³ (≈{mass:.0f} g TPU) "
          f"bbox={np.round(m.bounds[1] - m.bounds[0], 1).tolist()} mm  thinnest wall≈{info['waist_wall']:.2f} mm  faces={len(m.faces)}")


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    for tag, scale in (('B', 0.8), ('A', 1.0)):
        m, info = build(scale)
        name = f"sleeve_{tag}_{round(info['height'])}"
        m.export(f'{out}/{name}.stl')
        report(name, m, info)
