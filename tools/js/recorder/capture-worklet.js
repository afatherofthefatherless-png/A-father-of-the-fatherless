// AudioWorklet: copies raw Float32 mic samples (channel 0) to the main thread in 4096-sample blocks. Lossless: no codec.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.size = 4096; this.buf = new Float32Array(this.size); this.n = 0;
    this.port.onmessage = e => { if (e.data === 'flush') this.flush(); };
  }
  flush() { if (this.n) { const out = this.buf.slice(0, this.n); this.port.postMessage(out, [out.buffer]); this.n = 0; } }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let i = 0;
      while (i < ch.length) {
        const k = Math.min(ch.length - i, this.size - this.n);
        this.buf.set(ch.subarray(i, i + k), this.n); this.n += k; i += k;
        if (this.n === this.size) { const out = this.buf; this.port.postMessage(out, [out.buffer]); this.buf = new Float32Array(this.size); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('kjv-capture', CaptureProcessor);
