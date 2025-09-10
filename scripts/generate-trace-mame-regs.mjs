#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function which(cmd) {
  const r = spawnSync('bash', ['-lc', `command -v ${cmd} || true`], { encoding: 'utf8' })
  const s = (r.stdout || '').trim()
  return s.length > 0 ? s : null
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function runMameRegs(mame, args, env, outPath, maxWaitMs, pidFile) {
  try { fs.unlinkSync(outPath) } catch {}
  const child = spawn(mame, args, { stdio: 'inherit', env })
  try { fs.writeFileSync(pidFile, String(child.pid)) } catch {}
  let exited = false
  child.on('exit', () => { exited = true })

  const start = Date.now()
  while (!exited && (Date.now() - start) < maxWaitMs) await sleep(50)
  await sleep(300)
  return fs.existsSync(outPath) && fs.statSync(outPath).size > 0
}

async function main() {
  const mame = which('mame')
  if (!mame) {
    console.log('[skip] mame not found. Install with: brew install mame')
    process.exit(0)
  }
  const rom = process.env.ROM || process.env.NESTEST_ROM || path.resolve('roms/nestest.nes')
  if (!fs.existsSync(rom)) { console.error(`Missing ROM: ${rom}`); process.exit(2) }
  const seconds = parseFloat(process.env.TRACE_SECONDS || '0')
  const inst = parseInt(process.env.TRACE_MAX || process.env.MAME_INST || '2000', 10)
  // Do not force start PC unless explicitly provided; default to reset vector derived from ROM
  let start = process.env.START || process.env.NESTEST_START || ''
  if (!start) {
    try {
      const buf = fs.readFileSync(rom)
      if (buf.length >= 16 && buf[0] === 0x4E && buf[1] === 0x45 && buf[2] === 0x53 && buf[3] === 0x1A) {
        const prg16k = buf[4] | 0
        const hasTrainer = (buf[6] & 0x04) !== 0
        const prgStart = 16 + (hasTrainer ? 512 : 0)
        const prgSize = prg16k * 16384
        if (prgSize >= 16 && (prgStart + prgSize) <= buf.length) {
          const lo = buf[prgStart + prgSize - 4] | 0
          const hi = buf[prgStart + prgSize - 3] | 0
          const vec = (lo | (hi << 8)) & 0xFFFF
          start = vec.toString(16).toUpperCase()
        }
      }
    } catch {}
  }
  const outDir = path.resolve('out')
  const outPath = path.join(outDir, 'external-mame-regs.log')
  const pidFile = path.join(outDir, 'external-mame-regs.pid')
  const lua = path.resolve('scripts/external/mame_trace_regs.lua')
  fs.mkdirSync(outDir, { recursive: true })

  const env = {
    ...process.env,
    MAME_OUT: outPath,
    MAME_INST: String(Math.max(1, inst)),
    MAME_START: start,
    MAME_INIT_AUTO: (process.env.MAME_INIT_AUTO ?? '1'),
  }
  // Allow TRACE_SECONDS to impose a max wait; otherwise default to generous timeout for stepping
  const durationMs = Math.max(10000, Math.floor((isFinite(seconds) && seconds > 0 ? seconds : 10) * 1000))

  const args = [
    'nes',
    '-cart', rom,
    '-video', 'none',
    '-sound', 'none',
    '-nothrottle',
    '-nowaitvsync',
    '-debug',
    '-autoboot_script', lua,
    '-autoboot_delay', '0'
  ]
  console.log(`[run] ${mame} ${args.join(' ')} (start=${start||'reset'})`)
  const ok = await runMameRegs(mame, args, env, outPath, durationMs, pidFile)
  if (!ok) {
    console.error(`[error] No log produced at ${outPath}`)
    process.exit(1)
  }
  const head = fs.readFileSync(outPath, 'utf8').split(/\r?\n/).slice(0, 12).join('\n')
  console.log(`[ok] wrote ${path.relative(process.cwd(), outPath)}\n--- head ---\n${head}\n------------`)
}

main()

