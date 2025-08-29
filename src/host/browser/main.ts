import { idxToRGB } from './palette'
import { createAudioSAB } from './audio/shared-ring-buffer'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

const canvas = $('#screen') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { alpha: false })!
const statusEl = $('#status') as HTMLSpanElement
const startBtn = $('#start') as HTMLButtonElement
const pauseBtn = $('#pause') as HTMLButtonElement
const romInput = $('#rom') as HTMLInputElement

let running = false
let audioCtx: AudioContext | null = null
let workletNode: AudioWorkletNode | null = null
let gainNode: GainNode | null = null
let worker: Worker | null = null
let romBytes: Uint8Array | null = null
let flags: { useVT: boolean; strict: boolean } = { useVT: true, strict: false }

const setupAudio = async (): Promise<void> => {
  if (audioCtx) return
  audioCtx = new AudioContext()
  // Load new SAB-based worklet
  await audioCtx.audioWorklet.addModule(new URL('./worklets/nes-audio-processor.ts', import.meta.url))
}

const startAudioGraph = (): { sab: ReturnType<typeof createAudioSAB> } => {
  const ctx = audioCtx!
  const channels = 2
  const sab = createAudioSAB({ capacityFrames: 16384, channels })
  workletNode = new AudioWorkletNode(ctx, 'nes-audio-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
    processorOptions: { controlSAB: sab.controlSAB, dataSAB: sab.dataSAB },
  })
  gainNode = new GainNode(ctx, { gain: 0.25 })
  workletNode.connect(gainNode)
  gainNode.connect(ctx.destination)
  return { sab }
}

// Draw frame indices buffer to canvas
const drawIndices = (indices: Uint8Array): void => {
  const img = ctx.createImageData(256, 240)
  const data = img.data
  for (let i = 0, p = 0; i < indices.length; i++, p += 4) {
    const [r, g, b] = idxToRGB(indices[i] & 0x3F)
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

// Keyboard -> controller mapping (send to worker)
window.addEventListener('keydown', (ev) => {
  if (!worker) return
  switch (ev.code) {
    case 'KeyZ': case 'KeyX': case 'ShiftLeft': case 'Enter':
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
      ev.preventDefault(); worker.postMessage({ type: 'input', code: ev.code, down: true }); break
  }
})
window.addEventListener('keyup', (ev) => {
  if (!worker) return
  switch (ev.code) {
    case 'KeyZ': case 'KeyX': case 'ShiftLeft': case 'Enter':
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
      ev.preventDefault(); worker.postMessage({ type: 'input', code: ev.code, down: false }); break
  }
})

romInput.addEventListener('change', async () => {
  const file = romInput.files?.[0]
  if (!file) return
  statusEl.textContent = `Loading ${file.name}...`
  try {
    romBytes = new Uint8Array(await file.arrayBuffer())
    const params = new URLSearchParams(window.location.search)
    const forceLegacy = params.get('legacy') === '1' || params.get('timing') === 'legacy'
    const useVT = !forceLegacy
    const strict = params.get('strict') === '1'
    flags = { useVT, strict }
    startBtn.disabled = false
    pauseBtn.disabled = true
    statusEl.textContent = `Ready — press Start${useVT ? ' (VT timing)' : ' (legacy timing)'}`
  } catch (e) {
    statusEl.textContent = 'Failed to load ROM'
    console.error(e)
  }
})

startBtn.addEventListener('click', async () => {
  if (!romBytes) return
  await setupAudio()
  await audioCtx!.resume()
  const { sab } = startAudioGraph()
  // Spawn worker and init
  worker = new Worker(new URL('./workers/nesCore.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent) => {
    const { type } = e.data || {}
    if (type === 'ppu-frame') {
      drawIndices(e.data.indices as Uint8Array)
    }
  }
  const channels = 2
  worker.postMessage({ type: 'init', sab, sampleRate: audioCtx!.sampleRate, channels, targetFillFrames: 4096 })
  // Load ROM and start
  worker.postMessage({ type: 'load_rom', rom: romBytes, useVT: flags.useVT, strict: flags.strict }, [romBytes.buffer])
  worker.postMessage({ type: 'start' })
  running = true
  startBtn.disabled = true
  pauseBtn.disabled = false
  statusEl.textContent = 'Running'
})

pauseBtn.addEventListener('click', () => {
  running = false
  startBtn.disabled = false
  pauseBtn.disabled = true
  statusEl.textContent = 'Paused'
  worker?.postMessage({ type: 'pause' })
})

