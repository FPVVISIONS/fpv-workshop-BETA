"""Chart: minutes to cool 24 → 8 °C vs heatsink size (writes cooldown-chart.png).  Uses cooldown_sim.py."""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from cooldown_sim import cool

SURFACE, INK, INK2, GRID = '#1a1a19', '#f0efec', '#c3c2b7', '#2e2e2b'
SERIES = [(250, '#3987e5'), (500, '#d95926'), (770, '#199e70')]       # validated dark categorical slots 1-3
r_axis = np.linspace(1.1, 0.10, 34)                                   # big heatsink on the right
fig, ax = plt.subplots(figsize=(10.5, 6.0), dpi=150, facecolor=SURFACE)
ax.set_facecolor(SURFACE)
for vol, col in SERIES:
    t = [cool(vol, 1, r, 0.2, 60.0)[0] for r in r_axis]
    x = [r for r, v in zip(r_axis, t) if v is not None and v <= 120]
    y = [v for v in t if v is not None and v <= 120]
    ax.plot(x, y, color=col, lw=2, label=f'{vol} ml', solid_capstyle='round', zorder=3)
    if y:
        ax.annotate(f'{vol} ml', (x[-1], y[-1]), xytext=(8, 0), textcoords='offset points', color=INK, fontsize=10, va='center')
ax.axhline(15, color=INK, lw=1, ls=(0, (4, 3)), zorder=2)
ax.text(1.09, 16.6, 'your goal: 15 min', color=INK, fontsize=10, ha='left', va='bottom')
for r, name in ((1.0, '40 mm sink\n(fits the base)'), (0.5, '60 mm tower'), (0.25, '120 mm tower')):
    ax.axvline(r, color=GRID, lw=1, zorder=1)
    ax.text(r, 123, name, color=INK2, fontsize=9, ha='center', va='bottom')
ax.set_xlim(1.1, 0.10); ax.set_ylim(0, 120)
ax.set_xlabel('heatsink thermal resistance, K per watt  (bigger heatsink →)', color=INK2, fontsize=10, labelpad=8)
ax.set_ylabel('minutes to reach 8 °C', color=INK2, fontsize=10)
ax.set_title('Heat rejection sets the speed: one Peltier, water stirred, 24 → 8 °C', color=INK, fontsize=12, loc='left', pad=34)
ax.tick_params(colors=INK2, labelsize=9, length=0)
ax.grid(axis='y', color=GRID, lw=1); ax.set_axisbelow(True)
for sp in ax.spines.values(): sp.set_visible(False)
leg = ax.legend(loc='upper right', frameon=False, labelcolor=INK, fontsize=10, bbox_to_anchor=(1.0, 0.93))
fig.text(0.01, 0.01, 'A curve ends where that hardware cannot reach 8 °C within two hours. Model: design/cooldown_sim.py (TEC1-12706, 60 W supply, 60 °C heatsink limit).',
         color=INK2, fontsize=8)
fig.tight_layout(rect=(0, 0.03, 1, 1))
fig.savefig('cooldown-chart.png', facecolor=SURFACE)
print('ok')
