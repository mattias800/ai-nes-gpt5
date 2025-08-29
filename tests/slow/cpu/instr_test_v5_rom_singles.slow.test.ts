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
  const roms = listRoms();
  if (roms.length === 0) {
    it('roms exist', () => { expect(fs.existsSync(ROM_DIR)).toBe(true); });
    return;
  }

  for (const romPath of roms) {
    const name = path.basename(romPath);
    it(`passes ${name}`, () => {
      // Ensure deterministic IRQ behavior
      if (!process.env.DISABLE_APU_IRQ) process.env.DISABLE_APU_IRQ = '1';
      const { code, message, cycles } = runBlarggRom(romPath, { maxCycles: 60_000_000, pollEveryInstr: true });
      if (code !== 0) throw new Error(`FAIL code=${code} cycles=${cycles} msg="${message}"`);
      expect(code).toBe(0);
    }, 120_000);
  }
});
