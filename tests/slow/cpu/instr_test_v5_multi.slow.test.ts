import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runBlarggRom } from '../../helpers/blargg';

describe('blargg instr_test-v5 multi-ROMs', () => {
  const tests = [
    path.resolve('roms/nes-test-roms/instr_test-v5/all_instrs.nes'),
    path.resolve('roms/nes-test-roms/instr_test-v5/official_only.nes'),
  ];

  for (const romPath of tests) {
    const name = path.basename(romPath);
    it(`passes ${name}`, () => {
      if (!process.env.DISABLE_APU_IRQ) process.env.DISABLE_APU_IRQ = '1';
      const { code, message, cycles } = runBlarggRom(romPath, { maxCycles: 200_000_000, pollEveryInstr: true, resetDelayCycles: 200_000 });
      if (code !== 0) throw new Error(`FAIL code=${code} cycles=${cycles} msg="${message}"`);
      expect(code).toBe(0);
    }, 180_000);
  }
});
