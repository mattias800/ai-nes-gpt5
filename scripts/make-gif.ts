/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { NESSystem } from '@core/system/system'
import { parseINes } from '@core/cart/ines'
import { PNG } from 'pngjs'

// Palette mapping (same as screenshot harness)
const PALETTE: [number, number, number][] = [
  [84,84,84],[0,30,116],[8,16,144],[48,0,136],[68,0,100],[92,0,48],[84,4,0],[60,24,0],
  [32,42,0],[8,58,0],[0,64,0],[0,60,0],[0,50,60],[0,0,0],[0,0,0],[0,0,0],
  [152,150,152],[8,76,196],[48,50,236],[92,30,228],[136,20,176],[160,20,100],[152,34,32],[120,60,0],
  [84,90,0],[40,114,0],[8,124,0],[0,118,40],[0,102,120],[0,0,0],[0,0,0],[0,0,0],
  [236,238,236],[76,154,236],[120,124,236],[176,98,236],[228,84,236],[236,88,180],[236,106,100],[212,136,32],
  [160,170,0],[116,196,0],[76,208,32],[56,204,108],[56,180,204],[60,60,60],[0,0,0],[0,0,0],
  [236,238,236],[168,204,236],[188,188,236],[212,178,236],[236,174,236],[236,174,212],[236,180,176],[228,196,144],
  [204,210,120],[180,222,120],[168,226,144],[152,226,180],[160,214,228],[160,162,160],[0,0,0],[0,0,0],
]
const rgb = (idx: number): [number, number, number] => PALETTE[(idx & 0x3F) % PALETTE.length]

const writePngScaled = async (outPath: string, fb: Uint8Array, w = 256, h = 240, scale = 2): Promise<void> => {
  const W = w * scale, H = h * scale
  const png = new PNG({ width: W, height: H })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const [r, g, b] = rgb(fb[i] & 0x3F)
      for (let dy = 0; dy < scale; dy++) {
        const oy = (y * scale + dy) * W
        for (let dx = 0; dx < scale; dx++) {
          const o = ((oy + (x * scale + dx)) << 2)
          png.data[o + 0] = r
          png.data[o + 1] = g
          png.data[o + 2] = b
          png.data[o + 3] = 255
        }
      }
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const stream = fs.createWriteStream(outPath)
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve())
    stream.on('error', (e) => reject(e))
    png.pack().pipe(stream)
  })
}

function findRom(): string | null {
  const envRom = process.env.SCREENSHOT_ROM || process.env.SMB3_ROM || process.env.SMB_ROM
  if (envRom && fs.existsSync(envRom)) return envRom
  const roots = [process.cwd(), path.join(process.cwd(), 'roms')]
  const candidates: string[] = []
  for (const dir of roots) {
    try {
      for (const n of fs.readdirSync(dir)) if (/\.nes$/i.test(n)) candidates.push(path.join(dir, n))
    } catch {}
  }
  candidates.sort((a, b) => {
    const A = path.basename(a).toLowerCase()
    const B = path.basename(b).toLowerCase()
    const rank = (s: string): number => (/^smb3|^mario3/.test(s) ? 0 : (/^mario/.test(s) ? 1 : 2))
    const ra = rank(A), rb = rank(B)
    if (ra !== rb) return ra - rb
    return A.localeCompare(B)
  })
  return candidates[0] || null
}

async function main(): Promise<void> {
  const startAbs = parseInt(process.env.GIF_START_FRAME || '400', 10)
  const fps = parseInt(process.env.GIF_FPS || '30', 10)
  const seconds = parseInt(process.env.GIF_SECONDS || '5', 10)
  const scale = parseInt(process.env.GIF_SCALE || '2', 10)
  const framesNeeded = fps * seconds

  const romPath = findRom()
  if (!romPath) { console.error('ROM not found. Set SCREENSHOT_ROM/SMB3_ROM/SMB_ROM or place a ROM in repo root/roms'); process.exit(2) }
  const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)))
  const sys = new NESSystem(rom)
  ;(sys.ppu as any).setTimingMode?.('vt')
  ;(sys.apu as any).setRegion?.('NTSC')
  sys.reset()
  sys.io.write(0x2001, 0x1E)

  const wallMs = parseInt(process.env.HARNESS_WALL_TIMEOUT_MS || '180000', 10)
  let wallDeadline = Date.now() + wallMs

  // Advance to absolute start frame
  while (sys.ppu.frame < startAbs) { sys.stepInstruction(); if (Date.now() >= wallDeadline) break }
  if (sys.ppu.frame < startAbs) { console.error('Timeout before reaching start frame'); process.exit(1) }

  const outDir = path.resolve('screenshots/smb3_anim_30fps_5s_2x')
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  // Capture 30 fps by advancing 2 PPU frames between captures (NTSC is 60 fps)
  let target = startAbs
  for (let i = 0; i < framesNeeded; i++) {
    // ensure we are at target frame boundary
    while (sys.ppu.frame < target) { sys.stepInstruction(); if (Date.now() >= wallDeadline) break }
    if (sys.ppu.frame < target) { console.error('Timeout during capture'); process.exit(1) }
    const fb = (sys.ppu as any).getFrameBuffer() as Uint8Array
    const outPath = path.join(outDir, `frame_${String(i).padStart(4, '0')}.png`)
    await writePngScaled(outPath, fb, 256, 240, scale)
    target += 2 // step two frames per output frame (60 -> 30 fps)
  }

  // Try to assemble with ffmpeg if available
  const gifOut = path.resolve('screenshots/smb3_title_30fps_5s_2x.gif')
  const ff = spawnSync('ffmpeg', ['-y', '-framerate', String(fps), '-i', path.join(outDir, 'frame_%04d.png'), '-vf', 'scale=iw:ih:flags=neighbor', '-loop', '0', gifOut], { stdio: 'inherit' })
  if (ff.error) {
    console.warn('ffmpeg not found or failed. PNG frames are in:', outDir)
    console.warn('You can create the GIF manually, e.g.:')
    console.warn(`ffmpeg -y -framerate ${fps} -i ${path.join(outDir, 'frame_%04d.png')} -vf "scale=iw:ih:flags=neighbor" -loop 0 ${gifOut}`)
  } else {
    console.log('GIF written:', gifOut)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

