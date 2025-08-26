import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NESSystem } from '@core/system/system';
import { parseINes } from '@core/cart/ines';
import { crc32 } from '@utils/crc32';

// Load .env so FB_BASELINE_* can be set locally
(function loadDotEnv(){
  try {
    const p = path.resolve('.env');
    if (fs.existsSync(p)) {
      const t = fs.readFileSync(p, 'utf-8');
      for (const raw of t.split(/\r?\n/)) {
        const line = raw.trim(); if (!line || line.startsWith('#')) continue;
        const i = line.indexOf('='); if (i <= 0) continue;
        const k = line.slice(0, i).trim(); let v = line.slice(i+1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\''))) v = v.slice(1, -1);
        if (!(k in process.env)) process.env[k] = v;
      }
    }
  } catch {}
})();

function findLocalRom(): string | null {
  const cwd = process.cwd();
  const files = fs.readdirSync(cwd).filter((f) => f.toLowerCase().endsWith('.nes'));
  if (files.length === 0) return null;
  files.sort((a, b) => {
    const am = a.toLowerCase().startsWith('mario') ? 0 : 1;
    const bm = b.toLowerCase().startsWith('mario') ? 0 : 1;
    return am - bm;
  });
  return path.join(cwd, files[0]);
}

describe.skipIf(!findLocalRom())('Framebuffer hash smoke (background only)', () => {
  it('runs a few frames then hashes a background-only framebuffer', () => {
    const romPath = findLocalRom()!;
    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
    const sys = new NESSystem(rom);
    sys.reset();

    // Enable background rendering minimally
    sys.io.write(0x2001, 0x08);

    const start = sys.ppu.frame;
    const target = start + 3;
    let steps = 0;
    const maxSteps = 2_000_000;
    while (sys.ppu.frame < target && steps < maxSteps) { sys.stepInstruction(); steps++; }
    if (steps >= maxSteps) throw new Error('Frame render timed out');

    const fb = (sys.ppu as any).renderBgFrame();
    const hash = crc32(fb);

    const baseline = process.env.FB_BASELINE_BG;
    if (baseline) {
      const expected = baseline.startsWith('0x') || baseline.startsWith('0X') ? parseInt(baseline, 16) : parseInt(baseline, 10);
      expect(hash >>> 0).toBe(expected >>> 0);
    } else {
      // eslint-disable-next-line no-console
      console.log(`BG framebuffer CRC32: 0x${hash.toString(16).toUpperCase().padStart(8,'0')} (${hash})`);
      expect(typeof hash).toBe('number');
    }
  });
});

