"""Turn the app's bottle render into real dimensions and check the parts fit.

Geometry was measured from nexa-one/web/nexa-guide-bottle.svg (the app's own
product render), in the render's units. K is millimetres per unit.

    python3 fit_check.py            # table for several scales + the chosen design
"""
import math

K = 0.5            # chosen scale: makes the base Ø90, wide enough for a printed cell cage

# ---- measured from the render (render units) --------------------------------
R = dict(
    spout_w=38, spout_top=58.6,
    cap_w=128, cap_top=97.5, cap_bot=199,
    body_top=190, body_bot=714,
    body_w_bottom=176,            # widest, straight section at the bottom
    body_w_shoulder=171,          # at y=234
    body_w_waist=157,             # narrowest, at y=446 (x 101.5 .. 258.5)
    base_w=180, base_h=113.5,     # base height on the centre line
    base_bottom=829,
    display_w=70, display_h=35, button_d=16.8,
)

# ---- real parts --------------------------------------------------------------
CELL_D, CELL_L = 18.6, 65.2        # 18650 incl. wrap
TEC = 40.0
STACK_H = 10 + 3.9 + 20 + 10       # Al block + TEC + heatsink + fan
WALL, PLATE = 3.0, 4.0             # printed wall / top plate
CAGE_WALL, CAGE_GAP, CELL_GAP = 1.2, 0.6, 0.4
VESSEL_OD, VESSEL_WALL = 73.0, 1.0   # standard 73 mm aluminium bottle
SLEEVE_MIN = 2.5                      # thinnest printable/durable TPU sleeve wall


def dims(k=K, body_h=1.0, vessel_od=VESSEL_OD):
    body_h_mm = (R['body_bot'] - R['body_top']) * k * body_h
    waist = R['body_w_waist'] * k
    inner_d = vessel_od - 2 * VESSEL_WALL
    vessel_h = body_h_mm - 15           # shoulder + base thickness
    vol_ml = math.pi / 4 * (inner_d / 10) ** 2 * (vessel_h / 10)
    top_to_basebottom = (R['base_bottom'] - R['spout_top']) * k      # as rendered
    return dict(
        base_od=R['base_w'] * k, body_w=R['body_w_bottom'] * k, waist_w=waist,
        cap_w=R['cap_w'] * k, spout_w=R['spout_w'] * k, body_h=body_h_mm,
        vessel_od=vessel_od, inner_d=inner_d, volume_ml=vol_ml,
        sleeve_wall_waist=(waist - vessel_od) / 2,
        render_base_h=R['base_h'] * k,
        rendered_total_h=top_to_basebottom - (1 - body_h) * (R['body_bot'] - R['body_top']) * k,
        display_w=R['display_w'] * k, display_h=R['display_h'] * k, button_d=R['button_d'] * k)


def base_requirements():
    """Smallest base for 4x18650 in printed pockets around a 40 mm square TEC stack."""
    ring_r = TEC / 2 + CELL_GAP + CELL_D / 2            # cell centres from the axis (stack corner is further)
    ring_r = max(ring_r, 30.3)
    pocket_outer_r = CELL_D / 2 + CELL_GAP / 2 + CAGE_WALL
    inner_r = ring_r + pocket_outer_r + CAGE_GAP
    return dict(od=2 * (inner_r + WALL), h=CELL_L + 3 + 2 + PLATE, ring_r=ring_r,
                pocket_outer_r=pocket_outer_r, stack_h=STACK_H)


if __name__ == '__main__':
    need = base_requirements()
    print(f"Base needed (4x18650 in printed pockets + 40 mm TEC stack): Ø{need['od']:.1f} x {need['h']:.0f} mm "
          f"(cell centres r={need['ring_r']:.1f}, pockets reach r={need['ring_r'] + need['pocket_outer_r']:.1f}; stack {need['stack_h']:.0f} mm tall)\n")
    print(f"{'k':>6} {'base Ø':>7} {'base H(render)':>15} {'body Ø':>7} {'waist':>6} {'sleeve wall@waist':>18} {'fits Ø':>7} {'fits H':>7}")
    for k in (0.44, 0.46, 0.478, 0.50, 0.52):
        d = dims(k)
        print(f"{k:6.3f} {d['base_od']:7.1f} {d['render_base_h']:15.1f} {d['body_w']:7.1f} {d['waist_w']:6.1f} "
              f"{d['sleeve_wall_waist']:15.2f} mm {'yes' if d['base_od'] >= need['od'] else 'NO':>7} "
              f"{'yes' if d['render_base_h'] >= need['h'] else 'NO':>7}")
    print()
    BH = math.ceil(need['h'])
    for name, f in (('A  Faithful  (body height as rendered)', 1.0), ('B  Practical (body 20 % shorter)', 0.8)):
        d = dims(K, f)
        total = d['rendered_total_h'] - d['render_base_h'] + BH
        print(f"{name}: base Ø{d['base_od']:.0f} x {BH} (render {d['render_base_h']:.0f}), body Ø{d['body_w']:.0f}, waist Ø{d['waist_w']:.1f} "
              f"(sleeve wall {d['sleeve_wall_waist']:.2f} mm on a Ø{VESSEL_OD:.0f} vessel), cap Ø{d['cap_w']:.0f}, "
              f"{d['volume_ml']:.0f} ml, total height {total:.0f} mm")
    d = dims(K)
    print(f"\nDisplay window {d['display_w']:.1f} x {d['display_h']:.1f} mm   button ring Ø{d['button_d']:.1f} mm")
