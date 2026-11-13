#!/usr/bin/env python3
"""50 ohm grounded coplanar waveguide (GCPW / CPWG) for the 13 cm T/R switch board.

Two independent methods:

1. 2D finite-difference field solution (numpy only), the primary result. Uniform grid,
   bottom ground plane, layered dielectric, strip and top grounds with real copper
   thickness, grounded box far away. div(eps grad V) = 0 is solved by conjugate gradients;
   C comes from the field energy, once with the dielectric and once in air:
       Z0 = 1 / (c sqrt(C C0)),   eeff = C / C0
   Validated in check() against the Hammerstad microstrip formula (S -> infinity).

2. Quasi-static conformal mapping for conductor-backed CPW (Wadell, "Transmission Line
   Design Handbook", 1991, sec. 3.4.3; Ghione & Naldi 1987), zero thickness:
       k = W/(W+2S), k3 = tanh(pi W/4h) / tanh(pi (W+2S)/4h)
       eeff = 1 + q (er - 1),  q = r3/(r1 + r3),  r = K(k)/K(k')
       Z0 = 60 pi / sqrt(eeff) / (r1 + r3)
   Only for comparison: when S is comparable to h (our case) it reads high, it gives
   60 ohm instead of 52 ohm in the microstrip limit.

No solder mask in either model. Mask lowers Z0 by roughly an ohm or two; the JLCPCB
impedance calculator includes it, use it for the final check.

Run:  .venv/bin/python tr-switch/calc_gcpw.py          (about 8 minutes, mostly the 2-layer case and the launch)
"""
import math

import numpy as np

C0 = 299_792_458.0
EPS0 = 8.8541878128e-12
F_BAND = (2.320e9, 2.345e9)   # NB 2320 MHz, DATV 2340-2345 MHz
CU_OUT = 0.035                # outer copper 1 oz (JLC 4-layer and 2-layer default)
CU_IN = 0.0152                # inner copper 0.5 oz (JLC 4-layer)

# JLCPCB 1.6 mm stackups, dielectric from the reference plane up to the top copper
# (jlcpcb.com/impedance: L1-L2 prepreg of the 4-layer stacks; 2-layer er 4.5 from
# jlcpcb.com/capabilities/pcb-capabilities). Thickness in mm.
STACKUPS = [
    ("JLC04161H-7628", [(0.2104, 4.40)]),
    ("JLC04161H-2116", [(0.1164, 4.16)]),
    ("JLC04161H-3313", [(0.0994, 4.10)]),
    ("2 vrstvy 1,6 mm", [(1.6 - 2 * CU_OUT, 4.50)]),
]
GAPS = (0.15, 0.20, 0.25)     # mm; JLC min. spacing 0.09 (4L, 1 oz) / 0.10 (2L)


# --- 2D finite-difference solver -------------------------------------------------------

def fd_line(w, s, layers, t=CU_OUT, dx=None, top_gnd=True, margin=10, tol=1e-7):
    """Z0 (ohm), eeff of a strip of width w, thickness t on top of `layers`
    [(thickness, er), ...] listed from the bottom ground plane up. Top grounds start at
    |x| = w/2 + s when top_gnd. All dimensions in mm.

    The grid is symmetric with a node at x = 0, so edges land on nodes only when w/2 and s
    are multiples of dx (see width_for and gap_for). Cells are dx wide and dy high, dy close
    to dx but chosen so the dielectric layers come out exact."""
    h = sum(th for th, _ in layers)
    if dx is None:
        dx = min(w, 4 * s if top_gnd else w, min(th for th, _ in layers)) / 12
    rows = [max(2, round(th / dx)) for th, _ in layers]
    dy = h / sum(rows)                      # keep the total height exact
    nh = sum(rows)
    nt = max(1, round(t / dy)) if t > 0 else 0
    half_width = w / 2 + (s if top_gnd else 0.0) + margin * h + 0.5
    air = margin * h + 0.5
    nx = 2 * int(round(half_width / dx)) + 1
    ny = nh + nt + int(round(air / dy)) + 1
    if nx * ny > 1.5e6:
        raise ValueError(f"grid {nx}x{ny} too large, use a coarser dx or a smaller margin")
    x = (np.arange(nx) - (nx - 1) // 2) * dx

    fixed = np.zeros((ny, nx), bool)
    v0 = np.zeros((ny, nx))
    fixed[0, :] = fixed[-1, :] = fixed[:, 0] = fixed[:, -1] = True
    strip = np.abs(x) <= w / 2 + 1e-12
    gnd = np.abs(x) >= w / 2 + s - 1e-12
    for j in range(nh, nh + nt + 1):
        fixed[j, strip] = True
        v0[j, strip] = 1.0
        if top_gnd:
            fixed[j, gnd] = True

    eps = np.ones((ny - 1, nx - 1))          # cell (j, i) spans node rows j..j+1
    j0 = 0
    for (th, er), n in zip(layers, rows):
        eps[j0:j0 + n, :] = er
        j0 += n

    def capacitance(eps_cells):
        ec = np.pad(eps_cells, ((1, 1), (0, 0)), mode="edge")
        eh = (ec[:-1, :] + ec[1:, :]) / 2 * (dy / dx)    # horizontal edges (ny, nx-1)
        ec = np.pad(eps_cells, ((0, 0), (1, 1)), mode="edge")
        ev = (ec[:, :-1] + ec[:, 1:]) / 2 * (dx / dy)    # vertical edges (ny-1, nx)

        def apply(v):                         # A v, A symmetric positive definite
            out = np.zeros_like(v)
            fh = eh * (v[:, 1:] - v[:, :-1])
            out[:, :-1] += fh
            out[:, 1:] -= fh
            fv = ev * (v[1:, :] - v[:-1, :])
            out[:-1, :] += fv
            out[1:, :] -= fv
            return -out

        b = -apply(v0)
        b[fixed] = 0
        v = np.zeros_like(v0)
        r = b.copy()
        p = r.copy()
        rr = (r * r).sum()
        stop = tol * math.sqrt(rr)
        for _ in range(50000):
            ap = apply(p)
            ap[fixed] = 0
            alpha = rr / (p * ap).sum()
            v += alpha * p
            r -= alpha * ap
            rr_new = (r * r).sum()
            if math.sqrt(rr_new) < stop:
                break
            p = r + (rr_new / rr) * p
            rr = rr_new
        vt = v + v0
        return ((eh * (vt[:, 1:] - vt[:, :-1]) ** 2).sum()
                + (ev * (vt[1:, :] - vt[:-1, :]) ** 2).sum())   # C / eps0

    ce = capacitance(eps)
    ca = capacitance(np.ones_like(eps))
    return 1 / (C0 * EPS0 * math.sqrt(ce * ca)), ce / ca


def grid_root(fun, target, k0, k_min, k_max):
    """Find fun(k) = target on integer grid steps k (fun monotonic in k), then interpolate
    linearly between the two bracketing steps. Returns (k as float, value at the step
    closer to target). Stepping on whole grid cells keeps every evaluated geometry exactly
    on the grid, so fun has no staircase noise from edges snapping to nodes."""
    k, f = k0, fun(k0)
    while True:
        up = (f - target) * (fun(k + 1) - f) < 0 if k == k0 else up
        k2 = k + (1 if up else -1)
        if not k_min <= k2 <= k_max:
            raise ValueError(f"no root of {target} for k in [{k_min}, {k_max}]")
        f2 = fun(k2)
        if (f - target) * (f2 - target) <= 0:
            kr = k + (k2 - k) * (target - f) / (f2 - f)
            return kr, f if abs(f - target) < abs(f2 - target) else f2
        k, f = k2, f2


def width_for(s, layers, target=50.0, m=12, margin=10):
    """W (mm) for Z0 = target at gap s: grid dx = s/m, W = 2 n dx."""
    dx = s / m
    cache = {}

    def z(n):
        if n not in cache:
            cache[n] = fd_line(2 * n * dx, s, layers, dx=dx, margin=margin)
        return cache[n][0]
    h = sum(th for th, _ in layers)
    n, _ = grid_root(z, target, max(2, round(0.8 * h / dx)), 2, 400)
    w = 2 * n * dx
    lo = cache[int(n)]
    hi = cache[int(n) + 1] if int(n) + 1 in cache else lo
    frac = n - int(n)
    return w, (1 - frac) * lo[1] + frac * hi[1], dx


def gap_for(w, layers, s_max, target=50.0, dx=0.02, margin=4):
    """Top ground gap s (mm) for Z0 = target with a fixed strip w: dx fitted to w/2."""
    dx = w / 2 / round(w / 2 / dx)
    z = lambda j: fd_line(w, j * dx, layers, dx=dx, margin=margin)[0]
    j, _ = grid_root(z, target, max(2, round(0.3 / dx)), 2, int(s_max / dx))
    return j * dx, dx


# --- closed forms (comparison / sanity check) -------------------------------------------

def agm(a, b):
    while abs(a - b) > 1e-15 * a:
        a, b = (a + b) / 2.0, math.sqrt(a * b)
    return a


def kratio(k, kp):
    """K(k)/K(k'), K(k) = pi / (2 AGM(1, k')); kp passed separately to avoid 1 - k^2 underflow."""
    return agm(1.0, k) / agm(1.0, kp)


def gcpw_conformal(w, s, h, er):
    k = w / (w + 2 * s)
    x1, x2 = math.pi * w / (4 * h), math.pi * (w + 2 * s) / (4 * h)
    k3 = math.tanh(x1) / math.tanh(x2)
    one_minus_k3 = math.sinh(x2 - x1) / (math.cosh(x1) * math.sinh(x2))
    r1 = kratio(k, math.sqrt(1 - k * k))
    r3 = kratio(k3, math.sqrt(one_minus_k3 * (1 + k3)))
    eeff = 1 + r3 / (r1 + r3) * (er - 1)
    return 60 * math.pi / math.sqrt(eeff) / (r1 + r3), eeff


def microstrip_hammerstad(w, h, er):
    u = w / h
    eeff = (er + 1) / 2 + (er - 1) / 2 * (1 + 12 / u) ** -0.5
    if u >= 1:
        z = 120 * math.pi / math.sqrt(eeff) / (u + 1.393 + 0.667 * math.log(u + 1.444))
    else:
        z = 60 / math.sqrt(eeff) * math.log(8 / u + u / 4)
    return z, eeff


# --- report -----------------------------------------------------------------------------

def check():
    print("Kontrola FD řešiče proti mikropásku (bez horních zemí, t = 0):")
    for w, h, er in ((0.376, 0.2104, 4.4), (2.9, 1.53, 4.5)):
        zf, ef = fd_line(w, 0, [(h, er)], t=0, top_gnd=False)
        zm, em = microstrip_hammerstad(w, h, er)
        zc, _ = gcpw_conformal(w, 50.0, h, er)
        print(f"  W {w:5.3f} h {h:6.4f} er {er}: FD {zf:5.1f} ohm (eeff {ef:.3f}), "
              f"Hammerstad {zm:5.1f} ohm (eeff {em:.3f}), konformní GCPW S->inf {zc:5.1f} ohm")
    print()


def table():
    print(f"50 ohm GCPW, měď {CU_OUT*1000:.0f} um, bez masky (FD; konformní vzorec pro srovnání)")
    print(f"{'skladba':18s} {'h mm':>6s} {'er':>5s} {'S mm':>5s} {'W mm':>6s} "
          f"{'eeff':>5s} {'Z0 konf.':>8s}")
    results = {}
    for name, layers in STACKUPS:
        h, er = layers[0]
        for s in GAPS:
            thick = h > 0.5                       # 2-layer: coarser grid, smaller box
            w, eeff, dx = width_for(s, layers, m=6 if thick else 12, margin=4 if thick else 10)
            zc, _ = gcpw_conformal(w, s, h, er)
            results[(name, s)] = (w, eeff)
            print(f"{name:18s} {h:6.4f} {er:5.2f} {s:5.2f} {w:6.3f} {eeff:5.2f} {zc:8.1f}")
        print()
    return results


def fence(eeff):
    f = F_BAND[1]
    lam0 = C0 / f * 1e3
    print(f"Via fence: lambda0 na {f/1e6:.0f} MHz = {lam0:.1f} mm")
    for er in (4.4, 4.6):
        lam = lam0 / math.sqrt(er)
        print(f"  dielektrikum er {er}: lambda = {lam:.1f} mm, lambda/10 = {lam/10:.2f} mm, "
              f"lambda/20 = {lam/20:.2f} mm")
    lg = lam0 / math.sqrt(eeff)
    print(f"  vedení 7628 (eeff {eeff:.2f}): lambda_g = {lg:.1f} mm, lambda_g/4 = {lg/4:.1f} mm\n")


def launch():
    # Samtec SMA-J-P-X-ST-EM1 print Rev. G: centre pad 1.27 mm, ground pads 4.30 mm apart.
    # JLC04161H-7628: L1-L2 7628 0.2104 mm, inner Cu 0.0152 mm, core 1.065 mm (er 4.6).
    pad = 1.27
    s_pads = (4.30 - pad) / 2
    pre, core = (0.2104, 4.40), (1.065, 4.60)
    cases = (
        ("reference L2 (bez výřezu)", [pre]),
        ("reference L3 (výřez v L2)", [core, (CU_IN, 4.40), pre]),
    )
    print(f"Launch SMA EM1: středový pad {pad} mm")
    dx = pad / 2 / round(pad / 2 / 0.02)
    for label, layers in cases:
        z, _ = fd_line(pad, round(s_pads / dx) * dx, layers, dx=dx, margin=4)
        print(f"  {label:28s} top zem na zemních padech (S {s_pads:.3f}): Z0 = {z:5.1f} ohm")
    s50, _ = gap_for(pad, cases[1][1], s_pads)
    print(f"  50 ohm s výřezem v L2: zemní měď na TOP {s50:.2f} mm od středového padu\n")


def main():
    check()
    results = table()
    fence(results[("JLC04161H-7628", 0.20)][1])
    launch()


if __name__ == "__main__":
    main()
