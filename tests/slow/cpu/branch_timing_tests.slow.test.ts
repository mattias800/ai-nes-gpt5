import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runBlarggRom } from '../../helpers/blargg';

// NES 6502 Branch Timing Tests (blargg)
// README: must be run AND pass in order.
// We run 1, then 2, then 3, stopping at first failure.
// Timeouts are marked as NO RESULT.

describe('blargg branch_timing_tests (ordered)', () => {
  const isQuick = process.env.BLARGG_QUICK === '1';
  const TIMEOUT = parseInt(process.env.BLARGG_TIMEOUT_MS || (isQuick ? '60000' : '120000'), 10);
  const MAXCYC = parseInt(process.env.BLARGG_MAX_CYCLES || (isQuick ? '40000000' : '120000000'), 10);
  const testsAll = [
    path.resolve('roms/nes-test-roms/branch_timing_tests/1.Branch_Basics.nes'),
    path.resolve('roms/nes-test-roms/branch_timing_tests/2.Backward_Branch.nes'),
    path.resolve('roms/nes-test-roms/branch_timing_tests/3.Forward_Branch.nes'),
  ];
  const tests = isQuick ? [testsAll[0]] : testsAll;

  for (const romPath of tests) {
    const name = path.basename(romPath);
    it(`passes ${name}`, () => {
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

