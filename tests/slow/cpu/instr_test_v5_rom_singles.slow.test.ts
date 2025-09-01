import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runBlarggRom } from '../../helpers/blargg';

const ROM_DIR = path.resolve('roms/nes-test-roms/instr_test-v5/rom_singles');

const listRoms = (): string[] => {
  if (!fs.existsSync(ROM_DIR)) return [];
  return fs.readdirSync(ROM_DIR)
    .filter((n) => n.toLowerCase().endsWith('.nes'))
    .map((n) => path.join(ROM_DIR, n))
    .sort();
};

describe('blargg instr_test-v5 singles', () => {
  const isQuick = process.env.BLARGG_QUICK === '1';
  const TIMEOUT = parseInt(process.env.BLARGG_TIMEOUT_MS || (isQuick ? '60000' : '120000'), 10);
  const MAXCYC = parseInt(process.env.BLARGG_MAX_CYCLES || (isQuick ? '40000000' : '60000000'), 10);

  let roms = listRoms();
  if (roms.length === 0) {
    it('roms exist', () => { expect(fs.existsSync(ROM_DIR)).toBe(true); });
    return;
  }
  if (isQuick) {
    roms = roms.slice(0, 4); // smaller subset in quick mode
  }

  for (const romPath of roms) {
    const name = path.basename(romPath);
    it(`passes ${name}`, () => {
      // Ensure deterministic IRQ behavior
      if (!process.env.DISABLE_APU_IRQ) process.env.DISABLE_APU_IRQ = '1';
      const { code, message, cycles } = runBlarggRom(romPath, { maxCycles: MAXCYC, pollEveryInstr: true });
      if (code !== 0) throw new Error(`FAIL code=${code} cycles=${cycles} msg="${message}"`);
      expect(code).toBe(0);
    }, TIMEOUT);
  }
});
