#!/usr/bin/env python3
"""sa_capture.py: spectrum measurements with the tinySA Ultra+ (ZS-407) over its USB serial port.

    tools/sa_capture.py info
    tools/sa_capture.py sweep --center 2320.05e6 --span 100e3 --rbw 1 --ext-att 30 -o out/carrier      (CSV + PNG, peak)
    tools/sa_capture.py sweep --start 1e6 --stop 200e6 --maxhold 20                                     (max hold over 20 s)
    tools/sa_capture.py drift --center 40e6 --span 1e3 --interval 5 --duration 1800 -o out/tcxo_drift  (peak every 5 s)
    tools/sa_capture.py pn --center 2320.05e6 --ext-att 30 -o out/pn                                    (phase noise, spurs)

Frequencies come from the normal sweep ("data 2" and "frequencies"): "scanraw" reads about 220 Hz high at 40 MHz on this unit.
The peak frequency is the power-weighted centroid of the points within 6 dB of the maximum, so it resolves less than the point
spacing. The tinySA's own TCXO (about 0.5..1 ppm, no external reference input) limits the absolute frequency; drift is relative.
Above 800 MHz the sweep needs the ultra mode, which is switched on. --ext-att adds an external attenuator back to the levels.
Measured at 40 MHz with a strong carrier, the close-in noise is the tinySA's own (about -87 dBc/Hz at 1 kHz): pn shows an upper bound.
"""
import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbports import SA_PORT  # noqa: E402


def log(*a):
    print(*a, file=sys.stderr, flush=True)


class TinySA:
    """The tinySA shell: commands end in CR, every answer ends with the prompt "ch> "."""

    PROMPT = b"ch> "

    def __init__(self, port=SA_PORT):
        import serial
        self.s = serial.Serial(port, 115200, timeout=2)
        time.sleep(0.3)
        self.s.reset_input_buffer()
        self.s.write(b"\r")                          # the first line after opening can lose characters
        self.s.read_until(self.PROMPT)
        self.s.reset_input_buffer()
        for i in range(3):                             # after plugging in, the shell answers only from a real command on
            try:
                self.cmd("version", timeout=2)
                break
            except TimeoutError:
                if i == 2:
                    raise
                self.s.reset_input_buffer()

    def cmd(self, c, timeout=10):
        self.s.timeout = timeout
        self.s.write(c.encode() + b"\r")
        r = self.s.read_until(self.PROMPT)
        if not r.endswith(self.PROMPT):
            raise TimeoutError(f"tinySA did not answer {c!r} (check CONFIG > CONNECTION = USB, no menu open)")
        r = r[:-len(self.PROMPT)]
        echo = c.encode() + b"\r\n"
        return (r[len(echo):] if r.startswith(echo) else r).decode(errors="replace")

    def setup(self, f1, f2, rbw="auto", points=450):
        self.cmd("ultra on" if f2 > 800e6 else "ultra auto")
        self.cmd(f"rbw {rbw}")
        self.cmd(f"sweep {int(f1)} {int(f2)} {points}")
        self.cmd("waitscan 1", timeout=300)          # the first sweep with the new settings
        return np.array([float(x) for x in self.cmd("frequencies").split()])

    def trace(self):
        """dBm of one fresh sweep. The firmware prints a mantissa that rounds up to 10 as ':' ("-:.000000e+01" is -100 dBm)."""
        self.cmd("waitscan 1", timeout=300)
        return np.array([float(x.replace(":", "10")) for x in self.cmd("data 2").split()])

    def close(self):
        try:
            self.cmd("rbw auto")
        finally:
            self.s.close()


def peak(fr, d):
    """Centroid of the points within 6 dB of the maximum (linear power), and the maximum."""
    m = d > d.max() - 6
    p = 10 ** (d[m] / 10)
    return float((fr[m] * p).sum() / p.sum()), float(d.max())


def span_args(a):
    if a.center is not None:
        return a.center - a.span / 2, a.center + a.span / 2
    if a.start is None or a.stop is None:
        sys.exit("give --center and --span, or --start and --stop")
    return a.start, a.stop


def save(base, header, cols, fmt):
    if not base:
        return
    os.makedirs(os.path.dirname(os.path.abspath(base)), exist_ok=True)
    np.savetxt(base + ".csv", np.column_stack(cols), delimiter=",", header=header, comments="", fmt=fmt)
    log("wrote", base + ".csv")


def plot(base, x, y, xlabel, ylabel, title, marks=()):
    if not base:
        return
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(x, y, lw=0.8)
    for mx, my, txt in marks:
        ax.plot(mx, my, "rv")
        ax.annotate(txt, (mx, my), textcoords="offset points", xytext=(5, 5), fontsize=8)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_title(title, fontsize=9)
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(base + ".png", dpi=120)
    log("wrote", base + ".png")


def cmd_info(t, a):
    print(t.cmd("info").strip())


def cmd_sweep(t, a):
    f1, f2 = span_args(a)
    fr = t.setup(f1, f2, a.rbw, a.points)
    d = t.trace()
    if a.avg > 1:
        acc = 10 ** (d / 10)
        for _ in range(a.avg - 1):
            acc += 10 ** (t.trace() / 10)
        d = 10 * np.log10(acc / a.avg)
    if a.maxhold:
        t0 = time.time()
        while time.time() - t0 < a.maxhold:
            d = np.maximum(d, t.trace())
    d = d + a.ext_att
    fp, lp = peak(fr, d)
    line = f"peak {fp:.1f} Hz {lp:.1f} dBm"
    if a.expect:
        line += f", {fp - a.expect:+.1f} Hz ({(fp - a.expect) / a.expect * 1e6:+.3f} ppm) from {a.expect:.1f}"
    print(line + f"; median {np.median(d):.1f} dBm, RBW {t.cmd('rbw').split()[-1]}")
    save(a.out, "f_hz,dbm", (fr, d), "%.1f,%.2f")
    unit, scale = (1e6, "MHz") if f2 - f1 > 5e6 else (1e3, "kHz")
    ref = 0 if scale == "MHz" else (f1 + f2) / 2
    plot(a.out, (fr - ref) / unit, d, f"{scale}" + (f" from {ref / 1e6:.6f} MHz" if ref else ""), "dBm" + (f" (+{a.ext_att:g} dB ext.)" if a.ext_att else ""),
         line, [((fp - ref) / unit, lp, f"{fp / 1e6:.6f} MHz")])


def cmd_drift(t, a):
    f1, f2 = span_args(a)
    fr = t.setup(f1, f2, a.rbw, a.points)
    rows, t0 = [], time.time()
    try:
        while time.time() - t0 < a.duration:
            d = t.trace() + a.ext_att
            fp, lp = peak(fr, d)
            rows.append((time.time() - t0, fp, lp))
            log(f"{rows[-1][0]:7.1f} s  {fp:.1f} Hz  {lp:.1f} dBm")
            time.sleep(max(0.0, a.interval - (time.time() - t0) % a.interval))
    except KeyboardInterrupt:
        pass
    r = np.array(rows)
    if len(r) < 2:
        sys.exit("too few points")
    slope = np.polyfit(r[:, 0], r[:, 1], 1)[0] * 60
    print(f"{len(r)} points over {r[-1, 0]:.0f} s: mean {r[:, 1].mean():.1f} Hz, p-p {np.ptp(r[:, 1]):.1f} Hz, std {r[:, 1].std():.1f} Hz, "
          f"slope {slope:+.2f} Hz/min, level {r[:, 2].mean():.1f} dBm")
    save(a.out, "t_s,f_hz,dbm", (r[:, 0], r[:, 1], r[:, 2]), "%.1f,%.2f,%.2f")
    plot(a.out, r[:, 0] / 60, r[:, 1] - r[0, 1], "min", f"Hz from {r[0, 1]:.1f}", f"drift: p-p {np.ptp(r[:, 1]):.1f} Hz, {slope:+.2f} Hz/min")


def cmd_pn(t, a):
    """Phase noise at offsets from the carrier, four spans with their RBW, plus lines more than 6 dB above their neighbourhood."""
    fc0 = a.center
    rows = []
    for span, rbw in ((5e3, 0.2), (50e3, 1), (500e3, 10), (5e6, 100)):
        fr = t.setup(fc0 - span, fc0 + span, rbw, 450)
        acc = sum(10 ** (t.trace() / 10) for _ in range(a.avg))
        d = 10 * np.log10(acc / a.avg) + a.ext_att
        car, fc = d.max(), fr[d.argmax()]
        save(a.out and f"{a.out}_{int(span / 1e3)}k", "f_hz,dbm", (fr, d), "%.1f,%.2f")
        out = []
        for off in (1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6):
            if off < 4 * rbw * 1e3 or off > span * 0.98:
                continue
            v = [np.median(d[np.abs(fr - (fc + s * off)) <= max(off * 0.05, rbw * 1e3)]) for s in (1, -1)]
            L = float(np.mean(v)) - car - 10 * np.log10(rbw * 1e3)
            out.append(f"{off / 1e3:g}k {L:.0f}")
            rows.append((off, L))
        med = np.array([np.median(d[max(0, k - 15):k + 15]) for k in range(len(d))])
        spurs = [(fr[k] - fc, d[k] - car) for k in range(len(d)) if d[k] - med[k] > 6 and abs(fr[k] - fc) > 5 * rbw * 1e3]
        print(f"+-{span / 1e3:g} kHz RBW {rbw:g} kHz: carrier {car:.1f} dBm at {fc:.0f} Hz | dBc/Hz: " + ", ".join(out))
        if spurs:
            print("   lines: " + ", ".join(f"{o / 1e3:+.1f} kHz {lv:.0f} dBc" for o, lv in spurs[:16]))
    r = np.array(sorted(rows))
    save(a.out, "offset_hz,dbc_hz", (r[:, 0], r[:, 1]), "%.0f,%.1f")
    if a.out:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(8, 5))
        ax.semilogx(r[:, 0], r[:, 1], "o-")
        ax.set_xlabel("offset Hz")
        ax.set_ylabel("dBc/Hz (tinySA: upper bound)")
        ax.grid(alpha=0.3, which="both")
        fig.tight_layout()
        fig.savefig(a.out + ".png", dpi=120)
        log("wrote", a.out + ".png")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", default=SA_PORT)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("info")
    for name in ("sweep", "drift", "pn"):
        p = sub.add_parser(name)
        p.add_argument("--center", type=float, required=name == "pn")
        p.add_argument("--span", type=float, default=1e3 if name == "drift" else 100e3)
        if name != "pn":
            p.add_argument("--start", type=float)
            p.add_argument("--stop", type=float)
            p.add_argument("--rbw", default="0.2" if name == "drift" else "auto", help="kHz (0.2..850) or auto")
            p.add_argument("--points", type=int, default=201 if name == "drift" else 450)
        p.add_argument("--ext-att", type=float, default=0.0, help="external attenuator in dB, added to the levels")
        p.add_argument("-o", "--out", help="output base name (CSV + PNG)")
        if name == "sweep":
            p.add_argument("--avg", type=int, default=1, help="average N sweeps (power)")
            p.add_argument("--maxhold", type=float, default=0, help="max hold for this many seconds")
            p.add_argument("--expect", type=float, help="expected frequency in Hz: prints the deviation")
        if name == "drift":
            p.add_argument("--interval", type=float, default=5.0)
            p.add_argument("--duration", type=float, default=60.0, help="seconds (Ctrl-C ends early)")
        if name == "pn":
            p.add_argument("--avg", type=int, default=3)
    a = ap.parse_args()
    t = TinySA(a.port)
    try:
        {"info": cmd_info, "sweep": cmd_sweep, "drift": cmd_drift, "pn": cmd_pn}[a.cmd](t, a)
    finally:
        t.close()


if __name__ == "__main__":
    main()
