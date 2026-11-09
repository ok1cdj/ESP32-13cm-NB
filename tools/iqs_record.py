#!/usr/bin/env python3
"""iqs_record.py: record I/Q from the ESP32-S3 running the ESP-SDR firmware (zodoczi/esp-sdr, IQS continuous stream) with a JSON sidecar.

    tools/iqs_record.py build/rx/x --center 2320.05e6 --seconds 30              (62.5 kS/s, 16 bit)
    tools/iqs_record.py build/rx/x --center 2320.804e6 --decim 64 --bits 8      (250 kS/s, 8 bit)
    tools/iqs_record.py --info                                                    (INFO, VERSION?, LIMITS?)

The output (BASE.cf32 + BASE.json) is what tools/cw_analyze.py reads; the sidecar's lo_hz is the centre of the recording.

Tuning: the stream runs in mode 2 (the samples are rotated by fs/4 of the 16 MS/s ring before the filter), with the LO 4 MHz
below the centre, so the receiver's own LO leakage and its hump at 0 Hz IF are 4 MHz away from the band. FREQ takes whole MHz,
FOFS adds kHz; the PLL then rounds the LO down to its step of 30 MHz / 65536 = 457.76 Hz (the same as the C3), and the centre in
the sidecar includes that, so on the shared TCXO frequencies come out exact. The samples are conjugated (RF up = frequency up).
Every frame carries a sample index and a CRC32: lost or damaged frames are counted and reported, and the gaps are filled with
zeros so that the time base stays right.
Protocol: fw/esp-sdr/docs/iq-stream.md (ESP-SDR is GPL-3.0-or-later; this client is written from the protocol description).
"""
import argparse
import datetime
import json
import math
import os
import struct
import sys
import time
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbports import RX_PORT, tty_release  # noqa: E402

RING_HZ = 16e6
PLL_STEP = 30e6 / 65536          # Hz


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def pll_actual(f_hz):
    """The frequency the PLL settles on for a request of f_hz (rounded down to its step)."""
    return math.floor(f_hz / PLL_STEP + 1e-9) * PLL_STEP


class Esp:
    def __init__(self, port):
        import serial
        self.s = serial.Serial(port, 115200, timeout=1, write_timeout=2)
        time.sleep(0.3)
        self.s.reset_input_buffer()

    def cmd(self, c, wait=0.5):
        """A command and its reply line(s); ERR raises."""
        self.s.write((c + "\n").encode())
        time.sleep(wait)
        r = self.s.read(self.s.in_waiting or 1).decode(errors="replace").strip()
        if r.startswith("ERR"):
            raise RuntimeError(f"{c}: {r}")
        return r


def record(esp, center, seconds, decim, bits, gain):
    lo_req = center - RING_HZ / 4                              # mode 2: the output is centred fs/4 above the LO
    lo_khz = int(round(lo_req / 1e3))
    esp.cmd(f"FOFS {lo_khz % 1000}")
    esp.cmd(f"FREQ {lo_khz // 1000}", 1.0)
    esp.cmd("GAIN HARDWARE" if gain is None else f"GAIN MANUAL {gain}")
    fs = RING_HZ / decim
    esp.s.write(f"IQS {int(seconds * 1000)} {decim} {bits} 6 0 2\n".encode())
    start = esp.s.read_until(b"\n").decode(errors="replace").strip()
    if not start.startswith("IQS "):
        raise RuntimeError(f"no stream: {start!r}")
    log("stream:", start)
    buf, chunks, expect = bytearray(), [], 0
    stats = {"frames": 0, "crc_bad": 0, "gaps": 0, "gap_samples": 0, "flagged": 0}
    esp.s.timeout = 0.2
    t_end = time.time() + seconds + 5
    end_line = ""
    while time.time() < t_end:
        d = esp.s.read(65536)
        if d:
            buf += d
        k = done = 0                                           # done: bytes of buf that are parsed
        while True:                                            # parse the complete frames in buf
            k = buf.find(b"IQS1", k)
            if k < 0 or k + 24 > len(buf):
                break
            seq, idx, n, b, flags, dec, gain_meta, shift = struct.unpack_from("<IQHBBHBB", buf, k + 4)
            plen = n * 2 * b // 8
            if b not in (4, 8, 16) or plen > 1024:
                k += 4
                done = k
                continue
            if k + 24 + plen + 4 > len(buf):
                break
            if zlib.crc32(bytes(buf[k:k + 24 + plen])) != struct.unpack_from("<I", buf, k + 24 + plen)[0]:
                stats["crc_bad"] += 1
                k += 4
                done = k
                continue
            if idx < expect:                                   # a frame seen before (cannot happen): skip it
                k += 24 + plen + 4
                done = k
                continue
            if idx > expect:                                   # lost frames: zeros keep the time base
                stats["gaps"] += 1
                stats["gap_samples"] += idx - expect
                chunks.append(np.zeros(idx - expect, np.complex64))
            stats["flagged"] += flags != 0
            raw = bytes(buf[k + 24:k + 24 + plen])
            if b == 16:
                v = np.frombuffer(raw, "<i2").astype(np.float32)
            elif b == 8:
                v = np.frombuffer(raw, np.int8).astype(np.float32)
            else:                                              # 4 bit: I low nibble, Q high nibble
                u = np.frombuffer(raw, np.uint8)
                v = np.empty(2 * len(u), np.float32)
                v[0::2] = ((u & 15).astype(np.int8) << 4 >> 4)
                v[1::2] = (u.astype(np.int8) >> 4)
            chunks.append((v[0::2] - 1j * v[1::2]).astype(np.complex64))   # conjugate: RF up = frequency up
            expect = idx + n
            stats["frames"] += 1
            k += 24 + plen + 4
            done = k
        if done:
            del buf[:done]
        m = buf.find(b"IQSEND")
        if m >= 0 and b"\n" in buf[m:]:
            end_line = buf[m:].split(b"\n")[0].decode(errors="replace").strip()
            break
    x = np.concatenate(chunks) if chunks else np.zeros(0, np.complex64)
    lo_act = pll_actual(lo_khz * 1e3)
    return x, {"fs": fs, "lo_hz": lo_act + RING_HZ / 4, "lo_pll_hz": lo_act, "lo_requested_khz": lo_khz, "decimation": decim,
               "bits": bits, "gain": "auto" if gain is None else gain, "start": start, "end": end_line, **stats}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", nargs="?", help="output base name: OUT.cf32 and OUT.json")
    ap.add_argument("--center", type=float, help="centre frequency in Hz (the signal can sit anywhere within +-0.4 fs)")
    ap.add_argument("--signal", type=float, help="expected signal frequency in Hz, for the sidecar (default: --center)")
    ap.add_argument("--seconds", type=float, default=30)
    ap.add_argument("--decim", type=int, default=256, choices=(64, 128, 256, 512, 1024), help="16 MS/s / decim (default 256: 62.5 kS/s)")
    ap.add_argument("--bits", type=int, default=16, choices=(4, 8, 16))
    ap.add_argument("--gain", type=int, help="manual gain index (LIMITS?); default hardware AGC, which moves during key edges: "
                                             "use a manual gain to measure the envelope")
    ap.add_argument("--port", default=RX_PORT)
    ap.add_argument("--note", default="")
    ap.add_argument("--info", action="store_true", help="print INFO, VERSION?, LIMITS?, RANGE? and exit")
    a = ap.parse_args()
    esp = Esp(a.port)
    try:
        return run(esp, a, ap)
    finally:
        tty_release(esp.s)


def run(esp, a, ap):
    if a.info:
        for c in ("INFO", "VERSION?", "LIMITS?", "RANGE?", "TRANSPORT?"):
            print(esp.cmd(c).splitlines()[-1])
        return 0
    if not a.out or a.center is None:
        ap.error("give OUT and --center (or --info)")
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    t0 = datetime.datetime.now(datetime.timezone.utc)
    x, meta = record(esp, a.center, a.seconds, a.decim, a.bits, a.gain)
    x.tofile(a.out + ".cf32")
    meta.update({"signal_hz": a.signal or a.center, "start_utc": t0.isoformat(timespec="seconds"), "seconds": a.seconds,
                 "samples": len(x), "format": "cf32", "port": a.port, "note": a.note, "firmware": "esp-sdr IQS"})
    with open(a.out + ".json", "w") as f:
        json.dump(meta, f, indent=1)
    print(f"{a.out}.cf32: {len(x)} samples = {len(x) / meta['fs']:.2f} s at {meta['fs']:.0f} S/s, centre {meta['lo_hz']:.1f} Hz; "
          f"frames {meta['frames']}, CRC bad {meta['crc_bad']}, gaps {meta['gaps']} ({meta['gap_samples']} samples), flagged {meta['flagged']}")
    return 1 if meta["gaps"] or meta["crc_bad"] else 0


if __name__ == "__main__":
    sys.exit(main())
