#!/usr/bin/env node
import { spawn } from 'node:child_process'

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function main() {
  console.log('[nestest] Step 1/3: Fetch canonical assets')
  let code = await run('npm', ['run', '-s', 'nestest:fetch'], { ...process.env })
  if (code !== 0) { console.error(`[nestest] fetch failed with code ${code}`); process.exit(code) }

  console.log('[nestest] Step 2/3: Validate canonical log')
  code = await run('npm', ['run', '-s', 'nestest:validate:canonical'], { ...process.env })
  if (code !== 0) { console.error(`[nestest] validate failed with code ${code}`); process.exit(code) }

  console.log('[nestest] Step 3/3: Compare emulator vs canonical log')
  code = await run('npm', ['run', '-s', 'compare:log'], { ...process.env })
  if (code !== 0) { console.error(`[nestest] compare failed with code ${code}`); process.exit(code) }

  console.log('[nestest] Done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
