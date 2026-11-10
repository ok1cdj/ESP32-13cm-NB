// The page: S3 receiver (spectrum, waterfall, CW audio) and C3 beacon control, through tools/web_bridge.py or Web Serial.
import { S3Radio, WsPort, pllActual } from "./iqs.js";
import { Spectrum, Demod, TxChain, TestTones } from "./dsp.js";

const $ = (id) => document.getElementById(id);
const ESPRESSIF = { usbVendorId: 0x303a };
const FFT_N = 4096;

// Served by tools/web_bridge.py: the boards come through its WebSocket (any browser, no port chooser);
// served by a plain web server: Web Serial with the browser's port chooser.
let bridge = null;
// ?webserial: Web Serial even when the bridge serves the page
const bridgeReady = (new URLSearchParams(location.search).has("webserial") ? Promise.resolve(null)
  : fetch("bridge.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null))
  .then((b) => { bridge = b; if (b) log(`bridge: S3 ${b.ports.s3}, C3 ${b.ports.c3}`, "ok"); return b; });

async function pickPort(which) {
  await bridgeReady;
  if (bridge) return new WsPort(`ws://${location.host}${bridge[which]}`);
  return navigator.serial.requestPort({ filters: [ESPRESSIF] });
}

const st = {
  s3: null, c3: null,
  fs: 0, centerHz: 0,                       // of the running stream
  listenHz: 2320.05e6,
  spec: null, demod: null,
  audio: null, node: null,
  lastSpec: null, peakDb: -60, floorDb: -120,
  t0: 0, samples: 0,
};

function log(msg, cls = "") {
  const d = document.createElement("div");
  d.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  if (cls) d.className = cls;
  $("log").prepend(d);
  while ($("log").childElementCount > 200) $("log").lastChild.remove();
}

/* ------------------------------------------------------------ S3 */

function disconnectedS3() {
  st.s3 = null;
  $("s3conn").textContent = "Connect S3"; $("s3info").textContent = "not connected"; $("s3info").className = "stat";
  $("start").disabled = $("stop").disabled = true;
}

/** Opens the S3 on port and checks INFO; throws (with the port closed again) when it is something else. */
async function connectS3(port) {
  if (st.c3 && port === st.c3.port) throw new Error("this port is the C3's: pick the other one");
  const r = new S3Radio(onSamples, (l) => { if (!l.startsWith("I (")) log("S3: " + l); });
  try {
    await r.open(port);
    let info = "";
    for (let i = 0; i < 3 && !info; i++) info = await r.cmd("INFO", (l) => /^(S3SDR|ESP32DATV|ERR)/.test(l)).catch(() => "");
    if (!info.startsWith("S3SDR")) throw new Error(info ? `not an S3 with ESP-SDR (${info}): pick the other port` : "the S3 does not answer INFO");
    st.s3 = r;
    $("s3info").textContent = info; $("s3info").className = "stat ok";
    $("s3conn").textContent = "Disconnect S3";
    $("start").disabled = false;
  } catch (e) {
    await r.close();
    throw e;
  }
}

$("s3conn").onclick = async () => {
  if (st.s3) { await st.s3.close().catch(() => {}); disconnectedS3(); return; }
  try { await connectS3(await pickPort("s3")); } catch (e) { log("S3: " + e.message, "err"); }
};

// a board that resets or is unplugged: drop it, so that "Connect" starts afresh
navigator.serial?.addEventListener("disconnect", (e) => {
  if (st.s3 && e.target === st.s3.port) { log("S3 gone (reset or USB)", "err"); disconnectedS3(); }
  if (st.c3 && e.target === st.c3.port) { log("C3 gone (reset or USB)", "err"); disconnectedC3(); }
});

// The gain can only be set between runs: a running stream is stopped and started again with it (a short dropout).
async function applyGain() {
  $("gain").disabled = $("gainmode").value !== "man";
  if (!st.s3?.streaming || st.calRunning) return;
  await $("start").onclick();
  log(`gain ${$("gainmode").value === "man" ? "manual " + $("gain").value : "AGC"} (stream restarted)`);
}
$("gainmode").onchange = applyGain;
$("gain").onchange = applyGain;

// A new centre on a running stream. The in-stream retune of the firmware ("T <MHz> <kHz>", ~9 ms gap) is not used: on the
// bench (ESP-SDR 4128c24, 2026-11-10) it reported a retune (IQSEND) but a line stayed at the same IF after a kHz-only change,
// so the LO had not moved and the page's frequencies were wrong. The stream is restarted instead (well under a second).
const RETUNE_IN_STREAM = false;
async function applyCenter() {
  if (!st.s3?.streaming || st.calRunning) return;
  if (!RETUNE_IN_STREAM || $("rate").value !== st.rateKey) { await $("start").onclick(); return; }
  try {
    st.centerHz = await st.s3.retune(Number($("center").value) * 1e6);
    setListen(st.listenHz);
    log(`centre ${(st.centerHz / 1e6).toFixed(6)} MHz (retuned in the stream)`);
  } catch (e) { log("retune: " + e.message, "err"); }
}
$("center").onchange = applyCenter;
$("rate").onchange = () => { if (st.s3?.streaming && !st.calRunning) $("start").onclick(); };

$("start").onclick = async () => {
  const [decim, bits] = $("rate").value.split(",").map(Number);
  const gain = $("gainmode").value === "man" ? Number($("gain").value) : null;
  try {
    if (st.s3.streaming) await st.s3.stop();
    const r = await st.s3.start(Number($("center").value) * 1e6, decim, bits, gain);
    st.fs = r.fs; st.centerHz = r.centerHz; st.rateKey = $("rate").value; st.s3.retunes = 0;
    st.spec = new Spectrum(FFT_N, Math.max(1, Math.round(st.fs / FFT_N / 15)), bits === 16 ? 32768 : 128, drawSpectrum);
    st.demod = newDemod();
    setListen(st.listenHz);
    st.t0 = performance.now(); st.samples = 0;
    $("stop").disabled = false;
    log(`stream ${(st.fs / 1e3).toFixed(3)} kS/s, ${bits} bit, centre ${(st.centerHz / 1e6).toFixed(6)} MHz (PLL)`, "ok");
  } catch (e) { log("start: " + e.message, "err"); }
};

$("stop").onclick = async () => {
  try { const r = await st.s3.stop(); log(r); } catch (e) { log("stop: " + e.message, "err"); }
  $("stop").disabled = true;
};

function onSamples(iq) {
  st.samples += iq.length / 2;
  if (st.cal) calSamples(iq);
  st.spec?.push(iq);
  if (st.node && st.demod) {
    const a = st.demod.process(iq);
    st.audioSamples += a.length;
    if (a.length) st.node.port.postMessage(a, [a.buffer]);
  }
}

/* ------------------------------------------------------------ tuning */

function setListen(hz) {
  st.listenHz = hz;
  $("listen").value = (hz / 1e6).toFixed(6);
  $("lfreq").textContent = (hz / 1e6).toFixed(6);
  if (st.demod) st.demod.setOffset(hz - st.centerHz);
}
$("listen").onchange = () => setListen(Number($("listen").value) * 1e6);
// Receive mode and filter. CW: +-width/2 around the listen frequency, heard at the pitch. USB: the listen frequency is the
// suppressed carrier, the filter passes lo .. hi above it.
const FILTERS = {
  cw: [["250", "250 Hz"], ["500", "500 Hz"], ["1000", "1 kHz"]],
  usb: [["300-2400", "2.1 kHz (300–2400)"], ["300-2700", "2.4 kHz (300–2700)"], ["200-3000", "2.8 kHz (200–3000)"]],
};
const FILTER_DEFAULT = { cw: "500", usb: "300-2700" };
function demodOptions() {
  const mode = $("mode").value, f = $("bw").value;
  if (mode === "usb") { const [lo, hi] = f.split("-").map(Number); return { mode, lo, hi, pitch: Number($("pitch").value) }; }
  return { mode, bw: Number(f), pitch: Number($("pitch").value) };
}
function newDemod() { return new Demod(st.fs, demodOptions()); }
function fillFilters() {
  const mode = $("mode").value;
  $("bw").innerHTML = FILTERS[mode].map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  $("bw").value = FILTER_DEFAULT[mode];
  $("pitchl").style.display = mode === "cw" ? "" : "none";
}
fillFilters();
$("mode").onchange = () => { fillFilters(); if (st.demod) { const o = demodOptions(); st.demod.setMode(o.mode, o); } };
$("bw").onchange = () => { if (st.demod) { const o = demodOptions(); st.demod.setMode(o.mode, o); } };
$("pitch").onchange = () => { if (st.demod) st.demod.pitch = Number($("pitch").value); };

// the visible span: fs / zoom around the listen frequency (kept inside the band)
function view() {
  const z = Number($("zoom").value), span = st.fs / z;
  let c = st.listenHz - st.centerHz;
  c = Math.max(-st.fs / 2 + span / 2, Math.min(st.fs / 2 - span / 2, c));
  return { lo: c - span / 2, span };
}

for (const id of ["spec", "wf"]) {
  $(id).addEventListener("click", (e) => {
    if (!st.fs) return;
    const r = e.target.getBoundingClientRect(), v = view();
    let off = v.lo + (e.clientX - r.left) / r.width * v.span;
    // CW: snap to the strongest bin within +-5 px (USB: the click is the carrier, no snapping)
    if (st.lastSpec && $("mode").value === "cw") {
      const bin = st.fs / FFT_N, px = v.span / r.width * 5;
      let best = -1e9, bf = off;
      for (let f = off - px; f <= off + px; f += bin) {
        const i = Math.round(f / bin) + FFT_N / 2;
        if (i >= 0 && i < FFT_N && st.lastSpec[i] > best) { best = st.lastSpec[i]; bf = (i - FFT_N / 2) * bin; }
      }
      off = bf;
    }
    setListen(st.centerHz + off);
  });
}
// mouse wheel: fine tuning, 10 Hz per notch (Shift: 100 Hz)
$("wf").addEventListener("wheel", (e) => { e.preventDefault(); setListen(st.listenHz - Math.sign(e.deltaY) * (e.shiftKey ? 100 : 10)); }, { passive: false });

/* ------------------------------------------------------------ audio */

$("audio").onclick = async () => {
  if (st.audio) {
    await st.audio.close().catch(() => {}); st.audio = null; st.node = null;
    $("audio").textContent = "Audio on"; $("audio").classList.remove("on");
    log("audio off");
    return;
  }
  try {
    const rate = st.demod ? st.demod.audioRate : 7812.5;
    const ctx = new AudioContext({ sampleRate: rate });
    await ctx.audioWorklet.addModule("audio-worklet.js");
    const node = new AudioWorkletNode(ctx, "cw-player");
    node.connect(ctx.destination);
    node.port.postMessage({ volume: Number($("vol").value) });
    await ctx.resume();
    st.audio = ctx; st.node = node; st.audioSamples = 0;
    $("audio").textContent = "Audio off"; $("audio").classList.add("on");
    log(`audio: ${ctx.sampleRate} Hz, ${ctx.state}` + (st.demod ? "" : " (no stream yet: press Start)"), "ok");
  } catch (e) { log("audio: " + e.message, "err"); }
};
$("vol").oninput = () => st.node?.port.postMessage({ volume: Number($("vol").value) });

/* ------------------------------------------------------------ drawing */

function fit(canvas) {
  const w = Math.round(canvas.clientWidth * devicePixelRatio), h = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
  return false;
}

const PALETTE = (() => {               // black - blue - cyan - yellow - red - white
  const stops = [[0, 0, 0, 0], [0.25, 0, 0, 160], [0.5, 0, 180, 220], [0.7, 240, 230, 0], [0.88, 255, 60, 0], [1, 255, 255, 255]];
  const p = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let k = 0; while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
    const [x0, ...a] = stops[k], [x1, ...b] = stops[k + 1], t = (x - x0) / (x1 - x0);
    for (let c = 0; c < 3; c++) p[3 * i + c] = a[c] + (b[c] - a[c]) * t;
  }
  return p;
})();

function drawSpectrum(db) {
  st.lastSpec = db;
  const v = view(), bin = st.fs / FFT_N;
  const spec = $("spec"), wf = $("wf");
  fit(spec); const resized = fit(wf);
  const W = spec.width, H = spec.height, ctx = spec.getContext("2d");
  // per pixel: the strongest bin it covers
  const col = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const f0 = v.lo + x / W * v.span, f1 = v.lo + (x + 1) / W * v.span;
    const i0 = Math.floor(f0 / bin) + FFT_N / 2, i1 = Math.max(i0, Math.ceil(f1 / bin) + FFT_N / 2 - 1);
    let m = -200;
    for (let i = Math.max(0, i0); i <= Math.min(FFT_N - 1, i1); i++) if (db[i] > m) m = db[i];
    col[x] = m;
  }
  // display range: the noise floor (median) up to "range" dB above it, smoothed
  const sorted = Float32Array.from(col).sort();
  const med = sorted[W >> 1];
  st.floorDb += (med - 5 - st.floorDb) * 0.1;
  const range = Number($("range").value), top = st.floorDb + range;
  const y = (d) => H - (d - st.floorDb) / range * H;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#33373c"; ctx.lineWidth = 1; ctx.fillStyle = "#8a9097"; ctx.font = `${11 * devicePixelRatio}px monospace`;
  for (let d = Math.ceil(st.floorDb / 10) * 10; d < top; d += 10) {
    ctx.beginPath(); ctx.moveTo(0, y(d)); ctx.lineTo(W, y(d)); ctx.stroke();
    ctx.fillText(`${d} dBFS`, 4, y(d) - 2);
  }
  // frequency grid: a round step for about 8 lines; the labels go on the axis strip
  const step = [10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4].find((s) => v.span / s <= 10);
  const ticks = [];
  for (let f = Math.ceil((st.centerHz + v.lo) / step) * step; f < st.centerHz + v.lo + v.span; f += step) {
    const x = (f - st.centerHz - v.lo) / v.span * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ticks.push([x, f]);
  }
  drawAxis(ticks, step, W, v);
  // listen frequency and filter
  const lx = (st.listenHz - st.centerHz - v.lo) / v.span * W;
  const [pb0, pb1] = st.demod ? st.demod.passband() : [-250, 250];
  ctx.fillStyle = "rgba(255,159,10,0.18)"; ctx.fillRect(lx + pb0 / v.span * W, 0, (pb1 - pb0) / v.span * W, H);
  ctx.strokeStyle = "#ff9f0a"; ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H); ctx.stroke();
  // trace
  ctx.strokeStyle = "#5ac8fa"; ctx.lineWidth = 1.5 * devicePixelRatio; ctx.beginPath();
  for (let x = 0; x < W; x++) { const yy = y(col[x]); x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }
  ctx.stroke();
  // waterfall: shift down one row, new row on top
  const wctx = wf.getContext("2d");
  if (!resized) wctx.drawImage(wf, 0, 0, wf.width, wf.height - 1, 0, 1, wf.width, wf.height - 1);
  const row = wctx.createImageData(wf.width, 1);
  for (let x = 0; x < wf.width; x++) {
    const d = col[Math.floor(x * W / wf.width)];
    const i = Math.max(0, Math.min(255, Math.round((d - st.floorDb) / range * 255)));
    row.data.set([PALETTE[3 * i], PALETTE[3 * i + 1], PALETTE[3 * i + 2], 255], 4 * x);
  }
  wctx.putImageData(row, 0, 0);
  // level of the listened signal, and statistics
  // the strongest bin of the passband (CW: within 2 bins of the listen frequency)
  const [q0, q1] = $("mode").value === "usb" && st.demod ? st.demod.passband() : [-2 * bin, 2 * bin];
  const i0 = Math.round((st.listenHz - st.centerHz + q0) / bin) + FFT_N / 2, i1 = Math.round((st.listenHz - st.centerHz + q1) / bin) + FFT_N / 2;
  let lv = -200;
  for (let i = i0; i <= i1; i++) if (i >= 0 && i < FFT_N && db[i] > lv) lv = db[i];
  const snr = lv - med;
  $("level").textContent = `${lv.toFixed(1)} dBFS, ${snr.toFixed(0)} dB above noise (bin ${bin.toFixed(1)} Hz)`;
  $("meter").style.width = `${Math.max(0, Math.min(100, snr * 2))}%`;
  const s = st.s3?.parser.stats, sec = (performance.now() - st.t0) / 1e3;
  if (s) $("stats").textContent = `${(st.samples / sec / 1e3).toFixed(1)} kS/s · frames ${s.frames} · CRC ${s.crcBad} · gaps ${s.gaps} (${s.gapSamples})` +
    (st.s3.retunes ? ` · retunes ${st.s3.retunes}` : "") +
    (st.audio ? ` · audio ${st.audio.state}, ${st.audioSamples} samples` : "");
}

// The axis strip: ticks with the frequency in MHz (enough decimals for the step), minor ticks, the listen marker.
function drawAxis(ticks, step, W, v) {
  const ax = $("axis");
  fit(ax);
  const c = ax.getContext("2d"), H = ax.height, dpr = devicePixelRatio;
  c.fillStyle = "#101214"; c.fillRect(0, 0, ax.width, H);
  const sx = ax.width / W;
  c.strokeStyle = "#5a6068"; c.lineWidth = 1;
  for (let f = Math.ceil((st.centerHz + v.lo) / (step / 5)) * (step / 5); f < st.centerHz + v.lo + v.span; f += step / 5) {
    const x = (f - st.centerHz - v.lo) / v.span * ax.width;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 4 * dpr); c.stroke();
  }
  const dec = step >= 1e5 ? 1 : step >= 1e4 ? 2 : step >= 1e3 ? 3 : step >= 100 ? 4 : step >= 10 ? 5 : 6;
  c.fillStyle = "#c8ccd0"; c.font = `${12 * dpr}px ui-monospace, monospace`; c.textAlign = "center"; c.textBaseline = "bottom";
  for (const [x, f] of ticks) {
    const xx = x * sx;
    c.strokeStyle = "#8a9097"; c.beginPath(); c.moveTo(xx, 0); c.lineTo(xx, 8 * dpr); c.stroke();
    c.fillText((f / 1e6).toFixed(dec), xx, H - 2 * dpr);
  }
  const lx = (st.listenHz - st.centerHz - v.lo) / v.span * ax.width;
  c.fillStyle = "#ff9f0a";
  c.beginPath(); c.moveTo(lx - 5 * dpr, 0); c.lineTo(lx + 5 * dpr, 0); c.lineTo(lx, 7 * dpr); c.fill();
  c.textAlign = "right"; c.fillStyle = "#8a9097"; c.font = `${10 * dpr}px ui-monospace, monospace`;
  c.fillText("MHz", ax.width - 3 * dpr, 12 * dpr);
}

/* ------------------------------------------------------------ presets */

$("preset").onchange = async () => {
  if (!$("preset").value) return;
  const [center, listen, decim] = $("preset").value.split(",");
  $("center").value = center;
  const opt = [...$("rate").options].find((o) => o.value.startsWith(decim + ","));
  if (opt) $("rate").value = opt.value;
  if (Number(decim) <= 64) $("zoom").value = "1";
  setListen(Number(listen) * 1e6);
  await applyCenter();                                    // restart the stream on the new centre
};

/* ------------------------------------------------------------ C3 */

function disconnectedC3() {
  st.c3 = null;
  $("c3conn").textContent = "Connect C3"; $("c3info").textContent = "not connected";
  for (const id of ["cwon", "cwoff", "c3set", "dccal", "ptt", "txbtn"]) $(id).disabled = true;
  if (st.tx) stopTx();
}

async function closeC3(c3) {
  c3.closing = true;
  await c3.reader.cancel().catch(() => {});
  await c3.readDone;
  try { c3.writer.releaseLock(); } catch (e) { /* gone */ }
  await c3.port.close().catch(() => {});
}

/** Opens the C3 on port; checked with "CW", which only reports (INFO would switch a running beacon off). */
async function connectC3(port) {
  if (st.s3 && port === st.s3.port) throw new Error("this port is the S3's: pick the other one");
  await port.open({ baudRate: 115200 });
  try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (e) { /* not supported */ }
  const c3 = { port, writer: port.writable.getWriter(), reader: port.readable.getReader(), lines: [] };
  c3.readDone = (async () => {
    let buf = new Uint8Array(0);
    try {
      for (;;) {
        const { value, done } = await c3.reader.read();
        if (done) break;
        const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb;
        let p = 0;
        for (;;) {
          if (buf[p] === 0xB7) {                                // a fill report of the SSB stream
            if (buf.length - p < 4) break;
            c3.fill = buf[p + 1] | buf[p + 2] << 8; c3.under = buf[p + 3]; c3.fillAt = performance.now();
            p += 4;
            continue;
          }
          const n = buf.indexOf(0x0a, p);
          if (n < 0) break;
          const raw = buf.subarray(p, n);
          p = n + 1;
          if (!raw.every((b) => (b >= 0x20 && b < 0x7f) || b === 0x0d)) continue;
          const l = new TextDecoder().decode(raw).replace(/\r$/, "");
          if (l) {
            log("C3: " + l); c3.lines.push(l);
            if (l.startsWith("CW ON")) $("c3info").textContent = l;
            if (l.startsWith("SSB END") || l.startsWith("ERR SSB")) c3.ssbBusy = false;
          }
        }
        buf = buf.slice(p);
      }
    } catch (e) { if (!c3.closing) log("C3 read: " + e, "err"); }
    try { c3.reader.releaseLock(); } catch (e) { /* gone */ }
  })();
  await c3.writer.write(new TextEncoder().encode("CW\n"));
  for (let i = 0; i < 15 && !c3.lines.some((l) => l.startsWith("CW ON")); i++) await new Promise((r) => setTimeout(r, 100));
  if (!c3.lines.some((l) => l.startsWith("CW ON"))) {
    await closeC3(c3);
    throw new Error("not a C3 with the cw-beacon firmware: pick the other port");
  }
  st.c3 = c3;
  $("c3conn").textContent = "Disconnect C3";
  for (const id of ["cwon", "cwoff", "c3set", "dccal", "ptt", "txbtn"]) $(id).disabled = false;
}

$("c3conn").onclick = async () => {
  if (st.c3) { await closeC3(st.c3); disconnectedC3(); return; }
  try { await connectC3(await pickPort("c3")); } catch (e) { log("C3: " + e.message, "err"); }
};

/* ------------------------------------------------------------ auto connect
 * Web Serial gives the page no device path and no serial number, and both boards are 303A:1001; but Chrome keeps the ports
 * this page was once allowed (getPorts, no chooser). Each one is asked "CAPS": the S3 (ESP-SDR) answers "CAPS ...", the C3
 * "ERR ? (commands: ...)" without switching its beacon off (the byte pauses a running beacon for 5 s). The chooser comes
 * only when a board is still missing. Through the bridge the ports are known (by MAC). */

async function probe(port) {
  await port.open({ baudRate: 115200 });
  try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (e) { /* not supported */ }
  const w = port.writable.getWriter(), r = port.readable.getReader();
  let text = "";
  const reading = (async () => {
    try { for (;;) { const { value, done } = await r.read(); if (done) break; text += new TextDecoder("latin1").decode(value); } } catch (e) { /* closed */ }
  })();
  try {
    // an empty line first: it stops a stream left running on an S3, which drops the rest of what arrives meanwhile
    await w.write(new TextEncoder().encode("\n"));
    await new Promise((res) => setTimeout(res, 400));
    for (let attempt = 0; attempt < 2 && !/CAPS |commands: INFO/.test(text); attempt++) {
      await w.write(new TextEncoder().encode("CAPS\n"));
      for (let i = 0; i < 12 && !/CAPS |commands: INFO/.test(text); i++) await new Promise((res) => setTimeout(res, 100));
    }
  } finally {
    await r.cancel().catch(() => {});
    await reading;
    r.releaseLock(); w.releaseLock();
    await port.close().catch(() => {});
  }
  return /CAPS /.test(text) ? "s3" : /commands: INFO/.test(text) ? "c3" : null;
}

$("autoconn").onclick = async () => {
  $("autoconn").disabled = true;
  try {
    await bridgeReady;
    if (bridge) {
      if (!st.s3) await connectS3(await pickPort("s3")).catch((e) => log("S3: " + e.message, "err"));
      if (!st.c3) await connectC3(await pickPort("c3")).catch((e) => log("C3: " + e.message, "err"));
      return;
    }
    const used = () => [st.s3?.port, st.c3?.port];
    const tryPorts = async (ports) => {
      for (const p of ports) {
        if (st.s3 && st.c3) return;
        if (used().includes(p)) continue;
        let kind = null;
        try { kind = await probe(p); } catch (e) { log(`port: ${e.message}`, "err"); continue; }
        try {
          if (kind === "s3" && !st.s3) await connectS3(p);
          else if (kind === "c3" && !st.c3) await connectC3(p);
          else if (!kind) log("a port answered neither as S3 nor as C3");
        } catch (e) { log(`${kind}: ${e.message}`, "err"); }
      }
    };
    await tryPorts((await navigator.serial.getPorts()).filter((p) => p.getInfo().usbVendorId === ESPRESSIF.usbVendorId));
    if (!st.s3 || !st.c3) {
      log(`still missing: ${[!st.s3 && "S3", !st.c3 && "C3"].filter(Boolean).join(", ")} – allow its port in the dialog (once; Chrome remembers it)`);
      try { await tryPorts([await navigator.serial.requestPort({ filters: [ESPRESSIF] })]); } catch (e) { /* chooser cancelled */ }
    }
    log(`auto connect: S3 ${st.s3 ? "connected" : "not found"}, C3 ${st.c3 ? "connected" : "not found"}`, st.s3 && st.c3 ? "ok" : "");
  } finally {
    $("autoconn").disabled = false;
  }
};

// The C3's carrier at its connector against AMP (tinySA, 2026-11-10, tools/c3_power.py; ±2 dB), interpolated in log AMP
const AMP_DBM = [[1, -35.5], [2, -31.0], [3, -27.0], [5, -23.0], [10, -17.0], [20, -11.0], [30, -7.5], [50, -3.5],
                 [100, 2.5], [150, 5.5], [200, 7.5], [300, 10.5], [400, 12.5], [480, 12.5]];
function ampDbm(amp) {
  const a = Math.max(1, Math.min(480, amp));
  for (let k = 1; k < AMP_DBM.length; k++) {
    const [a0, p0] = AMP_DBM[k - 1], [a1, p1] = AMP_DBM[k];
    if (a <= a1) return p0 + (p1 - p0) * Math.log(a / a0) / Math.log(a1 / a0);
  }
  return AMP_DBM.at(-1)[1];
}
function showAmpDbm() {
  const a = Number($("c3amp").value), p = ampDbm(a), mw = 10 ** (p / 10);
  $("c3dbm").textContent = `≈ ${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)} dBm (${mw >= 1 ? mw.toFixed(1) + " mW" : (mw * 1000).toFixed(mw < 0.01 ? 1 : 0) + " µW"})` +
    (a > 150 ? ", compressed" : "");
}
$("c3amp").addEventListener("input", showAmpDbm);
showAmpDbm();

async function c3send(line) {
  await st.c3.writer.write(new TextEncoder().encode(line + "\n"));
}
$("cwon").onclick = () => c3send("CW ON");
$("cwoff").onclick = () => c3send("CW OFF");
$("c3set").onclick = async () => {
  await c3send(`CW SET AMP ${Math.round(Number($("c3amp").value))}`);
  await new Promise((r) => setTimeout(r, 300));
  await c3send(`CW SET F ${Number($("c3f").value).toFixed(6)}`);
};

/* ------------------------------------------------------------ DC calibration of the C3 through the S3
 * The C3 sends its LO leakage alone (BDC TEST at its LO); the S3, tuned there, measures that line with a single-bin DFT
 * (0.4 s, after 0.3 s for the new value to settle) while the correction steps through a coordinate search (6 .. 0.4 codes).
 * Bench 2026-11-10: the S3 next to the C3 (ceramic antenna) sees the leakage at the C3's connector through crosstalk, 25 dB
 * above the board's own radiation, and the null it finds is the tinySA's (docs/nb-cw-krok1.md). The PHY calibrates anew at
 * every reset of the C3, so the result holds until the next one; with another antenna or placement check it again. */

function calSamples(iq) {
  const c = st.cal;
  for (let k = 0; k < iq.length; k += 2) {
    if (c.skip > 0) { c.skip--; continue; }
    const co = Math.cos(c.ph), si = Math.sin(c.ph);
    c.re += iq[k] * co + iq[k + 1] * si;
    c.im += iq[k + 1] * co - iq[k] * si;
    c.ph += c.w;
    if (++c.n >= c.need) {
      st.cal = null;
      c.done(20 * Math.log10(Math.hypot(c.re, c.im) / c.n + 1e-12));
      return;
    }
  }
  c.ph %= 2 * Math.PI;
}

function lineLevel(offsetHz) {
  return new Promise((done) => {
    st.cal = { skip: Math.round(0.3 * st.fs), need: Math.round(0.4 * st.fs), n: 0, re: 0, im: 0, ph: 0,
               w: 2 * Math.PI * offsetHz / st.fs, done };          // x e^(-j ph), ph = 2 pi f0 t
  });
}

$("dccal").onclick = async () => {
  if (!st.s3 || !st.c3) { log("DC calibration needs both the S3 and the C3 connected", "err"); return; }
  if (st.calRunning) return;
  st.calRunning = true;
  $("dccal").disabled = true;
  const prev = { center: $("center").value, rate: $("rate").value, gainmode: $("gainmode").value, gain: $("gain").value, streaming: st.s3.streaming };
  try {
    // the C3's LO from its settings: F and NCO of the CW beacon
    st.c3.lines.length = 0;
    await c3send("CW");
    await new Promise((r) => setTimeout(r, 600));
    const m = st.c3.lines.map((l) => /CW ON (\d).* F ([\d.]+) NCO (-?\d+)/.exec(l)).find(Boolean);
    if (!m) throw new Error("no CW settings from the C3");
    const loKhz = Math.round(Number(m[2]) - Number(m[3]) / 1000);
    const loHz = pllActual(loKhz * 1e3);
    log(`DC calibration: C3 LO ${(loHz / 1e6).toFixed(6)} MHz, BDC TEST on, S3 there (manual gain 50)`);
    // the S3 at the LO, manual gain (the AGC would move between the points)
    if (st.s3.streaming) await st.s3.stop();
    const r = await st.s3.start(loKhz * 1e3, 256, 16, 50);
    st.fs = r.fs; st.centerHz = r.centerHz;
    st.spec = new Spectrum(FFT_N, Math.max(1, Math.round(st.fs / FFT_N / 15)), 32768, drawSpectrum);
    st.demod = newDemod();
    setListen(loHz);
    await c3send(`BDC TEST on ${(loKhz / 1e3).toFixed(3)}`);
    await new Promise((r) => setTimeout(r, 2500));
    const off = loHz - st.centerHz;
    const level = async (i, q) => { await c3send(`BDC ${i.toFixed(2)} ${q.toFixed(2)}`); return lineLevel(off); };
    let i0 = 0, q0 = 0, best = await level(i0, q0), n = 1;
    const start = best;
    for (const d of [6, 3, 1.5, 0.75, 0.4]) {
      for (let moved = true; moved;) {
        moved = false;
        for (const [di, dq] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
          const L = await level(i0 + di, q0 + dq); n++;
          if (L < best - 0.3) { i0 += di; q0 += dq; best = L; moved = true; break; }
        }
      }
      log(`DC calibration: step ${d}: I ${i0.toFixed(2)} Q ${q0.toFixed(2)}, ${best.toFixed(1)} dB`);
    }
    await c3send(`BDC ${i0.toFixed(2)} ${q0.toFixed(2)}`);
    log(`DC calibration done: BDC ${i0.toFixed(2)} ${q0.toFixed(2)} (until the C3 resets), leakage ${(best - start).toFixed(1)} dB `
        + `against 0 0, ${n} points`, "ok");
  } catch (e) {
    log("DC calibration: " + e.message, "err");
  } finally {
    st.cal = null;
    await c3send("BDC TEST off").catch(() => {});
    // the receiver back as it was
    $("center").value = prev.center; $("rate").value = prev.rate; $("gainmode").value = prev.gainmode; $("gain").value = prev.gain;
    $("gain").disabled = prev.gainmode !== "man";
    try { if (st.s3.streaming) await st.s3.stop(); if (prev.streaming) await $("start").onclick(); } catch (e) { /* the user restarts */ }
    st.calRunning = false;
    $("dccal").disabled = !st.c3;
  }
};

/* ------------------------------------------------------------ USB transmit through the C3 (SSB ON)
 * The page makes the analytic USB signal at the C3's rate (50 kS/s): the microphone or an audio file through TxChain (band pass
 * 300-2700 Hz, AGC), or test tones directly; the int16 I, Q pairs go to the C3 after its OK line. The C3's fill reports pace the
 * stream: files and tones are topped up to about TX_FILL pairs, the microphone (real time) drops a chunk when the ring runs
 * full (latency) and adds silence when it runs low. Stopping the stream is the PTT: the C3 goes off 0.5 s later by itself.
 * The C3 transmits at its F and AMP: into a dummy load or an attenuator only. */
const TX_FILL = 4000;                                        // pairs in the C3's ring (8192 = 164 ms) the stream aims at
function showTxUi() {
  const s = $("txsrc").value;
  $("txtl").style.display = s === "tone" || s === "two" ? "" : "none";
  $("txt2").style.display = s === "two" ? "" : "none";
  $("txfl").style.display = s === "file" ? "" : "none";
  $("txgl").style.display = s === "mic" || s === "file" ? "" : "none";
}
$("txsrc").onchange = showTxUi;
showTxUi();
$("txgain").onchange = () => st.tx?.chain?.setGainDb(Number($("txgain").value));

function sendPairs(tx, iq) {                                 // Float32 interleaved I, Q in -1..1 -> int16 LE to the C3
  if (!tx.running || !st.c3) return;
  const v = new Int16Array(iq.length);
  let pk = 0;
  for (let k = 0; k < iq.length; k++) v[k] = Math.round(Math.max(-1, Math.min(1, iq[k])) * 32767);
  for (let k = 0; k < iq.length; k += 2) pk = Math.max(pk, Math.hypot(iq[k], iq[k + 1]));
  tx.peak = Math.max(pk, tx.peak * 0.9);
  tx.sent += iq.length / 2;
  const c3 = st.c3;
  tx.writes = tx.writes.then(() => c3.writer.write(new Uint8Array(v.buffer))).catch((e) => log("TX write: " + e.message, "err"));
}

async function startTx() {
  if (st.tx || !st.c3) return;
  const src = $("txsrc").value;
  const tx = st.tx = { src, running: true, sent: 0, peak: 0, writes: Promise.resolve(), t0: performance.now() };
  const released = () => !tx.running || st.tx !== tx;
  try {
    $("txbtn").textContent = "TX off"; $("txbtn").classList.add("on"); $("ptt").classList.add("on");
    // the previous run first has to end (0.5 s after its last data): in SSB mode the C3 takes every byte as audio
    for (let i = 0; i < 40 && st.c3.ssbBusy; i++) await new Promise((r) => setTimeout(r, 100));
    if (st.c3.ssbBusy) throw new Error("the C3 is still in its last SSB run");
    if (released()) return;
    await c3send(`CW SET AMP ${Math.round(Number($("c3amp").value))}`); await new Promise((r) => setTimeout(r, 250));
    await c3send(`CW SET F ${Number($("c3f").value).toFixed(6)}`); await new Promise((r) => setTimeout(r, 250));
    if (released()) return;
    st.c3.lines.length = 0; st.c3.fill = 0; st.c3.under = 0;
    st.c3.ssbBusy = true;
    await c3send("SSB ON");
    let ok = null;
    for (let i = 0; i < 30 && !ok; i++) { await new Promise((r) => setTimeout(r, 100)); ok = st.c3.lines.find((l) => /^(OK SSB|ERR)/.test(l)); }
    if (!ok || ok.startsWith("ERR")) throw new Error(ok || "no OK SSB from the C3");
    const fs = Number((/RATE (\d+)/.exec(ok) || [0, 50000])[1]);
    if (released()) { tx.running = true; sendPairs(tx, new Float32Array(2 * 500)); tx.running = false; return; }   // a short tap: 10 ms, then off
    sendPairs(tx, new Float32Array(2 * 2000));                   // 40 ms of silence first: no underrun at the start
    if (src === "tone" || src === "two") {
      const tones = new TestTones(fs, src === "tone" ? [Number($("txt1").value)] : [Number($("txt1").value), Number($("txt2").value)]);
      tx.pump = setInterval(() => { if (tx.running && (st.c3.fill || 0) < TX_FILL) sendPairs(tx, tones.next(1250)); }, 10);
    } else {
      tx.chain = new TxChain(fs, { gainDb: Number($("txgain").value) });
      tx.ctx = new AudioContext({ sampleRate: fs });
      if (src === "mic") {
        tx.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        await tx.ctx.audioWorklet.addModule("audio-tx-worklet.js");
        if (released()) { tx.stream.getTracks().forEach((t) => t.stop()); tx.ctx.close().catch(() => {}); return; }
        tx.node = new AudioWorkletNode(tx.ctx, "tx-capture", { numberOfOutputs: 0 });
        tx.ctx.createMediaStreamSource(tx.stream).connect(tx.node);
        let acc = [], n = 0;
        tx.node.port.onmessage = (e) => {
          if (!tx.running) return;
          acc.push(e.data); n += e.data.length;
          if (n < 1000) return;
          const a = new Float32Array(n); let o = 0; for (const c of acc) { a.set(c, o); o += c.length; } acc = []; n = 0;
          const iq = tx.chain.process(a), fill = st.c3.fill || 0;
          if (fill > 7000) return;                            // the ring is full: drop, so that the latency stays low
          if (fill < 1000) sendPairs(tx, new Float32Array(2 * 500));
          sendPairs(tx, iq);
        };
      } else {
        const f = $("txfile").files[0];
        if (!f) throw new Error("choose an audio file first");
        const audio = (await tx.ctx.decodeAudioData(await f.arrayBuffer())).getChannelData(0);
        if (released()) { tx.ctx.close().catch(() => {}); return; }
        let pos = 0;
        tx.pump = setInterval(() => {
          if (!tx.running || (st.c3.fill || 0) >= TX_FILL) return;
          if (pos >= audio.length) { stopTx(); return; }
          sendPairs(tx, tx.chain.process(audio.subarray(pos, pos + 1250))); pos += 1250;
        }, 10);
      }
    }
    if (released()) { clearInterval(tx.pump); return; }
    tx.status = setInterval(() => {
      $("txinfo").textContent = `${src}, ${(tx.sent / fs).toFixed(1)} s sent, C3 ring ${st.c3?.fill ?? "-"} pairs, underruns ${st.c3?.under ?? "-"}`;
      $("txmeter").style.width = `${Math.min(100, tx.peak * 100)}%`;
    }, 200);
    log(`TX on: ${ok.slice(0, 90)}`, "ok");
  } catch (e) {
    log("TX: " + e.message, "err");
    if (/no OK SSB/.test(e.message) && st.c3) st.c3.ssbBusy = false;      // nothing started: do not wait for an SSB END
    if (st.tx === tx) stopTx();
  }
}

function stopTx() {
  const tx = st.tx;
  if (!tx) return;
  // the C3 ends 0.5 s after the last data (3 s when none came): ssbBusy until its SSB END
  tx.running = false;
  clearInterval(tx.pump); clearInterval(tx.status);
  tx.stream?.getTracks().forEach((t) => t.stop());
  tx.ctx?.close().catch(() => {});
  st.tx = null;
  $("txbtn").textContent = "TX on"; $("txbtn").classList.remove("on"); $("ptt").classList.remove("on");
  $("txmeter").style.width = "0%";
  log("TX off (the C3 stops 0.5 s after the last data)");
}

$("txbtn").onclick = () => (st.tx ? stopTx() : startTx());
$("ptt").addEventListener("pointerdown", (e) => { e.preventDefault(); startTx(); });
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) $("ptt").addEventListener(ev, () => { if (st.tx) stopTx(); });
// Tab is the PTT key: held = transmit (its focus moving is given up on this page; the key repeat is ignored)
let tabPtt = false;
window.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  e.preventDefault();
  if (e.repeat || tabPtt || !st.c3 || $("ptt").disabled) return;
  tabPtt = true;
  startTx();
});
window.addEventListener("keyup", (e) => {
  if (e.key !== "Tab" || !tabPtt) return;
  e.preventDefault();
  tabPtt = false;
  if (st.tx) stopTx();
});
window.addEventListener("blur", () => { if (tabPtt) { tabPtt = false; if (st.tx) stopTx(); } });   // the window lost the key

bridgeReady.then((b) => { if (!b && !("serial" in navigator)) log("Without the bridge (tools/web_bridge.py) this needs Web Serial: Chrome or Edge on http://localhost.", "err"); });

// ?demo: no board; a synthetic stream (noise and a keyed tone 1 kHz above the centre) to check the page and the audio
if (new URLSearchParams(location.search).has("demo")) {
  st.fs = 62500; st.centerHz = Number($("center").value) * 1e6;
  st.spec = new Spectrum(FFT_N, 1, 32768, drawSpectrum);
  st.demod = newDemod();
  setListen(st.centerHz + 1000);
  st.t0 = performance.now();
  let ph = 0, n = 0;
  setInterval(() => {
    const m = st.fs / 10, iq = new Float32Array(2 * m);
    for (let k = 0; k < m; k++, n++) {
      const key = Math.floor(n / (st.fs * 0.08)) % 4 !== 3;            // dits at 15 WPM, a gap every fourth
      const a = key ? 300 : 0, g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 20;
      ph += 2 * Math.PI * 1000 / st.fs;
      iq[2 * k] = a * Math.cos(ph) + g(); iq[2 * k + 1] = a * Math.sin(ph) + g();
    }
    onSamples(iq);
  }, 100);
  log("demo: synthetic stream, keyed tone at +1 kHz", "ok");
}

window.nb = st;                        // for debugging from the console
