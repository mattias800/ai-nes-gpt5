// UI-only script. Does not modify emulator harness logic.
// - Keeps existing element IDs intact
// - Adds small interactivity for the help modal and volume label

const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector(sel) as T | null
const $$ = <T extends HTMLElement>(sel: string): NodeListOf<T> => document.querySelectorAll(sel) as NodeListOf<T>

// Help modal
const helpBtn = $('#help-btn') as HTMLButtonElement | null
const helpModal = $('#help-modal') as HTMLElement | null
const helpClose = $('#help-close') as HTMLButtonElement | null

const openHelp = (): void => {
  if (!helpModal || !helpBtn) return
  helpModal.classList.remove('hidden')
  helpBtn.setAttribute('aria-expanded', 'true')
}

const closeHelp = (): void => {
  if (!helpModal || !helpBtn) return
  helpModal.classList.add('hidden')
  helpBtn.setAttribute('aria-expanded', 'false')
}

helpBtn?.addEventListener('click', () => openHelp())
helpClose?.addEventListener('click', () => closeHelp())
helpModal?.addEventListener('click', (e: MouseEvent) => {
  if (e.target === helpModal) closeHelp()
})
window.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') closeHelp() })

// Volume label mirror (purely visual; the harness owns actual audio gain)
const vol = $('#volume') as HTMLInputElement | null
const volLbl = $('#volumeLabel') as HTMLElement | null
const syncVolLabel = (): void => { if (vol && volLbl) volLbl.textContent = `${vol.value}%` }
vol?.addEventListener('input', syncVolLabel)
syncVolLabel()

// Ensure canvas stays pixel-crisp when window resizes (no logic change)
const canvas = $('#screen') as HTMLCanvasElement | null

// Integer scale + Fit control (CSS-only effect)
const scaleSelect = $('#scale-control') as HTMLSelectElement | null
const scaleFit = $('#scale-fit') as HTMLInputElement | null

const applyScale = (): void => {
  if (!canvas) return
  const baseW = 256, baseH = 240
  const fit = !!scaleFit?.checked
  if (fit) {
    const parent = canvas.parentElement as HTMLElement | null
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const s = Math.max(1, Math.floor(Math.min(rect.width / baseW, rect.height / baseH)))
    canvas.style.width = `${baseW * s}px`
    canvas.style.height = `${baseH * s}px`
  } else if (scaleSelect) {
    const n = Math.max(1, Math.min(6, parseInt(scaleSelect.value || '2', 10)))
    canvas.style.width = `${baseW * n}px`
    canvas.style.height = `${baseH * n}px`
  }
}

scaleSelect?.addEventListener('change', () => { if (scaleFit) scaleFit.checked = false; applyScale() })
scaleFit?.addEventListener('change', applyScale)
window.addEventListener('resize', () => { if (scaleFit?.checked) applyScale() })
applyScale()

// Drag-and-drop ROM UX (forwards to existing file input)
const dropzone = $('#dropzone') as HTMLElement | null
const romInput = $('#rom') as HTMLInputElement | null

// Fullscreen toggle (UI-only)
const fsBtn = $('#fs-btn') as HTMLButtonElement | null
const fsTarget = document.querySelector('.screen-panel') as HTMLElement | null

const fsUpdate = (): void => {
  const active = !!document.fullscreenElement
  if (fsBtn) {
    fsBtn.textContent = active ? 'Exit Fullscreen' : 'Fullscreen'
    fsBtn.setAttribute('aria-pressed', active ? 'true' : 'false')
  }
}

fsBtn?.addEventListener('click', async (): Promise<void> => {
  try {
    if (!document.fullscreenElement) {
      await (fsTarget ?? document.documentElement).requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch (e) {
    // ignore
  } finally {
    fsUpdate()
  }
})

document.addEventListener('fullscreenchange', fsUpdate)
fsUpdate()

// Game info parsing (UI-only, reads iNES/NES 2.0 header)
interface GameInfo { title: string; prgRomBytes: number; chrRomBytes: number; mapper: number; mapperName: string; hasBattery: boolean; mirroring: 'Horizontal'|'Vertical'|'Four-screen'; isNES2: boolean; submapper?: number }

const mapperName = (id: number): string => {
  const m: Record<number, string> = {
    0: 'NROM',
    1: 'MMC1',
    2: 'UxROM (UNROM/UN1ROM)',
    3: 'CNROM',
    4: 'MMC3 (TxROM)',
    5: 'MMC5',
    7: 'AxROM',
    9: 'MMC2',
    10: 'MMC4',
    11: 'Color Dreams',
    13: 'CPROM',
    15: '100-in-1',
    19: 'Namco 163/175/340',
    21: 'Konami VRC4a/VRC4c',
    22: 'Konami VRC2a',
    23: 'Konami VRC2b/VRC4e',
    24: 'Konami VRC6a',
    25: 'Konami VRC4b/VRC4d',
    26: 'Konami VRC6b',
    66: 'GxROM / GNROM',
    69: 'Sunsoft FME-7',
    70: 'Bandai 74HC161/32',
    71: 'Camerica',
    79: 'NINA-003/006',
    85: 'Konami VRC7',
    94: 'MMC3 variant (TxSROM)',
  }
  return m[id] ?? `Mapper ${id}`
}

const parseHeader = (bytes: Uint8Array, fileName: string): GameInfo | null => {
  if (bytes.length < 16) return null
  if (!(bytes[0] === 0x4E && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1A)) return null
  const hdr = bytes
  const flags6 = hdr[6] | 0
  const flags7 = hdr[7] | 0
  const isNES2 = ((flags7 & 0x0C) === 0x08)
  let mapper = ((flags7 & 0xF0) | (flags6 >> 4)) | 0
  let submapper: number | undefined
  if (isNES2) {
    mapper |= (hdr[8] & 0x0F) << 8
    submapper = (hdr[8] >> 4) & 0x0F
  }
  // Sizes (basic iNES; NES 2.0 extended sizes not handled for extremely large ROMs)
  const prgRomBytes = (hdr[4] | 0) * 16 * 1024
  const chrRomBytes = (hdr[5] | 0) * 8 * 1024
  const hasBattery = !!(flags6 & 0x02)
  const mirroring: GameInfo['mirroring'] = (flags6 & 0x08) ? 'Four-screen' : ((flags6 & 0x01) ? 'Vertical' : 'Horizontal')
  const title = fileName.replace(/\.[^.]+$/i, '')
  return { title, prgRomBytes, chrRomBytes, mapper, mapperName: mapperName(mapper), hasBattery, mirroring, isNES2, submapper }
}

const fmtBytes = (n: number): string => {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2).replace(/\.00$/, '')} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

const gameInfoEl = $('#game-info') as HTMLElement | null
const renderGameInfo = (gi: GameInfo | null): void => {
  if (!gameInfoEl) return
  if (!gi) { gameInfoEl.innerHTML = '<div class="info-header">Game Info</div><div class="info-body muted">Invalid or unsupported ROM.</div>'; return }
  const sub = gi.submapper != null ? ` (submapper ${gi.submapper})` : ''
  gameInfoEl.innerHTML = `
    <div class="info-header">Game Info</div>
    <div class="info-grid">
      <div class="k">Title</div><div class="v">${gi.title}</div>
      <div class="k">PRG ROM</div><div class="v">${fmtBytes(gi.prgRomBytes)}</div>
      <div class="k">CHR ${gi.chrRomBytes ? 'ROM' : 'RAM'}</div><div class="v">${gi.chrRomBytes ? fmtBytes(gi.chrRomBytes) : 'Present'}</div>
      <div class="k">Mapper</div><div class="v">${gi.mapperName} (#${gi.mapper})${sub}</div>
      <div class="k">Mirroring</div><div class="v">${gi.mirroring}</div>
      <div class="k">Battery</div><div class="v">${gi.hasBattery ? 'Yes' : 'No'}</div>
      <div class="k">Header</div><div class="v">${gi.isNES2 ? 'NES 2.0' : 'iNES'}</div>
    </div>
  `
}

const loadGameInfoFromFile = async (file: File): Promise<void> => {
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    const info = parseHeader(buf, file.name)
    renderGameInfo(info)
  } catch {
    renderGameInfo(null)
  }
}

romInput?.addEventListener('change', () => {
  const f = romInput.files?.[0]
  if (f) void loadGameInfoFromFile(f)
})

// Gamepad -> synthetic Keyboard events (UI-only controller support)
const padInd = $('#pad-ind') as HTMLElement | null
let trackedPad: number | null = null
let held: Record<string, boolean> = {}

const dispatchKey = (code: string, down: boolean): void => {
  const type = down ? 'keydown' : 'keyup'
  const ev = new KeyboardEvent(type, { code, bubbles: true, cancelable: true })
  window.dispatchEvent(ev)
}

const updateIndicator = (connected: boolean, id?: string): void => {
  if (!padInd) return
  padInd.textContent = connected ? `🎮 ${id || 'Controller'}` : '🎮 Not connected'
}

window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
  if (trackedPad == null) trackedPad = e.gamepad.index
  updateIndicator(true, e.gamepad.id)
})
window.addEventListener('gamepaddisconnected', (e: GamepadEvent) => {
  if (trackedPad === e.gamepad.index) {
    // release any held keys
    for (const code of Object.keys(held)) { if (held[code]) { dispatchKey(code, false); held[code] = false } }
    trackedPad = null
    updateIndicator(false)
  }
})

const mapPadState = (gp: Gamepad): Record<string, boolean> => {
  const pressed = (i: number): boolean => {
    const b = gp.buttons[i]; return !!b && (typeof b === 'object' ? b.pressed : (b as unknown as number) > 0.5)
  }
  const axes = gp.axes || []
  const thresh = 0.5
  const left = axes[0] ?? 0
  const up = axes[1] ?? 0
  const m: Record<string, boolean> = {}
  // Face buttons
  if (pressed(0)) m['KeyZ'] = true // A
  if (pressed(1)) m['KeyX'] = true // B
  // Start/Select
  if (pressed(9)) m['Enter'] = true // Start
  if (pressed(8)) m['ShiftLeft'] = true // Select
  // D-Pad
  if (pressed(12) || up < -thresh) m['ArrowUp'] = true
  if (pressed(13) || up > thresh) m['ArrowDown'] = true
  if (pressed(14) || left < -thresh) m['ArrowLeft'] = true
  if (pressed(15) || left > thresh) m['ArrowRight'] = true
  return m
}

const pollPad = (): void => {
  const pads = navigator.getGamepads ? navigator.getGamepads() : ([] as unknown as Gamepad[])
  let gp: Gamepad | null = null
  if (trackedPad != null) gp = pads[trackedPad] || null
  if (!gp) {
    // find first connected
    for (const p of pads) { if (p && p.connected) { gp = p; trackedPad = p.index; break } }
  }
  if (gp && gp.connected) {
    const next = mapPadState(gp)
    // diff against held
    const allCodes = new Set([...Object.keys(held), ...Object.keys(next)])
    for (const code of allCodes) {
      const was = !!held[code]
      const now = !!next[code]
      if (now && !was) { dispatchKey(code, true) }
      if (!now && was) { dispatchKey(code, false) }
    }
    held = next
    updateIndicator(true, gp.id)
  } else {
    // if lost, release keys
    if (Object.keys(held).some(k => held[k])) {
      for (const code of Object.keys(held)) { if (held[code]) { dispatchKey(code, false) } }
      held = {}
    }
    updateIndicator(false)
  }
  requestAnimationFrame(pollPad)
}

requestAnimationFrame(pollPad)

// Release held keys on blur
window.addEventListener('blur', () => {
  for (const code of Object.keys(held)) { if (held[code]) { dispatchKey(code, false) } }
  held = {}
})

const showDrop = (): void => { dropzone?.classList.remove('hidden') }
const hideDrop = (): void => { dropzone?.classList.add('hidden') }

window.addEventListener('dragenter', (e: DragEvent) => { e.preventDefault(); showDrop() })
window.addEventListener('dragover', (e: DragEvent) => { e.preventDefault() })
window.addEventListener('dragleave', (e: DragEvent) => {
  if (e.target === dropzone) hideDrop()
})
window.addEventListener('drop', async (e: DragEvent) => {
  e.preventDefault(); hideDrop()
  const files = e.dataTransfer?.files
  if (!files || files.length === 0 || !romInput) return
  // Programmatically set the file input to trigger existing handler
  // Note: Most browsers disallow programmatic FileList assignment; instead dispatch change with DataTransfer
  try {
    const dt = new DataTransfer()
    dt.items.add(files[0])
    romInput.files = dt.files
    romInput.dispatchEvent(new Event('change', { bubbles: true }))
  } catch {
    // Fallback: focus the input so user can confirm
    romInput.focus()
  }
})

