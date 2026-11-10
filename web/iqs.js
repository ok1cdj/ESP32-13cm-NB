// IQS stream of the ESP-SDR firmware on the ESP32-S3 (zodoczi/esp-sdr, docs/iq-stream.md), written from the protocol description.
// Text commands end in "\n"; replies are text lines; after "IQS ..." binary frames follow until "IQSEND ...".
// Frame: "IQS1", u32 sequence, u64 sample index, u16 samples, u8 bits, u8 flags, u16 decimation, u8 gain, u8 shift,
// interleaved I, Q (int8 / int16 LE / 4-bit nibbles), u32 CRC32 (zlib) of header and payload. No DOM here: also used by Node tests.

export const RING_HZ = 16e6;
export const PLL_STEP = 30e6 / 65536;          // the PLL rounds the LO down to this step (as the C3 does)

/** The frequency the PLL settles on for a request of fHz. */
export function pllActual(fHz) {
  return Math.floor(fHz / PLL_STEP + 1e-9) * PLL_STEP;
}

/** Tuning for a centre frequency: mode 2 (fs/4 rotation) with the LO 4 MHz below, in whole kHz. */
export function tuning(centerHz) {
  const loKhz = Math.round((centerHz - RING_HZ / 4) / 1e3);
  return { mhz: Math.floor(loKhz / 1000), fofsKhz: loKhz % 1000, centerHz: pllActual(loKhz * 1e3) + RING_HZ / 4 };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8, start = 0, end = u8.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const MAGIC = [0x49, 0x51, 0x53, 0x31];       // "IQS1"

/**
 * Splits the byte stream into text lines and IQS frames.
 * onLine(text): a text line (without "\r\n"); onSamples(iq, index, frame): iq is a Float32Array of interleaved I, Q, already
 * conjugated (RF up = frequency up), in counts of the frame's bit depth.
 */
export class IqsParser {
  constructor(onLine, onSamples) {
    this.onLine = onLine;
    this.onSamples = onSamples;
    this.buf = new Uint8Array(1 << 16);
    this.len = 0;
    this.reset();
  }

  reset() {
    this.expect = null;
    this.stats = { frames: 0, samples: 0, crcBad: 0, gaps: 0, gapSamples: 0, flagged: 0 };
  }

  push(chunk) {
    if (this.len + chunk.length > this.buf.length) {
      const nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + chunk.length));
      nb.set(this.buf.subarray(0, this.len));
      this.buf = nb;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.length;
    let p = 0;
    const b = this.buf;
    for (;;) {
      if (this.len - p >= 4 && b[p] === MAGIC[0] && b[p + 1] === MAGIC[1] && b[p + 2] === MAGIC[2] && b[p + 3] === MAGIC[3]) {
        if (this.len - p < 24) break;
        const dv = new DataView(b.buffer, b.byteOffset + p);
        const n = dv.getUint16(16, true), bits = b[p + 18], flags = b[p + 19];
        const plen = (n * 2 * bits) >> 3;
        if (![4, 8, 16].includes(bits) || plen > 1024) { p += 4; continue; }
        if (this.len - p < 24 + plen + 4) break;
        if (crc32(b, p, p + 24 + plen) !== dv.getUint32(24 + plen, true)) { this.stats.crcBad++; p += 4; continue; }
        const index = Number(dv.getBigUint64(8, true));
        if (this.expect !== null && index > this.expect) { this.stats.gaps++; this.stats.gapSamples += index - this.expect; }
        if (this.expect === null || index >= this.expect) {
          this.stats.flagged += flags !== 0;
          this.stats.frames++;
          this.stats.samples += n;
          this.expect = index + n;
          this.onSamples(unpack(b, p + 24, n, bits), index, { gap: (flags & 1) !== 0, dropped: (flags & 2) !== 0 });
        }
        p += 24 + plen + 4;
        continue;
      }
      // text: up to the next "\n", unless a frame starts first
      let nl = -1, mg = -1;
      for (let i = p; i < this.len; i++) {
        if (b[i] === 0x0a) { nl = i; break; }
        if (b[i] === MAGIC[0] && i + 3 < this.len && b[i + 1] === MAGIC[1] && b[i + 2] === MAGIC[2] && b[i + 3] === MAGIC[3]) { mg = i; break; }
      }
      if (mg >= 0) { p = mg; continue; }                       // stray bytes before a frame
      if (nl < 0) break;
      const raw = b.subarray(p, nl);
      p = nl + 1;
      if (raw.every((c) => (c >= 0x20 && c < 0x7f) || c === 0x0d)) {   // only printable text: not the rest of a damaged frame
        const line = new TextDecoder().decode(raw).replace(/\r$/, "");
        if (line.length) this.onLine(line);
      }
    }
    this.buf.copyWithin(0, p, this.len);
    this.len -= p;
  }
}

function unpack(b, off, n, bits) {
  const out = new Float32Array(2 * n);
  if (bits === 16) {
    const dv = new DataView(b.buffer, b.byteOffset + off, 4 * n);
    for (let k = 0; k < n; k++) { out[2 * k] = dv.getInt16(4 * k, true); out[2 * k + 1] = -dv.getInt16(4 * k + 2, true); }
  } else if (bits === 8) {
    for (let k = 0; k < n; k++) { out[2 * k] = (b[off + 2 * k] << 24) >> 24; out[2 * k + 1] = -((b[off + 2 * k + 1] << 24) >> 24); }
  } else {
    for (let k = 0; k < n; k++) { const v = b[off + k]; out[2 * k] = ((v & 15) << 28) >> 28; out[2 * k + 1] = -((v << 24) >> 28); }
  }
  return out;
}

/**
 * The S3 over Web Serial (browser only). Commands wait for their reply line; the stream runs until stop().
 */
export class S3Radio {
  constructor(onSamples, onLog) {
    this.onLog = onLog || (() => {});
    this.waiters = [];
    this.parser = new IqsParser((l) => this._line(l), onSamples);
    this.streaming = false;
  }

  async open(port) {
    this.port = port;
    await port.open({ baudRate: 115200, bufferSize: 1 << 16 });
    // DTR and RTS both set (as z2-web-sdr does): another combination of the two resets the S3's native USB port
    try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (e) { /* not supported */ }
    this.writer = port.writable.getWriter();
    this.readDone = this._readLoop();
    await new Promise((r) => setTimeout(r, 300));
    // a stream from an earlier session may still run: any byte stops it; then wait until the line is quiet
    await this.send("");
    let bytes = -1;
    for (let i = 0; i < 30 && bytes !== this.bytes; i++) { bytes = this.bytes; await new Promise((r) => setTimeout(r, 150)); }
    this.parser.len = 0;
    this.waiters = [];
  }

  async close() {
    try { if (this.streaming) await this.stop(); } catch (e) { /* closing anyway */ }
    this.closing = true;
    try { await this.reader?.cancel(); } catch (e) { /* already gone */ }
    try { await this.readDone; } catch (e) { /* already gone */ }
    try { this.writer?.releaseLock(); } catch (e) { /* already gone */ }
    try { await this.port.close(); } catch (e) { /* lost or never opened */ }
  }

  async _readLoop() {
    this.reader = this.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.bytes = (this.bytes || 0) + value.length;
        this.parser.push(value);
      }
    } catch (e) {
      if (!this.closing) this.onLog("read: " + e);
    } finally {
      this.reader.releaseLock();
    }
  }

  _line(l) {
    this.onLog(l);
    const w = this.waiters.findIndex((x) => x.match(l));
    if (w >= 0) this.waiters.splice(w, 1)[0].resolve(l);
  }

  _wait(match, ms = 3000) {
    return new Promise((resolve, reject) => {
      const w = { match, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) { this.waiters.splice(i, 1); reject(new Error("no reply")); }
      }, ms);
    });
  }

  async send(text) {
    await this.writer.write(new TextEncoder().encode(text + "\n"));
  }

  /** A command; resolves with its reply line (OK / value), rejects on ERR. */
  async cmd(c, match = (l) => !l.startsWith("I (") && !l.startsWith("IQS")) {
    const p = this._wait(match);
    await this.send(c);
    const r = await p;
    if (r.startsWith("ERR")) throw new Error(`${c}: ${r}`);
    return r;
  }

  async start(centerHz, decim = 256, bits = 16, gain = null) {
    const t = tuning(centerHz);
    await this.cmd(`FOFS ${t.fofsKhz}`);
    await this.cmd(`FREQ ${t.mhz}`);
    await this.cmd(gain === null ? "GAIN HARDWARE" : `GAIN MANUAL ${gain}`);
    this.parser.reset();
    const p = this._wait((l) => l.startsWith("IQS ") || l.startsWith("ERR"));
    await this.send(`IQS 0 ${decim} ${bits} 6 0 2`);
    const r = await p;
    if (r.startsWith("ERR")) throw new Error(r);
    this.streaming = true;
    return { fs: RING_HZ / decim, centerHz: t.centerHz, reply: r };
  }

  /** Retune a running stream ("T <MHz> <kHz>": PLL only, ~9 ms gap, the sample numbering goes on, the gap is flagged).
   *  Returns the new centre (PLL rounding included). Bench 2026-11-10 (ESP-SDR 4128c24): a kHz-only retune did not move
   *  the LO although IQSEND counted it; app.js restarts the stream instead (RETUNE_IN_STREAM). */
  async retune(centerHz) {
    if (!this.streaming) throw new Error("no stream to retune");
    const t = tuning(centerHz);
    this.retunes = (this.retunes || 0) + 1;
    await this.send(`T ${t.mhz} ${t.fofsKhz}`);
    return t.centerHz;
  }

  async stop() {
    const p = this._wait((l) => l.startsWith("IQSEND"), 4000);
    await this.send("");                                   // any byte ends the stream
    this.streaming = false;
    return p;
  }
}

/**
 * A serial port behind tools/web_bridge.py (WebSocket, raw bytes both ways) with the part of the Web Serial SerialPort interface
 * that this page uses: open(), readable, writable, setSignals(), close(), getInfo().
 */
export class WsPort {
  constructor(url) { this.url = url; }

  async open() {
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`the bridge does not answer: ${this.url}`));
    });
    this.readable = new ReadableStream({
      start: (c) => {
        ws.onmessage = (e) => c.enqueue(new Uint8Array(e.data));
        ws.onclose = (e) => { try { e.code === 1000 ? c.close() : c.error(new Error(`the bridge closed the connection (${e.code} ${e.reason})`)); } catch (x) { /* closed */ } };
      },
    });
    this.writable = new WritableStream({ write: (chunk) => ws.send(chunk) });
  }

  async setSignals() { /* the bridge keeps the port as pyserial opens it */ }

  async close() { this.ws?.close(1000); }

  getInfo() { return { bridge: this.url }; }
}

