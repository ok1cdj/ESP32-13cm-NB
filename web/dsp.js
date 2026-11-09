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
 * CW receiver: the signal at `offset` Hz from the centre is mixed to 0 Hz, decimated to about 7.8 kHz (stage 1, 3 kHz low pass),
 * filtered to +-bw/2 (stage 2, complex, so the other sideband is rejected), shifted up by the BFO pitch and turned into real audio
 * with a slow AGC. audioRate = fs / round(fs / 7812.5) (exactly 7812.5 Hz for the IQS rates).
 */
export class CwDemod {
  constructor(fs, bw = 500, pitch = 700) {
    this.fs = fs;
    this.d = Math.max(1, Math.round(fs / 7812.5));
    this.audioRate = fs / this.d;
    this.pitch = pitch;
    this.offset = 0;
    this.ph = 0; this.bfoPh = 0;
    const t1 = Math.min(1023, 2 * Math.round(3.3 * fs / 1500 / 2) + 1);
    this.st1 = new Decimator(lowpass(t1, 2500, fs), this.d);
    this.setBandwidth(bw);
    this.gain = 0; this.peak = 0;
    this.warm = Math.round(0.2 * this.audioRate);          // muted while the filters and the AGC settle
  }

  setBandwidth(bw) {
    this.bw = bw;
    const taps = 2 * Math.round(3.3 * this.audioRate / Math.max(50, bw / 2) / 2) + 1;
    this.st2 = new Decimator(lowpass(Math.min(511, taps), bw / 2, this.audioRate), 1);
  }

  setOffset(hz) { this.offset = hz; }

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
    const [r2, i2] = this.st2.run(r1, i1);
    const out = new Float32Array(r2.length), wb = 2 * Math.PI * this.pitch / this.audioRate;
    for (let k = 0; k < r2.length; k++) {
      const a = r2[k] * Math.cos(this.bfoPh) - i2[k] * Math.sin(this.bfoPh);
      this.bfoPh += wb;
      const mag = Math.hypot(r2[k], i2[k]);
      // AGC: fast attack, slow release (about 1 s)
      this.peak = mag > this.peak ? mag : this.peak * (1 - 1 / this.audioRate);
      const target = this.peak > 0 ? 0.3 / this.peak : this.gain;
      if (!this.gain) this.gain = target;                     // the first level at once
      else this.gain += (target - this.gain) * (target < this.gain ? 0.5 : 1 / this.audioRate);
      if (this.warm > 0) { this.warm--; out[k] = 0; continue; }
      out[k] = Math.max(-1, Math.min(1, a * this.gain));
    }
    this.bfoPh %= 2 * Math.PI;
    this.level = this.peak;
    return out;
  }
}
