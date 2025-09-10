import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NESSystem } from '@core/system/system';
import { parseINes } from '@core/cart/ines';
import { crc32 } from '@utils/crc32';
import { mkWallDeadline, hitWall, vitestTimeout } from '../helpers/walltime';

// Load .env so LONG_RUN flags can be set locally
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

const LONG_RUN = !!(process.env.LONG_RUN && process.env.LONG_RUN !== '0');

describe.skipIf(!findLocalRom() || !LONG_RUN)('Long-run Mario integration (optional)', () => {
  it('runs ~60 frames and computes a stable state CRC', { timeout: vitestTimeout('HARNESS_WALL_TIMEOUT_MS', 180000) }, () => {
    const romPath = findLocalRom()!;
    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
    const sys = new NESSystem(rom);
    sys.reset();

    // Enable background and sprites minimally
    sys.io.write(0x2001, 0x1E);

    const start = sys.ppu.frame;
    const target = start + 60; // about one second
    let steps = 0;
    const maxSteps = 10_000_000;
    const wallDeadline = mkWallDeadline('HARNESS_WALL_TIMEOUT_MS', 180000);
    while (sys.ppu.frame < target && steps < maxSteps) {
      sys.stepInstruction(); steps++;
      if (hitWall(wallDeadline)) break;
    }
    if (sys.ppu.frame < target) throw new Error('Long-run frame render timed out (wall or steps cap)');

    // Compute deterministic CRC over PPU state similar to deterministic_crc_smoke
    const vram = (sys.ppu as any)['vram'] as Uint8Array; // background nametables (2KB)
    const palette = (sys.ppu as any)['palette'] as Uint8Array; // 32 bytes
    // Snapshot CHR via mapper interface for 8KB region
    const chr = new Uint8Array(0x2000);
    for (let a = 0; a < 0x2000; a++) chr[a] = (sys.cart as any).readChr(a & 0x1FFF);

    // Combine into one buffer
    const buf = new Uint8Array(vram.length + palette.length + chr.length);
    buf.set(vram, 0);
    buf.set(palette, vram.length);
    buf.set(chr, vram.length + palette.length);

    const hash = crc32(buf);
    const baseline = process.env.LONG_RUN_BASELINE_CRC;
    if (baseline) {
      const expected = baseline.startsWith('0x') || baseline.startsWith('0X') ? parseInt(baseline, 16) : parseInt(baseline, 10);
      expect(hash >>> 0).toBe(expected >>> 0);
    } else {
      // eslint-disable-next-line no-console
      console.log(`Long-run state CRC32: 0x${hash.toString(16).toUpperCase().padStart(8,'0')} (${hash})`);
      expect(typeof hash).toBe('number');
    }
  });
});

