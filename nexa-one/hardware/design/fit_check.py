"""Turn the app's bottle render into real dimensions and check the parts fit.

Geometry below was measured from nexa-one/web/nexa-guide-bottle.svg (the app's
own product render), in the render's units. `k` is millimetres per unit.

    python3 fit_check.py            # table for several scales + the recommendation
"""
import math

# ---- measured from the render (render units) --------------------------------
R = dict(
    spout_w=38, spout_top=58.6,
    cap_w=128, cap_top=97.5, cap_bot=199,
    body_top=190, body_bot=714, body_w_max=176, body_w_waist=155,
    base_w=180, base_h=113.5,                 # on the centre line
    base_bottom=829,                          # centre-line bottom of the base
    display_w=70, display_h=35, display_dx=-19.5, display_dy=-39.5,   # from base centre / top
    button_d=16.8, button_dx=36,
)

# ---- real parts --------------------------------------------------------------
CELL_D, CELL_L = 18.6, 65.2        # 18650 incl. wrap
TEC = 40.0                          # TEC1-12706 footprint
STACK_H = 10 + 3.9 + 20 + 10        # Al block + TEC + heatsink + 40 mm fan
WALL, PLATE = 3.0, 3.0              # printed wall / floor / top plate
CLEAR = 1.0
SLEEVE, VESSEL_WALL = 3.0, 1.0      # silicone/TPU sleeve, aluminium vessel


def dims(k, body_h=1.0):
    """Real-world size (mm) of every visible part at scale k."""
    body_h_mm = (R['body_bot'] - R['body_top']) * k * body_h
    base_od = R['base_w'] * k
    bodyd = lambda w: w * k
    # average vessel diameter (mm): sleeve and vessel walls come off each side
    avg_w = (R['body_w_max'] + R['body_w_waist'] + 174) / 3
    inner_d = bodyd(avg_w) - 2 * (SLEEVE + VESSEL_WALL)
    vessel_h = body_h_mm - 15           # dome/base thickness
    vol_ml = math.pi / 4 * (inner_d / 10) ** 2 * (vessel_h / 10)
    total_h = (R['cap_bot'] - R['spout_top']) * k + body_h_mm - (R['cap_bot'] - R['body_top']) * k \
        + R['base_h'] * k
    return dict(base_od=base_od, body_w=bodyd(R['body_w_max']), waist_w=bodyd(R['body_w_waist']),
                cap_w=R['cap_w'] * k, spout_w=R['spout_w'] * k, body_h=body_h_mm,
                inner_d=inner_d, volume_ml=vol_ml, total_h=total_h,
                render_base_h=R['base_h'] * k,
                display_w=R['display_w'] * k, display_h=R['display_h'] * k, button_d=R['button_d'] * k)


def base_requirements():
    """Smallest base that holds 4x18650 upright around a 40 mm square TEC stack."""
    ring_r = TEC / 2 + CELL_D / 2 + CLEAR          # cell centres from the axis
    inner_d = 2 * (ring_r + CELL_D / 2)
    od = inner_d + 2 * WALL
    h = CELL_L + 2 + 2 * PLATE                    # holder + floor + top plate
    return dict(od=od, h=h, ring_r=ring_r, stack_h=STACK_H)


if __name__ == '__main__':
    need = base_requirements()
    print(f"Base needed for 4x18650 (2S2P) + 40 mm TEC stack: Ø{need['od']:.0f} x {need['h']:.0f} mm "
          f"(cells at r={need['ring_r']:.1f} mm; stack is {need['stack_h']:.0f} mm tall)\n")
    print(f"{'scale k':>8} {'base Ø':>7} {'base H(render)':>15} {'body Ø':>7} {'waist':>6} {'volume':>8} {'total H':>8}   fits Ø  fits H")
    for k in (0.40, 0.44, 0.46, 0.478, 0.50, 0.55):
        d = dims(k)
        print(f"{k:8.3f} {d['base_od']:7.1f} {d['render_base_h']:15.1f} {d['body_w']:7.1f} {d['waist_w']:6.1f} "
              f"{d['volume_ml']:7.0f}ml {d['total_h']:7.0f}   {'yes' if d['base_od'] >= need['od'] else 'NO '}    "
              f"{'yes' if d['render_base_h'] >= need['h'] else 'NO '}")
    print()
    K = 0.478
    for name, bh in (('Faithful (body height as rendered)', 1.0), ('Practical (body 20 % shorter)', 0.8)):
        d = dims(K, bh)
        print(f"{name}: base Ø{d['base_od']:.0f} x {need['h']:.0f} (render says {d['render_base_h']:.0f}), body Ø{d['body_w']:.0f} "
              f"(waist Ø{d['waist_w']:.0f}), cap Ø{d['cap_w']:.0f}, vessel {d['inner_d']:.0f} mm inner, "
              f"{d['volume_ml']:.0f} ml, total height {d['total_h'] - d['render_base_h'] + need['h']:.0f} mm")
    d = dims(K)
    print(f"\nDisplay window {d['display_w']:.1f} x {d['display_h']:.1f} mm   button ring Ø{d['button_d']:.1f} mm")
