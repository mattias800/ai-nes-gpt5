// SharedArrayBuffer ring buffer for interleaved Float32 PCM
// Arrow functions only; no any types.

export interface AudioRingBufferConfig { capacityFrames: number; channels: number }

export interface SabBundle {
  controlSAB: SharedArrayBuffer
  dataSAB: SharedArrayBuffer
  capacityFrames: number
  channels: number
}

// Header indices (Int32)
export const H = {
  ReadIdx: 0,
  WriteIdx: 1,
  Capacity: 2,
  Channels: 3,
  Underruns: 4,
  Overruns: 5,
  LastOccupancy: 6,
} as const

const HEADER_INT32_COUNT = 8 // room for future fields

export const createAudioSAB = ({ capacityFrames, channels }: AudioRingBufferConfig): SabBundle => {
  const controlSAB = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * HEADER_INT32_COUNT)
  const control = new Int32Array(controlSAB)
  control[H.ReadIdx] = 0
  control[H.WriteIdx] = 0
  control[H.Capacity] = capacityFrames|0
  control[H.Channels] = channels|0
  control[H.Underruns] = 0
  control[H.Overruns] = 0
  control[H.LastOccupancy] = 0
  const dataSAB = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * capacityFrames * channels)
  return { controlSAB, dataSAB, capacityFrames, channels }
}

export interface RingBufferWriter {
  write: (srcInterleaved: Float32Array) => number
  freeSpace: () => number
  occupancy: () => number
  consumerOccupancy: () => number
  debugRW: () => { r: number; w: number }
}

export const getWriter = (bundle: SabBundle): RingBufferWriter => {
  const control = new Int32Array(bundle.controlSAB)
  const data = new Float32Array(bundle.dataSAB)
  const channels = control[H.Channels]|0
  const capacity = control[H.Capacity]|0
  const write = (src: Float32Array): number => {
    const framesRequested = (src.length / channels)|0
    const r = Atomics.load(control, H.ReadIdx)|0
    const w = Atomics.load(control, H.WriteIdx)|0
    const occ = ((w - r + capacity) % capacity)|0
    const free = (capacity - 1 - occ)|0
    const toWriteFrames = Math.min(framesRequested, free)|0
    if (toWriteFrames < framesRequested) Atomics.add(control, H.Overruns, 1)
    let framesWritten = 0
    while (framesWritten < toWriteFrames) {
      const curW = (Atomics.load(control, H.WriteIdx)|0)
      const spaceUntilWrap = (capacity - curW)|0
      const chunkFrames = Math.min(toWriteFrames - framesWritten, spaceUntilWrap)|0
      const dstStart = curW * channels
      const srcStart = framesWritten * channels
      const count = chunkFrames * channels
      data.set(src.subarray(srcStart, srcStart + count), dstStart)
      const newW = (curW + chunkFrames) % capacity
      Atomics.store(control, H.WriteIdx, newW)
      framesWritten += chunkFrames
    }
    // Do not update LastOccupancy here; leave it as a consumer-published metric
    return toWriteFrames
  }
  const freeSpace = (): number => {
    const r = Atomics.load(control, H.ReadIdx)|0
    const w = Atomics.load(control, H.WriteIdx)|0
    const occ = ((w - r + capacity) % capacity)|0
    const free = (capacity - 1 - occ)|0
    // Debug: log occasionally
    if (Math.random() < 0.001) {
      console.log('[ring-buffer] r:', r, 'w:', w, 'occ:', occ, 'free:', free, 'capacity:', capacity)
    }
    return free
  }
  const occupancy = (): number => ((Atomics.load(control, H.WriteIdx)|0 - (Atomics.load(control, H.ReadIdx)|0) + capacity) % capacity)|0
  const consumerOccupancy = (): number => Atomics.load(control, H.LastOccupancy)|0
  const debugRW = (): { r: number; w: number } => ({ r: Atomics.load(control, H.ReadIdx)|0, w: Atomics.load(control, H.WriteIdx)|0 })
  return { write, freeSpace, occupancy, consumerOccupancy, debugRW }
}

