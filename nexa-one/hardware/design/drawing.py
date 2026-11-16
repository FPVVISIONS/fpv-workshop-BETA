"""Dimensioned drawing of the NEXA ONE bottle, drawn on the app's own render.

    python3 drawing.py > bottle-dimensions.svg
All numbers come from fit_check.py (render units × k = mm).
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import math  # noqa: E402
from fit_check import K, R, base_requirements, dims  # noqa: E402

D = dims(K)
NEED = base_requirements()
BASE_H = math.ceil(NEED['h'])                        # built base height
EXTRA = (BASE_H - D['render_base_h']) / K        # render units to add below the base
SRC = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'nexa-guide-bottle.svg')
bottle = open(SRC, encoding='utf-8').read()
bottle = re.sub(r'<svg [^>]*>', '<svg x="0" y="20" width="360" height="850" viewBox="0 20 360 850" overflow="visible">', bottle, count=1)

INK, LINE, TXT, DIM = '#101114', '#8BDFFF', '#F5F7FA', '#9299A5'
out = []
mm = lambda units: units * K


def hdim(x1, x2, y, label, up=True):
    t = -6 if up else 14
    out.append(f'<g stroke="{LINE}" stroke-width="0.8" fill="none"><path d="M{x1} {y - 4}V{y + 4}M{x2} {y - 4}V{y + 4}M{x1} {y}H{x2}"/></g>')
    out.append(f'<text x="{(x1 + x2) / 2}" y="{y + t}" text-anchor="middle" fill="{TXT}" font-size="10.5">{label}</text>')


def vdim(x, y1, y2, label, side=1):
    out.append(f'<g stroke="{LINE}" stroke-width="0.8" fill="none"><path d="M{x - 4} {y1}H{x + 4}M{x - 4} {y2}H{x + 4}M{x} {y1}V{y2}"/></g>')
    out.append(f'<text x="{x + side * 9}" y="{(y1 + y2) / 2 + 3.5}" text-anchor="{"start" if side > 0 else "end"}" fill="{TXT}" font-size="10.5">{label}</text>')


def ext(x1, y1, x2, y2):
    out.append(f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{DIM}" stroke-width="0.5" stroke-dasharray="2 3"/>')


def leader(x1, y1, x2, y2, lines, anchor='start'):
    out.append(f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{LINE}" stroke-width="0.8"/><circle cx="{x1}" cy="{y1}" r="1.6" fill="{LINE}"/>')
    for i, ln in enumerate(lines):
        out.append(f'<text x="{x2 + (4 if anchor == "start" else -4)}" y="{y2 + 3.5 + i * 12.5}" text-anchor="{anchor}" fill="{TXT if i == 0 else DIM}" font-size="{10.5 if i == 0 else 9.5}">{ln}</text>')


bottom_render = R['base_bottom']
bottom_build = R['base_bottom'] + EXTRA
base_top = R['base_bottom'] - R['base_h']

# the buildable base is taller than the render: dashed extension
out.append(f'<g stroke="{LINE}" stroke-width="1" stroke-dasharray="4 3" fill="none">'
           f'<path d="M90 {bottom_render - 6}V{bottom_build - 6}M270 {bottom_render - 6}V{bottom_build - 6}"/>'
           f'<path d="M90 {bottom_build - 6}Q180 {bottom_build + 12} 270 {bottom_build - 6}"/></g>')
out.append(f'<text x="180" y="{bottom_build + 22}" text-anchor="middle" fill="{LINE}" font-size="9.5">taller base to hold the battery (+{BASE_H - D["render_base_h"]:.0f} mm)</text>')

# widths
hdim(116, 244, 86, f'Ø{D["cap_w"]:.0f} cap')
hdim(161, 199, 50, f'Ø{D["spout_w"]:.0f}')
hdim(92, 268, 262, f'Ø{D["body_w"]:.0f} body')
hdim(102.5, 257.5, 456, f'Ø{D["waist_w"]:.1f} waist', up=False)
hdim(90, 270, bottom_build + 40, f'Ø{D["base_od"]:.0f} base', up=False)

# heights: cap/body on the right, base further right, total on the far left (rotated label)
X = 296
ext(250, R['spout_top'], X + 4, R['spout_top']); ext(268, R['body_bot'], X + 4, R['body_bot'])
ext(250, R['cap_top'], X + 4, R['cap_top']); ext(244, R['cap_bot'], X + 4, R['cap_bot'])
vdim(X, R['spout_top'], R['cap_bot'], f'{mm(R["cap_bot"] - R["spout_top"]):.0f} cap + spout', 1)
vdim(X, R['body_top'], R['body_bot'], f'{mm(R["body_bot"] - R["body_top"]):.0f} body', 1)
X2 = 380
ext(270, base_top, X2 + 4, base_top); ext(268, bottom_build - 6, X2 + 4, bottom_build - 6)
vdim(X2, base_top, bottom_build - 6, f'{BASE_H} base', 1)
total = D['rendered_total_h'] - D['render_base_h'] + BASE_H        # same number as fit_check.py
X3 = -170
ext(161, R['spout_top'], X3 - 4, R['spout_top']); ext(110, bottom_build - 6, X3 - 4, bottom_build - 6)
ym = (R['spout_top'] + bottom_build - 6) / 2
out.append(f'<g stroke="{LINE}" stroke-width="0.8" fill="none"><path d="M{X3 - 4} {R["spout_top"]}H{X3 + 4}M{X3 - 4} {bottom_build - 6}H{X3 + 4}M{X3} {R["spout_top"]}V{ym - 92}M{X3} {ym + 92}V{bottom_build - 6}"/></g>')
out.append(f'<text transform="translate({X3 + 4} {ym}) rotate(-90)" text-anchor="middle" fill="{TXT}" font-size="10.5">{total:.0f} total (cap to base)</text>')

# callouts (text always sits clear of the dimension lines)
leader(160, 755, 40, 706, [f'Display {D["display_w"]:.1f} × {D["display_h"]:.1f} mm', '1.3″ blue OLED, 128×64'], 'end')
leader(216, 755, 270, 756, [f'Button Ø{D["button_d"]:.0f} mm'], 'start')
leader(180, 812, 40, 780, ['Intake slots, 36 around'], 'end')
leader(120, base_top + 2, 40, 648, ['Exhaust seam, 1.6 mm', 'hot air leaves here'], 'end')
leader(105, 330, 18, 330, ['Matte black silicone / TPU sleeve', 'ribs + waist as rendered'], 'end')

H_TOTAL = bottom_build + 96
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-190 14 700 {H_TOTAL - 14}" font-family="Heebo, Segoe UI, Arial, sans-serif">'
       f'<rect x="-190" y="14" width="700" height="{H_TOTAL}" fill="{INK}"/>'
       f'{bottle}<g>{"".join(out)}</g>'
       f'<text x="-176" y="{H_TOTAL - 10}" fill="{DIM}" font-size="9">NEXA ONE · mm, scale {K} mm per unit of the app render · '
       f'{D["volume_ml"]:.0f} ml vessel · the base height is the only intentional change</text></svg>')
print(svg)
