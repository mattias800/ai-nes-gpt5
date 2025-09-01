import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runBlarggRom } from '../../helpers/blargg';

// NES 6502 Timing Test (blargg)
// README: tests all official and unofficial (except branches and HLT), up to ~16s runtime.
// We use the standard blargg status protocol via runBlarggRom and surface timeouts as NO RESULT.

describe('blargg cpu_timing_test6', () => {
  const romPath = path.resolve('roms/nes-test-roms/cpu_timing_test6/cpu_timing_test.nes');
  const isQuick = process.env.BLARGG_QUICK === '1';
  const TIMEOUT = parseInt(process.env.BLARGG_TIMEOUT_MS || (isQuick ? '60000' : '180000'), 10);
  const MAXCYC = parseInt(process.env.BLARGG_MAX_CYCLES || (isQuick ? '60000000' : '200000000'), 10);

  it('passes cpu_timing_test.nes', () => {
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
        throw new Error(`NO RESULT (timeout) for ${romPath}: ${msg}`);
      }
      throw e;
    }
  }, TIMEOUT);
});

