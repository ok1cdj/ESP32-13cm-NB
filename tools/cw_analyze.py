#!/usr/bin/env python3
"""cw_analyze.py: analyse a CW recording from the ESP32-S3 (tools/rx_record.py): tone frequency and drift, SNR, keying envelope and
timing, and a simple CW decoder that prints the text of the beacon.

    tools/cw_analyze.py out/cw1                    (out/cw1.cf32 + out/cw1.json)
    tools/cw_analyze.py out/cw1 --plot out/cw1     (PNG: spectrum, envelope, an edge, frequency over time)
    tools/cw_analyze.py --selftest                 (a synthetic beacon with noise, drift and the receiver's hump: must decode)

Steps: the strongest line outside the receiver's hump around its LO (--hump) is the tone; it is mixed to 0 Hz, decimated to about
8 kHz and low-pass filtered (--bw for keying and frequency, a wider filter for the edges). The envelope with a hysteresis threshold
at 40 % from the noise to the key-down level and the noise gives the key; the dit length comes from the shortest key-down runs, and the runs
are read as dits, dahs, gaps and long carriers (longer than 5 dits). The frequency is the phase slope over 0.5 s pieces of key-down
time; on the shared TCXO the difference to the transmitter's setting is only the receiver's PLL rounding and the analysis.
"""
import argparse
import json
import sys

import numpy as np

MORSE = {".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E", "..-.": "F", "--.": "G", "....": "H", "..": "I", ".---": "J",
         "-.-": "K", ".-..": "L", "--": "M", "-.": "N", "---": "O", ".--.": "P", "--.-": "Q", ".-.": "R", "...": "S", "-": "T",
         "..-": "U", "...-": "V", ".--": "W", "-..-": "X", "-.--": "Y", "--..": "Z", "-----": "0", ".----": "1", "..---": "2",
         "...--": "3", "....-": "4", ".....": "5", "-....": "6", "--...": "7", "---..": "8", "----.": "9", "-..-.": "/",
         "..--..": "?", ".-.-.-": ".", "--..--": ",", "-...-": "=", "-....-": "-", ".-.-.": "+"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def lowpass(x, fs, fc, taps=255):
    """Windowed-sinc FIR, zero phase (the delay is taken out)."""
    n = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * fc / fs * n) * np.blackman(taps)
    h /= h.sum()
    return np.convolve(x, h, mode="same")


def to_baseband(x, fs, f0, fs1):
    """x shifted by -f0 and resampled to about fs1 with a brick-wall filter in the frequency domain (one FFT of the whole recording):
    nothing outside +-fs1/2 aliases in, not even the receiver's strong hump around its LO. Returns (y, exact fs1)."""
    n = len(x)
    k0 = int(round(f0 / fs * n))                               # shift by whole bins; the rest stays as an offset below 0.5 bin
    X = np.roll(np.fft.fft(x), -k0)
    m = int(n * fs1 / fs) // 2 * 2
    Y = np.concatenate((X[:m // 2], X[-m // 2:]))
    y = np.fft.ifft(Y) * (m / n)
    fs_out = m * fs / n
    rest = f0 - k0 * fs / n                                    # below one bin of the whole recording: take it out in the time domain
    return (y * np.exp(-2j * np.pi * rest / fs_out * np.arange(m))).astype(np.complex64), fs_out


def find_tone(x, fs, hump, lo_hz=0.0, band=None):
    """Strongest line of a Welch spectrum outside +-hump (and inside band, absolute Hz), interpolated; returns (f, psd_f, psd_db)."""
    nfft = 1 << 16
    nseg = max(1, min(40, len(x) // nfft))
    step = max(nfft, (len(x) - nfft) // max(1, nseg - 1)) if nseg > 1 else nfft
    w = np.blackman(nfft)
    acc = np.zeros(nfft)
    for k in range(nseg):
        s = x[k * step:k * step + nfft]
        if len(s) < nfft:
            break
        acc += np.abs(np.fft.fft(s * w)) ** 2
    f = np.fft.fftshift(np.fft.fftfreq(nfft, 1 / fs))
    p = 10 * np.log10(np.fft.fftshift(acc) + 1e-30)
    ok = (np.abs(f) > hump) & (np.abs(f) < 0.42 * fs)
    if band:
        ok &= (f + lo_hz >= band[0]) & (f + lo_hz <= band[1])
    i = np.flatnonzero(ok)[np.argmax(p[ok])]
    a, b, c = p[i - 1], p[i], p[i + 1]                         # parabolic interpolation of the peak
    d = 0.5 * (a - c) / (a - 2 * b + c) if a - 2 * b + c else 0.0
    return f[i] + d * fs / nfft, f, p


def key_runs(e, thr, hyst):
    """Hysteresis threshold -> list of (start index, length, on)."""
    on = e[0] > thr
    runs, start = [], 0
    hi, lo = thr + hyst, thr - hyst
    for k in np.flatnonzero((e > hi) | (e < lo)):           # only samples outside the band can change the state
        now = e[k] > hi
        if now != on:
            runs.append((start, k - start, on))
            start, on = k, now
    runs.append((start, len(e) - start, on))
    return runs


def decode(runs, fs):
    """Runs -> (text, dit seconds). Long key-down runs (> 5 dits) are carriers."""
    ons = np.array([n / fs for _, n, on in runs[1:-1] if on])  # the first and last runs are cut by the recording
    if not len(ons):
        return "", float("nan")
    short = np.sort(ons[ons < 2.0])
    if not len(short):
        return f"[CARRIER {ons.max():.1f} s]", float("nan")
    # dit: the median of the runs below the largest jump of the sorted short runs (dits vs dahs), if that jump is clear
    lr = np.log(short)
    j = int(np.argmax(np.diff(lr))) if len(lr) > 1 else -1
    dit = float(np.median(short[:j + 1])) if j >= 0 and np.diff(lr)[j] > np.log(2) else float(np.median(short))
    # the threshold below half lengthens marks and shortens spaces by the same amount: a dit is the mean of a dit mark and a dit space
    offs = np.array([n / fs for _, n, on in runs[1:-1] if not on])
    gap1 = offs[(offs > 0.5 * dit) & (offs < 1.5 * dit)]
    if len(gap1):
        dit = (dit + float(np.median(gap1))) / 2
    text, sym = [], ""
    for k, (_, n, on) in enumerate(runs):
        d = n / fs / dit
        first_or_last = k == 0 or k == len(runs) - 1           # cut by the start or the end of the recording
        if on:
            if d > 5:
                if sym:
                    text.append(MORSE.get(sym, "*"))
                    sym = ""
                text.append(f" [CARRIER {n / fs:.1f} s{', cut' if first_or_last else ''}] ")
            elif not first_or_last:
                sym += "." if d < 2 else "-"
        else:
            if d >= 2 and sym:
                text.append(MORSE.get(sym, "*"))
                sym = ""
            if d >= 5 and text and not text[-1].endswith(" "):
                text.append(" ")
    if sym:
        text.append(MORSE.get(sym, "*"))
    return " ".join("".join(text).split()), dit


def edge_times(p, fs, runs, noise_p, rising):
    """10-90 % time (ms) of the mean edge: the power envelope p of all edges with long enough runs on both sides, aligned at the
    threshold crossing and averaged (the noise averages out, its power noise_p is taken off), back to amplitude."""
    half = int(0.02 * fs)
    ws = []
    for k in range(1, len(runs) - 1):
        s, n, on = runs[k]
        if on != rising or runs[k - 1][1] < half or n < half or s < half or s + half > len(p):
            continue
        w = p[s - half:s + half]
        ws.append(w if rising else w[::-1])
    if not ws:
        return float("nan"), 0
    a = np.sqrt(np.maximum(np.mean(ws, axis=0) - noise_p, 0))
    a /= np.median(a[-half // 2:])                             # the flat top after the edge
    try:                                                       # from the 50 % crossing outwards: residual noise far off does not count
        i50 = half // 2 + np.flatnonzero(a[half // 2:] > 0.5)[0]
        i10 = np.flatnonzero(a[:i50] < 0.1)[-1]
        i90 = i50 + np.flatnonzero(a[i50:] > 0.9)[0]
    except IndexError:
        return float("nan"), len(ws)
    return (i90 - i10) / fs * 1e3, len(ws)


def analyse(x, meta, args):
    fs, lo = meta["fs"], meta["lo_hz"]
    expect = args.expect or meta.get("signal_hz")
    ftone, sf, sp = find_tone(x, fs, args.hump, lo, args.band)
    print(f"{len(x) / fs:.1f} s at {fs:.0f} S/s, LO {lo:.0f} Hz: tone at {ftone:+.1f} Hz = {lo + ftone:.1f} Hz RF"
          + (f" ({lo + ftone - expect:+.1f} Hz from {expect:.0f})" if expect else ""))
    y, fs1 = to_baseband(x, fs, ftone, 8000.0)
    yk = lowpass(y, fs1, args.bw)                              # keying, frequency
    ye = lowpass(y, fs1, min(args.edge_bw, 0.45 * fs1))        # edges
    e = np.abs(yk)
    hi, noise = np.percentile(e, 97), np.percentile(e, 5)
    thr, hyst = noise + 0.4 * (hi - noise), 0.1 * (hi - noise)    # below half: short dips (lost receiver samples) do not key
    runs = key_runs(e, thr, hyst)
    on_mask = np.zeros(len(e), bool)
    for s, m, on in runs:
        on_mask[s:s + m] = on
    sig = np.mean(np.abs(yk[on_mask]) ** 2) if on_mask.any() else 0
    nse = np.mean(np.abs(yk[~on_mask]) ** 2) if (~on_mask).any() else 1e-30
    print(f"SNR {10 * np.log10(sig / nse - 1 if sig > nse else 1e-3):.1f} dB in {2 * args.bw:.0f} Hz "
          f"(key down {100 * on_mask.mean():.0f} % of the time); spectrum: tone {sp.max():.1f} dB, median {np.median(sp):.1f} dB")
    text, dit = decode(runs, fs1)
    if np.isfinite(dit):
        print(f"dit {dit * 1e3:.1f} ms = {1.2 / dit:.1f} WPM")
    print(f"decoded: {text}")
    pe = np.abs(ye) ** 2
    noise_p = np.mean(pe[~on_mask]) if (~on_mask).any() else 0.0
    rise, nr = edge_times(pe, fs1, runs, noise_p, True)
    fall, nf = edge_times(pe, fs1, runs, noise_p, False)
    print(f"edges 10-90 %: rise {rise:.2f} ms ({nr} edges), fall {fall:.2f} ms ({nf}); "
          f"a raised-cosine ramp of T ms gives 0.59 T (filter {args.edge_bw:.0f} Hz adds about {0.35e3 / args.edge_bw:.2f} ms)")
    # frequency over time: phase slope over 0.5 s of key-down time
    seg = int(0.5 * fs1)
    tf = []
    for s, m, on in runs:
        if not on or m < seg // 2:
            continue
        for k in range(s + int(0.01 * fs1), s + m - seg // 2, seg):
            z = yk[k:min(k + seg, s + m - int(0.01 * fs1))]
            if len(z) < seg // 2:
                continue
            df = np.angle(np.sum(z[1:] * np.conj(z[:-1]))) * fs1 / (2 * np.pi)
            tf.append((k / fs1, lo + ftone + df))
    tf = np.array(tf)
    if len(tf) >= 2:
        slope = np.polyfit(tf[:, 0], tf[:, 1], 1)[0] * 60
        print(f"frequency: {len(tf)} pieces, mean {tf[:, 1].mean():.1f} Hz, p-p {np.ptp(tf[:, 1]):.1f} Hz, std {tf[:, 1].std():.2f} Hz, "
              f"slope {slope:+.2f} Hz/min" + (f", {tf[:, 1].mean() - expect:+.1f} Hz from {expect:.0f}" if expect else ""))
    if args.plot:
        plot(args.plot, sf, sp, lo, ftone, e, fs1, thr, np.abs(ye), runs, tf, text)
    return {"tone_hz": lo + ftone, "text": text, "dit": dit, "rise_ms": rise, "fall_ms": fall, "freq": tf}


def plot(base, sf, sp, lo, ftone, e, fs1, thr, ee, runs, tf, text):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(4, 1, figsize=(11, 12))
    ax[0].plot(sf / 1e3, sp - sp.max(), lw=0.6)
    ax[0].axvline(ftone / 1e3, color="r", lw=0.5)
    ax[0].set_xlabel(f"kHz from LO {lo / 1e6:.6f} MHz")
    ax[0].set_ylabel("dB")
    ax[0].set_title("spectrum (Welch)", fontsize=9)
    t = np.arange(len(e)) / fs1
    ax[1].plot(t, e, lw=0.5)
    ax[1].axhline(thr, color="r", lw=0.5)
    ax[1].set_xlabel("s")
    ax[1].set_title(f"envelope: {text}", fontsize=9)
    edges = [s for k, (s, n, on) in enumerate(runs[1:-1], 1) if on and runs[k - 1][1] > 0.02 * fs1 and n > 0.02 * fs1]
    if edges:
        s = edges[0]
        w = slice(max(0, s - int(0.02 * fs1)), s + int(0.03 * fs1))
        ax[2].plot((np.arange(len(e))[w] - s) / fs1 * 1e3, ee[w], ".-", lw=0.6, ms=2)
        ax[2].set_xlabel("ms from the key-down edge")
        ax[2].set_title("a rising edge (wide filter)", fontsize=9)
    if len(tf):
        ax[3].plot(tf[:, 0], tf[:, 1] - tf[:, 1].mean(), "o", ms=3)
        ax[3].set_xlabel("s")
        ax[3].set_ylabel(f"Hz from {tf[:, 1].mean():.1f}")
        ax[3].set_title("frequency (0.5 s pieces of key-down time)", fontsize=9)
    for a in ax:
        a.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(base + ".png", dpi=110)
    log("wrote", base + ".png")


def synth(text="VVV DE OK1CDJ", wpm=15, carrier=3.0, rise=0.005, fs=1e6 / 3, tone=-78601.3, drift=2.0, snr_db=25.0, seed=1):
    """A beacon cycle written from the rules of the beacon (PARIS timing, raised-cosine ramp from the key edges), with the
    receiver's hump (strong DC and low-frequency noise), the transmitter's LO leakage 20 kHz below the tone and white noise; SNR in 500 Hz."""
    codes = {v: k for k, v in MORSE.items()}
    unit = 1.2 / wpm
    key = [(False, 7 * unit)]
    for w, word in enumerate(text.split()):
        if w:
            key.append((False, 7 * unit))
        for c, ch in enumerate(word):
            if c:
                key.append((False, 3 * unit))
            for k, s in enumerate(codes[ch]):
                if k:
                    key.append((False, unit))
                key.append((True, (3 if s == "-" else 1) * unit))
    key += [(False, 7 * unit), (True, carrier), (False, 7 * unit)]
    n = int(sum(d for _, d in key) * fs)
    k_arr = np.zeros(n)
    pos = 0
    for on, d in key:
        m = int(round(d * fs))
        k_arr[pos:pos + m] = on
        pos += m
    # envelope: one step per sample towards the key along a raised cosine of rise seconds
    R = int(rise * fs)
    env_idx = np.zeros(n)
    e = 0
    step = np.where(k_arr > 0, 1, -1)
    for i in range(n):                                          # slow in Python, but only ~5 M samples once
        e = min(R, e + 1) if step[i] > 0 else max(0, e - 1)
        env_idx[i] = e
    env = 0.5 * (1 - np.cos(np.pi * env_idx / R))
    t = np.arange(n) / fs
    ph = 2 * np.pi * (tone * t + 0.5 * drift / 60 * t ** 2)
    rng = np.random.default_rng(seed)
    noise_rms = 1.0
    amp = np.sqrt(10 ** (snr_db / 10) * noise_rms ** 2 * 500 / fs)     # SNR in 500 Hz
    x = amp * env * np.exp(1j * ph)
    x += 0.012 * amp * np.exp(2j * np.pi * (tone - 20e3) * t)          # LO leakage of the transmitter, -38 dBc
    x += (rng.standard_normal(n) + 1j * rng.standard_normal(n)) * noise_rms / np.sqrt(2)
    hump = lowpass(rng.standard_normal(n) + 1j * rng.standard_normal(n), fs, 20e3, 101) * 30 * noise_rms
    x += hump + 50 * noise_rms
    return x.astype(np.complex64), {"fs": fs, "lo_hz": 2320.13e6, "signal_hz": 2320.13e6 + tone}


def selftest(args):
    log("synthesising a beacon cycle (VVV DE OK1CDJ, 15 WPM, 3 s carrier, 5 ms ramp, 25 dB in 500 Hz, drift 2 Hz/min) ...")
    x, meta = synth(drift=2.0)
    r = analyse(x, meta, args)
    ok = True
    ok &= r["text"] == "VVV DE OK1CDJ [CARRIER 3.0 s]"
    ok &= abs(r["tone_hz"] - meta["signal_hz"]) < 1.0
    ok &= abs(1.2 / r["dit"] - 15) < 0.5
    ok &= 2.5 < r["rise_ms"] < 3.6 and 2.5 < r["fall_ms"] < 3.6
    print("SELFTEST", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("base", nargs="?", help="recording: BASE.cf32 + BASE.json (tools/rx_record.py)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--hump", type=float, default=30e3, help="ignore +-this many Hz around the LO when looking for the tone")
    ap.add_argument("--band", type=float, nargs=2, metavar=("F1", "F2"), help="look for the tone only in F1..F2 (absolute Hz)")
    ap.add_argument("--bw", type=float, default=250.0, help="low-pass for keying and frequency, Hz (default 250)")
    ap.add_argument("--edge-bw", type=float, default=2000.0, help="low-pass for the edge times, Hz (default 2000)")
    ap.add_argument("--expect", type=float, help="transmitter frequency in Hz (default: signal_hz of the sidecar)")
    ap.add_argument("--plot", metavar="BASE", help="write BASE.png")
    a = ap.parse_args()
    if a.selftest:
        return selftest(a)
    if not a.base:
        ap.error("give a recording or --selftest")
    with open(a.base + ".json") as f:
        meta = json.load(f)
    x = np.fromfile(a.base + ".cf32", np.complex64)
    analyse(x, meta, a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
