// DSP for the narrowband receiver page: FFT spectrum and a CW demodulator. No DOM here: also used by Node tests.

/** In-place radix-2 complex FFT of size n (power of two). */
export class Fft {
  constructor(n) {
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) { this.cos[k] = Math.cos(-2 * Math.PI * k / n); this.sin[k] = Math.sin(-2 * Math.PI * k / n); }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
  }

  run(re, im) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step], wi = this.sin[k * step];
          const a = s + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

export function blackman(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (n - 1));
  return w;
}

/**
 * Averaged power spectrum: push interleaved I, Q; every `avg` FFTs of size n calls onSpectrum(dB array, -fs/2 .. +fs/2).
 * dB is relative to a full-scale sine of amplitude `fullScale` in one bin (0 dB).
 */
export class Spectrum {
  constructor(n, avg, fullScale, onSpectrum) {
    this.n = n; this.avg = avg; this.onSpectrum = onSpectrum;
    this.fft = new Fft(n);
    this.win = blackman(n);
    const wsum = this.win.reduce((a, b) => a + b, 0);
    this.ref = (fullScale * wsum) ** 2;
    this.re = new Float64Array(n); this.im = new Float64Array(n);
    this.acc = new Float64Array(n);
    this.fill = 0; this.count = 0;
    this.iq = new Float32Array(2 * n);
  }

  push(iq) {
    for (let k = 0; k < iq.length; k += 2) {
      this.iq[2 * this.fill] = iq[k]; this.iq[2 * this.fill + 1] = iq[k + 1];
      if (++this.fill === this.n) { this.fill = 0; this._one(); }
    }
  }

  _one() {
    const n = this.n;
    for (let i = 0; i < n; i++) { this.re[i] = this.iq[2 * i] * this.win[i]; this.im[i] = this.iq[2 * i + 1] * this.win[i]; }
    this.fft.run(this.re, this.im);
    for (let i = 0; i < n; i++) this.acc[i] += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    if (++this.count < this.avg) return;
    const db = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + n / 2) % n;                            // fftshift
      db[i] = 10 * Math.log10(this.acc[j] / this.count / this.ref + 1e-20);
      this.acc[j] = 0;
    }
    this.count = 0;
    this.onSpectrum(db);
  }
}

/** Windowed-sinc low pass, unit gain at DC. */
export function lowpass(taps, cutoff, fs) {
  const h = new Float64Array(taps), m = (taps - 1) / 2, w = blackman(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - m;
    h[i] = (x === 0 ? 2 * cutoff / fs : Math.sin(2 * Math.PI * cutoff / fs * x) / (Math.PI * x)) * w[i];
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}

/** Complex FIR with decimation; history kept across calls. */
class Decimator {
  constructor(h, d) {
    this.h = h; this.d = d;
    this.n = h.length;
    this.hr = new Float64Array(2 * this.n); this.hi = new Float64Array(2 * this.n);   // doubled history: no wrap in the dot product
    this.pos = 0; this.phase = 0;
  }

  /** re, im: input arrays; returns [outRe, outIm]. */
  run(re, im) {
    const n = this.n, h = this.h, outR = [], outI = [];
    for (let k = 0; k < re.length; k++) {
      this.pos = this.pos === 0 ? n - 1 : this.pos - 1;
      this.hr[this.pos] = this.hr[this.pos + n] = re[k];
      this.hi[this.pos] = this.hi[this.pos + n] = im[k];
      if (++this.phase < this.d) continue;
      this.phase = 0;
      let sr = 0, si = 0;
      for (let t = 0, p = this.pos; t < n; t++, p++) { sr += h[t] * this.hr[p]; si += h[t] * this.hi[p]; }
      outR.push(sr); outI.push(si);
    }
    return [outR, outI];
  }
}

/**
 * CW / USB receiver. The dial frequency (offset Hz from the centre) is mixed to 0 Hz and decimated to about 7.8 kHz (stage 1,
 * 3.3 kHz low pass, so the USB passband fits); stage 2 is a complex band pass made of a shift by -fc, a low pass of +-half and a
 * shift back, so the other sideband is rejected; the output is the real part, shifted by fc (and by the BFO pitch in CW), with a
 * slow AGC. audioRate = fs / round(fs / 7812.5) (exactly 7812.5 Hz for the IQS rates).
 *   CW:  pass +-bw/2 around the dial frequency, heard at the pitch (the signal at the dial frequency gives the pitch)
 *   USB: pass dial + lo .. dial + hi (default 300 .. 2700 Hz); the dial frequency is the suppressed carrier
 */
export class Demod {
  constructor(fs, { mode = "cw", bw = 500, pitch = 700, lo = 300, hi = 2700 } = {}) {
    this.fs = fs;
    this.d = Math.max(1, Math.round(fs / 7812.5));
    this.audioRate = fs / this.d;
    this.pitch = pitch;
    this.offset = 0;
    this.ph = 0; this.ph2 = 0; this.ph3 = 0;
    const t1 = Math.min(1023, 2 * Math.round(3.3 * fs / 600 / 2) + 1);
    this.st1 = new Decimator(lowpass(t1, 3300, fs), this.d);
    this.setMode(mode, { bw, lo, hi });
    this.gain = 0; this.peak = 0;
    this.warm = Math.round(0.2 * this.audioRate);          // muted while the filters and the AGC settle
  }

  setMode(mode, { bw = this.bw ?? 500, lo = this.lo ?? 300, hi = this.hi ?? 2700 } = {}) {
    this.mode = mode; this.bw = bw; this.lo = lo; this.hi = hi;
    this.fc = mode === "usb" ? (lo + hi) / 2 : 0;
    const half = mode === "usb" ? (hi - lo) / 2 : bw / 2;
    const transition = mode === "usb" ? 150 : Math.max(50, Math.min(half, 600));        // Hz: USB edges steep enough for 300 Hz
    const taps = 2 * Math.round(3.3 * this.audioRate / transition / 2) + 1;
    this.st2 = new Decimator(lowpass(Math.min(511, taps), half, this.audioRate), 1);
  }

  setBandwidth(bw) { this.setMode(this.mode, { bw }); }

  setOffset(hz) { this.offset = hz; }

  /** The passband in Hz relative to the dial frequency: [from, to]. */
  passband() { return this.mode === "usb" ? [this.lo, this.hi] : [-this.bw / 2, this.bw / 2]; }

  /** iq: interleaved I, Q; returns a Float32Array of audio samples (about +-0.3). */
  process(iq) {
    const n = iq.length / 2, re = new Float64Array(n), im = new Float64Array(n);
    const w = -2 * Math.PI * this.offset / this.fs;
    for (let k = 0; k < n; k++) {
      const c = Math.cos(this.ph), s = Math.sin(this.ph);
      re[k] = iq[2 * k] * c - iq[2 * k + 1] * s;
      im[k] = iq[2 * k] * s + iq[2 * k + 1] * c;
      this.ph += w;
    }
    this.ph %= 2 * Math.PI;
    const [r1, i1] = this.st1.run(re, im);
    // the band pass: down by fc, low pass, back up by fc (+ the CW pitch)
    const m = r1.length, sr = new Float64Array(m), si = new Float64Array(m), w2 = -2 * Math.PI * this.fc / this.audioRate;
    for (let k = 0; k < m; k++) {
      const c = Math.cos(this.ph2), s = Math.sin(this.ph2);
      sr[k] = r1[k] * c - i1[k] * s;
      si[k] = r1[k] * s + i1[k] * c;
      this.ph2 += w2;
    }
    this.ph2 %= 2 * Math.PI;
    const [r2, i2] = this.st2.run(sr, si);
    const out = new Float32Array(r2.length);
    const w3 = 2 * Math.PI * (this.fc + (this.mode === "cw" ? this.pitch : 0)) / this.audioRate;
    for (let k = 0; k < r2.length; k++) {
      const a = r2[k] * Math.cos(this.ph3) - i2[k] * Math.sin(this.ph3);
      this.ph3 += w3;
      const mag = Math.hypot(r2[k], i2[k]);
      // AGC: fast attack, slow release (about 1 s)
      this.peak = mag > this.peak ? mag : this.peak * (1 - 1 / this.audioRate);
      const target = this.peak > 0 ? 0.3 / this.peak : this.gain;
      if (!this.gain) this.gain = target;                     // the first level at once
      else this.gain += (target - this.gain) * (target < this.gain ? 0.5 : 1 / this.audioRate);
      if (this.warm > 0) { this.warm--; out[k] = 0; continue; }
      out[k] = Math.max(-1, Math.min(1, a * this.gain));
    }
    this.ph3 %= 2 * Math.PI;
    this.level = this.peak;
    return out;
  }
}

/** The CW receiver of the first version: Demod in CW mode. */
export class CwDemod extends Demod {
  constructor(fs, bw = 500, pitch = 700) { super(fs, { mode: "cw", bw, pitch }); }
}

/** Complex FIR interpolator by an integer factor (polyphase), gain L so that the passband level is kept. */
class Interpolator {
  constructor(h, L) {
    this.L = L;
    this.k = Math.ceil(h.length / L);
    this.ph = [];                                             // phase p: h[p], h[p + L], ...
    for (let p = 0; p < L; p++) {
      const c = new Float64Array(this.k);
      for (let i = 0; i < this.k; i++) c[i] = (h[p + i * L] || 0) * L;
      this.ph.push(c);
    }
    this.hr = new Float64Array(2 * this.k); this.hi = new Float64Array(2 * this.k);
    this.pos = 0;
  }

  run(re, im, outR, outI, off) {
    const k = this.k;
    let o = off;
    for (let n = 0; n < re.length; n++) {
      this.pos = this.pos === 0 ? k - 1 : this.pos - 1;
      this.hr[this.pos] = this.hr[this.pos + k] = re[n];
      this.hi[this.pos] = this.hi[this.pos + k] = im[n];
      for (let p = 0; p < this.L; p++, o++) {
        const c = this.ph[p];
        let sr = 0, si = 0;
        for (let i = 0, q = this.pos; i < k; i++, q++) { sr += c[i] * this.hr[q]; si += c[i] * this.hi[q]; }
        outR[o] = sr; outI[o] = si;
      }
    }
    return o;
  }
}

/**
 * USB transmit chain: real audio at fs (50 kHz, the C3's SSB rate) -> analytic USB signal at fs, interleaved I, Q in -1 .. 1.
 * Decimation by 5 to 10 kHz (3.5 kHz low pass), a complex band pass lo .. hi (shift by -fc, low pass, shift back: only the
 * positive frequencies remain, which is the USB analytic signal), an AGC on the magnitude (instant attack, release about 0.3 s:
 * it brings the peak to `peak`, raising by at most maxGainDb so that the noise of the pauses stays down), interpolation by 5 back
 * to fs (3 kHz low pass). gainDb: before the AGC; maxGainDb 0 makes it a plain limiter.
 */
export class TxChain {
  constructor(fs = 50000, { lo = 300, hi = 2700, peak = 0.9, gainDb = 0, maxGainDb = 20 } = {}) {
    this.fs = fs; this.M = 5; this.fs2 = fs / this.M;
    this.lo = lo; this.hi = hi; this.peak = peak; this.gain = 10 ** (gainDb / 20); this.maxGain = 10 ** (maxGainDb / 20);
    this.dec = new Decimator(lowpass(2 * Math.round(3.3 * fs / 1500 / 2) + 1, 3500, fs), this.M);
    this.fc = (lo + hi) / 2;
    this.bp = new Decimator(lowpass(2 * Math.round(3.3 * this.fs2 / 150 / 2) + 1, (hi - lo) / 2, this.fs2), 1);
    this.up = new Interpolator(lowpass(2 * Math.round(3.3 * fs / 2000 / 2) + 1, 3000, fs), this.M);
    this.ph1 = 0; this.ph2 = 0;
    this.env = 0;                                             // the limiter's envelope
  }

  setGainDb(db) { this.gain = 10 ** (db / 20); }

  /** audio: Float32Array at fs; returns a Float32Array of interleaved I, Q at fs (length 2 * floor-ish(audio.length)). */
  process(audio) {
    const n = audio.length, zero = new Float64Array(n), a = new Float64Array(n);
    for (let k = 0; k < n; k++) a[k] = audio[k];
    const [r1, i1] = this.dec.run(a, zero);
    const m = r1.length, sr = new Float64Array(m), si = new Float64Array(m);
    const w = 2 * Math.PI * this.fc / this.fs2;
    for (let k = 0; k < m; k++) {                             // down by fc
      const c = Math.cos(this.ph1), s = Math.sin(this.ph1);
      sr[k] = r1[k] * c + i1[k] * s; si[k] = i1[k] * c - r1[k] * s;
      this.ph1 += w;
    }
    this.ph1 %= 2 * Math.PI;
    const [r2, i2] = this.bp.run(sr, si);
    const ur = new Float64Array(m), ui = new Float64Array(m);
    for (let k = 0; k < m; k++) {                             // back up by fc, x2 (the analytic signal of a real input), limiter
      const c = Math.cos(this.ph2), s = Math.sin(this.ph2);
      let re = 2 * this.gain * (r2[k] * c - i2[k] * s), im = 2 * this.gain * (r2[k] * s + i2[k] * c);
      this.ph2 += w;
      const mag = Math.hypot(re, im);
      this.env = mag > this.env ? mag : this.env * (1 - 1 / (0.3 * this.fs2));     // release about 0.3 s
      const g = Math.min(this.maxGain, this.peak / Math.max(this.env, 1e-9));
      re *= g; im *= g;
      ur[k] = re; ui[k] = im;
    }
    this.ph2 %= 2 * Math.PI;
    const outR = new Float64Array(m * this.M), outI = new Float64Array(m * this.M);
    const len = this.up.run(ur, ui, outR, outI, 0);
    const out = new Float32Array(2 * len);
    for (let k = 0; k < len; k++) { out[2 * k] = Math.max(-1, Math.min(1, outR[k])); out[2 * k + 1] = Math.max(-1, Math.min(1, outI[k])); }
    return out;
  }
}

/** Analytic test signals at fs: one tone (level 0.9) or two (0.45 each), continuous across calls. */
export class TestTones {
  constructor(fs, freqs) {
    this.fs = fs; this.freqs = freqs; this.ph = freqs.map(() => 0);
    this.level = freqs.length > 1 ? 0.45 : 0.9;
  }

  next(n) {
    const out = new Float32Array(2 * n);
    for (let j = 0; j < this.freqs.length; j++) {
      const w = 2 * Math.PI * this.freqs[j] / this.fs;
      let ph = this.ph[j];
      for (let k = 0; k < n; k++) { out[2 * k] += this.level * Math.cos(ph); out[2 * k + 1] += this.level * Math.sin(ph); ph += w; }
      this.ph[j] = ph % (2 * Math.PI);
    }
    return out;
  }
}

