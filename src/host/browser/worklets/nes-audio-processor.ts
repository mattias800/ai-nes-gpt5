// AudioWorkletProcessor that reads from a SharedArrayBuffer ring buffer.
// Note: AudioWorklet runs in its own global scope (no DOM). Keep it allocation-free.

// Header indices (must match shared-ring-buffer.ts)
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
    const sab = options?.processorOptions || {};
    this._control = new Int32Array(sab.controlSAB);
    this._data = new Float32Array(sab.dataSAB);
    this._capacity = this._control[H.Capacity] | 0;
    this._ringChannels = this._control[H.Channels] | 0; // 1 or 2
  }

  process = (inputs, outputs) => {
    const out = outputs[0]; // array of channels
    const frames = out[0].length | 0;
    const channelsOut = out.length | 0;

    // Available frames in ring
    const r = Atomics.load(this._control, H.ReadIdx) | 0;
    const w = Atomics.load(this._control, H.WriteIdx) | 0;
    const occ = ((w - r + this._capacity) % this._capacity) | 0;
    const toRead = (occ < frames ? occ : frames) | 0;

    // Copy from interleaved ring buffer to planar outputs
    let readIdx = r;
    for (let i = 0; i < toRead; i++) {
      const base = (readIdx * this._ringChannels) | 0;
      const s0 = this._data[base] || 0;
      const s1 = this._ringChannels === 2 ? this._data[base + 1] : s0;
      // write to all output channels; duplicate as needed
      if (channelsOut >= 1) out[0][i] = s0;
      if (channelsOut >= 2) out[1][i] = s1;
      for (let c = 2; c < channelsOut; c++) out[c][i] = s0;
      readIdx++;
      if (readIdx === this._capacity) readIdx = 0;
    }

    // Zero-fill remainder and count underrun
    if (toRead < frames) {
      for (let i = toRead; i < frames; i++) {
        for (let c = 0; c < channelsOut; c++) out[c][i] = 0;
      }
      Atomics.add(this._control, H.Underruns, 1);
    }

    // Publish new read index and last occupancy
    Atomics.store(this._control, H.ReadIdx, readIdx);
    const newR = readIdx | 0;
    const newOcc = ((Atomics.load(this._control, H.WriteIdx) | 0 - newR + this._capacity) % this._capacity) | 0;
    Atomics.store(this._control, H.LastOccupancy, newOcc);

    return true;
  }
}

registerProcessor('nes-audio-processor', NesAudioProcessor);

