#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const LINE_RE = /^([0-9A-F]{4}).*A:([0-9A-F]{2}) X:([0-9A-F]{2}) Y:([0-9A-F]{2}) P:([0-9A-F]{2}) SP:([0-9A-F]{2}).*CYC:\s*(\d+)\s*$/

export async function validateLogFile(filePath, opts = {}) {
  const quiet = !!opts.quiet
  const abs = path.resolve(filePath || 'roms/nestest.log')
  let text = ''
  try {
    text = await fs.readFile(abs, 'utf8')
  } catch (e) {
    if (!quiet) console.error(`Missing file: ${abs}`)
    return false
  }
  const rawLines = text.split(/\r?\n/)
  const lines = rawLines.filter((l) => l.trim().length > 0)
  if (lines.length === 0) {
    if (!quiet) console.error('Empty log file')
    return false
  }
  // First line PC must be C000
  const first = lines[0].toUpperCase()
  if (!/^C000\b/.test(first)) {
    if (!quiet) console.error('First line PC is not C000 (expected nestest start)')
    return false
  }
  // Validate each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!LINE_RE.test(line)) {
      if (!quiet) console.error(`Line ${i + 1} does not match expected format: ${line}`)
      return false
    }
  }
  const maxEnv = process.env.NESTEST_MAX ? parseInt(process.env.NESTEST_MAX, 10) : 0
  if (maxEnv > 0 && lines.length < maxEnv) {
    if (!quiet) console.error(`Insufficient lines for NESTEST_MAX=${maxEnv}; have ${lines.length}`)
    return false
  }
  if (!quiet) console.log(`OK ${abs} lines=${lines.length}`)
  return true
}

async function main() {
  const p = process.argv[2] || 'roms/nestest.log'
  const ok = await validateLogFile(p)
  process.exit(ok ? 0 : 1)
}

// If run as CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1) })
}

