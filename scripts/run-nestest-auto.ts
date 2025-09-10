/*
Run nestest.nes in auto mode using our emulator and emit a deterministic CPU trace.
- Forces PC=$C000 at start (auto mode entry point)
- Steps a configurable number of instructions
- Writes a log (default: nestest-our.log) capturing PC, A, X, Y, P, S, PPU(s,c), and cycle counter

Usage:
  ROM=roms/nestest/nestest.nes STEPS=50000 OUT=nestest-our.log npx tsx scripts/run-nestest-auto.ts

Env vars:
  ROM   : path to nestest.nes (default: roms/nestest/nestest.nes)
  STEPS : max instructions to execute (default: 50000)
  OUT   : output path (default: nestest-our.log)
*/

import fs from 'node:fs'
import path from 'node:path'
import { parseINes } from '@core/cart/ines'
import { NESSystem } from '@core/system/system'

const toHex = (v: number, w: number) => v.toString(16).toUpperCase().padStart(w, '0')

function main() {
  const ROM = process.env.ROM || 'roms/nestest/nestest.nes'
  const OUT = process.env.OUT || 'nestest-our.log'
  const STEPS = Number.parseInt(process.env.STEPS || '50000', 10)

  if (!fs.existsSync(ROM)) {
    console.error(`[nestest-auto] ROM not found: ${ROM}`)
    process.exit(2)
  }

  const romBuf = new Uint8Array(fs.readFileSync(ROM))
  const rom = parseINes(romBuf)

  // Build system and reset
  const sys = new NESSystem(rom)
  sys.reset()

  // Auto mode: force entry at $C000
  sys.cpu.state.pc = 0xC000

  // Optional: avoid NMI interference
  sys.ppu.nmiOccurred = false
  sys.ppu.nmiOutput = false

  // Log stream
  const outPath = path.resolve(OUT)
  const ws = fs.createWriteStream(outPath, { encoding: 'utf8' })

  // Write simple header
  ws.write(`# nestest auto trace\n`)
  ws.write(`# rom=${ROM}\n`)
  ws.write(`# steps=${STEPS}\n`)

  for (let i = 0; i < STEPS; i++) {
    const s = sys.cpu.state
    const pc = s.pc & 0xFFFF
    // Capture state before executing the instruction
    const a = s.a & 0xFF
    const x = s.x & 0xFF
    const y = s.y & 0xFF
    const p = s.p & 0xFF
    const sp = s.s & 0xFF
    const cyc = s.cycles | 0
    const sl = sys.ppu.scanline | 0
    const cx = sys.ppu.cycle | 0

    // Fetch opcode bytes non-destructively for context
    const b0 = sys.bus.read(pc)
    const b1 = sys.bus.read((pc + 1) & 0xFFFF)
    const b2 = sys.bus.read((pc + 2) & 0xFFFF)

    // Minimal, sortable line: PC bytes A X Y P S PPU(s,c) CYC
    ws.write(
      `${toHex(pc,4)}  ${toHex(b0,2)} ${toHex(b1,2)} ${toHex(b2,2)}  ` +
      `A:${toHex(a,2)} X:${toHex(x,2)} Y:${toHex(y,2)} P:${toHex(p,2)} S:${toHex(sp,2)} ` +
      `PPU:${sl.toString().padStart(3,' ')}:${cx.toString().padStart(3,' ')} ` +
      `CYC:${cyc}\n`
    )

    // Step one CPU instruction (interleaves PPU/APU via system scheduler)
    sys.stepInstruction()

    // Optional stop condition: BRK (0x00) at PC, if you wish to end earlier
    // if (b0 === 0x00) break
  }

  ws.end(() => {
    console.log(`[nestest-auto] wrote ${STEPS} steps -> ${outPath}`)
  })
}

main()

