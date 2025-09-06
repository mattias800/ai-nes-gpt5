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

async function runFceuxOnce(fceux, args, env, outPath, durationMs, pidFile) {
  try { fs.unlinkSync(outPath) } catch {}
  const child = spawn(fceux, args, { stdio: 'inherit', env })
  try { fs.writeFileSync(pidFile, String(child.pid)) } catch {}
  let done = false
  let exited = false
  child.on('exit', () => { exited = true })

  // Kill plan: SIGTERM at duration, then SIGKILL after grace.
  const graceMs = 500
  setTimeout(() => {
    if (done) return
    try { process.kill(child.pid, 'SIGTERM') } catch {}
    setTimeout(() => { if (!exited) { try { process.kill(child.pid, 'SIGKILL') } catch {} } }, graceMs)
  }, durationMs)

  // Wait until process exits or duration+grace+buffer
  const maxWait = durationMs + graceMs + 1000
  const start = Date.now()
  while (!exited && (Date.now() - start) < maxWait) {
    await sleep(50)
  }
  done = true
  // Allow some time for file flush
  await sleep(200)
  return fs.existsSync(outPath) && fs.statSync(outPath).size > 0
}

async function main() {
  const fceux = which('fceux')
  if (!fceux) {
    console.log('[skip] FCEUX not found. Install with: brew install fceux')
    process.exit(0)
  }
  const rom = process.env.ROM || process.env.NESTEST_ROM || path.resolve('roms/nestest.nes')
  if (!fs.existsSync(rom)) {
    console.error(`Missing ROM: ${rom}`)
    process.exit(2)
  }
  const seconds = parseFloat(process.env.TRACE_SECONDS || '1')
  const max = parseInt(process.env.TRACE_MAX || '0', 10)
  const start = process.env.START || process.env.NESTEST_START || 'C000'
  const lua = path.resolve('scripts/external/fceux-trace.lua')
  const outDir = path.resolve('out')
  const outPath = path.join(outDir, 'external-fceux.log')
  const pidFile = path.join(outDir, 'external-fceux.pid')
  fs.mkdirSync(outDir, { recursive: true })

  const baseEnv = {
    ...process.env,
    FCEUX_OUT: outPath,
    FCEUX_SECONDS: String(Math.max(0, Math.floor(seconds))),
    FCEUX_MAX: String(Math.max(0, max)),
    FCEUX_START: start
  }
  const durationMs = Math.max(500, Math.floor((isFinite(seconds) && seconds > 0 ? seconds : 1) * 1000))

  // Try a few argument layouts until a log appears
  const variants = [
    ['--nogui', '--autoexit', '--lua', lua, rom],
    ['--nogui', '--autoexit', rom, '--lua', lua],
    ['--nogui', '--autoexit', '--loadlua', lua, rom],
    ['--nogui', '--autoexit', rom, '--loadlua', lua],
  ]
  for (const args of variants) {
    console.log(`[run] ${fceux} ${args.join(' ')}`)
    const ok = await runFceuxOnce(fceux, args, baseEnv, outPath, durationMs, pidFile)
    if (ok) {
      const sample = fs.readFileSync(outPath, 'utf8').split(/\r?\n/).slice(0, 12).join('\n')
      console.log(`[ok] wrote ${path.relative(process.cwd(), outPath)}\n--- head ---\n${sample}\n------------`)
      process.exit(0)
    }
    console.warn('[warn] No log produced with this invocation, trying next variant...')
  }
  console.error(`[error] No log produced. Checked at: ${outPath}`)
  process.exit(1)
}

main()

