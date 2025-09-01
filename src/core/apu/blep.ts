// Band-limited synthesis scaffolding (minBLEP-style) for NES APU
// This is an initial placeholder implementation that records step transitions
// and exposes a rendering API. By default, rendering is pass-through and
// does not modify audio. Future work will add proper minBLEP kernels.

export type Channel = 'p1' | 'p2' | 'tri' | 'noi' | 'dmc'

export type BlepEvent = {
  // CPU cycle timestamp when the step transition occurred
  t: number
  // Channel identifier (for future per-channel processing)
  ch: Channel
  // Step amplitude delta in linear channel units (e.g., 0..15 for pulse/noise, 0..127 for DMC)
  delta: number
}

export type BlepCorrection = { p1p2: number; dmc: number }

export interface IBandlimitedSynth {
  // Clear internal state
  reset(): void
  // Enqueue a step transition event
  push(e: BlepEvent): void
  // Render one audio sample given the sample start CPU cycle and cycles-per-sample.
  // dt: optional normalized phase step per sample for specific channels (frequency/sampleRate)
  // Returns additive corrections in linear units for the channels we correct.
  render(sampleStartCycle: number, cyclesPerSample: number, dt?: Partial<Record<Channel, number>>): BlepCorrection
  // Optional: allow trimming of stale events to avoid unbounded growth
  prune(beforeCycleExclusive: number): void
  // Debug helper (optional)
  _count?(): number
}

// PolyBLEP utility: 2-sample polynomial band-limited step correction
// u: fractional position of edge relative to current sample start in samples
//    (-1..1): negative means the edge occurred in the previous sample window
// dt: normalized step width (≈ frequency/sampleRate), small (0..0.5]
const polyBLEPAt = (u: number, dt: number): number => {
  // Map tails from previous sample into [0,1) domain
  let t = u
  if (t < 0) t += 1
  if (dt <= 0) return 0
  if (t < dt) {
    t = t / dt
    return t + t - t * t - 1.0
  } else if (t > 1.0 - dt) {
    t = (t - 1.0) / dt
    return t * t + t + t + 1.0
  }
  return 0
}

export class PassThroughBlep implements IBandlimitedSynth {
  protected q: BlepEvent[] = []

  reset(): void { this.q.length = 0 }
  push(e: BlepEvent): void {
    // Keep a bounded queue to avoid unbounded growth even if not consumed
    if (this.q.length > 8192) this.q.splice(0, this.q.length - 4096)
    this.q.push(e)
  }
  render(_sampleStartCycle: number, _cyclesPerSample: number, _dt?: Partial<Record<Channel, number>>): BlepCorrection {
    return { p1p2: 0, dmc: 0 }
  }
  prune(beforeCycleExclusive: number): void {
    if (this.q.length === 0) return
    // Drop events older than beforeCycleExclusive minus a small hysteresis
    const keepFrom = Math.max(0, this.q.findIndex((e) => e.t >= beforeCycleExclusive) - 1)
    if (keepFrom > 0) this.q.splice(0, keepFrom)
  }
  // Debug helper
  _count(): number { return this.q.length|0 }
}

// PolyBLEP-based synth: computes additive corrections around pulse edges.
// Uses a simple per-channel average edge interval to estimate dt.
export class PolyBlepSynth extends PassThroughBlep {
  private lastT: Record<BlepEvent['ch'], number> = { p1: -1e15, p2: -1e15, tri: -1e15, noi: -1e15, dmc: -1e15 }
  private avgInt: Record<BlepEvent['ch'], number> = { p1: 1000, p2: 1000, tri: 1000, noi: 1000, dmc: 1000 }

  override reset(): void {
    super.reset()
    this.lastT = { p1: -1e15, p2: -1e15, tri: -1e15, noi: -1e15, dmc: -1e15 }
    this.avgInt = { p1: 1000, p2: 1000, tri: 1000, noi: 1000, dmc: 1000 }
  }

  override push(e: BlepEvent): void {
    const last = this.lastT[e.ch]
    if (last > -1e14) {
      const interval = Math.max(1, (e.t - last) | 0)
      // Exponential moving average with mild smoothing
      const a = 0.2
      this.avgInt[e.ch] = (1 - a) * this.avgInt[e.ch] + a * interval
    }
    this.lastT[e.ch] = e.t
    super.push(e)
  }

  override render(sampleStartCycle: number, cyclesPerSample: number, dt?: Partial<Record<Channel, number>>): BlepCorrection {
    if (this.q.length === 0) return { p1p2: 0, dmc: 0 }
    const s0 = sampleStartCycle
    const cps = cyclesPerSample
    let corrPulse = 0
    let corrDmc = 0

    // Consider events within +/- 1 sample window
    // (polyBLEP has non-zero support only within two adjacent samples)
    for (let i = 0; i < this.q.length; i++) {
      const e = this.q[i]
      const u = (e.t - s0) / cps
      if (u <= -1.0) continue // too far in the past; eligible for prune later
      if (u >= 1.0) break // future events; queue is in time order

      // Prefer provided dt; fall back to EMA of intervals
      let dtn = dt?.[e.ch]
      if (typeof dtn !== 'number' || !(dtn > 0)) {
        const intCycles = Math.max(1, this.avgInt[e.ch])
        dtn = cps / intCycles
      }
      if (dtn < 1e-6) dtn = 1e-6
      if (dtn > 0.5) dtn = 0.5

      const c = polyBLEPAt(u, dtn) * e.delta
      if (e.ch === 'p1' || e.ch === 'p2') corrPulse += c
      else if (e.ch === 'dmc') corrDmc += c
    }
    return { p1p2: corrPulse, dmc: corrDmc }
  }
}
