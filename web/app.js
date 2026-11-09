// The page: S3 receiver (spectrum, waterfall, CW audio) and C3 beacon control, through tools/web_bridge.py or Web Serial.
import { S3Radio, WsPort } from "./iqs.js";
import { Spectrum, CwDemod } from "./dsp.js";

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

$("s3conn").onclick = async () => {
  if (st.s3) {
    await st.s3.close().catch(() => {});
    st.s3 = null;
    $("s3conn").textContent = "Connect S3"; $("s3info").textContent = "not connected";
    $("start").disabled = $("stop").disabled = true;
    return;
  }
  let r = null;
  try {
    const port = await pickPort("s3");
    if (st.c3 && port === st.c3.port) throw new Error("this port is the C3's: pick the other one");
    r = new S3Radio(onSamples, (l) => { if (!l.startsWith("I (")) log("S3: " + l); });
    await r.open(port);
    let info = "";
    for (let i = 0; i < 3 && !info; i++) info = await r.cmd("INFO", (l) => /^(S3SDR|ESP32DATV|ERR)/.test(l)).catch(() => "");
    if (!info.startsWith("S3SDR")) {
      throw new Error(info ? `not an S3 with ESP-SDR (${info}): pick the other port` : "the S3 does not answer INFO");
    }
    st.s3 = r;
    $("s3info").textContent = info; $("s3info").className = "stat ok";
    $("s3conn").textContent = "Disconnect S3";
    $("start").disabled = false;
  } catch (e) {
    log("S3: " + e.message, "err");
    if (r) await r.close();
  }
};

// a board that resets or is unplugged: drop it, so that "Connect" starts afresh
navigator.serial?.addEventListener("disconnect", (e) => {
  if (st.s3 && e.target === st.s3.port) {
    log("S3 gone (reset or USB)", "err");
    st.s3 = null; $("s3conn").textContent = "Connect S3"; $("s3info").textContent = "not connected"; $("s3info").className = "stat";
    $("start").disabled = $("stop").disabled = true;
  }
  if (st.c3 && e.target === st.c3.port) {
    log("C3 gone (reset or USB)", "err");
    st.c3 = null; $("c3conn").textContent = "Connect C3"; $("c3info").textContent = "not connected";
    for (const id of ["cwon", "cwoff", "c3set"]) $(id).disabled = true;
  }
});

$("gainmode").onchange = () => { $("gain").disabled = $("gainmode").value !== "man"; };

$("start").onclick = async () => {
  const [decim, bits] = $("rate").value.split(",").map(Number);
  const gain = $("gainmode").value === "man" ? Number($("gain").value) : null;
  try {
    if (st.s3.streaming) await st.s3.stop();
    const r = await st.s3.start(Number($("center").value) * 1e6, decim, bits, gain);
    st.fs = r.fs; st.centerHz = r.centerHz;
    st.spec = new Spectrum(FFT_N, Math.max(1, Math.round(st.fs / FFT_N / 15)), bits === 16 ? 32768 : 128, drawSpectrum);
    st.demod = new CwDemod(st.fs, Number($("bw").value), Number($("pitch").value));
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
$("bw").onchange = () => st.demod?.setBandwidth(Number($("bw").value));
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
    // snap to the strongest bin within +-5 px
    if (st.lastSpec) {
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
  const lx = (st.listenHz - st.centerHz - v.lo) / v.span * W, bwx = Number($("bw").value) / v.span * W;
  ctx.fillStyle = "rgba(255,159,10,0.18)"; ctx.fillRect(lx - bwx / 2, 0, bwx, H);
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
  const li = Math.round((st.listenHz - st.centerHz) / bin) + FFT_N / 2;
  let lv = -200;
  for (let i = li - 2; i <= li + 2; i++) if (i >= 0 && i < FFT_N && db[i] > lv) lv = db[i];
  const snr = lv - med;
  $("level").textContent = `${lv.toFixed(1)} dBFS, ${snr.toFixed(0)} dB above noise (bin ${bin.toFixed(1)} Hz)`;
  $("meter").style.width = `${Math.max(0, Math.min(100, snr * 2))}%`;
  const s = st.s3?.parser.stats, sec = (performance.now() - st.t0) / 1e3;
  if (s) $("stats").textContent = `${(st.samples / sec / 1e3).toFixed(1)} kS/s · frames ${s.frames} · CRC ${s.crcBad} · gaps ${s.gaps} (${s.gapSamples})` +
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
  if (st.s3?.streaming) $("start").onclick();             // restart the stream on the new centre
};

/* ------------------------------------------------------------ C3 */

$("c3conn").onclick = async () => {
  if (st.c3) {
    st.c3.closing = true;
    await st.c3.reader.cancel().catch(() => {});
    st.c3.writer.releaseLock();
    await st.c3.port.close().catch(() => {});
    st.c3 = null;
    $("c3conn").textContent = "Connect C3"; $("c3info").textContent = "not connected";
    for (const id of ["cwon", "cwoff", "c3set"]) $(id).disabled = true;
    return;
  }
  try {
    const port = await pickPort("c3");
    if (st.s3 && port === st.s3.port) throw new Error("this port is the S3's: pick the other one");
    await port.open({ baudRate: 115200 });
    try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (e) { /* not supported */ }
    const c3 = { port, writer: port.writable.getWriter(), reader: port.readable.getReader(), lines: [] };
    st.c3 = c3;
    (async () => {
      let text = "";
      try {
        for (;;) {
          const { value, done } = await c3.reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
          let n;
          while ((n = text.indexOf("\n")) >= 0) {
            const l = text.slice(0, n).replace(/\r$/, ""); text = text.slice(n + 1);
            if (l) { log("C3: " + l); c3.lines.push(l); if (l.startsWith("CW ON")) $("c3info").textContent = l; }
          }
        }
      } catch (e) { if (!c3.closing) log("C3 read: " + e, "err"); }
    })();
    await c3send("INFO");
    await new Promise((r) => setTimeout(r, 600));
    if (!c3.lines.some((l) => l.startsWith("ESP32DATV"))) {
      log("C3: not a C3 with the ESP32-DATV firmware: pick the other port", "err");
      $("c3conn").onclick();
      return;
    }
    $("c3conn").textContent = "Disconnect C3";
    for (const id of ["cwon", "cwoff", "c3set"]) $(id).disabled = false;
  } catch (e) { log("C3: " + e.message, "err"); }
};

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

bridgeReady.then((b) => { if (!b && !("serial" in navigator)) log("Without the bridge (tools/web_bridge.py) this needs Web Serial: Chrome or Edge on http://localhost.", "err"); });

// ?demo: no board; a synthetic stream (noise and a keyed tone 1 kHz above the centre) to check the page and the audio
if (new URLSearchParams(location.search).has("demo")) {
  st.fs = 62500; st.centerHz = Number($("center").value) * 1e6;
  st.spec = new Spectrum(FFT_N, 1, 32768, drawSpectrum);
  st.demod = new CwDemod(st.fs, Number($("bw").value), Number($("pitch").value));
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
