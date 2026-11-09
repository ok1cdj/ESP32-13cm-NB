// Node tests of the page's protocol and DSP modules.
//   node web/test/test.mjs [recording.cf32]     (default build/rx/iqs_cw.cf32: the C3 CW beacon recorded by tools/iqs_record.py)
import { readFileSync } from "node:fs";
import { IqsParser, crc32, tuning, pllActual } from "../iqs.js";
import { Spectrum, CwDemod, Fft } from "../dsp.js";

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

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
