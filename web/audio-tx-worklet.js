// Captures the microphone (the context runs at 50 kHz, the C3's SSB rate) and posts the frames to the page.
class TxCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}

registerProcessor("tx-capture", TxCapture);
