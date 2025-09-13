// AudioWorkletProcessor that reads from a SharedArrayBuffer ring buffer.
// Note: AudioWorklet runs in its own global scope (no DOM). Keep it allocation-free and avoid any logging in process().

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
  private _control: Int32Array;
  private _data: Float32Array;
  private _capacity: number;
  private _ringChannels: number;

  // Telemetry
  private _statsEnabled: boolean;
  private _occMin: number;
  private _occMax: number;
  private _occSum: number;
  private _occCount: number;
  private _lastPost: number;

  constructor(options: { processorOptions?: { controlSAB: SharedArrayBuffer, dataSAB: SharedArrayBuffer } }) {
    super();
    try {
      const sab = options?.processorOptions || {} as { controlSAB: SharedArrayBuffer, dataSAB: SharedArrayBuffer, dataByteOffset?: number };
      this._control = new Int32Array(sab.controlSAB);
      // Map data with optional byteOffset to support single-SAB layouts
      const cap = (this._control[H.Capacity] | 0) >>> 0;
      const ch = (this._control[H.Channels] | 0) >>> 0;
      const length = Math.max(0, cap * ch);
      this._data = new Float32Array(sab.dataSAB, (sab as any).dataByteOffset ?? 0, length);
      this._capacity = cap;
      this._ringChannels = ch; // 1 or 2
    } catch (e) {
      // If constructor fails to map SAB, notify main thread for diagnostics
      try { this.port.postMessage({ type: 'worklet-error', message: (e as Error)?.message || String(e) }) } catch {}
      // Create safe fallbacks to avoid crashes
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

    // Allow enabling via message from main
    this.port.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; value?: unknown; controlSAB?: SharedArrayBuffer; dataSAB?: SharedArrayBuffer } | null;
      if (!d) return;
      if (d.type === 'enable-stats') {
        this._statsEnabled = !!d.value;
        try { this.port.postMessage({ type: 'worklet-ack', what: 'enable-stats', value: !!d.value }) } catch {}
      } else if (d.type === 'set-sab' && d.controlSAB && d.dataSAB) {
        try {
          // Rebind to SABs provided after node creation
          this._control = new Int32Array(d.controlSAB as SharedArrayBuffer);
          const cap = (this._control[H.Capacity] | 0) >>> 0;
          const ch = (this._control[H.Channels] | 0) >>> 0;
          const length = Math.max(0, cap * ch);
          const byteOffset = (d as any).dataByteOffset ?? 0;
          this._data = new Float32Array(d.dataSAB as SharedArrayBuffer, byteOffset, length);
          this._capacity = cap;
          this._ringChannels = ch;
          try { this.port.postMessage({ type: 'worklet-ack', what: 'set-sab', cap: this._capacity, ch: this._ringChannels }) } catch {}
        } catch (e) {
          try { this.port.postMessage({ type: 'worklet-error', what: 'set-sab', message: (e as Error)?.message || String(e) }) } catch {}
        }
      }
    };
    // Signal readiness to host
    try { this.port.postMessage({ type: 'worklet-ready' }) } catch {}
  }

  process = (inputs: Float32Array[][], outputs: Float32Array[][]): boolean => {
    // Guard for cases where the graph isn't fully connected yet
    if (!outputs || outputs.length === 0 || !outputs[0] || outputs[0].length === 0) return true;
    const out = outputs[0]; // array of channels
    const frames = out[0].length | 0;
    const channelsOut = out.length | 0;

    // Guard against invalid state
    if (this._capacity <= 0 || this._ringChannels <= 0) {
      // Zero-fill output and return
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channelsOut; c++) out[c][i] = 0;
      }
      return true;
    }

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
    const wNow = (Atomics.load(this._control, H.WriteIdx) | 0);
    const newOcc = (((wNow - newR + this._capacity) % this._capacity) | 0);
    Atomics.store(this._control, H.LastOccupancy, newOcc);

    // Telemetry: track occupancy and post periodically
    if (this._statsEnabled) {
      this._occMin = Math.min(this._occMin, occ);
      this._occMax = Math.max(this._occMax, occ);
      this._occSum += occ; this._occCount++;
      if ((currentTime - this._lastPost) > 0.5) {
        const underruns = Atomics.load(this._control, H.Underruns) | 0;
        const occAvg = this._occCount > 0 ? (this._occSum / this._occCount) : 0;
        // Include debug snapshot
        const rDbg = Atomics.load(this._control, H.ReadIdx) | 0;
        const wDbg = Atomics.load(this._control, H.WriteIdx) | 0;
        try { this.port.postMessage({ type: 'worklet-stats', underruns, occMin: this._occMin, occAvg, occMax: this._occMax, sampleRate, r: rDbg, w: wDbg, capacity: this._capacity, ringChannels: this._ringChannels }) } catch {}
        this._lastPost = currentTime;
        this._occMin = Number.POSITIVE_INFINITY; this._occMax = 0; this._occSum = 0; this._occCount = 0;
      }
    }

    return true;
  }
}

registerProcessor('nes-audio-processor', NesAudioProcessor);

