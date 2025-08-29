/* eslint-disable no-restricted-globals */
// Worker that runs the NES emulator core and writes audio into a SAB ring buffer.
// Arrow functions only for top-level functions.

import { NESSystem } from '../../../core/system/system'
import { parseINes } from '../../../core/cart/ines'
import { getWriter, type SabBundle } from '../audio/shared-ring-buffer'

const CPU_HZ = 1789773

interface InitMsg { type: 'init'; sab: SabBundle; sampleRate: number; channels: number; targetFillFrames: number }
interface LoadRomMsg { type: 'load_rom'; rom: Uint8Array; useVT: boolean; strict: boolean }
interface StartMsg { type: 'start' }
interface PauseMsg { type: 'pause' }
interface InputMsg { type: 'input'; code: string; down: boolean }

type Msg = InitMsg | LoadRomMsg | StartMsg | PauseMsg | InputMsg

let sys: NESSystem | null = null
let writer = null as ReturnType<typeof getWriter> | null
let sampleRate = 48000
let channels = 2
let run = false
let audioTimer: number | null = null
let videoTimer: number | null = null
let targetFillFrames = 4096

const state = { lastCycles: 0, targetCycles: 0 }

const occupancy = (): number => {
  if (!writer) return 0
  return writer.occupancy()
}

const audioQuantum = 128
const maxChunkFrames = 1024

const generateInto = (frames: number, scratch: Float32Array): number => {
  if (!sys) return 0
  const cyclesPerSample = CPU_HZ / sampleRate
  let i = 0
  while (i < frames) {
    state.targetCycles += cyclesPerSample
    // Step CPU towards target cycles
    while (sys.cpu.state.cycles < state.targetCycles) sys.stepInstruction()
    const amp = (((sys.apu.mixSample() | 0) - 128) / 128)
    if (channels === 2) {
      const p = i * 2
      scratch[p] = amp
      scratch[p + 1] = amp
    } else {
      scratch[i] = amp
    }
    i++
  }
  return frames
}

const pumpAudio = (): void => {
  if (!run || !writer || !sys) return
  const occ = occupancy()
  const free = writer.freeSpace()
  // Pre-fill to target then maintain
  const desired = Math.min(free, Math.max(0, targetFillFrames - occ))
  const toProduce = Math.max(audioQuantum, Math.min(maxChunkFrames, desired))
  if (free < audioQuantum) return
  const scratch = new Float32Array(toProduce * channels)
  if (state.lastCycles === 0) { state.lastCycles = sys.cpu.state.cycles; state.targetCycles = state.lastCycles }
  generateInto(toProduce, scratch)
  writer.write(scratch)
}

const sendVideoFrame = (): void => {
  if (!sys) return
  const fb = (sys.ppu as unknown as { getFrameBuffer: () => Uint8Array }).getFrameBuffer()
  // Transfer palette indices buffer to main; main will colorize
  // Note: Transfer underlying buffer and rewrap so we don't block
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
      writer = getWriter(msg.sab)
      sampleRate = msg.sampleRate|0
      channels = msg.channels|0
      targetFillFrames = msg.targetFillFrames|0
      break
    }
    case 'load_rom': {
      const rom = parseINes(msg.rom)
      sys = new NESSystem(rom)
      ;(sys.ppu as unknown as { setTimingMode?: (m: 'vt'|'legacy') => void }).setTimingMode?.(msg.useVT ? 'vt' : 'legacy')
      sys.reset()
      sys.io.write(0x2001, 0x1E)
      ;(sys.cpu as unknown as { setIllegalMode?: (m: 'strict'|'lenient') => void }).setIllegalMode?.(msg.strict ? 'strict' : 'lenient')
      state.lastCycles = 0; state.targetCycles = 0
      break
    }
    case 'start': {
      run = true
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

