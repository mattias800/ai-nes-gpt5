import { NES_PALETTE } from './palette'
import { createAudioSAB } from './audio/shared-ring-buffer'

// Require SAB (COOP/COEP)
if (!crossOriginIsolated) {
  const div = document.createElement('div')
  div.style.cssText = 'position:fixed;inset:0;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font:16px/1.4 system-ui;text-align:center;padding:24px;'
  div.innerHTML = `
    <div>
      <h2 style="margin:0 0 12px 0">SharedArrayBuffer unavailable</h2>
      <p>This app requires crossOriginIsolated (COOP/COEP) to use low-latency audio. Start the dev server or host with headers:</p>
      <code style="display:inline-block;text-align:left;margin-top:8px">
        Cross-Origin-Opener-Policy: same-origin<br/>
        Cross-Origin-Embedder-Policy: require-corp
      </code>
    </div>`
  document.body.appendChild(div)
  throw new Error('crossOriginIsolated=false')
}

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T

const canvas = $('#screen') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true } as any)!
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

const query = new URL(window.location.href).searchParams
const statsEnabled = query.get('stats') === '1'

// Stats overlay
interface StatsOverlay { root: HTMLElement; set: (k: string, v: string) => void }
const makeStatsOverlay = (): StatsOverlay => {
  const root = document.createElement('div')
  root.style.cssText = 'position:fixed;right:8px;bottom:8px;background:rgba(0,0,0,0.6);color:#0f0;font:12px/1.3 monospace;padding:6px 8px;border-radius:4px;max-width:40vw;white-space:pre;'
  root.id = 'stats-overlay'
  const map = new Map<string, HTMLElement>()
  const set = (k: string, v: string): void => {
    let row = map.get(k)
    if (!row) { row = document.createElement('div'); map.set(k, row); root.appendChild(row) }
    row.textContent = `${k}: ${v}`
  }
  document.body.appendChild(root)
  return { root, set }
}
const stats = statsEnabled ? makeStatsOverlay() : null
const onStats = (data: any): void => {
  if (!stats) return
  if (data?.type === 'worker-stats' && data.audio) {
    const a = data.audio
    stats.set('pump/ms avg', (a.pumpMsAvg ?? 0).toFixed(2))
    stats.set('pump/ms 95p', (a.pumpMs95p ?? 0).toFixed(2))
    stats.set('frames/pump avg', (a.framesPerPumpAvg ?? 0).toFixed(1))
    stats.set('SAB occ min/avg/max', `${Math.round(a.sabOccMin ?? 0)}/${Math.round(a.sabOccAvg ?? 0)}/${Math.round(a.sabOccMax ?? 0)}`)
    stats.set('occ now (cons/prod)', `${Math.round(a.occConsumerNow ?? -1)}/${Math.round(a.occProducerNow ?? -1)}`)
    stats.set('rw (r/w)', `${Math.round(a.r ?? -1)}/${Math.round(a.w ?? -1)}`)
  } else if (data?.type === 'worklet-stats') {
    stats.set('Underruns', String((data.underruns ?? 0)|0))
    stats.set('Worklet occ min/avg/max', `${Math.round(data.occMin ?? 0)}/${Math.round(data.occAvg ?? 0)}/${Math.round(data.occMax ?? 0)}`)
    stats.set('sampleRate', String((data.sampleRate ?? 0)|0))
  }
}

// Audio setup
const setupAudio = async (): Promise<void> => {
  if (audioCtx) return
  audioCtx = new AudioContext()
  await audioCtx.audioWorklet.addModule(new URL('./worklets/nes-audio-processor.ts', import.meta.url))
}

const startAudioGraph = (): { sab: ReturnType<typeof createAudioSAB> } => {
  const ctxA = audioCtx!
  const channels = 2
  const sab = createAudioSAB({ capacityFrames: 16384, channels })
  workletNode = new AudioWorkletNode(ctxA, 'nes-audio-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
    processorOptions: { controlSAB: sab.controlSAB, dataSAB: sab.dataSAB },
  })
  workletNode.port.onmessage = (ev: MessageEvent) => onStats(ev.data)
  if (statsEnabled) workletNode.port.postMessage({ type: 'enable-stats', value: true })
  gainNode = new GainNode(ctxA, { gain: 0.25 })
  workletNode.connect(gainNode)
  gainNode.connect(ctxA.destination)
  return { sab }
}

// RAF-driven presenter with coalescing
const WIDTH = 256
const HEIGHT = 240
canvas.width = WIDTH
canvas.height = HEIGHT
let rgbaImage = ctx.createImageData(WIDTH, HEIGHT)
let rgbaU32 = new Uint32Array(rgbaImage.data.buffer)
const U32_PALETTE = (() => {
  const p = new Uint32Array(64)
  for (let i = 0; i < 64; i++) {
    const [r, g, b] = NES_PALETTE[i]
    p[i] = (0xFF << 24) | (b << 16) | (g << 8) | r
  }
  return p
})()

let latestFrame: Uint8Array | null = null
let newFrameAvailable = false
let framesDrawn = 0
let framesDropped = 0
let drawCostEMA = 0
let lastFpsTs = performance.now()
let fpsCounter = 0

const drawLatest = (): void => {
  if (!latestFrame) return
  const t0 = performance.now()
  const idx = latestFrame
  for (let i = 0; i < idx.length; i++) {
    rgbaU32[i] = U32_PALETTE[idx[i] & 0x3F]
  }
  ctx.putImageData(rgbaImage, 0, 0)
  const dt = performance.now() - t0
  drawCostEMA = drawCostEMA === 0 ? dt : (drawCostEMA * 0.9 + dt * 0.1)
  framesDrawn++
  fpsCounter++
}

const presentLoop = (_ts: number): void => {
  if (newFrameAvailable) {
    drawLatest()
    newFrameAvailable = false
  }
  if (stats) {
    const now = performance.now()
    if ((now - lastFpsTs) > 1000) {
      stats.set('video fps', String(fpsCounter))
      stats.set('frames drawn', String(framesDrawn))
      stats.set('frames dropped', String(framesDropped))
      stats.set('draw ms (EMA)', drawCostEMA.toFixed(2))
      fpsCounter = 0
      lastFpsTs = now
    }
  }
  requestAnimationFrame(presentLoop)
}
requestAnimationFrame(presentLoop)

// Keyboard -> controller mapping (send to worker)
window.addEventListener('keydown', (ev: KeyboardEvent): void => {
  if (!worker) return
  switch (ev.code) {
    case 'KeyZ': case 'KeyX': case 'ShiftLeft': case 'Enter':
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
      ev.preventDefault(); worker.postMessage({ type: 'input', code: ev.code, down: true }); break
  }
})
window.addEventListener('keyup', (ev: KeyboardEvent): void => {
  if (!worker) return
  switch (ev.code) {
    case 'KeyZ': case 'KeyX': case 'ShiftLeft': case 'Enter':
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
      ev.preventDefault(); worker.postMessage({ type: 'input', code: ev.code, down: false }); break
  }
})

romInput.addEventListener('change', async (): Promise<void> => {
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
    const regionParam = (params.get('region') || '').toLowerCase()
    const apuRegion: 'NTSC'|'PAL'|undefined = regionParam === 'pal' ? 'PAL' : (regionParam === 'ntsc' ? 'NTSC' : undefined)
    const timingParam = (params.get('apu_timing') || params.get('aputimings') || '').toLowerCase()
    const apuTiming: 'integer'|'fractional'|undefined = timingParam === 'fractional' ? 'fractional' : (timingParam === 'integer' ? 'integer' : undefined)
    const synthParam = (params.get('apu_synth') || params.get('synth') || '').toLowerCase()
    const apuSynth: 'raw'|'blep'|undefined = synthParam === 'blep' ? 'blep' : (synthParam === 'raw' ? 'raw' : undefined)
    statusEl.textContent = `Ready — press Start${useVT ? ' (VT timing)' : ' (legacy timing)'}${apuRegion ? `, APU ${apuRegion}` : ''}${apuTiming ? `, ${apuTiming} fc` : ''}${apuSynth ? `, ${apuSynth} synth` : ''}`
    ;(window as any).__apuRegion = apuRegion; (window as any).__apuTiming = apuTiming; (window as any).__apuSynth = apuSynth
  } catch (e) {
    statusEl.textContent = 'Failed to load ROM'
    console.error(e)
  }
})

startBtn.addEventListener('click', async (): Promise<void> => {
  if (!romBytes) return
  await setupAudio()
  await audioCtx!.resume()
  const { sab } = startAudioGraph()
  // Spawn worker and init
  worker = new Worker(new URL('./workers/nesCore.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent): void => {
    const d = e.data || {}
    if (d.type === 'ppu-frame') {
      // Coalesce frames
      if (newFrameAvailable) framesDropped++
      latestFrame = d.indices as Uint8Array
      newFrameAvailable = true
      // Draw immediately as a fallback to ensure visible output even if RAF is delayed
      drawLatest()
      newFrameAvailable = false
    } else if (d.type === 'worker-stats') {
      onStats(d)
    }
  }
  const channels = 2
  worker.postMessage({ type: 'init', sab, sampleRate: audioCtx!.sampleRate, channels, targetFillFrames: 4096 })
  // Load ROM and start
  worker.postMessage({ type: 'load_rom', rom: romBytes, useVT: flags.useVT, strict: flags.strict, apuRegion: (window as any).__apuRegion, apuTiming: (window as any).__apuTiming, apuSynth: (window as any).__apuSynth }, [romBytes.buffer])
  worker.postMessage({ type: 'start' })
  running = true
  startBtn.disabled = true
  pauseBtn.disabled = false
  statusEl.textContent = 'Running'
})

pauseBtn.addEventListener('click', (): void => {
  running = false
  startBtn.disabled = false
  pauseBtn.disabled = true
  statusEl.textContent = 'Paused'
  worker?.postMessage({ type: 'pause' })
})

