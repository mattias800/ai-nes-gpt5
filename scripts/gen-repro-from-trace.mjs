#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

// Minimal repro generator: converts a captured trace JSON into a vitest test skeleton.
// Usage: node scripts/gen-repro-from-trace.mjs input.json [outDir]
// input.json format (flexible):
// {
//   "mmc3Trace": [{"type":"8000","v":2}, {"type":"8001","v":4}, {"type":"C000","v":1}, {"type":"C001"}, ...],
//   "a12Trace": [{"frame":0,"scanline":120,"cycle":260}, ...],
//   "notes": "optional"
// }

function main() {
  const inPath = process.argv[2];
  if (!inPath || !fs.existsSync(inPath)) {
    console.error('Usage: node scripts/gen-repro-from-trace.mjs trace.json [outDir]');
    process.exit(1);
  }
  const outDir = process.argv[3] || path.join('tests','repros');
  const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const mm = Array.isArray(raw.mmc3Trace) ? raw.mmc3Trace : [];
  const a12 = Array.isArray(raw.a12Trace) ? raw.a12Trace : [];
  const base = path.basename(inPath).replace(/\.json$/i,'');

  const body = `import { describe, it, expect } from 'vitest'\nimport { PPU } from '@core/ppu/ppu'\nimport { MMC3 } from '@core/cart/mappers/mmc3'\n\nfunction writeAddr(ppu: PPU, addr: number) { ppu.cpuWrite(0x2006, (addr>>8)&0xFF); ppu.cpuWrite(0x2006, addr&0xFF); }\nfunction writePPU(ppu: PPU, addr: number, val: number) { writeAddr(ppu, addr); ppu.cpuWrite(0x2007, val & 0xFF); }\n\ndescribe('Repro from trace: ${base}', () => {\n  it('replays captured MMC3 register sequence and ticks PPU to approximate timing', () => {\n    const ppu = new PPU('vertical'); ppu.reset(); ppu.setTimingMode('vt');\n    const mmc3 = new MMC3(new Uint8Array(0x40000), new Uint8Array(0x2000));\n    ppu.connectCHR(a => mmc3.ppuRead(a), (a,v) => mmc3.ppuWrite(a,v));\n    ppu.setA12Hook(() => mmc3.notifyA12Rise());\n\n    // Palettes to avoid zeros\n    writePPU(ppu, 0x3F00, 0x00); writePPU(ppu, 0x3F01, 0x05);\n\n    // Apply MMC3 writes from trace\n    ${mm.map((e:any) => `mmc3.cpuWrite(0x${e.type}, ${typeof e.v==='number'?('0x'+(e.v&0xFF).toString(16)):0});`).join('\n    ')}\n\n    // Approximate A12 rises by ticking until we exceed last trace entry\n    const rises = ${JSON.stringify(a12)};\n    for (let i=0;i<rises.length;i++){ ppu.tick(10); /* coarse driver; refine as needed */ }\n\n    // TODO: add concrete expectations (CRC, IRQ pending, etc.)\n    expect(typeof mmc3.irqPending!()).toBe('boolean');\n  })\n})\n`;

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${base}.test.ts`);
  fs.writeFileSync(outPath, body);
  console.log(`Wrote repro test to ${outPath}`);
}

main();

