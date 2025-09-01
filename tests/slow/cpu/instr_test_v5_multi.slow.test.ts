import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runBlarggRom } from '../../helpers/blargg';

describe('blargg instr_test-v5 multi-ROMs', () => {
  const isQuick = process.env.BLARGG_QUICK === '1';
  const TIMEOUT = parseInt(process.env.BLARGG_TIMEOUT_MS || (isQuick ? '90000' : '180000'), 10);
  const MAXCYC = parseInt(process.env.BLARGG_MAX_CYCLES || (isQuick ? '80000000' : '200000000'), 10);
  const tests = [
    path.resolve('roms/nes-test-roms/instr_test-v5/all_instrs.nes'),
    path.resolve('roms/nes-test-roms/instr_test-v5/official_only.nes'),
  ];

  for (const romPath of tests) {
    const name = path.basename(romPath);
    it(`passes ${name}`, () => {
      if (!process.env.DISABLE_APU_IRQ) process.env.DISABLE_APU_IRQ = '1';
      const { code, message, cycles } = runBlarggRom(romPath, { maxCycles: MAXCYC, pollEveryInstr: true, resetDelayCycles: 200_000 });
      if (code !== 0) throw new Error(`FAIL code=${code} cycles=${cycles} msg="${message}"`);
      expect(code).toBe(0);
    }, TIMEOUT);
  }
});
