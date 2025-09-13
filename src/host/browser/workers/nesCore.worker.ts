/* eslint-disable no-restricted-globals */
// Worker that runs the NES emulator core and writes audio into a SAB ring buffer.
// Arrow functions only for top-level functions.

import { NESSystem } from '../../../core/system/system'
import { parseINes } from '../../../core/cart/ines'
import { getWriter, type SabBundle } from '../audio/shared-ring-buffer'

const CPU_HZ = 1789773

interface InitMsg { type: 'init'; sab?: SabBundle | null; sampleRate: number; channels: number; targetFillFrames: number; noAudio?: boolean; useLegacy?: boolean }
interface LoadRomMsg { type: 'load_rom'; rom: Uint8Array; useVT: boolean; strict: boolean; apuRegion?: 'NTSC'|'PAL'; apuTiming?: 'integer'|'fractional'; apuSynth?: 'raw'|'blep' }
interface StartMsg { type: 'start' }
interface PauseMsg { type: 'pause' }
interface InputMsg { type: 'input'; code: string; down: boolean }
interface SetDebugMsg { type: 'set-debug'; enabled: boolean }

type Msg = InitMsg | LoadRomMsg | StartMsg | PauseMsg | InputMsg | SetDebugMsg

let sys: NESSystem | null = null
let writer = null as ReturnType<typeof getWriter> | null
let legacyChunk: Float32Array | null = null
let sampleRate = 48000
let channels = 2
let run = false
let useBlep = false
let audioTimer: number | null = null
let videoTimer: number | null = null
let lastPpuFrameSent = -1
let targetFillFrames = 4096
let noAudio = false
let useLegacy = false
// Debug logging gate (off by default)
let debugAudio = false

// Monitor whether audio ring is draining; if not, notify main to fallback
let drainMonitor: number | null = null
let lastOccSeen = 0
let lastOccDecreaseTs = 0
let startupPhase = true
const startDrainMonitor = (): void => {
  if (!writer || noAudio || drainMonitor != null) return
  lastOccSeen = (writer as unknown as { occupancy: () => number }).occupancy()
  lastOccDecreaseTs = (typeof performance !== 'undefined') ? performance.now() : 0
  startupPhase = true
  drainMonitor = (setInterval(() => {
    if (!writer || noAudio) { if (drainMonitor != null) { clearInterval(drainMonitor as unknown as number); drainMonitor = null } return }
    const now = (typeof performance !== 'undefined') ? performance.now() : 0
    const occ = (writer as unknown as { occupancy: () => number }).occupancy()
    
    // During startup (first 3 seconds), be more lenient
    if (startupPhase && (now - lastOccDecreaseTs) > 3000) {
      startupPhase = false
    }
    
    if (occ < lastOccSeen) {
      lastOccDecreaseTs = now
      lastOccSeen = occ
    } else {
      lastOccSeen = occ
    }
    
    // Only check for stall after startup phase and if occupancy is high
    const stallThreshold = startupPhase ? 5000 : 2000
    const highOccupancy = occ > (targetFillFrames * 0.8)
    
    if (!startupPhase && highOccupancy && (now - lastOccDecreaseTs) > stallThreshold) {
      ;(postMessage as (msg: unknown) => void)({ type: 'audio-stall' })
      clearInterval(drainMonitor as unknown as number)
      drainMonitor = null
    }
  }, 250) as unknown as number)
}
const stopDrainMonitor = (): void => {
  if (drainMonitor != null) { clearInterval(drainMonitor as unknown as number); drainMonitor = null }
}

// Simple DC-block filter state for audio (applied in worker before writing to SAB)
let dcPrevIn = 0
let dcPrevOut = 0

const state = { lastCycles: 0, targetCycles: 0 }

// Preallocated audio scratch buffer (set after init)
let scratch: Float32Array | null = null

// Telemetry (worker-side)
let telemetryPumpCount = 0
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
  // Clamp sampleRate to sane range to avoid division by zero or NaN
  const sr = (sampleRate && isFinite(sampleRate) && sampleRate > 0) ? sampleRate : 44100
  const cyclesPerSample = CPU_HZ / sr
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
  telemetryPumpCount++
  const dt = Math.max(0, t1 - t0)
  pumpMsWindow.push(dt)
  if (pumpMsWindow.length > 240) pumpMsWindow.shift()
  framesPerPumpAvg = ((framesPerPumpAvg * (telemetryPumpCount - 1)) + toProduce) / telemetryPumpCount
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
        pumps: telemetryPumpCount,
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

let pumpCount = 0
let lastPumpTs = (typeof performance !== 'undefined') ? performance.now() : 0
const pumpAudio = (): void => {
  if (!run || !sys) return
  if (useLegacy) {
    // Generate a small chunk and post to main
    const frames = 512
    const ch = Math.max(1, channels|0)
    if (!legacyChunk || legacyChunk.length < (frames * ch)) legacyChunk = new Float32Array(frames * ch)
    generateInto(frames, legacyChunk)
    ;(postMessage as (m: unknown, t?: Transferable[]) => void)({ type: 'audio-chunk', samples: legacyChunk }, [legacyChunk.buffer])
    return
  }
  if (!writer) return
  
  pumpCount++
  if (debugAudio && (pumpCount % 2000 === 0)) {
    // Rare heartbeat log for debugging only
    console.log('[worker] pumpAudio heartbeat', pumpCount)
  }
  
  // Initialize audio state if needed
  if (state.lastCycles === 0) { 
    state.lastCycles = sys.cpu.state.cycles; 
    state.targetCycles = state.lastCycles 
    if (debugAudio) console.log('[worker] audio state initialized, cycles:', state.lastCycles)
  }
  
  // Calculate occupancy and free space using writer helpers
  let r, w, occNow, freeNow
  try {
    const debug = writer.debugRW()
    r = debug.r
    w = debug.w
    occNow = writer.occupancy()
    freeNow = writer.freeSpace()
  } catch (e) {
    if (debugAudio) console.error('[worker] debugRW failed:', e)
    return
  }
  
  // Only produce if we have reasonable free space
  if (freeNow < audioQuantum) {
    if (debugAudio && (pumpCount % 2000 === 0)) {
      console.log('[worker] skipping pump - insufficient free space:', freeNow, 'need:', audioQuantum)
    }
    return
  }
  
  if (!scratch) scratch = new Float32Array(maxChunkFrames * channels)
  
  const t0 = (typeof performance !== 'undefined') ? performance.now() : 0
  const dt = Math.max(0, t0 - lastPumpTs)
  lastPumpTs = t0
  
  // Compute how many frames we must produce this pump based on elapsed real time
  const mustProduce = Math.max(audioQuantum, Math.min(maxChunkFrames, Math.ceil((sampleRate | 0) * dt / 1000)))

  let bursts = 0
  let producedTotal = 0
  
  // Aim to keep buffer around ~55–60% for steady progression; keep each pump very short
  const fillTarget = Math.max(audioQuantum, Math.floor(targetFillFrames * 0.55))
  let maxPumpFramesPerCall = 512
  let maxPumpMs = 2.5
  
  // If we are far behind or elapsed time was long, allow a slightly bigger pump budget (but keep it tight)
  const deficit = Math.max(0, fillTarget - occNow)
  const ratio = fillTarget > 0 ? (deficit / fillTarget) : 0
  if (ratio > 0.5 || mustProduce > 512) { maxPumpMs = 4.0; maxPumpFramesPerCall = 768 }

  const targetThisPump = Math.min(maxPumpFramesPerCall, mustProduce + Math.min(deficit, 384))

  // Produce audio in very small bursts; enforce time and frame budget per pump
  while (occNow < fillTarget && freeNow >= audioQuantum && bursts < 6 && producedTotal < targetThisPump) {
    const desired = Math.min(freeNow, Math.max(0, fillTarget - occNow), targetThisPump - producedTotal)
    const perBurstCap = ratio > 0.5 ? 192 : 128
    const toProduce = Math.max(audioQuantum, Math.min(perBurstCap, desired))
    const buf = scratch.subarray(0, toProduce * channels)
    generateInto(toProduce, buf)

    const written = writer.write(buf)
    if (written === 0) {
      if (debugAudio) console.warn('[worker] failed to write audio data, freeSpace:', freeNow, 'toProduce:', toProduce)
      break
    }
    producedTotal += toProduce
    occNow = writer.occupancy()
    freeNow = writer.freeSpace()
    bursts++

    // Time-budget guard
    const now = (typeof performance !== 'undefined') ? performance.now() : 0
    if ((now - t0) > maxPumpMs) break
  }
  const t1 = (typeof performance !== 'undefined') ? performance.now() : 0

  // After producing audio, opportunistically ship a video frame if a new one is ready
  try { sendVideoFrame() } catch {}

  // Telemetry (include producer view and R/W)
  const prodOcc = occNow // Use the same occupancy calculation
  const { r: rTelemetry, w: wTelemetry } = (writer as unknown as { debugRW: () => { r: number; w: number } }).debugRW()
  postStatsIfDue(producedTotal, occNow, t0, t1, { occProd: prodOcc, r: rTelemetry, w: wTelemetry })

  // If below target, schedule a micro backfill ASAP; otherwise next interval pump will handle it
  if (occNow < fillTarget && freeNow > 0) {
    setTimeout(pumpAudio, 0)
  }
}

// CPU/PPU advance is primarily driven by audio generation (generateInto).
// Keep this a no-op to avoid long blocking loops on the worker event loop.
const stepOneFrame = (): void => { /* no-op */ }

const sendVideoFrame = (): void => {
  if (!sys) return
  const cur = (sys.ppu as unknown as { frame: number }).frame | 0
  if (cur === lastPpuFrameSent) return
  const fb = (sys.ppu as unknown as { getFrameBuffer: () => Uint8Array }).getFrameBuffer()
  const buf = new Uint8Array(fb)
  ;(postMessage as (msg: unknown, transfer?: Transferable[]) => void)({ type: 'ppu-frame', w: 256, h: 240, indices: buf }, [buf.buffer])
  lastPpuFrameSent = cur
}

const startLoops = (): void => {
  // Use frequent, short audio pumps for stability; browsers clamp timers, but 2ms target is fine
  if (audioTimer == null) audioTimer = (setInterval(pumpAudio, 2) as unknown as number)
  if (videoTimer == null) videoTimer = (setInterval(sendVideoFrame, 1000 / 60) as unknown as number)
}

const stopLoops = (): void => {
  if (audioTimer != null) { clearInterval(audioTimer as unknown as number); audioTimer = null }
  if (videoTimer != null) { clearInterval(videoTimer as unknown as number); videoTimer = null }
}

const handleMessage = (e: MessageEvent<Msg>): void => {
  const msg = e.data
  switch (msg.type) {
    case 'set-debug': {
      debugAudio = !!msg.enabled
      break
    }
    case 'init': {
      noAudio = !!msg.noAudio
      useLegacy = !!msg.useLegacy
      writer = msg.sab ? getWriter(msg.sab) : null
      sampleRate = msg.sampleRate|0
      channels = msg.channels|0
      targetFillFrames = msg.targetFillFrames|0
      // Allocate scratch based on channels
      scratch = new Float32Array(maxChunkFrames * channels)
      
      console.log('[worker] init: noAudio:', noAudio, 'useLegacy:', useLegacy, 'writer:', !!writer, 'sampleRate:', sampleRate, 'channels:', channels, 'targetFillFrames:', targetFillFrames)
      if (writer) {
        const { r, w } = writer.debugRW()
        console.log('[worker] initial SAB state: r:', r, 'w:', w, 'occ:', writer.occupancy(), 'free:', writer.freeSpace())
      }
      
      // Drain monitor disabled: do not auto-fallback; remain on SAB path
      // if (writer && !noAudio && !useLegacy) startDrainMonitor()
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
      lastPpuFrameSent = -1
      break
    }
case 'start': {
      run = true
      // Synchronous prefill to reduce initial underruns
      if (!useLegacy && writer && sys) {
        if (!scratch) scratch = new Float32Array(maxChunkFrames * channels)
        // Fill up to targetFillFrames (bounded bursts to avoid blocking too long)
        let guard = 0
        while (writer.occupancy() < (targetFillFrames - audioQuantum) && writer.freeSpace() >= audioQuantum && guard < 64) {
          let occNow = writer.occupancy()
          const toProduce = Math.min(maxChunkFrames, Math.max(audioQuantum, targetFillFrames - occNow))
          const buf = scratch.subarray(0, toProduce * channels)
          generateInto(toProduce, buf)
          writer.write(buf)
          guard++
        }
      }
      startLoops()
      // Drain monitor disabled: do not auto-fallback; remain on SAB path
      // if (!useLegacy && writer && !noAudio) startDrainMonitor()
      break
    }
    case 'pause': {
      run = false
      stopLoops()
      stopDrainMonitor()
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

