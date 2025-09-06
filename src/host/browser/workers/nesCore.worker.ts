/* eslint-disable no-restricted-globals */
// Worker that runs the NES emulator core and writes audio into a SAB ring buffer.
// Arrow functions only for top-level functions.

import { NESSystem } from '../../../core/system/system'
import { parseINes } from '../../../core/cart/ines'
import { getWriter, type SabBundle } from '../audio/shared-ring-buffer'

const CPU_HZ = 1789773

interface InitMsg { type: 'init'; sab?: SabBundle | null; sampleRate: number; channels: number; targetFillFrames: number; noAudio?: boolean }
interface LoadRomMsg { type: 'load_rom'; rom: Uint8Array; useVT: boolean; strict: boolean; apuRegion?: 'NTSC'|'PAL'; apuTiming?: 'integer'|'fractional'; apuSynth?: 'raw'|'blep' }
interface StartMsg { type: 'start' }
interface PauseMsg { type: 'pause' }
interface InputMsg { type: 'input'; code: string; down: boolean }

type Msg = InitMsg | LoadRomMsg | StartMsg | PauseMsg | InputMsg

let sys: NESSystem | null = null
let writer = null as ReturnType<typeof getWriter> | null
let sampleRate = 48000
let channels = 2
let run = false
let useBlep = false
let audioTimer: number | null = null
let videoTimer: number | null = null
let targetFillFrames = 4096
let noAudio = false

// Simple DC-block filter state for audio (applied in worker before writing to SAB)
let dcPrevIn = 0
let dcPrevOut = 0

const state = { lastCycles: 0, targetCycles: 0 }

// Preallocated audio scratch buffer (set after init)
let scratch: Float32Array | null = null

// Telemetry (worker-side)
let pumpCount = 0
const pumpMsWindow: number[] = []
let framesPerPumpAvg = 0
let occMin = Number.POSITIVE_INFINITY
let occMax = 0
let occSum = 0
let occCount = 0
let lastStatsPost = (typeof performance !== 'undefined') ? performance.now() : 0

const occupancy = (): number => {
  if (!writer) return 0
  return writer.occupancy()
}

const audioQuantum = 128
const maxChunkFrames = 1024

const generateInto = (frames: number, buf: Float32Array): number => {
  if (!sys) return 0
  const cyclesPerSample = CPU_HZ / sampleRate
  let i = 0
  while (i < frames) {
    state.targetCycles += cyclesPerSample
    // Step CPU towards target cycles
    while (sys.cpu.state.cycles < state.targetCycles) sys.stepInstruction()
    const sampleStart = state.targetCycles - cyclesPerSample
    const s8: number = (useBlep && (sys.apu as unknown as { mixSampleBlep?: (s: number, c: number) => number }).mixSampleBlep)
      ? (((sys.apu as unknown as { mixSampleBlep: (s: number, c: number) => number }).mixSampleBlep(sampleStart, cyclesPerSample)) | 0)
      : (sys.apu.mixSample() | 0)
    const amp = ((s8 - 128) / 128)
    // DC-block: y[n] = x[n] - x[n-1] + R * y[n-1]
    const R = 0.999
    const y = (amp - dcPrevIn) + R * dcPrevOut
    dcPrevIn = amp
    dcPrevOut = y
    const out = Math.max(-1, Math.min(1, y))
    if (channels === 2) {
      const p = i * 2
      buf[p] = out
      buf[p + 1] = out
    } else {
      buf[i] = out
    }
    i++
  }
  return frames
}

const postStatsIfDue = (toProduce: number, occNow: number, t0: number, t1: number, extra?: { occProd?: number; r?: number; w?: number }): void => {
  pumpCount++
  const dt = Math.max(0, t1 - t0)
  pumpMsWindow.push(dt)
  if (pumpMsWindow.length > 240) pumpMsWindow.shift()
  framesPerPumpAvg = ((framesPerPumpAvg * (pumpCount - 1)) + toProduce) / pumpCount
  occMin = Math.min(occMin, occNow)
  occMax = Math.max(occMax, occNow)
  occSum += occNow
  occCount++
  const now = (typeof performance !== 'undefined') ? performance.now() : 0
  if ((now - lastStatsPost) > 1000) {
    const sorted = pumpMsWindow.slice().sort((a, b) => a - b)
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95)))
    const pumpMs95p = sorted[idx] || 0
    const pumpMsAvg = sorted.length > 0 ? (sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0
    const occAvg = occCount > 0 ? (occSum / occCount) : 0
    ;(postMessage as (msg: unknown) => void)({
      type: 'worker-stats',
      audio: {
        pumps: pumpCount,
        pumpMsAvg,
        pumpMs95p,
        framesPerPumpAvg,
        sabOccMin: occMin,
        sabOccAvg: occAvg,
        sabOccMax: occMax,
        occConsumerNow: occNow,
        occProducerNow: extra?.occProd ?? -1,
        r: extra?.r ?? -1,
        w: extra?.w ?? -1,
      },
    })
    lastStatsPost = now
    occMin = Number.POSITIVE_INFINITY
    occMax = 0
    occSum = 0
    occCount = 0
  }
}

const pumpAudio = (): void => {
  if (!run || !writer || !sys) return
  // Use consumer-published occupancy if available
  const occConsumer = (writer as any).consumerOccupancy ? (writer as unknown as { consumerOccupancy: () => number }).consumerOccupancy() : occupancy()
  const occ = occConsumer
  const free = writer.freeSpace()
  // Aggressive burst pumping until near target
  if (free < audioQuantum) return
  if (!scratch) scratch = new Float32Array(maxChunkFrames * channels)
  if (state.lastCycles === 0) { state.lastCycles = sys.cpu.state.cycles; state.targetCycles = state.lastCycles }
  const t0 = (typeof performance !== 'undefined') ? performance.now() : 0
  let bursts = 0
  let occNow = occ
  let freeNow = free
  let producedTotal = 0
  while (occNow < (targetFillFrames - audioQuantum) && freeNow >= audioQuantum && bursts < 8) {
    const desired = Math.min(freeNow, Math.max(0, targetFillFrames - occNow))
    const toProduce = Math.max(audioQuantum, Math.min(maxChunkFrames, desired))
    const buf = scratch.subarray(0, toProduce * channels)
    generateInto(toProduce, buf)
    writer.write(buf)
    producedTotal += toProduce
    occNow = (writer as any).consumerOccupancy ? (writer as any).consumerOccupancy() : writer.occupancy()
    freeNow = writer.freeSpace()
    bursts++
  }
  const t1 = (typeof performance !== 'undefined') ? performance.now() : 0

  // Telemetry (include producer view and R/W)
  const prodOcc = writer.occupancy()
  const { r, w } = (writer as unknown as { debugRW: () => { r: number; w: number } }).debugRW()
  postStatsIfDue(producedTotal, occ, t0, t1, { occProd: prodOcc, r, w })

  // If far below target (underrun risk), schedule a micro backfill
  if (writer.occupancy() < (targetFillFrames >> 1) && free > 0) {
    setTimeout(pumpAudio, 0)
  }
}

const stepOneFrame = (): void => {
  if (!sys) return
  const start = sys.ppu.frame
  let guard = 0
  // Hard cap to avoid runaway if something goes wrong; typical SMB frames need ~30k CPU cycles
  while (sys.ppu.frame === start && guard < 20_000_000) { sys.stepInstruction(); guard++ }
}

const sendVideoFrame = (): void => {
  if (!sys) return
  if (!writer) stepOneFrame()
  const fb = (sys.ppu as unknown as { getFrameBuffer: () => Uint8Array }).getFrameBuffer()
  // Transfer palette indices buffer to main; main will colorize
  const buf = new Uint8Array(fb)
  ;(postMessage as (msg: unknown, transfer?: Transferable[]) => void)({ type: 'ppu-frame', w: 256, h: 240, indices: buf }, [buf.buffer])
}

const startLoops = (): void => {
  if (audioTimer == null) audioTimer = (setInterval(pumpAudio, 1) as unknown as number)
  if (videoTimer == null) videoTimer = (setInterval(sendVideoFrame, 1000 / 60) as unknown as number)
}

const stopLoops = (): void => {
  if (audioTimer != null) { clearInterval(audioTimer as unknown as number); audioTimer = null }
  if (videoTimer != null) { clearInterval(videoTimer as unknown as number); videoTimer = null }
}

const handleMessage = (e: MessageEvent<Msg>): void => {
  const msg = e.data
  switch (msg.type) {
case 'init': {
      noAudio = !!msg.noAudio
      writer = msg.sab ? getWriter(msg.sab) : null
      sampleRate = msg.sampleRate|0
      channels = msg.channels|0
      targetFillFrames = msg.targetFillFrames|0
      // Allocate scratch based on channels
      scratch = new Float32Array(maxChunkFrames * channels)
      break
    }
    case 'load_rom': {
      const rom = parseINes(msg.rom)
      sys = new NESSystem(rom)
      ;(sys.ppu as unknown as { setTimingMode?: (m: 'vt'|'legacy') => void }).setTimingMode?.(msg.useVT ? 'vt' : 'legacy')
      // Configure APU region and timing if provided (defaults remain NTSC/integer)
      try {
        const region = (msg.apuRegion === 'PAL' ? 'PAL' : 'NTSC') as 'NTSC'|'PAL'
        ;(sys.apu as unknown as { setRegion?: (r: 'NTSC'|'PAL') => void }).setRegion?.(region)
        const timing = (msg.apuTiming === 'fractional' ? 'fractional' : 'integer') as 'integer'|'fractional'
        ;(sys.apu as unknown as { setFrameTimingMode?: (m: 'integer'|'fractional') => void }).setFrameTimingMode?.(timing)
        // Optional band-limited synthesis scaffolding
        useBlep = msg.apuSynth === 'blep'
        if (useBlep) (sys.apu as unknown as { enableBandlimitedSynth?: (v: boolean) => void }).enableBandlimitedSynth?.(true)
      } catch {}
      sys.reset()
      sys.io.write(0x2001, 0x1E)
      ;(sys.cpu as unknown as { setIllegalMode?: (m: 'strict'|'lenient') => void }).setIllegalMode?.(msg.strict ? 'strict' : 'lenient')
      state.lastCycles = 0; state.targetCycles = 0
      // Reset DC blocker state
      dcPrevIn = 0; dcPrevOut = 0
      break
    }
case 'start': {
      run = true
      // Synchronous prefill to reduce initial underruns
      if (writer && sys) {
        if (!scratch) scratch = new Float32Array(maxChunkFrames * channels)
        // Fill up to targetFillFrames (bounded bursts to avoid blocking too long)
        let guard = 0
        while (writer.occupancy() < (targetFillFrames - audioQuantum) && writer.freeSpace() >= audioQuantum && guard < 64) {
          const occNow = writer.occupancy()
          const toProduce = Math.min(maxChunkFrames, Math.max(audioQuantum, targetFillFrames - occNow))
          const buf = scratch.subarray(0, toProduce * channels)
          generateInto(toProduce, buf)
          writer.write(buf)
          guard++
        }
      }
      startLoops()
      break
    }
    case 'pause': {
      run = false
      stopLoops()
      break
    }
    case 'input': {
      if (!sys) break
      // Map key codes to buttons as in main
      const map: Record<string, { btn: string; idx: 1|2 }|undefined> = {
        'KeyZ': { btn: 'A', idx: 1 },
        'KeyX': { btn: 'B', idx: 1 },
        'ShiftLeft': { btn: 'Select', idx: 1 },
        'Enter': { btn: 'Start', idx: 1 },
        'ArrowUp': { btn: 'Up', idx: 1 },
        'ArrowDown': { btn: 'Down', idx: 1 },
        'ArrowLeft': { btn: 'Left', idx: 1 },
        'ArrowRight': { btn: 'Right', idx: 1 },
      }
      const m = map[msg.code]
      if (m) (sys.io.getController(m.idx) as unknown as { setButton: (b: string, d: boolean) => void }).setButton(m.btn, msg.down)
      break
    }
  }
}

self.onmessage = handleMessage

