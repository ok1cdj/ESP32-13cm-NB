#!/usr/bin/env python3
"""rx_record.py: record I/Q from the ESP32-S3 receiver (espdr narrowband firmware of ESP32-DATV-RX) with a JSON sidecar.

    tools/rx_record.py out/cw1 --signal 2320.05e6 --seconds 30            (out/cw1.cf32 + out/cw1.json)
    tools/rx_record.py out/cw1 --signal 2320.05e6 --lo-offset -80e3 --gain 60 --decim 3

The S3 has a hump of +-25 kHz around its LO (LO leakage, ADC offset) and a spur of its own at multiples of 20 MHz (2320 MHz), so the
LO goes --lo-offset away from the signal (default +80 kHz: the signal at -80 kHz, the C3's LO leakage 20 kHz further out, the
2320 MHz spur beyond the band edge). cf32 = complex64, RF-up = frequency-up (espdr --convert cf32). The sidecar holds the LO the
ESP actually settled on (1 Hz), the sample rate and the time, which is what tools/cw_analyze.py needs.
The firmware must already run on the S3 (it does after rx/flash_rx_xiao.sh in ESP32-ATV, or after espdr-rx loaded it).
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbports import RX_PORT, RX_VENV  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", help="output base name: OUT.cf32 and OUT.json")
    ap.add_argument("--signal", type=float, required=True, help="expected signal frequency in Hz")
    ap.add_argument("--lo-offset", type=float, default=80e3, help="LO minus signal in Hz (default 80000)")
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--decim", type=int, choices=(3, 4), default=3, help="3: 333 ksps, 4: 250 ksps")
    ap.add_argument("--gain", type=int, default=60, help="gain selector 0..127 (default 60)")
    ap.add_argument("--port", default=RX_PORT)
    ap.add_argument("--note", default="", help="free text for the sidecar (set-up, attenuation ...)")
    a = ap.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    lo_req = a.signal + a.lo_offset
    cmd = [RX_VENV, "-m", "espdr.nb", "-p", a.port, "run", "--freq", str(round(lo_req)), "--decim", str(a.decim), "--format", "cs8",
           "--gain", str(a.gain), "--seconds", str(a.seconds), "--convert", "cf32", "-o", a.out + ".cf32"]
    t0 = datetime.datetime.now(datetime.timezone.utc)
    print("running:", " ".join(cmd), file=sys.stderr)
    p = subprocess.run(cmd, capture_output=True, text=True)
    sys.stderr.write(p.stderr)
    if p.returncode:
        sys.exit(f"espdr.nb failed ({p.returncode})")
    m = re.search(r"LO ([0-9.]+) MHz", p.stderr)
    if not m:
        sys.exit("no LO in espdr's output")
    fs = 1e6 / a.decim
    meta = {"lo_hz": float(m.group(1)) * 1e6, "lo_requested_hz": lo_req, "fs": fs, "signal_hz": a.signal, "gain": a.gain,
            "format": "cf32", "start_utc": t0.isoformat(timespec="seconds"), "seconds": a.seconds,
            "samples": os.path.getsize(a.out + ".cf32") // 8, "port": a.port, "note": a.note, "espdr": p.stderr.strip()}
    with open(a.out + ".json", "w") as f:
        json.dump(meta, f, indent=1)
    print(f"{a.out}.cf32: {meta['samples']} samples at {fs:.0f} S/s, LO {meta['lo_hz']:.0f} Hz "
          f"(signal expected at {a.signal - meta['lo_hz']:+.0f} Hz)")


if __name__ == "__main__":
    main()
