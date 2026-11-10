// Node tests of the page's protocol and DSP modules.
//   node web/test/test.mjs [recording.cf32]     (default build/rx/iqs_cw.cf32: the C3 CW beacon recorded by tools/iqs_record.py)
import { readFileSync } from "node:fs";
import { IqsParser, crc32, tuning, pllActual } from "../iqs.js";
import { Spectrum, CwDemod, Demod, Fft, TxChain, TestTones } from "../dsp.js";

let fails = 0;
function check(ok, what) { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) fails++; }

check(crc32(new TextEncoder().encode("123456789")) === 0xcbf43926, "crc32 check value");
const t = tuning(2320.05e6);
check(t.mhz === 2316 && t.fofsKhz === 50 && Math.abs(t.centerHz - 2320049804.6875) < 1e-3, `tuning 2320.05 MHz -> FREQ ${t.mhz} FOFS ${t.fofsKhz}, centre ${t.centerHz}`);
check(Math.abs(pllActual(2320029602) - 2320029602) < 458, "pllActual within one step");

// FFT: a bin-centred tone lands in its bin
{
  const n = 256, f = new Fft(n), re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { re[i] = Math.cos(2 * Math.PI * 10 * i / n); im[i] = Math.sin(2 * Math.PI * 10 * i / n); }
  f.run(re, im);
  check(Math.abs(re[10] - n) < 1e-9 && Math.abs(re[11]) < 1e-9, "FFT bin 10");
}

// the recording, back into IQS frames (int16, un-conjugated as the S3 sends them)
const file = process.argv[2] || new URL("../../build/rx/iqs_cw.cf32", import.meta.url).pathname;
const x = new Float32Array(readFileSync(file).buffer.slice(0));
const nSamp = x.length / 2, fs = 62500;
function frame(seq, index, n) {
  const u = new Uint8Array(24 + 4 * n + 4), dv = new DataView(u.buffer);
  u.set([0x49, 0x51, 0x53, 0x31]);
  dv.setUint32(4, seq, true); dv.setBigUint64(8, BigInt(index), true); dv.setUint16(16, n, true);
  u[18] = 16; u[19] = 0; dv.setUint16(20, 256, true); u[22] = 0; u[23] = 0;
  for (let k = 0; k < n; k++) {
    dv.setInt16(24 + 4 * k, Math.round(x[2 * (index + k)]), true);
    dv.setInt16(26 + 4 * k, Math.round(-x[2 * (index + k) + 1]), true);
  }
  dv.setUint32(24 + 4 * n, crc32(u, 0, 24 + 4 * n), true);
  return u;
}
const parts = [new TextEncoder().encode("OK\r\nIQS 16000000 256 16 0 2 2316\n")];
let seq = 0;
for (let i = 0; i + 256 <= nSamp; i += 256, seq++) {
  if (seq === 100) continue;                                  // a lost frame: a gap of 256 samples
  const f = frame(seq, i, 256);
  if (seq === 200) f[30] ^= 1;                                // a damaged frame: CRC
  parts.push(f);
}
parts.push(new TextEncoder().encode("IQSEND 0 0 1 2 3 6 0 9 0 0 0 0 0 0\n"));
const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }

const lines = [];
const got = new Float32Array(nSamp * 2);
let gotN = 0;
const spectra = [];
const spec = new Spectrum(4096, 4, 32768, (db) => spectra.push(db));
const demod = new CwDemod(fs, 500, 700);
let lastLevel = 0;
const audio = [];
const parser = new IqsParser((l) => lines.push(l), (iq, index) => {
  got.set(iq, 2 * index); gotN += iq.length / 2;
  spec.push(iq);
  for (const a of demod.process(iq)) audio.push(a);
});
let rnd = 12345;
for (let p = 0; p < all.length;) {                            // chunks of random size, as USB delivers them
  rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
  const n = 1 + (rnd % 5000);
  parser.push(all.subarray(p, p + n));
  p += n;
}
const s = parser.stats;
check(lines.length === 3 && lines[0] === "OK" && lines[1].startsWith("IQS ") && lines.at(-1).startsWith("IQSEND"), `text lines: ${lines.join(" | ")}`);
check(s.crcBad === 1 && s.gaps === 2 && s.gapSamples === 512, `damaged and lost frames counted (crcBad ${s.crcBad}, gaps ${s.gaps}, gapSamples ${s.gapSamples})`);
let maxErr = 0;
for (let i = 0; i < 2 * 256 * 90; i++) maxErr = Math.max(maxErr, Math.abs(got[i] - Math.round(x[i])));
check(maxErr === 0, "samples come out as recorded (conjugated back)");

// spectrum: the beacon at +195.3 Hz from the centre (its 2320.050 MHz against the centre 2320049804.7)
const last = spectra.at(-1), bin = fs / 4096;
let pk = 0; for (let i = 0; i < last.length; i++) if (last[i] > last[pk]) pk = i;
const fpk = (pk - 2048) * bin;
check(Math.abs(fpk - 195.3) < bin, `spectrum peak at ${fpk.toFixed(1)} Hz (bin ${bin.toFixed(1)} Hz), ${last[pk].toFixed(1)} dBFS`);

// demodulator, tuned to the beacon: a 700 Hz tone keyed on and off
const demod2 = new CwDemod(fs, 500, 700);
demod2.setOffset(195.3);
const a2 = [];
for (let i = 0; i + 4096 <= nSamp; i += 4096) for (const v of demod2.process(x.subarray(2 * i, 2 * i + 8192))) a2.push(v);
check(Math.abs(demod2.audioRate - 7812.5) < 1e-9, `audio rate ${demod2.audioRate}`);
const ar = demod2.audioRate, na = 4096, fa = new Fft(na);
// the audio tone during the long carrier: the loudest 0.5 s
let best = 0, bestAt = 0;
for (let i = 2 * 7813; i + na < a2.length; i += 512) { let e = 0; for (let k = 0; k < na; k++) e += a2[i + k] ** 2; if (e > best) { best = e; bestAt = i; } }
const re = new Float64Array(na), im = new Float64Array(na);
for (let k = 0; k < na; k++) re[k] = a2[bestAt + k];
fa.run(re, im);
let ap = 1; for (let i = 1; i < na / 2; i++) if (re[i] ** 2 + im[i] ** 2 > re[ap] ** 2 + im[ap] ** 2) ap = i;
check(Math.abs(ap * ar / na - 700) < 3, `audio tone at ${(ap * ar / na).toFixed(1)} Hz`);
const rms = (a, b) => Math.sqrt(a2.slice(a, b).reduce((s2, v) => s2 + v * v, 0) / (b - a));
const env = []; for (let i = 0; i + 400 < a2.length; i += 400) env.push(rms(i, i + 400));
const loud = env.filter((v) => v > 0.1).length / env.length;
check(Math.max(...env) < 0.35 && Math.max(...env) > 0.15 && Math.min(...env) < 0.02 && loud > 0.4 && loud < 0.9, `keyed audio: max ${Math.max(...env).toFixed(2)}, min ${Math.min(...env).toFixed(3)}, on ${(100 * loud).toFixed(0)} %`);
// a station 2 kHz away is out of the 500 Hz filter
const demod3 = new CwDemod(fs, 500, 700); demod3.setOffset(195.3 + 2000);
let e3 = 0, n3 = 0; demod3.gain = 1; demod3.process = demod3.process.bind(demod3);
for (let i = 0; i + 4096 <= nSamp; i += 4096) for (const v of demod3.process(x.subarray(2 * i, 2 * i + 8192))) { e3 = Math.max(e3, demod3.level); n3++; }
check(e3 < 0.05 * demod2.level, `2 kHz off: level ${(e3 / demod2.level).toExponential(1)} of the tuned one`);

// USB: a tone 1 kHz above the dial frequency comes out at 1 kHz; one 1 kHz below (the lower sideband) is rejected
{
  const fs = 62500, dial = 5000, n = fs * 2;
  const tone = (f, a) => { const x = new Float32Array(2 * n); for (let k = 0; k < n; k++) { x[2 * k] = a * Math.cos(2 * Math.PI * f * k / fs); x[2 * k + 1] = a * Math.sin(2 * Math.PI * f * k / fs); } return x; };
  // level: the filter output's peak, reset after the first second so that the filters' start-up transient does not count
  const run = (x) => { const d = new Demod(fs, { mode: "usb" }); d.setOffset(dial); d.warm = 0; const a = []; for (let i = 0; i < n; i += 4096) { if (i >= n / 2 && i < n / 2 + 4096) d.peak = 0; for (const v of d.process(x.subarray(2 * i, Math.min(2 * n, 2 * i + 8192)))) a.push(v); } return { a, d }; };
  const up = run(tone(dial + 1000, 1000)), down = run(tone(dial - 1000, 1000));
  const na = 4096, f = new Fft(na), re = new Float64Array(na), im = new Float64Array(na);
  for (let k = 0; k < na; k++) re[k] = up.a[up.a.length - na + k];
  f.run(re, im);
  let ap = 1; for (let i = 1; i < na / 2; i++) if (re[i] ** 2 + im[i] ** 2 > re[ap] ** 2 + im[ap] ** 2) ap = i;
  const audioHz = ap * up.d.audioRate / na;
  check(Math.abs(audioHz - 1000) < 3, `USB: tone 1 kHz above the dial heard at ${audioHz.toFixed(1)} Hz`);
  const rej = 20 * Math.log10(up.d.level / down.d.level);
  check(rej > 40, `USB: lower sideband rejected by ${rej.toFixed(1)} dB`);
  const edge = run(tone(dial + 150, 1000)), mid = run(tone(dial + 1500, 1000));
  check(20 * Math.log10(mid.d.level / edge.d.level) > 6, `USB: 150 Hz (below the 300 Hz edge) ${(20 * Math.log10(mid.d.level / edge.d.level)).toFixed(1)} dB down`);
}

// TX chain: a real 1 kHz tone at 50 kHz becomes an analytic USB signal: +1 kHz, nothing at -1 kHz, 150 Hz (below 300) gone
{
  const fs = 50000, n = fs * 2;
  const spectrumOf = (iq) => {
    const na = 1 << 15, start = iq.length / 2 - na, re = new Float64Array(na), im = new Float64Array(na), f = new Fft(na);
    for (let k = 0; k < na; k++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * k / (na - 1)); re[k] = iq[2 * (start + k)] * w; im[k] = iq[2 * (start + k) + 1] * w; }
    f.run(re, im);
    return (hz) => { const b = Math.round(hz / fs * na); const i = (b + na) % na; let m = 0; for (let d = -2; d <= 2; d++) { const j = (i + d + na) % na; m = Math.max(m, Math.hypot(re[j], im[j])); } return 20 * Math.log10(m + 1e-12); };
  };
  const run = (f0, a) => { const x = new Float32Array(n); for (let k = 0; k < n; k++) x[k] = a * Math.sin(2 * Math.PI * f0 * k / fs); const t = new TxChain(fs); const parts = []; for (let i = 0; i < n; i += 4000) parts.push(t.process(x.subarray(i, i + 4000))); const out = new Float32Array(parts.reduce((s2, p) => s2 + p.length, 0)); let o2 = 0; for (const p of parts) { out.set(p, o2); o2 += p.length; } return out; };
  const y = run(1000, 0.3), S = spectrumOf(y);
  check(S(1000) - S(-1000) > 50, `TX: USB tone +1 kHz, -1 kHz ${(S(-1000) - S(1000)).toFixed(1)} dB`);
  let pk = 0; for (let k = 0; k < y.length; k += 2) pk = Math.max(pk, Math.hypot(y[k], y[k + 1]));
  check(pk > 0.85 && pk <= 0.95, `TX: AGC brings a -10 dB tone to a peak of ${pk.toFixed(2)}`);
  const lowTone = spectrumOf(run(150, 0.3)), mid = spectrumOf(run(1500, 0.3));
  check(mid(1500) - lowTone(150) > 30, `TX: 150 Hz ${(lowTone(150) - mid(1500)).toFixed(1)} dB against 1.5 kHz`);
  check(S(1000) - Math.max(S(1000 + 10000), S(1000 - 10000), S(11000)) > 50, `TX: images of the 10 kHz stage ${(Math.max(S(11000), S(-9000)) - S(1000)).toFixed(1)} dB`);
  const tt = new TestTones(fs, [700, 1900]).next(fs);
  let mx = 0; for (let k = 0; k < tt.length; k += 2) mx = Math.max(mx, Math.hypot(tt[k], tt[k + 1]));
  check(Math.abs(mx - 0.9) < 0.01, `two tones: peak envelope ${mx.toFixed(3)}`);
}

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
