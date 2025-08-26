import { describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseINes } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

function findLocalNes(): string | null {
  // Prefer SMB_ROM from env; otherwise search for a .nes file in cwd, preferring mario*.nes
  const env = process.env.SMB_ROM;
  if (env && fs.existsSync(env)) return env;
  const cwd = process.cwd();
  const files = fs.readdirSync(cwd);
  const nes = files.filter((f) => f.toLowerCase().endsWith('.nes')).sort((a, b) => {
    const am = a.toLowerCase().startsWith('mario') ? 0 : 1;
    const bm = b.toLowerCase().startsWith('mario') ? 0 : 1;
    return am - bm;
  });
  if (nes.length === 0) return null;
  return path.join(cwd, nes[0]);
}

describe.skipIf(!findLocalNes())('Headless ROM smoke test', () => {
  it('loads ROM and runs a few frames without exceptions', () => {
    const romPath = findLocalNes()!;
    const buf = new Uint8Array(fs.readFileSync(romPath));
    const rom = parseINes(buf);
    const sys = new NESSystem(rom);
    sys.reset();

    const startFrame = sys.ppu.frame;
    const targetFrames = 5;
    const maxSteps = 5_000_000; // guard against runaway
    let steps = 0;

    while (sys.ppu.frame < startFrame + targetFrames && steps < maxSteps) {
      sys.stepInstruction();
      steps++;
    }

    if (steps >= maxSteps) throw new Error('Smoke test timed out before reaching target frames');
  });
});
