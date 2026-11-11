#!/usr/bin/env python3
"""s3trx.py: single-board TRX experiments on the plain XIAO ESP32-S3 (ESP-SDR fork, branch s3-trx in fw/esp-sdr).

    tools/s3trx.py cmd "TXSTAT?"                                   (one command, prints the answer)
    tools/s3trx.py lo --mhz 2400 --offset 100e3 --amp 50 -o docs/s3-trx/lo_amp50       (carrier, LO leakage, I/Q image)
    tools/s3trx.py lo --mode hold --fs 2e6 ...                     (the CPU-held DAC word instead of the replay loop)
    tools/s3trx.py null --amp 50                                   (DC correction TXDC that nulls the LO leakage)
    tools/s3trx.py reset -n 10 --null --dc I Q -o docs/s3-trx/reset10   (resets: leakage with a fixed DC, own null each time)

The S3's U.FL goes through an attenuator (--ext-att, dB) into the tinySA. TXLOOP keys the transmitter for --ms and the tinySA
sweeps while it is on; the levels are carrier at LO+offset, leakage at LO, image at LO-offset, all in dBm at the S3's connector.
"""
import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbports import SA_PORT, tty_release  # noqa: E402
from sa_capture import TinySA, log, peak, plot, save  # noqa: E402

TRX_PORT = os.environ.get("TRX_PORT", "/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_28:84:85:8A:C1:78-if00")


class S3:
    """The ESP-SDR text protocol: one command line, one answer line."""

    def __init__(self, port=TRX_PORT):
        import serial
        self.s = serial.Serial(port, 115200, timeout=3)
        time.sleep(0.2)
        self.s.reset_input_buffer()
        self.s.write(b"\n")                           # flush a boot log line or a half command
        self.s.readline()
        self.s.reset_input_buffer()

    def cmd(self, c, timeout=3):
        self.s.timeout = timeout
        self.s.write(c.encode() + b"\n")
        r = self.s.readline().decode(errors="replace").strip()
        if not r:
            raise TimeoutError(f"S3 did not answer {c!r}")
        return r

    def reset(self):
        """Chip reset through the USB-JTAG bridge (RTS = EN, DTR = BOOT kept high)."""
        self.s.dtr = False
        self.s.rts = True
        time.sleep(0.1)
        self.s.rts = False
        self.s.close()
        time.sleep(1.5)
        port = self.s.port
        for _ in range(30):
            try:
                self.__init__(port)
                self.cmd("VERSION?")
                return
            except Exception:
                time.sleep(0.5)
        raise TimeoutError("S3 did not come back after the reset")

    def close(self):
        tty_release(self.s)


def level_at(fr, d, f, win):
    m = np.abs(fr - f) <= win
    return float(d[m].max()) if m.any() else float("nan")


def measure_lo(s3, sa, a, tag=""):
    """Key the TX, sweep around the LO, return (freqs, dBm, carrier, leak, image)."""
    lo = a.mhz * 1e6 + a.khz * 1e3
    span = max(4 * abs(a.offset), 200e3)
    fr = sa.setup(lo - span / 2, lo + span / 2, rbw=a.rbw, points=a.points)
    if a.mode == "loop":
        r = s3.cmd(f"TXLOOP {a.mhz} {a.khz} {a.offset:.3f} {a.amp} 0 {a.rate}")
        log(r)
        time.sleep(0.2)
        d = np.max([sa.trace() for _ in range(a.avg)], axis=0) + a.ext_att
        log(s3.cmd("TXOFF"))
    else:
        # TXHOLD blocks the S3 (interrupts masked); sweep from a second thread while it holds the carrier.
        import threading
        res = {}
        th = threading.Thread(target=lambda: res.setdefault(
            "r", s3.cmd(f"TXHOLD {a.mhz} {a.khz} {a.offset:.3f} {a.amp} {a.ms} {int(a.fs)}", timeout=a.ms / 1000 + 5)))
        th.start()
        time.sleep(0.3)
        d = sa.trace() + a.ext_att
        th.join()
        log(res.get("r"))
    # The plain crystal is several ppm off (tens of kHz at 2.3 GHz): find the carrier first, the rest relative to it.
    m = np.abs(fr - (lo + a.offset)) <= abs(a.offset) / 2
    fc, car = peak(fr[m], d[m])
    err = fc - (lo + a.offset)
    win = max(3 * (fr[1] - fr[0]), 2e3)
    leak = level_at(fr, d, lo + err, win)
    img = level_at(fr, d, lo + err - a.offset, win)
    log(f"{tag}carrier {car:.1f} dBm at {fc / 1e6:.6f} MHz ({err:+.0f} Hz, {err / fc * 1e6:+.2f} ppm), "
        f"LO leakage {leak:.1f} dBm ({leak - car:.1f} dBc), image {img:.1f} dBm ({img - car:.1f} dBc)")
    return fr, d, car, leak, img, err


def leak_dbm(s3, sa, a, lo_seen, i, q):
    """Restart the tone with DC (i, q) and read the LO leakage (narrow sweep set up by the caller)."""
    s3.cmd(f"TXDC {i} {q}")
    s3.cmd(f"TXLOOP {a.mhz} {a.khz} {a.offset:.3f} {a.amp} 0 {a.rate}")
    time.sleep(0.05)
    d = sa.trace() + a.ext_att
    return float(d.max())


def find_null(s3, sa, a, lo_seen):
    """DC correction that nulls the leakage: P(i, q) = A((i - i0)^2 + (q - q0)^2) + N, three points per axis, refined."""
    sa.setup(lo_seen - 5e3, lo_seen + 5e3, rbw="3", points=21)
    i0 = q0 = 0.0
    for d in (24, 8, 3):
        for axis in (0, 1):
            p = []
            for k in (-d, 0, d):
                i, q = (round(i0 + k), round(q0)) if axis == 0 else (round(i0), round(q0 + k))
                p.append(10 ** (leak_dbm(s3, sa, a, lo_seen, i, q) / 10))
            curv = p[0] + p[2] - 2 * p[1]
            if curv > 0:
                step = max(-2 * d, min(2 * d, (p[0] - p[2]) * d / (2 * curv)))
                if axis == 0:
                    i0 += step
                else:
                    q0 += step
    best = leak_dbm(s3, sa, a, lo_seen, round(i0), round(q0))
    s3.cmd("TXOFF")
    s3.cmd("TXDC 0 0")
    return round(i0), round(q0), best


def cmd_null(a):
    s3, sa = S3(a.port), TinySA(a.sa_port)
    try:
        s3.cmd(f"TXDC {a.dc[0]} {a.dc[1]}")
        fr, d, car, leak, img, err = measure_lo(s3, sa, a)
        i, q, best = find_null(s3, sa, a, a.mhz * 1e6 + a.khz * 1e3 + err)
        log(f"null at TXDC {i} {q}: leakage {best:.1f} dBm ({best - car:.1f} dBc), was {leak - car:.1f} dBc")
        print(f"{i},{q},{best - car:.2f},{leak - car:.2f}")
    finally:
        s3.close()
        sa.close()


def cmd_reset(a):
    """N chip resets; after each: carrier, leakage, image, frequency, the leakage with a fixed DC (--dc) and the own null."""
    s3, sa = S3(a.port), TinySA(a.sa_port)
    rows = []
    try:
        for n in range(a.n):
            s3.reset()
            s3.cmd(f"TXDC {a.dc[0]} {a.dc[1]}")
            fr, d, car, leak, img, err = measure_lo(s3, sa, a, tag=f"#{n} ")
            i, q, best = find_null(s3, sa, a, a.mhz * 1e6 + a.khz * 1e3 + err) if a.null else (0, 0, float("nan"))
            log(f"#{n} null TXDC {i} {q}: {best - car:.1f} dBc")
            rows.append([n, car, leak - car, img - car, err, i, q, best - car])
    finally:
        s3.close()
        sa.close()
    r = np.array(rows)
    save(a.out, "n,carrier_dbm,leak_dbc,image_dbc,freq_err_hz,null_i,null_q,null_dbc", [r[:, k] for k in range(r.shape[1])],
         "%d,%.2f,%.2f,%.2f,%.0f,%d,%d,%.2f")
    for k, name in ((2, "leak dBc"), (3, "image dBc"), (5, "null I"), (6, "null Q")):
        log(f"{name}: mean {np.nanmean(r[:, k]):.1f}, min {np.nanmin(r[:, k]):.1f}, max {np.nanmax(r[:, k]):.1f}")


def cmd_switch(a):
    """TX -> RX -> TX cycles on the one chip: times of each step, the receiver's level and spurs after each TX, the TX frequency."""
    from iqs_record import Esp, record
    s3, sa = S3(a.port), TinySA(a.sa_port)
    lo = a.mhz * 1e6 + a.khz * 1e3
    fsa = sa.setup(lo + a.offset - 50e3, lo + a.offset + 50e3, rbw="1", points=201)
    esp = Esp.__new__(Esp)
    esp.s = s3.s
    rows = []
    try:
        for c in range(a.n):
            t0 = time.perf_counter()
            r = s3.cmd(f"TXLOOP {a.mhz} {a.khz} {a.offset:.3f} {a.amp} 0 {a.rate}")
            t_tx = time.perf_counter() - t0
            d = sa.trace() + a.ext_att                           # the TX frequency, every cycle
            fc, car = peak(fsa, d)
            time.sleep(a.tx_s)
            t0 = time.perf_counter()
            st = s3.cmd("TXSTAT?")
            s3.cmd("TXOFF")
            t_off = time.perf_counter() - t0
            st2 = s3.cmd("TXSTAT?").split()
            t0 = time.perf_counter()
            x, meta = record(esp, a.rx_center, a.rx_s, 256, 16, a.gain)
            t_rx = time.perf_counter() - t0 - a.rx_s
            p = np.abs(x[len(x) // 10:]) ** 2
            spec = 10 * np.log10(np.abs(np.fft.fftshift(np.fft.fft(x[-16384:] * np.hanning(16384)))) ** 2 + 1e-9)
            row = [c, t_tx * 1e3, int(st2[4]) / 1e3, t_off * 1e3, t_rx * 1e3, fc - lo - a.offset, car,
                   10 * np.log10(p.mean() + 1e-12), 10 * np.log10(np.abs(x[len(x) // 10:].mean()) ** 2 + 1e-12),
                   spec.max() - np.median(spec), meta["frames"], meta["gaps"]]
            log(f"#{c} TX on {row[1]:.1f} ms (host), off {row[2]:.2f} ms (fw) / {row[3]:.1f} ms (host), RX start "
                f"{row[4]:.0f} ms incl. FREQ, TX {row[5]:+.0f} Hz {car:.1f} dBm, RX power {row[7]:.1f} dB, DC {row[8]:.1f} dB, "
                f"spur {row[9]:.1f} dB over median, frames {meta['frames']} gaps {meta['gaps']}  [{r} | {st}]")
            rows.append(row)
    finally:
        try:
            s3.cmd("TXOFF")
        except Exception:
            pass
        s3.close()
        sa.close()
    r = np.array(rows)
    save(a.out, "cycle,tx_on_host_ms,tx_off_fw_ms,tx_off_host_ms,rx_start_ms,tx_err_hz,tx_dbm,rx_power_db,rx_dc_db,rx_spur_db,"
         "frames,gaps", [r[:, k] for k in range(r.shape[1])], "%d,%.2f,%.3f,%.2f,%.0f,%.0f,%.2f,%.2f,%.2f,%.2f,%d,%d")


def cmd_cmd(a):
    s3 = S3(a.port)
    try:
        print(s3.cmd(a.line, timeout=a.timeout))
    finally:
        s3.close()


def cmd_lo(a):
    s3, sa = S3(a.port), TinySA(a.sa_port)
    try:
        fr, d, car, leak, img, err = measure_lo(s3, sa, a)
    finally:
        s3.close()
        sa.close()
    lo = a.mhz * 1e6 + a.khz * 1e3
    save(a.out, "freq_hz,dbm", [fr, d], "%.1f,%.2f")
    plot(a.out, (fr - lo) / 1e3, d, "kHz from LO", "dBm at the S3 connector",
         f"S3 {a.mode} LO {lo / 1e6:.3f} MHz offset {a.offset / 1e3:g} kHz amp {a.amp}: "
         f"carrier {car:.1f} dBm, leak {leak - car:.1f} dBc, image {img - car:.1f} dBc",
         [((a.offset + err) / 1e3, car, "carrier"), (err / 1e3, leak, "LO"), ((err - a.offset) / 1e3, img, "image")])
    print(f"{car:.2f},{leak:.2f},{img:.2f},{err:.0f}")


def tx_args(p):
    p.add_argument("--mhz", type=int, default=2320)
    p.add_argument("--khz", type=int, default=100)
    p.add_argument("--offset", type=float, default=100e3, help="tone offset from the LO, Hz")
    p.add_argument("--amp", type=int, default=50, help="DAC amplitude, 0..511")
    p.add_argument("--mode", choices=["loop", "hold"], default="loop")
    p.add_argument("--rate", type=int, default=40, help="loop replay rate, MS/s (40 or 80)")
    p.add_argument("--fs", type=float, default=2e6, help="hold mode update rate")
    p.add_argument("--ms", type=int, default=3000, help="hold mode duration")
    p.add_argument("--rbw", default="1")
    p.add_argument("--points", type=int, default=450)
    p.add_argument("--avg", type=int, default=1, help="loop mode: max of N sweeps")
    p.add_argument("--ext-att", type=float, default=30)
    p.add_argument("--dc", type=int, nargs=2, default=[0, 0], metavar=("I", "Q"), help="TXDC for the measurement")
    p.add_argument("-o", "--out")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", default=TRX_PORT)
    ap.add_argument("--sa-port", default=SA_PORT)
    sub = ap.add_subparsers(dest="what", required=True)
    p = sub.add_parser("cmd")
    p.add_argument("line")
    p.add_argument("--timeout", type=float, default=3)
    p.set_defaults(fn=cmd_cmd)
    p = sub.add_parser("lo")
    tx_args(p)
    p.set_defaults(fn=cmd_lo)
    p = sub.add_parser("null")
    tx_args(p)
    p.set_defaults(fn=cmd_null)
    p = sub.add_parser("switch")
    tx_args(p)
    p.add_argument("-n", type=int, default=10)
    p.add_argument("--tx-s", type=float, default=1.0)
    p.add_argument("--rx-s", type=float, default=2.0)
    p.add_argument("--rx-center", type=float, default=2320.2e6)
    p.add_argument("--gain", type=int, default=40)
    p.set_defaults(fn=cmd_switch)
    p = sub.add_parser("reset")
    tx_args(p)
    p.add_argument("-n", type=int, default=10)
    p.add_argument("--null", action="store_true", help="also search the null after every reset")
    p.set_defaults(fn=cmd_reset)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
