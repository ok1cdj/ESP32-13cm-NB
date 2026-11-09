// Plays the demodulated audio that the page posts in chunks; the context runs at the demodulator's rate (7812.5 Hz).
// Keeps about 0.25 s in a ring; on an underrun it plays silence, on an overrun it drops the oldest samples.
class CwPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(1 << 14);
    this.r = 0;
    this.w = 0;
    this.volume = 1;
    this.port.onmessage = (e) => {
      if (e.data.volume !== undefined) { this.volume = e.data.volume; return; }
      const a = e.data;
      const size = this.ring.length;
      for (let i = 0; i < a.length; i++) {
        this.ring[this.w] = a[i];
        this.w = (this.w + 1) % size;
        if (this.w === this.r) this.r = (this.r + 1) % size;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0][0], size = this.ring.length;
    for (let i = 0; i < out.length; i++) {
      if (this.r === this.w) { out[i] = 0; continue; }
      out[i] = this.ring[this.r] * this.volume;
      this.r = (this.r + 1) % size;
    }
    return true;
  }
}

registerProcessor("cw-player", CwPlayer);
