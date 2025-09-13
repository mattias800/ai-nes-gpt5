import { NES_PALETTE } from './palette'
import { createAudioSAB } from './audio/shared-ring-buffer'

// Prefer SAB (COOP/COEP) for low-latency audio, but fall back to video-only when unavailable
const sabAvailable = (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) && (typeof SharedArrayBuffer !== 'undefined')
if (!sabAvailable) {
  const div = document.createElement('div')
  div.style.cssText = 'position:fixed;left:8px;bottom:8px;background:rgba(0,0,0,0.75);color:#fff;padding:10px 12px;border-radius:6px;max-width:520px;font:13px/1.4 system-ui;z-index:9999;'
  div.innerHTML = `
    <div style="margin-bottom:6px;font-weight:600">Audio disabled (SharedArrayBuffer unavailable)</div>
    <div>This host will run in video-only fallback. For audio, start via the dev server or host with headers:<br/>
      <code style="display:inline-block;margin-top:4px">Cross-Origin-Opener-Policy: same-origin</code><br/>
      <code style="display:inline-block">Cross-Origin-Embedder-Policy: require-corp</code>
    </div>`
  document.body.appendChild(div)
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
let legacyNode: AudioWorkletNode | null = null
let audioWorkletLoaded = false
// Diagnostics: track inbound frames from worker and last frame timestamp
let framesReceived = 0
let lastFrameTs = 0
let lastWorkletStatsTs = 0

const query = new URL(window.location.href).searchParams
const statsEnabled = query.get('stats') === '1'
const forceNoAudio = query.get('noaudio') === '1'

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
    lastWorkletStatsTs = performance.now()
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

// Audio setup
const setupAudio = async (): Promise<void> => {
  if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 44100 })
  if (!audioWorkletLoaded) {
    await audioCtx.audioWorklet.addModule(new URL('./worklets/nes-audio-processor.ts', import.meta.url))
    audioWorkletLoaded = true
  }
}

const startAudioGraph = (): { sab: ReturnType<typeof createAudioSAB> } => {
  const ctxA = audioCtx!
  const channels = 2
  const sab = createAudioSAB({ capacityFrames: 16384, channels })
  
  // Create worklet without SAB in constructor to avoid timing issues
  workletNode = new AudioWorkletNode(ctxA, 'nes-audio-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
    channelCount: channels,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  } as any)
  
  workletNode.port.onmessage = (ev: MessageEvent) => {
    const d = ev.data
    if (d?.type === 'worklet-ready') {
      console.log('[audio] worklet-ready, sending SAB')
      // Send SAB binding after readiness
      try {
        workletNode!.port.postMessage({ type: 'set-sab', controlSAB: sab.controlSAB, dataSAB: sab.dataSAB })
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
  
  // Enable stats and connect audio graph
  workletNode.port.postMessage({ type: 'enable-stats', value: true })
  gainNode = new GainNode(ctxA, { gain: 0.25 })
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
  // Connect directly; volume can be adjusted on node if needed
  legacyNode.connect(audioCtx.destination)
  try { await audioCtx.resume() } catch {}
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
      stats.set('frames recv', String(framesReceived))
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
  let sab: ReturnType<typeof createAudioSAB> | null = null
  let sampleRate = 48000
  const channels = 2
  const wantAudio = sabAvailable && !forceNoAudio
  if (wantAudio) {
    try {
      // Explicitly match device sampleRate to avoid resample mismatch; load worklet before creating node
      await setupAudio()
      const g = startAudioGraph()
      sab = g.sab
      sampleRate = audioCtx!.sampleRate
      await audioCtx!.resume()
    } catch (e) {
      console.warn('Audio setup failed, falling back to no-audio mode:', e)
      sab = null
    }
  }
  // Spawn worker and init
  worker = new Worker(new URL('./workers/nesCore.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent): void => {
    const d = e.data || {}
    if (d.type === 'ppu-frame') {
      // Coalesce frames
      if (newFrameAvailable) framesDropped++
      latestFrame = d.indices as Uint8Array
      newFrameAvailable = true
      framesReceived++
      lastFrameTs = performance.now()
      // Draw immediately as a fallback to ensure visible output even if RAF is delayed
      drawLatest()
      newFrameAvailable = false
    } else if (d.type === 'worker-stats') {
      onStats(d)
    } else if (d.type === 'audio-stall') {
      console.warn('[audio] worker reported stall; switching to legacy audio fallback')
      void fallbackToLegacyAudio('worker-reported stall')
    } else if (d.type === 'audio-chunk' && legacyNode) {
      const arr = new Float32Array(d.samples)
      legacyNode.port.postMessage({ type: 'samples', data: arr }, [arr.buffer])
    }
  }
  worker.postMessage({ type: 'init', sab: sab ? { controlSAB: sab.controlSAB, dataSAB: sab.dataSAB } : null, sampleRate, channels, targetFillFrames: 4096, noAudio: !sab })
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
  statusEl.textContent = sab ? 'Running' : 'Running (no audio)'
    // If no frames arrive shortly after start, surface a helpful status to aid debugging.
    const startCheckTs = performance.now()
    setTimeout((): void => {
      if (framesReceived === 0 && running && performance.now() - startCheckTs >= 1900) {
        statusEl.textContent = 'No video frames received yet. Open with ?stats=1 and check console for worker errors.'
      }
      // If audio was desired but no worklet stats have arrived and frames are stalled, fall back to video-only
      if ((sabAvailable && !forceNoAudio) && (lastWorkletStatsTs < startCheckTs) && framesReceived <= 1 && running) {
        console.warn('[audio] suspected stall at startup; switching to legacy audio fallback')
        void fallbackToLegacyAudio('startup stall')
      }
    }, 1800)
    
    // Additional check for video-only mode if audio completely fails
    setTimeout((): void => {
      if (framesReceived === 0 && running && performance.now() - startCheckTs >= 3000) {
        console.warn('[video] No frames received after 3s, attempting video-only restart')
        statusEl.textContent = 'Restarting in video-only mode...'
        // Force restart without audio
        worker?.terminate()
        worker = new Worker(new URL('./workers/nesCore.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e: MessageEvent): void => {
          const d = e.data || {}
          if (d.type === 'ppu-frame') {
            if (newFrameAvailable) framesDropped++
            latestFrame = d.indices as Uint8Array
            newFrameAvailable = true
            framesReceived++
            lastFrameTs = performance.now()
            drawLatest()
            newFrameAvailable = false
          }
        }
        worker.postMessage({ type: 'init', sab: null, sampleRate: 48000, channels: 1, targetFillFrames: 2048, noAudio: true })
        if (romBytes) {
          const romCopy = new Uint8Array(romBytes)
          worker.postMessage({ type: 'load_rom', rom: romCopy, useVT: flags.useVT, strict: flags.strict, apuRegion: (window as any).__apuRegion, apuTiming: (window as any).__apuTiming, apuSynth: (window as any).__apuSynth }, [romCopy.buffer])
        }
        worker.postMessage({ type: 'start' })
        statusEl.textContent = 'Running (video-only fallback)'
      }
    }, 3000)
})

pauseBtn.addEventListener('click', (): void => {
  running = false
  startBtn.disabled = false
  pauseBtn.disabled = true
  statusEl.textContent = 'Paused'
  worker?.postMessage({ type: 'pause' })
})

// Fallback: respawn in legacy audio mode if SAB-drain fails
const fallbackToLegacyAudio = async (reason: string): Promise<void> => {
  // Tear down SAB path
  try { workletNode?.disconnect() } catch {}
  try { gainNode?.disconnect() } catch {}
  workletNode = null
  gainNode = null
  // Keep AudioContext open for legacy path (creates its own worklet)
  // Respawn worker and switch to legacy audio mode
  const old = worker
  try { old?.terminate() } catch {}
  await startLegacyAudioGraph()
  worker = new Worker(new URL('./workers/nesCore.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent): void => {
    const d = e.data || {}
    if (d.type === 'ppu-frame') {
      if (newFrameAvailable) framesDropped++
      latestFrame = d.indices as Uint8Array
      newFrameAvailable = true
      framesReceived++
      lastFrameTs = performance.now()
      drawLatest()
      newFrameAvailable = false
    } else if (d.type === 'worker-stats') {
      onStats(d)
    } else if (d.type === 'audio-chunk' && legacyNode) {
      // Forward audio samples to legacy worklet
      const arr = new Float32Array(d.samples)
      legacyNode.port.postMessage({ type: 'samples', data: arr }, [arr.buffer])
    }
  }
  worker.onerror = (ev: ErrorEvent): void => { console.error('[worker] error (legacy)', ev.message, ev.error) }
  worker.onmessageerror = (ev: MessageEvent): void => { console.error('[worker] messageerror (legacy)', ev.data) }
  const sampleRate = audioCtx?.sampleRate || 48000
  const channels = 1 // legacy processor duplicates to output
  worker.postMessage({ type: 'init', sab: null, sampleRate, channels, targetFillFrames: 2048, noAudio: false, useLegacy: true })
  if (romBytes) {
    const romCopy = new Uint8Array(romBytes)
    worker.postMessage({ type: 'load_rom', rom: romCopy, useVT: flags.useVT, strict: flags.strict, apuRegion: (window as any).__apuRegion, apuTiming: (window as any).__apuTiming, apuSynth: (window as any).__apuSynth }, [romCopy.buffer])
  }
  worker.postMessage({ type: 'start' })
  statusEl.textContent = `Running (legacy audio, fallback: ${reason})`
}

