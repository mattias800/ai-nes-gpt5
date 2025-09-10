import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseINes } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';
import { mkWallDeadline, hitWall, vitestTimeout } from '../helpers/walltime';

function* listRoms(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.nes')) {
      const full = path.join(dir, e.name);
      if (/nestest\.nes$/i.test(e.name)) continue; // skip nestest in suite
      yield full;
    }
  }
}

describe.skipIf(process.env.BLARGG !== '1')('blargg suite', () => {
  const root = path.resolve(process.env.BLARGG_DIR || 'roms');
  const timeoutCycles = Number.parseInt(process.env.BLARGG_TIMEOUT || '50000000', 10);
  const roms = fs.existsSync(root) ? Array.from(listRoms(root)) : [];

  for (const romPath of roms) {
    const name = path.basename(romPath);
    it(`runs ${name} until PASS or timeout`, { timeout: vitestTimeout('HARNESS_WALL_TIMEOUT_MS', 300000) }, () => {
      const buf = new Uint8Array(fs.readFileSync(romPath));
      const rom = parseINes(buf);
      const sys = new NESSystem(rom);
      sys.reset();

      let msg = '';
      const wallDeadline = mkWallDeadline('HARNESS_WALL_TIMEOUT_MS', 300000);
      while (sys.cpu.state.cycles < timeoutCycles) {
        sys.stepInstruction();
        if (hitWall(wallDeadline)) break;
        const status = sys.bus.read(0x6000);
        if (status === 0x80) {
          // running
        } else if (status === 0x81) {
          msg = readString(sys, 0x6004);
          break;
        } else if (status === 0x00) {
          msg = readString(sys, 0x6004);
          throw new Error(`FAIL: ${msg}`);
        }
      }
      if (!msg) throw new Error('blargg test timed out (wall or cycles)');
      expect(msg).toBeTypeOf('string');
    });
  }
});

function readString(sys: NESSystem, addr: number): string {
  let s = '';
  for (let i = 0; i < 512; i++) {
    const ch = sys.bus.read((addr + i) & 0xFFFF);
    if (ch === 0) break;
    s += String.fromCharCode(ch);
  }
  return s;
}
