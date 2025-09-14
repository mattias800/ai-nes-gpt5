import { NES_PALETTE } from './palette'
import { createAudioSAB } from './audio/shared-ring-buffer'
// Import the audio worklet URL at module top (TS + ?url) so it resolves in dev and build
import nesAudioProcessorUrl from './worklets/nes-audio-processor.ts?url'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import NESCoreWorker from './workers/nesCore.worker.ts?worker'

// Query flags (read once; UI controls take precedence)
const query = new URL(window.location.href).searchParams
const defaultStatsEnabled = query.get('stats') === '1'
const defaultForceNoAudio = query.get('noaudio') === '1'
const defaultFastDraw = query.has('fastdraw') ? (query.get('fastdraw') === '1') : true
const defaultLowLat = query.has('lowlat') ? (query.get('lowlat') === '1') : true
const fillParam = (() => { const v = Number(query.get('fill')); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0 })()

// Prefer SAB (COOP/COEP) for low-latency audio, but fall back to video-only when unavailable
const sabAvailable = (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) && (typeof SharedArrayBuffer !== 'undefined')
console.log('[main] SAB availability check:', {
  crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'undefined',
  SharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined' ? 'available' : 'unavailable',
  sabAvailable
})
if (!sabAvailable) {
  const div = document.createElement('div')
  div.style.cssText = 'position:fixed;left:8px;bottom:8px;background:rgba(0,0,0,0.75);color:#fff;padding:10px 12px;border-radius:6px;max-width:520px;font:13px/1.4 system-ui;z-index:9999;'
  div.innerHTML = `
    <div style="margin-bottom:6px;font-weight:600">SharedArrayBuffer unavailable</div>
    <div>This environment lacks COOP/COEP. Using legacy audio fallback (slightly higher latency). For optimal audio, start via the dev server or host with headers:<br/>
      <code style="display:inline-block;margin-top:4px">Cross-Origin-Opener-Policy: same-origin</code><br/>
      <code style="display:inline-block">Cross-Origin-Embedder-Policy: require-corp</code>
    </div>`
  document.body.appendChild(div)
}

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T

const canvas = $('#screen') as HTMLCanvasElement
const statusEl = $('#status') as HTMLSpanElement
const startBtn = $('#start') as HTMLButtonElement
const pauseBtn = $('#pause') as HTMLButtonElement
const romInput = $('#rom') as HTMLInputElement
const optStats = $('#opt-stats') as HTMLInputElement | null
const optFastdraw = $('#opt-fastdraw') as HTMLInputElement | null
const optLowlat = $('#opt-lowlat') as HTMLInputElement | null
const optNoaudio = $('#opt-noaudio') as HTMLInputElement | null
const volumeSlider = $('#volume') as HTMLInputElement | null
const volumeLabel = $('#volumeLabel') as HTMLSpanElement | null

// Initialize UI controls from URL defaults
if (optStats) optStats.checked = defaultStatsEnabled
if (optFastdraw) optFastdraw.checked = defaultFastDraw
if (optLowlat) optLowlat.checked = defaultLowLat
if (optNoaudio) optNoaudio.checked = defaultForceNoAudio

// Runtime options (mutable)
let options = {
  statsEnabled: optStats?.checked ?? defaultStatsEnabled,
  forceNoAudio: optNoaudio?.checked ?? defaultForceNoAudio,
  lowLat: optLowlat?.checked ?? defaultLowLat,
}
let fastDraw: boolean = optFastdraw?.checked ?? defaultFastDraw

// Create drawing context using current fastDraw
let ctx = canvas.getContext('2d', { alpha: false, desynchronized: fastDraw } as any) as CanvasRenderingContext2D

let running = false
let audioCtx: AudioContext | null = null
let workletNode: AudioWorkletNode | null = null
let gainNode: GainNode | null = null
let volumeLevel = 0.25
let worker: Worker | null = null
let romBytes: Uint8Array | null = null
let flags: { useVT: boolean; strict: boolean } = { useVT: true, strict: false }
let legacyNode: AudioWorkletNode | null = null
let audioWorkletLoaded = false
// Diagnostics: track inbound frames from worker
let framesReceived = 0

// Helpers to manage session lifecycle
const teardownAudioGraph = (): void => {
  try { workletNode?.disconnect() } catch {}
  try { gainNode?.disconnect() } catch {}
  try { legacyNode?.disconnect() } catch {}
  workletNode = null
  gainNode = null
  legacyNode = null
}
const terminateWorker = (): void => {
  try { worker?.terminate() } catch {}
  worker = null
}
const resetPresentationState = (): void => {
  latestFrame = null
  newFrameAvailable = false
  framesDrawn = 0
  framesDropped = 0
  framesReceived = 0
  fpsCounter = 0
  drawCostEMA = 0
  lastFpsTs = performance.now()
}


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
let stats: StatsOverlay | null = null
const setStatsEnabled = (enabled: boolean): void => {
  if (enabled) {
    if (!stats) stats = makeStatsOverlay()
  } else {
    if (stats) { stats.root.remove(); stats = null }
  }
  try { workletNode?.port.postMessage({ type: 'enable-stats', value: enabled }) } catch {}
}
setStatsEnabled(options.statsEnabled)
const onStats = (data: any): void => {
  if (!stats) return
  if (data?.type === 'worker-stats' && data.audio) {
    const a = data.audio
    stats.set('pump/ms avg', (a.pumpMsAvg ?? 0).toFixed(2))
    stats.set('pump/ms 95p', (a.pumpMs95p ?? 0).toFixed(2))
    stats.set('frames/pump avg', (a.framesPerPumpAvg ?? 0).toFixed(1))
    if (typeof a.genMsAvg === 'number') stats.set('gen/ms avg', (a.genMsAvg ?? 0).toFixed(2))
    if (typeof a.writeMsAvg === 'number') stats.set('write/ms avg', (a.writeMsAvg ?? 0).toFixed(2))
    stats.set('SAB occ min/avg/max', `${Math.round(a.sabOccMin ?? 0)}/${Math.round(a.sabOccAvg ?? 0)}/${Math.round(a.sabOccMax ?? 0)}`)
    stats.set('occ now (cons/prod)', `${Math.round(a.occConsumerNow ?? -1)}/${Math.round(a.occProducerNow ?? -1)}`)
    stats.set('rw (r/w)', `${Math.round(a.r ?? -1)}/${Math.round(a.w ?? -1)}`)
  } else if (data?.type === 'worklet-stats') {
    stats.set('Underruns', String((data.underruns ?? 0)|0))
    stats.set('Worklet occ min/avg/max', `${Math.round(data.occMin ?? 0)}/${Math.round(data.occAvg ?? 0)}/${Math.round(data.occMax ?? 0)}`)
    stats.set('sampleRate', String((data.sampleRate ?? 0)|0))
    if (typeof data.r === 'number' && typeof data.w === 'number') {
      stats.set('worklet rw (r/w)', `${data.r}|${data.w}`)
    }
    if (typeof data.capacity === 'number') stats.set('worklet cap', String(data.capacity))
    if (typeof data.ringChannels === 'number') stats.set('worklet ch', String(data.ringChannels))
  }
}

// Volume helpers (UI -> master gain)
const getSliderVolume = (): number => {
  const raw = Number(volumeSlider?.value ?? '25')
  if (!Number.isFinite(raw)) return 0.25
  return Math.max(0, Math.min(1, raw / 100))
}
const applyVolume = (): void => {
  volumeLevel = getSliderVolume()
  try { if (gainNode) gainNode.gain.value = volumeLevel } catch {}
  if (volumeLabel) volumeLabel.textContent = `${Math.round(volumeLevel * 100)}%`
}
if (volumeSlider) {
  applyVolume()
  volumeSlider.addEventListener('input', applyVolume)
}

// Audio setup
const setupAudio = async (): Promise<void> => {
  if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 44100 })
  if (!audioWorkletLoaded) {
    await audioCtx.audioWorklet.addModule(nesAudioProcessorUrl as unknown as string)
    audioWorkletLoaded = true
  }
}

const startAudioGraph = (): { sab: ReturnType<typeof createAudioSAB> } => {
  const ctxA = audioCtx!
  const ringChannels = 1 // mono ring (APU is mono); worklet duplicates to stereo output
  const outputChannels = 2
  const sab = createAudioSAB({ capacityFrames: 16384, channels: ringChannels })
  
  // Create worklet and provide SAB in processorOptions so it's bound before the first process() call
  workletNode = new AudioWorkletNode(ctxA, 'nes-audio-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [outputChannels],
    channelCount: outputChannels,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: { controlSAB: sab.controlSAB, dataSAB: sab.dataSAB, dataByteOffset: (sab as any).dataByteOffset ?? 0 },
  } as any)
  
  workletNode.port.onmessage = (ev: MessageEvent) => {
    const d = ev.data
    if (d?.type === 'worklet-ready') {
      // Worklet may already be bound via processorOptions; keep idempotent set-sab as a fallback
      try {
        workletNode!.port.postMessage({ type: 'set-sab', controlSAB: sab.controlSAB, dataSAB: sab.dataSAB, dataByteOffset: (sab as any).dataByteOffset ?? 0 })
      } catch (e) {
        console.warn('[audio] failed to post set-sab:', e)
      }
    } else if (d?.type === 'worklet-ack') {
      console.log('[audio] worklet-ack:', d.what)
      onStats(d)
    } else if (d?.type === 'worklet-stats') {
      onStats(d)
  } else if (d?.type === 'worklet-error') {
      console.warn('[audio] worklet error:', d?.message)
    }
  }
  
  // Disable worker-driven drain monitor fallback entirely; rely on explicit SAB-availability logic only.
  try { worker?.postMessage({ type: 'set-debug', enabled: false }) } catch {}
  
  // Enable stats if requested
  if (options.statsEnabled) {
    workletNode.port.postMessage({ type: 'enable-stats', value: true })
  }
  gainNode = new GainNode(ctxA, { gain: volumeLevel })
  workletNode.connect(gainNode)
  gainNode.connect(ctxA.destination)
  
  // Ensure context is running after connecting
  try { 
    void ctxA.resume() 
    console.log('[audio] context resumed, state:', ctxA.state)
    
    // Check if worklet is properly connected
    setTimeout(() => {
      console.log('[audio] context state after 1s:', ctxA.state)
      console.log('[audio] worklet connected:', workletNode?.context === ctxA)
      console.log('[audio] gain connected:', gainNode?.context === ctxA)
    }, 1000)
  } catch (e) {
    console.warn('[audio] context resume failed:', e)
  }
  
  return { sab }
}

// Legacy audio path using message-queued chunks into a simpler worklet
const startLegacyAudioGraph = async (): Promise<void> => {
  if (!audioCtx) audioCtx = new AudioContext()
  await audioCtx.audioWorklet.addModule(new URL('./nes-worklet.js', import.meta.url))
  // Create processor that expects {type:'samples', data: Float32Array}
  legacyNode = new AudioWorkletNode(audioCtx, 'nes-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })
  // Route through master gain for unified volume control
  gainNode = new GainNode(audioCtx, { gain: volumeLevel })
  legacyNode.connect(gainNode)
  gainNode.connect(audioCtx.destination)
  try { await audioCtx.resume() } catch {}
}

// RAF-driven presenter with coalescing
const WIDTH = 256
const HEIGHT = 240
canvas.width = WIDTH
canvas.height = HEIGHT
let rgbaImage = ctx.createImageData(WIDTH, HEIGHT)
let rgbaU32 = new Uint32Array(rgbaImage.data.buffer)
const recreateContext = (): void => {
  ctx = canvas.getContext('2d', { alpha: false, desynchronized: fastDraw } as any) as CanvasRenderingContext2D
  rgbaImage = ctx.createImageData(WIDTH, HEIGHT)
  rgbaU32 = new Uint32Array(rgbaImage.data.buffer)
}
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
      stats.set('frames recv', String(framesReceived))
      fpsCounter = 0
      lastFpsTs = now
    }
  }
  requestAnimationFrame(presentLoop)
}
requestAnimationFrame(presentLoop)

// Wire up UI toggles
if (optStats) optStats.addEventListener('change', () => {
  options.statsEnabled = optStats.checked
  setStatsEnabled(options.statsEnabled)
})
if (optFastdraw) optFastdraw.addEventListener('change', () => {
  fastDraw = optFastdraw.checked
  recreateContext()
})
if (optLowlat) optLowlat.addEventListener('change', () => {
  options.lowLat = optLowlat.checked
  statusEl.textContent = `Low-latency audio ${options.lowLat ? 'enabled' : 'disabled'} (applies on next Start)`
})
if (optNoaudio) optNoaudio.addEventListener('change', () => {
  options.forceNoAudio = optNoaudio.checked
  statusEl.textContent = `No audio ${options.forceNoAudio ? 'enabled' : 'disabled'} (applies on next Start)`
})

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
    // Keep Pause/Resume availability depending on current run state
    pauseBtn.disabled = !running
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
  // If a session is already running or paused, tear it down before starting new (or rebooting with new ROM)
  terminateWorker()
  teardownAudioGraph()
  resetPresentationState()
  let sab: ReturnType<typeof createAudioSAB> | null = null
  let sampleRate = 48000
  const wantAudio = sabAvailable && !options.forceNoAudio
  let usingLegacy = false
  console.log('[main] Audio setup decision:', {
    sabAvailable,
    forceNoAudio: options.forceNoAudio,
    wantAudio
  })
  if (wantAudio) {
    try {
      console.log('[main] Setting up SAB audio...')
      // Explicitly match device sampleRate to avoid resample mismatch; load worklet before creating node
      await setupAudio()
      const g = startAudioGraph()
      sab = g.sab
      sampleRate = audioCtx!.sampleRate
      await audioCtx!.resume()
      console.log('[main] SAB audio setup successful, sampleRate:', sampleRate)
    } catch (e) {
      console.warn('Audio setup failed, falling back to no-audio mode:', e)
      sab = null
    }
  } else if (!options.forceNoAudio && !sabAvailable) {
    console.log('[main] SAB unavailable, setting up legacy audio...')
    // SAB unavailable (e.g., GitHub Pages). Use legacy audio path instead of video-only.
    try {
      await startLegacyAudioGraph()
      sampleRate = audioCtx?.sampleRate || 48000
      usingLegacy = true
      console.log('[main] Legacy audio setup successful, sampleRate:', sampleRate)
    } catch (e) {
      console.warn('Legacy audio setup failed, continuing without audio:', e)
      usingLegacy = false
    }
  }
// Spawn worker and init (use Vite worker loader for both dev and prod)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  worker = new (NESCoreWorker as unknown as { new (): Worker })()
  worker.onmessage = (e: MessageEvent): void => {
    const d = e.data || {}
    if (d.type === 'ppu-frame') {
      // Coalesce frames
      if (newFrameAvailable) framesDropped++
      latestFrame = d.indices as Uint8Array
      newFrameAvailable = true
      framesReceived++
      // Fast-draw path: draw immediately to minimize latency (may tear)
      if (fastDraw) { drawLatest(); newFrameAvailable = false }
  } else if (d.type === 'worker-stats') {
      onStats(d)
  } else if (d.type === 'audio-chunk' && legacyNode) {
      // samples is a transferable Float32Array; forward it directly without copying
      const arr = d.samples as Float32Array
      legacyNode.port.postMessage({ type: 'samples', data: arr }, [arr.buffer])
    }
  }
const targetFillFrames = fillParam > 0 ? fillParam : (options.lowLat ? 768 : 1024)
  worker.postMessage({ type: 'init', sab: sab ? { controlSAB: sab.controlSAB, dataSAB: sab.dataSAB, dataByteOffset: (sab as any).dataByteOffset ?? 0 } : null, sampleRate, channels: 1, targetFillFrames, noAudio: (!sab && !usingLegacy), useLegacy: usingLegacy })
  worker.onerror = (ev: ErrorEvent): void => { console.error('[worker] error', ev.message, ev.error) }
  worker.onmessageerror = (ev: MessageEvent): void => { console.error('[worker] messageerror', ev.data) }
  // Load ROM and start (send a copy so we retain our local ROM for possible fallback)
  {
    const romCopy = new Uint8Array(romBytes)
    worker.postMessage({ type: 'load_rom', rom: romCopy, useVT: flags.useVT, strict: flags.strict, apuRegion: (window as any).__apuRegion, apuTiming: (window as any).__apuTiming, apuSynth: (window as any).__apuSynth }, [romCopy.buffer])
  }
  worker.postMessage({ type: 'start' })
  running = true
  startBtn.disabled = true
  pauseBtn.disabled = false
  pauseBtn.textContent = 'Pause'
statusEl.textContent = sab ? `Running${options.lowLat ? ' (low-lat)' : ''}` : (usingLegacy ? 'Running (legacy audio)' : 'Running (no audio)')
    // If no frames arrive shortly after start, surface a helpful status to aid debugging.
    const startCheckTs = performance.now()
    setTimeout((): void => {
      if (framesReceived === 0 && running && performance.now() - startCheckTs >= 1900) {
        statusEl.textContent = 'No video frames received yet. Enable the Stats overlay and check the console for worker errors.'
      }
    }, 1800)
})

pauseBtn.addEventListener('click', (): void => {
  if (!worker) return
  if (running) {
    // Pause
    running = false
    startBtn.disabled = false
    pauseBtn.disabled = false
    pauseBtn.textContent = 'Resume'
    statusEl.textContent = 'Paused'
    worker.postMessage({ type: 'pause' })
  } else {
    // Resume current session
    worker.postMessage({ type: 'start' })
    running = true
    startBtn.disabled = true
    pauseBtn.disabled = false
    pauseBtn.textContent = 'Pause'
    statusEl.textContent = 'Running'
  }
})


