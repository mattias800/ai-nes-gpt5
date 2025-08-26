import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NESSystem } from '@core/system/system';
import { parseINes } from '@core/cart/ines';
import { crc32 } from '@utils/crc32';

// Load .env if present so CRC_BASELINE can be set without exporting in shell
(function loadDotEnv() {
  try {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
      const text = fs.readFileSync(envPath, 'utf-8');
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
      }
    }
  } catch {}
})();

// Deterministic CRC smoke test for a local ROM.
// Runs a fixed number of frames with no inputs and computes a CRC32 over selected
// emulator state that is stable across runs (palette contents + a sample of nametable RAM
// + a few CHR reads from the current mapper). This guards against regressions.

function findLocalRom(): string | null {
  const cwd = process.cwd();
  const files = fs.readdirSync(cwd).filter((f) => f.toLowerCase().endsWith('.nes'));
  if (files.length === 0) return null;
  // Prefer mario*.nes if present
  files.sort((a, b) => {
    const am = a.toLowerCase().startsWith('mario') ? 0 : 1;
    const bm = b.toLowerCase().startsWith('mario') ? 0 : 1;
    return am - bm;
  });
  return path.join(cwd, files[0]);
}

// Build a stable snapshot buffer from system state
function snapshot(sys: NESSystem): Uint8Array {
  const ppu: any = sys.ppu as any;
  const cart: any = (sys.cart as any).mapper;
  const buf: number[] = [];
  // Palette (32 bytes)
  for (let i = 0; i < 32; i++) buf.push(ppu['palette'][i] & 0x3F);
  // Nametable sample: first 64 bytes of mapped nt0
  for (let i = 0; i < 64; i++) {
    const addr = 0x2000 + i;
    const ntIndex = ppu['mapNametable'] ? ppu['mapNametable'](addr) : (addr - 0x2000) & 0x7FF;
    buf.push(ppu['vram'][ntIndex] & 0xFF);
  }
  // CHR sample: read 64 bytes starting at pattern base 0x0000
  const chrRead = cart.ppuRead ? (a: number) => cart.ppuRead(a) : (a: number) => 0;
  for (let i = 0; i < 64; i++) buf.push(chrRead(i & 0x1FFF) & 0xFF);
  return new Uint8Array(buf);
}

describe.skipIf(!findLocalRom())('Deterministic CRC system smoke', () => {
  it('runs fixed frames and produces stable CRC of emulator state', () => {
    const romPath = findLocalRom()!;
    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
    const sys = new NESSystem(rom);
    sys.reset();

    const startFrame = sys.ppu.frame;
    const targetFrames = 3;
    const maxSteps = 2_000_000;
    let steps = 0;

    while (sys.ppu.frame < startFrame + targetFrames && steps < maxSteps) {
      sys.stepInstruction();
      steps++;
    }
    if (steps >= maxSteps) throw new Error('CRC smoke timed out');

    const snap = snapshot(sys);
    const crc = crc32(snap);
    const baselineEnv = process.env.CRC_BASELINE;
    if (baselineEnv) {
      const expected = baselineEnv.startsWith('0x') || baselineEnv.startsWith('0X')
        ? parseInt(baselineEnv, 16)
        : parseInt(baselineEnv, 10);
      expect(crc).toBe(expected >>> 0);
    } else {
      // Log CRC for baseline capture in local runs
      // eslint-disable-next-line no-console
      console.log(`Deterministic CRC: 0x${crc.toString(16).toUpperCase().padStart(8, '0')} (${crc})`);
      expect(typeof crc).toBe('number');
    }
  });
});

