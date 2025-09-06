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

async function main() {
  const mame = which('mame')
  if (!mame) { console.log('[skip] mame not found. brew install mame'); process.exit(0) }
  const rom = process.env.ROM || './mario.nes'
  if (!fs.existsSync(rom)) { console.error(`Missing ROM: ${rom}`); process.exit(2) }
  const outDir = path.resolve('out')
  fs.mkdirSync(outDir, { recursive: true })
  const ramPath = path.join(outDir, 'mame_ram.bin')
  const regsPath = path.join(outDir, 'mame_regs.json')
  // Remove old outputs to prevent false positives
  try { if (fs.existsSync(ramPath)) fs.unlinkSync(ramPath) } catch {}
  try { if (fs.existsSync(regsPath)) fs.unlinkSync(regsPath) } catch {}
  const lua = path.resolve('scripts/external/mame_dump_at_pc.lua')
  // Determine target PC: prefer explicit TARGET_PC; otherwise attempt to derive reset vector from ROM (last 4 bytes of PRG)
  let targetPC = process.env.TARGET_PC
  if (!targetPC) {
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
          targetPC = vec.toString(16).toUpperCase()
        }
      }
    } catch {}
  }
  if (!targetPC) targetPC = 'C000'
  // Default a small range around reset start to ensure we catch early PCs on a frame boundary
  let range = process.env.TARGET_RANGE
  if (!range) {
    const base = parseInt(targetPC, 16)
    const end = (base + 0x50) & 0xFFFF
    const fmt = (v) => v.toString(16).toUpperCase().padStart(4,'0')
    range = `${fmt(base)}-${fmt(end)}`
  }
  console.log(`[cfg] target PC = ${targetPC}, range=${range}`)
  const seconds = Math.max(1, parseFloat(process.env.MAME_SECONDS || '10'))
  const env = { ...process.env, MAME_DUMP_RAM: ramPath, MAME_DUMP_REGS: regsPath, MAME_TARGET_PC: targetPC, MAME_TARGET_RANGE: range }
  const args = ['nes','-cart', rom, '-video','none','-sound','none','-nothrottle','-nowaitvsync','-seconds_to_run', String(seconds), '-autoboot_script', lua, '-autoboot_delay','0']

  console.log(`[run] ${mame} ${args.join(' ')}`)
  const child = spawn(mame, args, { stdio: 'inherit', env })
  const timeoutMs = Math.max(5000, parseInt(process.env.TIMEOUT_MS || '15000', 10))
  let done = false
  child.on('exit', () => { done = true })
  const start = Date.now()
  while (!done && (Date.now() - start) < timeoutMs) await sleep(100)
  if (!done) { try { process.kill(child.pid, 'SIGKILL') } catch {} }

  if (!fs.existsSync(ramPath) || !fs.existsSync(regsPath)) {
    console.error('[error] RAM/regs dump not found'); process.exit(1)
  }
  const head = fs.readFileSync(regsPath, 'utf8')
  console.log(`[ok] wrote ${path.relative(process.cwd(), ramPath)} and ${path.relative(process.cwd(), regsPath)}\nregs: ${head}`)
}

main()

