// Plain JS AudioWorkletProcessor implementation to ensure correct MIME and resolution on Cloudflare Pages.
// Mirrors the logic from nes-audio-processor.ts without TypeScript types.

const H = {
  ReadIdx: 0,
  WriteIdx: 1,
  Capacity: 2,
  Channels: 3,
  Underruns: 4,
  Overruns: 5,
  LastOccupancy: 6,
};

class NesAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    try {
      const sab = (options && options.processorOptions) || {};
      this._control = new Int32Array(sab.controlSAB);
      const cap = (this._control[H.Capacity] | 0) >>> 0;
      const ch = (this._control[H.Channels] | 0) >>> 0;
      const length = Math.max(0, cap * ch);
      this._data = new Float32Array(sab.dataSAB, sab.dataByteOffset || 0, length);
      this._capacity = cap;
      this._ringChannels = ch;
    } catch (e) {
      try { this.port.postMessage({ type: 'worklet-error', message: (e && e.message) || String(e) }) } catch {}
      this._control = new Int32Array(8);
      this._data = new Float32Array(1);
      this._capacity = 1;
      this._ringChannels = 1;
    }

    this._statsEnabled = false;
    this._occMin = Number.POSITIVE_INFINITY;
    this._occMax = 0;
    this._occSum = 0;
    this._occCount = 0;
    this._lastPost = currentTime;

    this.port.onmessage = (ev) => {
      const d = ev.data;
      if (!d) return;
      if (d.type === 'enable-stats') {
        this._statsEnabled = !!d.value;
        try { this.port.postMessage({ type: 'worklet-ack', what: 'enable-stats', value: !!d.value }) } catch {}
      } else if (d.type === 'set-sab' && d.controlSAB && d.dataSAB) {
        try {
          this._control = new Int32Array(d.controlSAB);
          const cap = (this._control[H.Capacity] | 0) >>> 0;
          const ch = (this._control[H.Channels] | 0) >>> 0;
          const length = Math.max(0, cap * ch);
          const byteOffset = d.dataByteOffset || 0;
          this._data = new Float32Array(d.dataSAB, byteOffset, length);
          this._capacity = cap;
          this._ringChannels = ch;
          try { this.port.postMessage({ type: 'worklet-ack', what: 'set-sab', cap: this._capacity, ch: this._ringChannels }) } catch {}
        } catch (e2) {
          try { this.port.postMessage({ type: 'worklet-error', what: 'set-sab', message: (e2 && e2.message) || String(e2) }) } catch {}
        }
      }
    };
    try { this.port.postMessage({ type: 'worklet-ready' }) } catch {}
  }

  process(inputs, outputs) {
    if (!outputs || outputs.length === 0 || !outputs[0] || outputs[0].length === 0) return true;
    const out = outputs[0];
    const frames = out[0].length | 0;
    const channelsOut = out.length | 0;

    if (this._capacity <= 0 || this._ringChannels <= 0) {
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channelsOut; c++) out[c][i] = 0;
      }
      return true;
    }

    const r = Atomics.load(this._control, H.ReadIdx) | 0;
    const w = Atomics.load(this._control, H.WriteIdx) | 0;
    const occ = ((w - r + this._capacity) % this._capacity) | 0;
    const toRead = (occ < frames ? occ : frames) | 0;

    let readIdx = r;
    for (let i = 0; i < toRead; i++) {
      const base = (readIdx * this._ringChannels) | 0;
      const s0 = this._data[base] || 0;
      const s1 = this._ringChannels === 2 ? this._data[base + 1] : s0;
      if (channelsOut >= 1) out[0][i] = s0;
      if (channelsOut >= 2) out[1][i] = s1;
      for (let c = 2; c < channelsOut; c++) out[c][i] = s0;
      readIdx++;
      if (readIdx === this._capacity) readIdx = 0;
    }

    if (toRead < frames) {
      for (let i = toRead; i < frames; i++) {
        for (let c = 0; c < channelsOut; c++) out[c][i] = 0;
      }
      Atomics.add(this._control, H.Underruns, 1);
    }

    Atomics.store(this._control, H.ReadIdx, readIdx);
    const newR = readIdx | 0;
    const wNow = (Atomics.load(this._control, H.WriteIdx) | 0);
    const newOcc = (((wNow - newR + this._capacity) % this._capacity) | 0);
    Atomics.store(this._control, H.LastOccupancy, newOcc);

    if (this._statsEnabled) {
      this._occMin = Math.min(this._occMin, occ);
      this._occMax = Math.max(this._occMax, occ);
      this._occSum += occ; this._occCount++;
      if ((currentTime - this._lastPost) > 0.5) {
        const underruns = Atomics.load(this._control, H.Underruns) | 0;
        const occAvg = this._occCount > 0 ? (this._occSum / this._occCount) : 0;
        try { this.port.postMessage({ type: 'worklet-stats', underruns, occMin: this._occMin, occAvg, occMax: this._occMax, sampleRate, r: newR, w: wNow, capacity: this._capacity, ringChannels: this._ringChannels }) } catch {}
        this._lastPost = currentTime;
        this._occMin = Number.POSITIVE_INFINITY; this._occMax = 0; this._occSum = 0; this._occCount = 0;
      }
    }

    return true;
  }
}

registerProcessor('nes-audio-processor', NesAudioProcessor);

