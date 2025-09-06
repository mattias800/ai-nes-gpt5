#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

// Import validator helper if available (works when run via npm scripts)
let validateLogFile = null
try {
  const mod = await import('./validate-nestest-log.mjs')
  validateLogFile = mod.validateLogFile || null
} catch {}

const NES_URL = 'https://raw.githubusercontent.com/christopherpow/nes-test-roms/master/other/nestest/nestest.nes'
const LOG_URL = 'https://raw.githubusercontent.com/christopherpow/nes-test-roms/master/other/nestest/nestest.log'

const OUT_DIR = path.resolve('roms')

async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true })
}

function httpGetBuffer(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const handle = (u, redirects) => {
      const req = https.get(u, (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location) {
          if (redirects <= 0) { reject(new Error(`Too many redirects for ${url}`)); return }
          const loc = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, u).toString()
          res.resume()
          handle(loc, redirects - 1)
          return
        }
        if (status !== 200) {
          reject(new Error(`HTTP ${status} for ${u}`))
          res.resume()
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })
      req.on('error', reject)
    }
    handle(url, maxRedirects)
  })
}

async function atomicWrite(destPath, data) {
  const dir = path.dirname(destPath)
  const tmp = path.join(dir, `.${path.basename(destPath)}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, destPath)
}

async function downloadIfMissing(url, destPath, postCheck = null) {
  if (await exists(destPath)) {
    const st = await fs.stat(destPath)
    console.log(`[skip] exists: ${path.relative(process.cwd(), destPath)} (${st.size} bytes)`) 
    return destPath
  }
  await ensureDir(path.dirname(destPath))
  console.log(`[get] ${url}`)
  const buf = await httpGetBuffer(url)
  if (typeof postCheck === 'function') await postCheck(buf)
  await atomicWrite(destPath, buf)
  const st = await fs.stat(destPath)
  console.log(`[ok]   wrote ${path.relative(process.cwd(), destPath)} (${st.size} bytes)`) 
  return destPath
}

async function validateINesHeader(buf) {
  if (!buf || buf.length < 16) throw new Error('Downloaded ROM too small')
  if (!(buf[0] === 0x4E && buf[1] === 0x45 && buf[2] === 0x53 && buf[3] === 0x1A)) {
    throw new Error('ROM missing iNES header (expected NES<1A>)')
  }
}

async function main() {
  await ensureDir(OUT_DIR)
  const romPath = path.join(OUT_DIR, 'nestest.nes')
  const logPath = path.join(OUT_DIR, 'nestest.log')

  await downloadIfMissing(NES_URL, romPath, validateINesHeader)
  await downloadIfMissing(LOG_URL, logPath)

  // Validate the log immediately if validator is available
  if (validateLogFile) {
    const ok = await validateLogFile(logPath, { quiet: true })
    if (!ok) {
      try { await fs.unlink(logPath) } catch {}
      throw new Error('Downloaded nestest.log failed validation; removed. Please retry or fetch manually.')
    }
    console.log(`[ok]   validated ${path.relative(process.cwd(), logPath)}`)
  } else {
    console.log('[warn] validator not found; consider running: npm run nestest:validate:canonical')
  }

  console.log('\nDone. You can now run:')
  console.log('  NESTEST_MAX=500 npm run nestest:compare')
  console.log('  npm run nestest:diff')
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })

