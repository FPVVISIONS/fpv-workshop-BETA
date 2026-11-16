"""How long does a Peltier bottle really need to cool its water?

    python3 cooldown_sim.py

A lumped model: water (+ vessel + cold block) → cold plate → Peltier → heatsink → air.
Peltier = the standard Seebeck/Joule/conduction model, fitted to TEC1-12706 datasheet
figures (Imax 6.4 A, Vmax 15.4 V, dTmax 66 K at 27 °C hot side → Qmax ≈ 60 W). The
controller runs the current that pumps the most heat, limited by the electrical
supply and a heatsink-temperature limit.

What it can't know: your heatsink, your water-side stirring, your assembly. The two
resistances that matter most (hot side, cold side) are inputs, with typical values.
"""
import math

# ---- TEC1-12706 (one module), fitted to the datasheet ------------------------
TH_REF, DT_MAX, V_MAX, I_MAX = 300.0, 66.0, 15.4, 6.4
ALPHA = V_MAX / TH_REF                                           # V/K  (module Seebeck)
R_TEC = (TH_REF - DT_MAX) / TH_REF * V_MAX / I_MAX              # ohm
K_TEC = (TH_REF - DT_MAX) / (2 * TH_REF * DT_MAX) * V_MAX * I_MAX   # W/K

CP_WATER = 4.186          # kJ/kg/K
EXTRA_HEAT_CAP = 0.15     # kJ/K  aluminium vessel + cold block (≈ 36 g of water)
LEAK = 0.4                # W/K   heat gain through the sleeve and cap
T_AMB = 24.0
T_START, T_TARGET = 24.0, 8.0
TH_LIMIT = 60.0           # °C    heatsink limit


def tec(I, Tc_C, Th_C):
    """One module: returns (Qc, P_electrical, Qh) in watts."""
    Tc, Th = Tc_C + 273.15, Th_C + 273.15
    qc = ALPHA * I * Tc - 0.5 * I * I * R_TEC - K_TEC * (Th - Tc)
    p = ALPHA * I * (Th - Tc) + I * I * R_TEC
    return qc, p, qc + p


def solve(I, n, Tw, r_hot, r_cold):
    """Exact cold-side and hot-side temperatures for current I (n modules, linear 2x2 system)."""
    a, bk = n * ALPHA * I, n * K_TEC
    c = n * I * I * R_TEC
    d = c / 2
    # (1 + Rc(a+b)) Tc - Rc b Th = Tw - Rc (273.15 a - d)
    # -Rh b Tc + (1 - Rh(a-b)) Th = Tamb + Rh (273.15 a + d)
    m11, m12, r1 = 1 + r_cold * (a + bk), -r_cold * bk, Tw - r_cold * (273.15 * a - d)
    m21, m22, r2 = -r_hot * bk, 1 - r_hot * (a - bk), T_AMB + r_hot * (273.15 * a + d)
    det = m11 * m22 - m12 * m21
    Tc = (r1 * m22 - m12 * r2) / det
    Th = (m11 * r2 - m21 * r1) / det
    qc = a * (Tc + 273.15) - d - bk * (Th - Tc)
    p = a * (Th - Tc) + c
    return qc, p, qc + p, Tc, Th


def best_current(n, Tw, r_hot, r_cold, p_max):
    """Current per module that pumps the most heat without breaking a limit."""
    best = (0.0, 0.0, 0.0, 0.0, T_AMB)
    for step in range(0, 33):
        I = step * 0.2
        qc, p, qh, Tc, Th = solve(I, n, Tw, r_hot, r_cold)
        if Th > TH_LIMIT or p > p_max or I > I_MAX:
            continue
        if qc > best[0]:
            best = (qc, p, qh, I, Th)
    return best


def cool(volume_ml, n=1, r_hot=1.0, r_cold=0.5, p_max=60.0, minutes=240, target=None):
    """Time (min) to cool from T_START to T_TARGET, plus peak power and energy."""
    target = T_TARGET if target is None else target
    m = volume_ml / 1000.0
    cap = (m * CP_WATER + EXTRA_HEAT_CAP) * 1000.0               # J/K
    Tw, t, energy, peak_p, peak_qh = T_START, 0, 0.0, 0.0, 0.0
    DT = 2.0
    while Tw > target and t < minutes * 60:
        qc, p, qh, I, Th = best_current(n, Tw, r_hot, r_cold, p_max)
        Tw += (-qc + LEAK * (T_AMB - Tw)) * DT / cap
        energy += p * DT / 3600.0
        peak_p, peak_qh = max(peak_p, p), max(peak_qh, qh)
        t += DT
        if qc <= 0.1 and t > 120:
            break
    ok = Tw <= target
    return (t / 60.0 if ok else None), peak_p, peak_qh, energy, Tw


def lowest_temp(n, r_hot, r_cold, p_max=60.0):
    """Coldest water temperature this hardware can hold in 24 °C air (steady state)."""
    Tw = T_AMB
    for _ in range(4000):
        qc, p, qh, I, Th = best_current(n, Tw, r_hot, r_cold, p_max)
        net = qc - LEAK * (T_AMB - Tw)
        if net <= 0.05:
            return Tw
        Tw -= 0.02
    return Tw


def need(volume_ml, minutes):
    kj = (volume_ml / 1000 * CP_WATER + EXTRA_HEAT_CAP) * (T_START - T_TARGET)
    return kj, kj * 1000 / (minutes * 60)


if __name__ == '__main__':
    print('Heat that must leave the water (24 → 8 °C), and the average cooling power for 15 min:')
    for v in (250, 330, 500, 770, 980):
        kj, w = need(v, 15)
        print(f'  {v:4d} ml  {kj:5.1f} kJ   {w:5.1f} W average over 15 min')
    print('\n(one TEC1-12706 pumps at most ≈ 60 W with a 0 K difference; about 35 W at 15 K; about 20 W at 25 K)\n')

    COLD_STIR, COLD_PLATE = 0.2, 0.6

    def required_rhot(volume, minutes, n, pcap, rcold, target=None):
        """Largest hot-side resistance (smallest heatsink) that still makes `minutes`."""
        lo, hi = 0.03, 1.5
        t_hi = cool(volume, n, lo, rcold, pcap, target=target)[0]
        if t_hi is None or t_hi > minutes:
            return None
        for _ in range(14):
            mid = (lo + hi) / 2
            t = cool(volume, n, mid, rcold, pcap, target=target)[0]
            lo, hi = (mid, hi) if (t is not None and t <= minutes) else (lo, mid)
        return lo

    print("0) Coldest water each hardware class can hold in 24 °C air (it can never cool below this, however long you wait):")
    for name, rh, n, pcap in (('40 mm sink + fan (fits the base)', 1.0, 1, 60.0), ('60 mm tower + fan', 0.5, 1, 60.0),
                              ('120 mm tower + fan', 0.25, 1, 60.0), ('120 mm tower, 2 TECs, 140 W', 0.25, 2, 140.0)):
        print(f"   {name:34} stirred {lowest_temp(n, rh, 0.2, pcap):5.1f} °C    bottom plate only {lowest_temp(n, rh, 0.6, pcap):5.1f} °C")
    print()
    print("A) What heatsink does 15 minutes to 8 °C need?  (hot-side resistance, K per watt; smaller = bigger heatsink)")
    print("   reference: 40 mm sink + fan ≈ 1.0   60 mm tower + fan ≈ 0.5   120 mm tower + fan ≈ 0.25   dual heat-pipe tower ≈ 0.15")
    for vol in (250, 330, 500, 770):
        row = []
        for n, pcap, label in ((1, 60.0, '1 TEC, 60 W'), (2, 140.0, '2 TECs, 140 W')):
            r = required_rhot(vol, 15, n, pcap, COLD_STIR)
            row.append(f"{label}: " + (f"{r:.2f} K/W" if r else 'not reachable'))
        print(f"   {vol:4d} ml   " + "   |   ".join(row))

    print("\nB) Minutes to reach the target, water stirred (1 TEC, 60 W unless stated):")
    HW = (('40 mm sink + fan (fits the base)', 1.0, 1, 60.0), ('60 mm tower + fan', 0.5, 1, 60.0),
          ('120 mm tower + fan', 0.25, 1, 60.0), ('120 mm tower, 2 TECs, 140 W', 0.25, 2, 140.0))
    print(f"   {'':34}" + ''.join(f"{v:>5d}ml→{tg:<2d}°C " for v in (250, 500) for tg in (8, 12, 15)))
    for name, rh, n, pcap in HW:
        cells = []
        for v in (250, 500):
            for tg in (8, 12, 15):
                t = cool(v, n, rh, COLD_STIR, pcap, target=tg)[0]
                cells.append(f"{t:8.0f} min  " if t else "      never  ")
        print(f"   {name:34}" + ''.join(cells))
    print("\nC) Same, but the water is NOT stirred (bottom plate only; the cold stays at the bottom):")
    for name, rh, n, pcap in HW[:3]:
        cells = []
        for v in (250, 500):
            for tg in (8, 12, 15):
                t = cool(v, n, rh, COLD_PLATE, pcap, target=tg)[0]
                cells.append(f"{t:8.0f} min  " if t else "      never  ")
        print(f"   {name:34}" + ''.join(cells))
