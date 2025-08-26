import { NESSystem } from '@core/system/system'
import { parseINes } from '@core/cart/ines'
import { idxToRGB } from './palette'

// NTSC CPU clock (approx)
const CPU_HZ = 1789773

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

const canvas = $('#screen') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { alpha: false })!
const statusEl = $('#status') as HTMLSpanElement
const startBtn = $('#start') as HTMLButtonElement
const pauseBtn = $('#pause') as HTMLButtonElement
const romInput = $('#rom') as HTMLInputElement

let sys: NESSystem | null = null
let running = false
let audioCtx: AudioContext | null = null
let workletNode: AudioWorkletNode | null = null
let audioPump: number | null = null

// Audio sample generator state
const audioState: { lastCycles: number, targetCycles: number } = { lastCycles: 0, targetCycles: 0 }
// Video fallback stepping state (when audio is not driving emulation)
const videoState: { lastCycles: number } = { lastCycles: 0 }

async function setupAudio() {
  if (audioCtx) return
  audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  await audioCtx.audioWorklet.addModule(new URL('./nes-worklet.js', import.meta.url))
  workletNode = new AudioWorkletNode(audioCtx, 'nes-processor')
  workletNode.connect(audioCtx.destination)
}

function generateSamples(frames: number, sampleRate: number): Float32Array {
  if (!sys) return new Float32Array(frames)
  const out = new Float32Array(frames)
  const cyclesPerSample = CPU_HZ / sampleRate
  if (audioState.lastCycles === 0) {
    audioState.lastCycles = sys.cpu.state.cycles
    audioState.targetCycles = audioState.lastCycles
  }
  for (let i = 0; i < frames; i++) {
    audioState.targetCycles += cyclesPerSample
    // Step CPU until reaching target cycles
    while (sys.cpu.state.cycles < audioState.targetCycles) {
      sys.stepInstruction()
    }
    const amp = (((sys.apu.mixSample() | 0) - 128) / 128)
    out[i] = amp
    audioState.lastCycles = sys.cpu.state.cycles
  }
  return out
}

function startAudioPump() {
  if (!audioCtx || !workletNode) return
  if (audioPump != null) return
  const sampleRate = audioCtx.sampleRate
  const block = 512
  const intervalMs = Math.max(4, Math.floor((block / sampleRate) * 1000))
  audioPump = window.setInterval(() => {
    if (!running || !sys) return
    const buf = generateSamples(block, sampleRate)
    // transfer to worklet
    workletNode!.port.postMessage({ type: 'samples', data: buf }, [buf.buffer])
  }, intervalMs)
}

function stopAudioPump() {
  if (audioPump != null) { window.clearInterval(audioPump); audioPump = null }
}

function startLoop() {
  if (!sys) return
  running = true
  startBtn.disabled = true
  pauseBtn.disabled = false
  statusEl.textContent = 'Running'
  startAudioPump()
  requestAnimationFrame(frame)
}

function pauseLoop() {
  running = false
  startBtn.disabled = false
  pauseBtn.disabled = true
  statusEl.textContent = 'Paused'
  stopAudioPump()
}

// Keyboard -> controller mapping
const keyMap: Record<string, { btn: string, idx: 1|2 }> = {
  'KeyZ': { btn: 'A', idx: 1 },
  'KeyX': { btn: 'B', idx: 1 },
  'ShiftLeft': { btn: 'Select', idx: 1 },
  'Enter': { btn: 'Start', idx: 1 },
  'ArrowUp': { btn: 'Up', idx: 1 },
  'ArrowDown': { btn: 'Down', idx: 1 },
  'ArrowLeft': { btn: 'Left', idx: 1 },
  'ArrowRight': { btn: 'Right', idx: 1 },
}

function setButton(code: string, down: boolean) {
  if (!sys) return
  const m = keyMap[code]
  if (!m) return
  (sys.io.getController(m.idx) as any).setButton(m.btn, down)
}

window.addEventListener('keydown', (ev) => {
  if (keyMap[ev.code]) ev.preventDefault()
  setButton(ev.code, true)
})
window.addEventListener('keyup', (ev) => {
  if (keyMap[ev.code]) ev.preventDefault()
  setButton(ev.code, false)
})

// Render one frame to canvas from PPU full framebuffer
function renderFrameToCanvas() {
  if (!sys) return
  const fb = (sys.ppu as any).getFrameBuffer() as Uint8Array // 256x240 palette indices
  const img = ctx.createImageData(256, 240)
  const data = img.data
  for (let i = 0, p = 0; i < fb.length; i++, p += 4) {
    const [r, g, b] = idxToRGB(fb[i] & 0x3F)
    data[p+0] = r
    data[p+1] = g
    data[p+2] = b
    data[p+3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

function frame() {
  if (!running || !sys) return
  // If audio pump is active, it drives CPU stepping. Otherwise, step roughly one video frame worth of CPU cycles here.
  const audioActive = !!audioPump && !!audioCtx && audioCtx.state === 'running'
  if (!audioActive) {
    const nowCycles = sys.cpu.state.cycles
    if (videoState.lastCycles === 0) videoState.lastCycles = nowCycles
    const target = videoState.lastCycles + Math.floor(CPU_HZ / 60)
    // Cap the amount of CPU work per RAF to avoid long stalls
    let guard = 0
    while (sys.cpu.state.cycles < target && guard < 200000) { sys.stepInstruction(); guard++ }
    videoState.lastCycles = sys.cpu.state.cycles
  }
  renderFrameToCanvas()
  requestAnimationFrame(frame)
}

romInput.addEventListener('change', async () => {
  const file = romInput.files?.[0]
  if (!file) return
  statusEl.textContent = `Loading ${file.name}...`
  const buf = new Uint8Array(await file.arrayBuffer())
  try {
    const rom = parseINes(buf)
    sys = new NESSystem(rom)
    // Default to VT timing for accuracy; allow opting into legacy via ?legacy=1 or ?timing=legacy
    const params = new URLSearchParams(window.location.search)
    const forceLegacy = params.get('legacy') === '1' || params.get('timing') === 'legacy'
    const useVT = !forceLegacy
    ;(sys.ppu as any).setTimingMode?.(useVT ? 'vt' : 'legacy')
    sys.reset()
    // Minimal rendering enable (left masks on for stable CRCs/visuals)
    sys.io.write(0x2001, 0x1E)
    // Lenient illegal opcodes by default to avoid jams on bad data; allow strict via ?strict=1
    const strict = params.get('strict') === '1'
    ;(sys.cpu as any).setIllegalMode?.(strict ? 'strict' : 'lenient')
    // Prepare audio context on user gesture (start)
    startBtn.disabled = false
    pauseBtn.disabled = true
    statusEl.textContent = `Ready — press Start${useVT ? ' (VT timing)' : ' (legacy timing)'}`
  } catch (e: any) {
    statusEl.textContent = 'Failed to load ROM'
    console.error(e)
  }
})

startBtn.addEventListener('click', async () => {
  if (!sys) return
  await setupAudio()
  await audioCtx!.resume()
  startLoop()
})

pauseBtn.addEventListener('click', () => {
  pauseLoop()
})

