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

