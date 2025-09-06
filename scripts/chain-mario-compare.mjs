#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function main() {
  // Resolve ROM from env or default to ./mario.nes
  let rom = process.env.ROM || './mario.nes'
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--rom=')) rom = a.slice(6)
  }
  const romAbs = path.resolve(rom)
  if (!fs.existsSync(romAbs)) {
    console.error(`[error] ROM not found: ${romAbs}`)
    process.exit(2)
  }
  console.log(`[chain] ROM=${romAbs}`)

  // 1) Dump RAM/regs at early reset PC range
  console.log(`[chain] Step 1/3: Dump RAM/regs from MAME at early PC`)
  let code = await run('npm', ['run', '-s', 'mame:dump'], { ...process.env, ROM: romAbs })
  if (code !== 0) { console.error(`[chain] mame:dump failed with code ${code}`); process.exit(code) }

  // 2) Generate PC-only MAME trace from reset
  console.log(`[chain] Step 2/3: Generate MAME trace (PC-only) from reset`)
  code = await run('npm', ['run', '-s', 'trace:mame'], { ...process.env, ROM: romAbs })
  if (code !== 0) { console.error(`[chain] trace:mame failed with code ${code}`); process.exit(code) }

  // 3) Compare using RAM preload and the PC-only MAME trace
  console.log(`[chain] Step 3/3: Compare emulator vs MAME using RAM preload`)
  code = await run('npm', ['run', '-s', 'compare:mame'], { ...process.env, ROM: romAbs, LOAD_RAM: path.resolve('out/mame_ram.bin') })
  if (code !== 0) { console.error(`[chain] compare:mame failed with code ${code}`); process.exit(code) }

  console.log('[chain] Done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
