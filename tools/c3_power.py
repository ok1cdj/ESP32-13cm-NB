#!/usr/bin/env python3
"""c3_power.py: the C3 CW beacon's carrier, LO leakage and I/Q image against AMP, measured with the tinySA.

    tools/c3_power.py -o build/meas/c3_power_vs_amp                       (AMP 1 .. 480, CSV + PNG)
    tools/c3_power.py --amps 10 30 100 --ext-att 30 -o build/meas/x

Set-up: the C3 (firmware cw-beacon) through an attenuator (--ext-att, default 30 dB) into the tinySA. The beacon sends the
carrier alone (empty text, CARRIER 600) while AMP steps; at the end CW OFF and the beacon's own AMP, CARRIER and TEXT come back
(RAM only, nothing is saved). The carrier is looked for within 3 kHz of its frequency (at low AMP the LO leakage, 20 kHz below
by default, can be stronger), the leakage at carrier - NCO and the image at carrier - 2 NCO. The tinySA here reads about
+1.4 kHz high near 2320 MHz (its own reference): --sa-offset.
The C3 transmits: only into a dummy load or an attenuator, never more than the tinySA takes (+6 dBm at its input).
"""
import argparse
import os
import re
import sys
import time

import numpy as np
import serial

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbports import TX_PORT, tty_release  # noqa: E402
from sa_capture import TinySA  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--amps", type=int, nargs="+", default=[1, 2, 3, 5, 10, 20, 30, 50, 100, 150, 200, 300, 400, 480])
    ap.add_argument("--freq", type=float, default=2320.05e6, help="carrier in Hz (CW SET F)")
    ap.add_argument("--nco", type=float, default=20e3, help="the beacon's NCO offset in Hz (where the LO leakage is)")
    ap.add_argument("--ext-att", type=float, default=30.0)
    ap.add_argument("--sa-offset", type=float, default=1400.0, help="tinySA reading minus the true frequency, Hz")
    ap.add_argument("--port", default=TX_PORT)
    ap.add_argument("-o", "--out", help="output base name (CSV + PNG)")
    a = ap.parse_args()

    c3 = serial.Serial(a.port, 115200, timeout=0.5, write_timeout=2)

    def cmd(c, wait=1.2):
        c3.write((c + "\n").encode())
        time.sleep(wait)
        return c3.read(8000).decode(errors="replace")

    m = re.search(r"CW ON \d AUTO \d F \S+ NCO \S+ AMP (\d+) WPM \d+ CARRIER (\d+) RISE \S+ PA \d TEXT (.*)", cmd("CW"))
    if not m:
        sys.exit("the C3 does not answer CW (firmware cw-beacon?)")
    orig = (m.group(1), m.group(2), m.group(3).strip())
    t = TinySA()
    rows = []
    try:
        t.cmd("attenuate auto")
        F = a.freq + a.sa_offset
        fr = t.setup(F - 2.5 * a.nco, F + 2.5 * a.nco, 1, 451)
        cmd(f"CW SET F {a.freq / 1e6:.6f}")
        cmd("CW SET TEXT ")                                    # the carrier alone
        cmd("CW SET CARRIER 600")
        cmd(f"CW SET AMP {a.amps[0]}")
        print(cmd("CW ON", 2.0).strip().splitlines()[-1], flush=True)
        for amp in a.amps:
            r = cmd(f"CW SET AMP {amp}", 2.0)
            if "ERR" in r:
                print(f"AMP {amp}: {r.strip()}")
                continue
            d = np.maximum(t.trace(), t.trace()) + a.ext_att
            near = np.abs(fr - F) <= 3000
            k = np.flatnonzero(near)[np.argmax(d[near])]
            fc, car = fr[k], d[k]

            def at(off):
                return float(d[np.abs(fr - (fc + off)) <= 700].max())
            rows.append((amp, car, at(-a.nco) - car, at(-2 * a.nco) - car, float(np.median(d))))
            print(f"AMP {amp:3d}: carrier {car:+6.1f} dBm ({car - 20 * np.log10(amp):+5.1f} dBm - 20 log AMP), "
                  f"LO leakage {rows[-1][2]:+5.1f} dBc, image {rows[-1][3]:+5.1f} dBc, median {rows[-1][4]:.0f} dBm", flush=True)
    finally:
        print(cmd("CW OFF").strip().splitlines()[0], flush=True)
        cmd(f"CW SET AMP {orig[0]}")
        cmd(f"CW SET CARRIER {orig[1]}")
        cmd(f"CW SET TEXT {orig[2]}")
        tty_release(c3)
        t.close()
    r = np.array(rows)
    if not a.out or not len(r):
        return
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    np.savetxt(a.out + ".csv", r, delimiter=",", header="amp,carrier_dbm,lo_leak_dbc,image_dbc,median_dbm", comments="", fmt="%.2f")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.semilogx(r[:, 0], r[:, 1], "o-", label="carrier")
    ref = r[np.argmin(np.abs(r[:, 0] - 10)), :]
    ax.semilogx(r[:, 0], ref[1] + 20 * np.log10(r[:, 0] / ref[0]), "--", lw=0.8, label=f"20 log(AMP) through AMP {ref[0]:.0f}")
    ax.semilogx(r[:, 0], r[:, 1] + r[:, 2], "s-", ms=3, lw=0.8, label=f"LO leakage (-{a.nco / 1e3:g} kHz)")
    ax.semilogx(r[:, 0], r[:, 1] + r[:, 3], "^-", ms=3, lw=0.8, label=f"I/Q image (-{2 * a.nco / 1e3:g} kHz)")
    ax.set_xlabel("AMP (DAC codes)")
    ax.set_ylabel(f"dBm at the C3's connector (tinySA + {a.ext_att:g} dB)")
    ax.set_title(f"C3 CW carrier {a.freq / 1e6:.3f} MHz vs AMP", fontsize=10)
    ax.grid(alpha=0.3, which="both")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(a.out + ".png", dpi=110)
    print(f"wrote {a.out}.csv / .png")


if __name__ == "__main__":
    main()
