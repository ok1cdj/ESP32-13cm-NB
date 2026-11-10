#!/usr/bin/env python3
"""ssb_tx.py: transmit USB through the C3 (firmware cw-beacon, SSB ON): a tone, two tones or a WAV file.

    tools/ssb_tx.py --tone 1000 --seconds 10
    tools/ssb_tx.py --two-tone 700 1900 --seconds 20 --amp 100
    tools/ssb_tx.py --wav speech.wav --freq 2320.05e6 --amp 60

The PC makes the analytic signal (USB: the spectrum above the carrier) at the C3's rate (50 kS/s, from its OK line), the C3 interpolates it, applies AMP and
puts it on the CW beacon's frequency F (LO = F - NCO; the carrier, suppressed, is at F). A tone of f Hz comes out at F + f.
Two tones: each at 0.45 of full scale (peak envelope 0.9). A WAV file is resampled, filtered to 300-2700 Hz (smooth edges in
the frequency domain), made analytic by zeroing the negative frequencies and normalised to a peak of 0.9.
The stream is paced by USB: the C3 stops reading when its ring (131 ms) is full, and the write waits. Its fill reports
(0xB7, fill, underruns) are shown. When the stream ends the C3 goes off by itself after 0.5 s (its silence limit).
The C3 transmits: into a dummy load or an attenuator only, and the AMP of the setting (the tinySA takes +6 dBm at most).
"""
import argparse
import os
import sys
import time

import numpy as np
import serial

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbports import TX_PORT, tty_release  # noqa: E402

RATE = 50000                                                  # pairs per second; the firmware's OK line says (RATE n)


def tones(freqs, seconds, level):
    t = np.arange(int(seconds * RATE)) / RATE
    z = sum(level * np.exp(2j * np.pi * f * t) for f in freqs)
    return z


def wav_analytic(path, lo=300.0, hi=2700.0):
    from scipy.io import wavfile
    from scipy.signal import resample_poly
    fs, x = wavfile.read(path)
    x = x.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    g = np.gcd(int(fs), RATE)
    x = resample_poly(x, RATE // g, int(fs) // g)
    X = np.fft.fft(x)
    f = np.fft.fftfreq(len(x), 1 / RATE)
    # positive frequencies only (x2), lo..hi with raised-cosine edges of 100 Hz
    w = np.clip((f - (lo - 100)) / 200, 0, 1) * np.clip(((hi + 100) - f) / 200, 0, 1)
    w = 0.5 - 0.5 * np.cos(np.pi * w)
    z = np.fft.ifft(2 * X * w)
    return 0.9 * z / np.abs(z).max()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--tone", type=float, metavar="HZ")
    src.add_argument("--two-tone", type=float, nargs=2, metavar=("HZ1", "HZ2"))
    src.add_argument("--wav", metavar="FILE")
    ap.add_argument("--seconds", type=float, default=10.0, help="tones: duration (WAV: the file)")
    ap.add_argument("--freq", type=float, help="carrier frequency in Hz (CW SET F); default: the C3's setting")
    ap.add_argument("--amp", type=int, help="AMP 1..480 (CW SET AMP); default: the C3's setting")
    ap.add_argument("--port", default=TX_PORT)
    a = ap.parse_args()

    c3 = serial.Serial(a.port, 115200, timeout=0.2, write_timeout=3)

    def cmd(c, wait=0.8):
        c3.write((c + "\n").encode())
        time.sleep(wait)
        return c3.read(8000).decode(errors="replace").strip()

    try:
        if a.freq is not None:
            print(cmd(f"CW SET F {a.freq / 1e6:.6f}").splitlines()[-1])
        if a.amp is not None:
            print(cmd(f"CW SET AMP {a.amp}").splitlines()[-1])
        c3.reset_input_buffer()
        c3.write(b"SSB ON\n")
        line, t0 = b"", time.time()
        while b"OK SSB" not in line and b"ERR" not in line and time.time() - t0 < 5:
            line += c3.read(200)
        print(line.decode(errors="replace").strip())
        if b"OK SSB" not in line:
            sys.exit("the C3 did not start SSB")
        global RATE
        m = __import__("re").search(rb"RATE (\d+)", line)
        RATE = int(m.group(1)) if m else RATE
        if a.tone is not None:
            z = tones([a.tone], a.seconds, 0.9)
        elif a.two_tone:
            z = tones(a.two_tone, a.seconds, 0.45)
        else:
            z = wav_analytic(a.wav)
        iq = np.empty(2 * len(z), np.int16)
        iq[0::2] = np.round(z.real * 32767)
        iq[1::2] = np.round(z.imag * 32767)
        data = iq.astype("<i2").tobytes()
        sent, chunk, t0, last = 0, 4096, time.time(), 0.0
        fills, unders, buf = [], 0, b""
        while sent < len(data):
            c3.write(data[sent:sent + chunk])                  # blocks while the C3's ring is full
            sent += chunk
            buf += c3.read(c3.in_waiting or 0)
            while (k := buf.find(b"\xb7")) >= 0 and len(buf) >= k + 4:
                fills.append(buf[k + 1] | buf[k + 2] << 8)
                unders = buf[k + 3]
                buf = buf[k + 4:]
            if time.time() - last > 1:
                last = time.time()
                print(f"{time.time() - t0:5.1f} s  sent {sent / 4 / RATE:5.1f} s of audio, ring {fills[-1] if fills else '-'} pairs, "
                      f"underruns {unders}", flush=True)
        print(f"sent {len(data) / 4 / RATE:.1f} s in {time.time() - t0:.1f} s; waiting for the C3 to stop")
        end, t1 = b"", time.time()
        while b"SSB END" not in end and time.time() - t1 < 3:
            end += c3.read(400)
        print(end[end.find(b"SSB END"):].decode(errors="replace").strip() if b"SSB END" in end else "no SSB END line")
    finally:
        tty_release(c3)


if __name__ == "__main__":
    main()
