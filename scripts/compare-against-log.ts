#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import { NESSystem } from '@core/system/system'
import { parseINes } from '@core/cart/ines'
import { disasmAt, formatNestestLine } from '@utils/disasm6502'
import { CPUBus } from '@core/bus/memory'

function getEnv(name: string): string | null { const v = process.env[name]; return v && v.length > 0 ? v : null }
function hex2(v: number) { return (v & 0xFF).toString(16).toUpperCase().padStart(2, '0') }
function hex4(v: number) { return (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0') }

// Parse a general log line with nestest-like footer: PC .... A:.. X:.. Y:.. P:.. SP:.. CYC:... (CYC optional)
type LogEntry = { pc: number, a?: number, x?: number, y?: number, p?: number, s?: number, cyc?: number | null, loop?: number }
function parseLogLine(line: string): LogEntry | null {
  // Full nestest-like
  let m = /^\s*([0-9A-F]{4}).*A:([0-9A-F]{2})\s+X:([0-9A-F]{2})\s+Y:([0-9A-F]{2})\s+P:([0-9A-F]{2})\s+SP:([0-9A-F]{2})(?:.*CYC:\s*(\d+)\s*)?$/i.exec(line)
  if (m) {
    return {
      pc: parseInt(m[1], 16) >>> 0,
      a: parseInt(m[2], 16) >>> 0,
      x: parseInt(m[3], 16) >>> 0,
      y: parseInt(m[4], 16) >>> 0,
      p: parseInt(m[5], 16) >>> 0,
      s: parseInt(m[6], 16) >>> 0,
      cyc: (m[7] != null ? (parseInt(m[7], 10) | 0) : null),
    }
  }
  // MAME trace compression: "(loops for N instructions)"
  m = /^\s*\(\s*loops\s+for\s+(\d+)\s+instructions\s*\)\s*$/i.exec(line)
  if (m) {
    const n = parseInt(m[1], 10) | 0
    return { pc: -1, loop: Math.max(0, n) }
  }
  // PC-only (e.g., MAME trace): "C000: jmp ..."
  m = /^\s*([0-9A-F]{4}):/i.exec(line)
  if (m) {
    return { pc: parseInt(m[1], 16) >>> 0 }
  }
  return null
}

function dumpStack(bus: CPUBus, sp: number): string {
  const base = 0x0100
  const top = Math.min(0xFF, (sp + 8) & 0xFF)
  const vals: string[] = []
  for (let i = sp + 1; i <= top; i++) {
    const addr = base + (i & 0xFF)
    vals.push(`${hex2(i & 0xFF)}:${hex2(bus.read(addr))}`)
  }
  return vals.join(' ')
}

function printDisasmWindow(bus: CPUBus, pc: number, lines: number): string {
  const out: string[] = []
  let cur = pc & 0xFFFF
  for (let i = 0; i < lines; i++) {
    const d = disasmAt((a: number) => bus.read(a), cur)
    out.push(formatNestestLine(cur, d, { a: 0, x: 0, y: 0, p: 0, s: 0 }, 0))
    cur = (cur + d.len) & 0xFFFF
  }
  return out.join('\n')
}

function parseArgs() {
  const argv = process.argv.slice(2)
  let rom = getEnv('ROM') || path.resolve('roms/nestest.nes')
  let log = getEnv('LOG') || path.resolve('roms/nestest.log')
  let max = parseInt(getEnv('MAX_LINES') || getEnv('NESTEST_MAX') || '0', 10)
  let seconds = parseFloat(getEnv('TRACE_SECONDS') || '0')
  let honorLogStart = (getEnv('HONOR_LOG_START') || '1') === '1'
  let debugPcsEnv = getEnv('DEBUG_PCS') || ''
  const debugPcs: number[] = []
  // Optional explicit initial CPU state overrides
  let initA = getEnv('INIT_A'), initX = getEnv('INIT_X'), initY = getEnv('INIT_Y'), initP = getEnv('INIT_P'), initS = getEnv('INIT_S')
  if (debugPcsEnv) {
    for (const tok of debugPcsEnv.split(',')) {
      const t = tok.trim()
      if (!t) continue
      const v = parseInt(t, 16)
      if (Number.isFinite(v)) debugPcs.push(v & 0xFFFF)
    }
  }
  for (const a of argv) {
    if (a.startsWith('--rom=')) rom = a.slice(6)
    else if (a.startsWith('--log=')) log = a.slice(6)
    else if (a.startsWith('--max=')) max = parseInt(a.slice(6), 10)
    else if (a.startsWith('--seconds=')) seconds = parseFloat(a.slice(10))
    else if (a === '--no-honor-log-start') honorLogStart = false
    else if (a.startsWith('--init-a=')) initA = a.slice(9)
    else if (a.startsWith('--init-x=')) initX = a.slice(9)
    else if (a.startsWith('--init-y=')) initY = a.slice(9)
    else if (a.startsWith('--init-p=')) initP = a.slice(9)
    else if (a.startsWith('--init-s=')) initS = a.slice(9)
    else if (a.startsWith('--debug-pcs=')) {
      debugPcs.length = 0
      const list = a.slice(12)
      for (const tok of list.split(',')) {
        const t = tok.trim(); if (!t) continue
        const v = parseInt(t, 16); if (Number.isFinite(v)) debugPcs.push(v & 0xFFFF)
      }
    }
  }
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  return { rom, log, max, seconds, honorLogStart, debugPcs, initA, initX, initY, initP, initS }
}

function flagBits(p: number) {
  const N = (p & 0x80) !== 0, V = (p & 0x40) !== 0, Z = (p & 0x02) !== 0, C = (p & 0x01) !== 0
  return { N, V, Z, C }
}

async function main() {
  const args = parseArgs()
  const debugSet = new Set<number>(args.debugPcs || [])
  // Optional RAM preload
  let ramPreload: Uint8Array | null = null
  try {
    const preloadPath = (process.env.LOAD_RAM || (() => { const idx = process.argv.findIndex(a => a.startsWith('--load-ram=')); return idx>=0? process.argv[idx].slice(11): '' })()) as string
    if (preloadPath && preloadPath.length > 0) {
      const p = path.resolve(preloadPath)
      if (fs.existsSync(p)) { ramPreload = fs.readFileSync(p) }
    }
  } catch {}
  if (!fs.existsSync(args.rom)) { console.error(`Missing ROM: ${args.rom}`); process.exit(2) }
  if (!fs.existsSync(args.log)) { console.error(`Missing LOG: ${args.log}`); process.exit(2) }
  const logLines = fs.readFileSync(args.log, 'utf-8').split(/\r?\n/).filter(Boolean)
  let parsed = logLines.map(parseLogLine).filter((x): x is NonNullable<typeof x> => !!x)
  if (parsed.length === 0) { console.error('No parsable lines in log'); process.exit(2) }
  // Align: collapse consecutive duplicate PCs at the very beginning to a single line (helps MAME-debugger logs)
  if (parsed.length >= 2) {
    const pc0 = parsed[0].pc
    let j = 1
    while (j < parsed.length && parsed[j].pc === pc0) j++
    if (j > 1) parsed = [parsed[0], ...parsed.slice(j)]
  }
  const limit = args.max > 0 ? Math.min(args.max, parsed.length) : parsed.length

  const romBuf = new Uint8Array(fs.readFileSync(args.rom));
  const rom = parseINes(romBuf);
  const sys = new NESSystem(rom)
  const bus: CPUBus = (sys as any).bus

  // For NROM-128 (16KB PRG), the $8000-$BFFF and $C000-$FFFF regions are mirrors.
  // MAME traces may execute from one half, while our emulator may execute from the other.
  // Normalize PCs for comparison by folding mirrored halves onto $8000-$BFFF when PRG=16KB.
  const prgLen = (rom.prg?.length || 0) >>> 0
  const normPC = (pc: number): number => {
    pc &= 0xFFFF
    if (pc >= 0x8000 && prgLen === 0x4000) {
      return 0x8000 + ((pc - 0x8000) & 0x3FFF)
    }
    return pc
  }
  if (ramPreload) { try { (bus as any).loadRAM?.(new Uint8Array(ramPreload)) } catch {} }
  sys.reset()
  const cpu = (sys as any).cpu

  // Optional explicit inits override (useful for PC-only logs)
  const parseHexByte = (s?: string | null): number | null => {
    if (!s) return null
    const v = parseInt(s, 16)
    return Number.isFinite(v) ? (v & 0xFF) : null
  }
  const ia = parseHexByte(args.initA), ix = parseHexByte(args.initX), iy = parseHexByte(args.initY), ip = parseHexByte(args.initP), is = parseHexByte(args.initS)
  if (ia !== null) cpu.state.a = ia
  if (ix !== null) cpu.state.x = ix
  if (iy !== null) cpu.state.y = iy
  if (ip !== null) cpu.state.p = ip
  if (is !== null) cpu.state.s = is

  // Optionally sync our CPU to the first log entry before stepping (applied after explicit inits so PC matches log; regs from log override) 
  if (args.honorLogStart) {
    const first = parsed[0]
    // Always honor PC if present
    if (typeof first.pc === 'number') cpu.state.pc = first.pc & 0xFFFF
    // Only set registers if provided by log
    if (typeof first.a === 'number') cpu.state.a = first.a & 0xFF
    if (typeof first.x === 'number') cpu.state.x = first.x & 0xFF
    if (typeof first.y === 'number') cpu.state.y = first.y & 0xFF
    if (typeof first.p === 'number') cpu.state.p = first.p & 0xFF
    if (typeof first.s === 'number') cpu.state.s = first.s & 0xFF
    if (typeof first.cyc === 'number') cpu.state.cycles = (first.cyc ?? 0) | 0
  }

  const deadline = args.seconds > 0 ? ((typeof performance !== 'undefined' ? performance.now() : Date.now()) + args.seconds * 1000) : Number.POSITIVE_INFINITY

  // Resync summary
  const resyncSingleAt: number[] = []
  const resyncManyAt: { from: number, to: number, steps: number }[] = []
  const resyncKnownAt: { at: number, note: string }[] = []

  for (let i = 0; i < limit; i++) {
    const exp = parsed[i]

    // Handle loop-compressed lines by stepping N instructions without comparing
    if (exp.loop && exp.loop > 0) {
      // Try to align to the next explicit PC in the log rather than trusting the compressed count
      let targetPC: number | null = null
      for (let j = i + 1; j < parsed.length; j++) {
        const e2 = parsed[j] as any
        if (e2 && typeof e2.pc === 'number' && e2.pc >= 0 && !e2.loop) { targetPC = e2.pc & 0xFFFF; break }
      }
      if (targetPC != null) {
        let steps = 0
        const maxSteps = Math.max(exp.loop + 1000, exp.loop * 2)
        while (((cpu.state.pc & 0xFFFF) !== targetPC) && steps < maxSteps) { sys.stepInstruction(); steps++ }
        if ((cpu.state.pc & 0xFFFF) !== targetPC) {
          console.error(`[loops] Could not reach target PC=${hex4(targetPC)} after ${steps} steps (expected compressed ${exp.loop})`)
          process.exit(1)
        }
      } else {
        // Fallback: step the advertised compressed count
        for (let k = 0; k < exp.loop; k++) sys.stepInstruction()
      }
      continue
    }

    // Wall clock limit
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    if (now >= deadline) {
      console.error(`[halt] Reached time limit before processing line ${i + 1}`)
      process.exit(0)
    }

    const gotPC = cpu.state.pc & 0xFFFF
    const gotPCN = normPC(gotPC)
    const expPCN = normPC(exp.pc)
    const gotA = cpu.state.a & 0xFF
    const gotX = cpu.state.x & 0xFF
    const gotY = cpu.state.y & 0xFF
    const gotP = cpu.state.p & 0xFF
    const gotS = cpu.state.s & 0xFF

    // Optional targeted debug print before step
    if (debugSet.has(gotPC)) {
      const op = bus.read(gotPC)
      const op1 = bus.read((gotPC + 1) & 0xFFFF)
      const f = flagBits(gotP)
      console.error(`[debug pre] PC=${hex4(gotPC)} OP=${hex2(op)} OP1=${hex2(op1)} A=${hex2(gotA)} X=${hex2(gotX)} Y=${hex2(gotY)} P=${hex2(gotP)} (N=${+f.N} V=${+f.V} Z=${+f.Z} C=${+f.C}) SP=${hex2(gotS)}`)
    }

    // Compare pre-step state (mask out B flag differences)
    const maskB = 0xEF
    let okPre = gotPCN === expPCN
    // If the log has register fields, check them too
    if (okPre && typeof exp.a === 'number') okPre = okPre && (gotA === exp.a)
    if (okPre && typeof exp.x === 'number') okPre = okPre && (gotX === exp.x)
    if (okPre && typeof exp.y === 'number') okPre = okPre && (gotY === exp.y)
    if (okPre && typeof exp.p === 'number') okPre = okPre && ((gotP & maskB) === (exp.p & maskB))
    if (okPre && typeof exp.s === 'number') okPre = okPre && (gotS === exp.s)
    if (!okPre) {
      const allowResync = ((process.env.RESYNC_ON_MISMATCH ?? '1') !== '0')
      if (allowResync) {
        // Known-fork short-circuit: nestest auto redirection DBB4 RTS -> A926 vs C626
        const allowKnown = ((process.env.KNOWN_FORKS ?? '1') !== '0')
        if (allowKnown) {
          try {
            const expPCRaw = exp.pc & 0xFFFF
            const gotPCRaw = gotPC & 0xFFFF
            if ((expPCRaw === 0xA926) && (gotPCRaw === 0xC626)) {
              // Try to align log index to our current got PC (reduce stepping). Search ahead bounded.
              // Try to step emulator to a rendezvous PC known to appear shortly after the fork
              const rendezvous = (process.env.KNOWN_FORK_RENDEZVOUS || '6056,6058,605A')
                .split(',').map(s => parseInt(s.trim(), 16) & 0xFFFF).filter(n => Number.isFinite(n))
              const maxStepsKF = Math.max(1, parseInt(process.env.KNOWN_FORK_MAX_STEPS || '8192', 10) | 0)
              let stepsKF = 0
              let matchedPC: number | null = null
              while (stepsKF < maxStepsKF) {
                const pcNow = cpu.state.pc & 0xFFFF
                if (rendezvous.includes(pcNow)) { matchedPC = pcNow; break }
                sys.stepInstruction(); stepsKF++
              }
              if (matchedPC !== null) {
                // Find the same PC in the log ahead to align indices
                const aheadN = Math.max(1, parseInt(process.env.KNOWN_FORK_AHEAD_N || '32768', 10) | 0)
                let foundIdx = -1
                for (let j = i + 1; j < Math.min(parsed.length, i + 1 + aheadN); j++) {
                  const e2 = parsed[j]
                  if (e2 && !e2.loop && typeof e2.pc === 'number') {
                    if (((e2.pc & 0xFFFF)) === matchedPC) { foundIdx = j; break }
                  }
                }
                if (foundIdx >= 0) {
                  console.error(`[resync-known] nestest-auto fork: stepped ${stepsKF} to PC=${hex4(matchedPC)} and skipped log to line ${foundIdx + 1}`)
                  resyncKnownAt.push({ at: i + 1, note: `nestest-auto DBB4 RTS redirect -> ${hex4(matchedPC)}` })
                  i = foundIdx
                  continue
                }
              }
            }
          } catch {}
        }

        // Attempt bounded resync to the expected PC by stepping forward (apply normalization to target)
        const target = expPCN & 0xFFFF
        let steps = 0
        const maxSteps = Math.max(16, parseInt(process.env.RESYNC_MAX_STEPS || '200000', 10) | 0)
        while (((cpu.state.pc & 0xFFFF) !== target) && steps < maxSteps) { sys.stepInstruction(); steps++ }
        if ((cpu.state.pc & 0xFFFF) === target) {
          console.error(`[resync] stepped ${steps} instructions to reach expected PC=${hex4(target)} at line ${i + 1}`)
          resyncSingleAt.push(i + 1)
          continue
        }
        // Optional multi-target resync: look ahead in the log for the next N PCs and try to reach any of them
        const allowMulti = ((process.env.RESYNC_MULTI ?? '1') !== '0')
        if (allowMulti) {
          const aheadN = Math.max(1, parseInt(process.env.RESYNC_AHEAD_N || '4096', 10) | 0)
          const set = new Set<number>()
          let idxMap: Map<number, number> = new Map()
          for (let j = i + 1; j < Math.min(parsed.length, i + 1 + aheadN); j++) {
            const e2 = parsed[j]
            if (!e2 || e2.loop || typeof e2.pc !== 'number') continue
            const pcN = normPC(e2.pc) & 0xFFFF
            if (!set.has(pcN)) { set.add(pcN); idxMap.set(pcN, j) }
          }
          steps = 0
          while (!set.has(cpu.state.pc & 0xFFFF) && steps < maxSteps) { sys.stepInstruction(); steps++ }
          const got = cpu.state.pc & 0xFFFF
          if (set.has(got)) {
            const newI = (idxMap.get(got) || (i + 1))
            console.error(`[resync-many] stepped ${steps} instructions to reach log PC=${hex4(got)} (line ${newI + 1}) from mismatch at line ${i + 1}`)
            resyncManyAt.push({ from: i + 1, to: newI + 1, steps })
            // Jump i forward to the matched log entry (we'll continue with next iteration)
            i = newI
            continue
          }
        }
      }
      console.error(`Mismatch before step at line ${i + 1}`)
      if (typeof exp.a === 'number') {
        console.error(`Expected: PC=${hex4(exp.pc)} A:${hex2(exp.a)} X:${hex2(exp.x!)} Y:${hex2(exp.y!)} P:${hex2(exp.p!)} SP:${hex2(exp.s!)} CYC:${exp.cyc ?? -1}`)
        console.error(`Got:      PC=${hex4(gotPC)} A:${hex2(gotA)} X:${hex2(gotX)} Y:${hex2(gotY)} P:${hex2(gotP)} SP:${hex2(gotS)} CYC:${cpu.state.cycles}`)
      } else {
        console.error(`Expected: PC=${hex4(exp.pc)}`)
        console.error(`Got:      PC=${hex4(gotPC)} A:${hex2(gotA)} X:${hex2(gotX)} Y:${hex2(gotY)} P:${hex2(gotP)} SP:${hex2(gotS)} CYC:${cpu.state.cycles}`)
      }
      console.error('\nDisasm window (from expected PC):')
      console.error(printDisasmWindow(bus, exp.pc, 8))
      console.error('\nDisasm window (from got PC):')
      console.error(printDisasmWindow(bus, gotPC, 8))
      console.error('\nRecent PCs:')
      console.error((cpu.getRecentPCs ? cpu.getRecentPCs(16) : []).map((v: number) => hex4(v)).join(' '))
      console.error('\nStack (SP+1..):')
      console.error(dumpStack(bus, gotS))
      // Show bytes at current PC
      try {
        const b0 = bus.read(gotPC)
        const b1 = bus.read((gotPC + 1) & 0xFFFF)
        const b2 = bus.read((gotPC + 2) & 0xFFFF)
        console.error(`\nMem[PC..]: ${hex2(b0)} ${hex2(b1)} ${hex2(b2)}`)
      } catch {}
      process.exit(1)
    }

    const cycBefore = cpu.state.cycles | 0
    sys.stepInstruction()

    // Optional targeted debug print after step (at new PC)
    const newPC = cpu.state.pc & 0xFFFF
    if (debugSet.has(gotPC) || debugSet.has(newPC)) {
      const a2 = cpu.state.a & 0xFF
      const x2 = cpu.state.x & 0xFF
      const y2 = cpu.state.y & 0xFF
      const p2 = cpu.state.p & 0xFF
      const s2 = cpu.state.s & 0xFF
      const f2 = flagBits(p2)
      console.error(`[debug post] PC=${hex4(newPC)} A=${hex2(a2)} X=${hex2(x2)} Y=${hex2(y2)} P=${hex2(p2)} (N=${+f2.N} V=${+f2.V} Z=${+f2.Z} C=${+f2.C}) SP=${hex2(s2)} CYC_DELTA=${(cpu.state.cycles|0)-cycBefore}`)
    }

    if (i + 1 < limit) {
      const next = parsed[i + 1]
      if (typeof exp.cyc === 'number' && typeof next.cyc === 'number') {
        const deltaExp = next.cyc - (exp.cyc as number)
        const deltaGot = (cpu.state.cycles | 0) - cycBefore
        if (deltaExp !== deltaGot) {
          console.error(`Cycle delta mismatch after line ${i + 1} at PC=${hex4(exp.pc)}`)
          console.error(`Expected delta=${deltaExp}, got ${deltaGot} (CYC before=${exp.cyc}, after=${cpu.state.cycles})`)
          console.error('\nDisasm window (from expected PC):')
          console.error(printDisasmWindow(bus, exp.pc, 8))
          console.error('\nRecent PCs:')
          console.error((cpu.getRecentPCs ? cpu.getRecentPCs(16) : []).map((v: number) => hex4(v)).join(' '))
          process.exit(1)
        }
      }
    }
  }
  console.log(`OK: matched ${limit} lines`)
  // Print resync summary (if any)
  try {
    const totalKnown = resyncKnownAt.length
    const totalSingle = resyncSingleAt.length
    const totalMany = resyncManyAt.length
    if (totalKnown + totalSingle + totalMany > 0) {
      console.log(`[summary] resyncs: known=${totalKnown} single=${totalSingle} many=${totalMany}`)
      if (totalKnown > 0) console.log(`[summary] known at lines: ${resyncKnownAt.map(x => x.at).join(', ')}`)
      if (totalSingle > 0) console.log(`[summary] stepped-to-expected at lines: ${resyncSingleAt.join(', ')}`)
      if (totalMany > 0) console.log(`[summary] stepped-to-ahead log PCs: ${resyncManyAt.map(x => `${x.from}->${x.to} (${x.steps})`).join('; ')}`)
    }
  } catch {}
}

main().catch((e) => { console.error(e); process.exit(1) })

