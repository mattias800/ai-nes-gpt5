import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runBlarggRom } from '../../helpers/blargg';

const ROM_DIR = path.resolve('roms/nes-test-roms/cpu_interrupts_v2/rom_singles');

const listRoms = (): string[] => {
  if (!fs.existsSync(ROM_DIR)) return [];
  return fs.readdirSync(ROM_DIR)
    .filter((n) => n.toLowerCase().endsWith('.nes'))
    .map((n) => path.join(ROM_DIR, n))
    .sort();
};

describe('blargg cpu_interrupts_v2 singles', () => {
  const isQuick = process.env.BLARGG_QUICK === '1';
  const TIMEOUT = parseInt(process.env.BLARGG_TIMEOUT_MS || (isQuick ? '60000' : '120000'), 10);
  const MAXCYC = parseInt(process.env.BLARGG_MAX_CYCLES || (isQuick ? '80000000' : '120000000'), 10);

  let roms = listRoms();
  if (roms.length === 0) {
    it('roms exist', () => { expect(fs.existsSync(ROM_DIR)).toBe(true); });
    return;
  }
  if (isQuick) {
    roms = roms.slice(0, 2); // run a small subset in quick mode
  }

  for (const romPath of roms) {
    const name = path.basename(romPath);
    it(`passes ${name}`, () => {
      // Ensure APU IRQs are enabled for this suite
      process.env.DISABLE_APU_IRQ = '0';

      try {
        const { code, message, cycles } = runBlarggRom(romPath, {
          maxCycles: MAXCYC,
          pollEveryInstr: true,
          resetDelayCycles: 200_000,
          requireMagic: true,
        });
        if (code !== 0) throw new Error(`FAIL code=${code} cycles=${cycles} msg="${message}"`);
        expect(code).toBe(0);
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.startsWith('Timeout:')) {
          throw new Error(`NO RESULT (timeout) for ${name}: ${msg}`);
        }
        throw e;
      }
    }, TIMEOUT);
  }
});

