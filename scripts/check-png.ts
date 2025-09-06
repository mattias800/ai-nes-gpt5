/* eslint-disable no-console */
import fs from 'node:fs'
import { PNG } from 'pngjs'

function usage(): never {
  console.error('Usage: tsx scripts/check-png.ts <path>')
  process.exit(2)
}

const pathArg = process.argv[2]
if (!pathArg) usage()
if (!fs.existsSync(pathArg)) {
  console.error(`File not found: ${pathArg}`)
  process.exit(2)
}

fs.createReadStream(pathArg)
  .pipe(new PNG())
  .on('parsed', function parsed(this: PNG) {
    const { width: w, height: h, data } = this
    let nonBlack = 0
    const uniq = new Set<number>()
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] | 0, g = data[i + 1] | 0, b = data[i + 2] | 0, a = data[i + 3] | 0
      if (a !== 0 && (r !== 0 || g !== 0 || b !== 0)) nonBlack++
      uniq.add((r << 16) | (g << 8) | b)
    }
    const total = (w * h) | 0
    const pct = total > 0 ? (100 * nonBlack / total) : 0
    const ok = uniq.size >= 2 && nonBlack > 1000
    console.log(JSON.stringify({ path: pathArg, width: w, height: h, unique_colors: uniq.size, non_black: nonBlack, non_black_pct: +pct.toFixed(2), ok }))
    process.exit(ok ? 0 : 1)
  })
  .on('error', (e: any) => { console.error(e); process.exit(1) })

