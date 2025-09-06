/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import { NESSystem } from '@core/system/system'
import { parseINes } from '@core/cart/ines'

function findRomFromEnvOrFs(): string | null {
  const env = process.env.SMB_ROM
  if (env && fs.existsSync(env)) return env
  const roots = [process.cwd(), path.join(process.cwd(), 'roms')]
  const candidates: string[] = []
  for (const dir of roots) {
    try {
      const names = fs.readdirSync(dir)
      for (const n of names) if (/^mario.*\.nes$/i.test(n)) candidates.push(path.join(dir, n))
    } catch {}
  }
  return candidates.length ? candidates.sort()[0] : null
}

function parseArgs() {
  const argv = process.argv.slice(2)
  const args: { rom?: string; frames?: number; traceMax?: number; vt?: boolean } = {}
  for (const a of argv) {
    if (a.startsWith('--rom=')) args.rom = a.slice('--rom='.length)
    else if (a.startsWith('--frames=')) args.frames = parseInt(a.slice('--frames='.length), 10)
    else if (a.startsWith('--trace-max=')) args.traceMax = parseInt(a.slice('--trace-max='.length), 10)
    else if (a === '--legacy') args.vt = false
    else if (a === '--vt') args.vt = true
  }
  return args
}

async function main() {
  const { rom: romArg, frames: framesArg, traceMax: traceMaxArg, vt } = parseArgs()
  const romPath = romArg || findRomFromEnvOrFs()
  if (!romPath) {
    console.error('SMB ROM not found. Provide --rom=/path/to/mario.nes or set SMB_ROM, or place mario*.nes in repo root or ./roms')
    process.exit(2)
  }
  const buf = new Uint8Array(fs.readFileSync(romPath))
  const rom = parseINes(buf)
  const sys = new NESSystem(rom)
  ;(sys.ppu as unknown as { setTimingMode?: (m: 'vt' | 'legacy') => void }).setTimingMode?.(vt === false ? 'legacy' : 'vt')

  sys.reset()
  // Minimal rendering enable for A12/NMI and visible output
  sys.io.write(0x2001, 0x1E)

  const traceMax = traceMaxArg ?? parseInt(process.env.TRACE_MAX || '20000', 10)
  let logged = 0
  ;(sys.cpu as any).setTraceHook((pc: number, op: number) => {
    if (logged < traceMax) {
      console.log(`PC=$${pc.toString(16).padStart(4, '0')} OP=$${op.toString(16).padStart(2, '0')} P=$${(sys.cpu.state.p & 0xff).toString(16).padStart(2, '0')} CYC=${sys.cpu.state.cycles}`)
      logged++
    }
  })

  const targetFrames = framesArg ?? parseInt(process.env.SMB_FRAMES || '120', 10)
  const hardCap = 200_000_000
  const startFrame = sys.ppu.frame
  let steps = 0
  while (sys.ppu.frame < startFrame + targetFrames && steps < hardCap) {
    sys.stepInstruction()
    steps++
    // If we appear stuck (no frame progress after many steps), dump a short recent-PC ring and break
    if (steps % 10_000_000 === 0) {
      const pcs = (sys.cpu as any).getRecentPCs?.(16) as number[] | undefined
      console.error(`[hang-check] steps=${steps} frame=${sys.ppu.frame} recentPCs=${pcs ? pcs.map(p=>'$'+p.toString(16).padStart(4,'0')).join(',') : 'n/a'}`)
    }
  }
  if (steps >= hardCap) {
    console.error('Timeout before reaching target frames')
    process.exit(1)
  }

  console.error(`Done. Frames=${sys.ppu.frame - startFrame} CPU cycles=${sys.cpu.state.cycles}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

