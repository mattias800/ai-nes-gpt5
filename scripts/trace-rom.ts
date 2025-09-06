#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import { NESSystem } from '@core/system/system'
import { parseINes } from '@core/cart/ines'
import { disasmAt, formatNestestLine } from '@utils/disasm6502'

function getEnv(name: string): string | null { const v = process.env[name]; return v && v.length > 0 ? v : null }

function parseArgs() {
  const argv = process.argv.slice(2)
  let rom = getEnv('ROM') || getEnv('NESTEST_ROM') || path.resolve('roms/nestest.nes')
  let startHex = getEnv('START') || ''
  let max = parseInt(getEnv('TRACE_MAX') || '0', 10)
  let seconds = parseFloat(getEnv('TRACE_SECONDS') || '0')
  let cyclesOnly = (getEnv('TRACE_CYCLES_ONLY') || '0') === '1'
  for (const a of argv) {
    if (a.startsWith('--rom=')) rom = a.slice(6)
    else if (a.startsWith('--start=')) startHex = a.slice(8)
    else if (a.startsWith('--max=')) max = parseInt(a.slice(6), 10)
    else if (a.startsWith('--seconds=')) seconds = parseFloat(a.slice(10))
    else if (a === '--cycles-only') cyclesOnly = true
  }
  const start = startHex ? (parseInt(startHex, 16) >>> 0) : -1
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  return { rom, start, max, seconds, cyclesOnly }
}

function hex2(v: number) { return (v & 0xFF).toString(16).toUpperCase().padStart(2, '0') }

async function main() {
  const args = parseArgs()
  if (!fs.existsSync(args.rom)) { console.error(`ROM not found: ${args.rom}`); process.exit(2) }
  const romBuf = new Uint8Array(fs.readFileSync(args.rom))
  const rom = parseINes(romBuf)
  const sys = new NESSystem(rom)
  sys.reset()
  if (args.start >= 0) {
    // Force start PC to requested value (useful for nestest-style traces)
    ;(sys as any).cpu.state.pc = args.start & 0xFFFF
  }

  const bus = (sys as any).bus
  const cpu = (sys as any).cpu

  const maxInst = args.max > 0 ? args.max : Number.MAX_SAFE_INTEGER
  const deadline = args.seconds > 0 ? ((typeof performance !== 'undefined' ? performance.now() : Date.now()) + args.seconds * 1000) : Number.POSITIVE_INFINITY

  let i = 0
  while (i < maxInst) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    if (now >= deadline) break
    const pc = cpu.state.pc & 0xFFFF
    const dis = disasmAt((addr: number) => bus.read(addr), pc)
    if (args.cyclesOnly) {
      const cyc = String(cpu.state.cycles).padStart(3, ' ')
      console.log(`CYC:${cyc}`)
    } else {
      const line = formatNestestLine(pc, dis, { a: cpu.state.a, x: cpu.state.x, y: cpu.state.y, p: cpu.state.p, s: cpu.state.s }, cpu.state.cycles)
      console.log(line)
    }
    sys.stepInstruction()
    i++
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

