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

async function runMameOnce(mame, args, env, outPath, durationMs, pidFile) {
  try { fs.unlinkSync(outPath) } catch {}
  const child = spawn(mame, args, { stdio: 'inherit', env })
  try { fs.writeFileSync(pidFile, String(child.pid)) } catch {}
  let exited = false
  child.on('exit', () => { exited = true })

  const graceMs = 500
  setTimeout(() => {
    try { process.kill(child.pid, 'SIGTERM') } catch {}
    setTimeout(() => { if (!exited) { try { process.kill(child.pid, 'SIGKILL') } catch {} } }, graceMs)
  }, durationMs)

  const maxWait = durationMs + graceMs + 1500
  const start = Date.now()
  while (!exited && (Date.now() - start) < maxWait) await sleep(50)
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
  const seconds = parseFloat(process.env.TRACE_SECONDS || '1')
  const fps = parseFloat(process.env.MAME_FPS || '60')
  // Do not force a start PC by default; trace from true reset unless explicitly provided
  let start = process.env.START || process.env.NESTEST_START || ''
  if (process.env.START && /^(reset|none)$/i.test(process.env.START)) start = ''
  const outDir = path.resolve('out')
  let outPath = path.join(outDir, 'external-mame.log')
  // Allow overriding output path via OUT or MAME_OUT env
  try {
    const override = process.env.OUT || process.env.MAME_OUT
    if (override && override.length > 0) outPath = path.resolve(override)
  } catch {}
  const pidFile = path.join(outDir, 'external-mame.pid')
  const lua = path.resolve('scripts/external/mame_trace.lua')
  fs.mkdirSync(outDir, { recursive: true })

  const env = {
    ...process.env,
    MAME_OUT: outPath,
    MAME_SECONDS: String(Math.max(0, seconds)),
    MAME_FPS: String(Math.max(1, fps)),
    MAME_START: start,
  }
  const durationMs = Math.max(500, Math.floor((isFinite(seconds) && seconds > 0 ? seconds : 1) * 1000))

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
  console.log(`[run] ${mame} ${args.join(' ')}`)
  const ok = await runMameOnce(mame, args, env, outPath, durationMs, pidFile)
  if (!ok) {
    console.error(`[error] No log produced at ${outPath}`)
    process.exit(1)
  }
  const head = fs.readFileSync(outPath, 'utf8').split(/\r?\n/).slice(0, 12).join('\n')
  console.log(`[ok] wrote ${path.relative(process.cwd(), outPath)}\n--- head ---\n${head}\n------------`)
}

main()

