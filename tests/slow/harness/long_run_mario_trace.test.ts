import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NESSystem } from '@core/system/system';
import { parseINes } from '@core/cart/ines';
import { mkWallDeadline, hitWall, vitestTimeout } from '../../helpers/walltime';

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

describe.skipIf(!findLocalRom())('Long-run Mario with CPU trace (optional)', () => {
  it('runs ~600 frames and logs a limited instruction trace for debugging', { timeout: vitestTimeout('HARNESS_WALL_TIMEOUT_MS', 600000) }, () => {
    const romPath = findLocalRom()!;
    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
    const sys = new NESSystem(rom);
    sys.reset();

    // Enable minimal rendering
    sys.io.write(0x2001, 0x1E);

    const maxLog = parseInt(process.env.TRACE_MAX || '20000', 10);
    let logged = 0;
    // Attach a lightweight trace hook that prints some PCs and opcodes when TRACE=1
    const enable = !!(process.env.TRACE && process.env.TRACE !== '0');
    if (enable) {
      (sys.cpu as any).setTraceHook((pc: number, op: number) => {
        if (logged < maxLog) {
          // eslint-disable-next-line no-console
          console.log(`PC=$${pc.toString(16).padStart(4,'0')} OP=$${op.toString(16).padStart(2,'0')}`);
          logged++;
        }
      });
    }

    const start = sys.ppu.frame;
    const target = start + 600;
    let steps = 0;
    const hardCap = 200_000_000;
    const wallDeadline = mkWallDeadline('HARNESS_WALL_TIMEOUT_MS', 600000);
    while (sys.ppu.frame < target && steps < hardCap) {
      sys.stepInstruction(); steps++;
      if (hitWall(wallDeadline)) break;
    }
    if (sys.ppu.frame < target) throw new Error('Trace long-run timed out (wall or steps cap)');

    expect(sys.ppu.frame).toBeGreaterThanOrEqual(target);
  });
});

