import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runBlarggRom } from '../../helpers/blargg';

// CPU Power/Reset Tests
// README semantics:
// - $6000 status: $80 running, $81 delayed reset needed, < $80 final result (0 pass, 1 fail, >=2 specific)
// - $6001..$6003 = $DE $B0 $61 magic indicates test validity
// - We surface timeouts as "NO RESULT (timeout)" to disambiguate hangs.

describe('blargg cpu_reset suite', () => {
  const isQuick = process.env.BLARGG_QUICK === '1';
  const TIMEOUT = parseInt(process.env.BLARGG_TIMEOUT_MS || (isQuick ? '45000' : '120000'), 10);
  const MAXCYC = parseInt(process.env.BLARGG_MAX_CYCLES || (isQuick ? '30000000' : '60000000'), 10);
  const tests = [
    path.resolve('roms/nes-test-roms/cpu_reset/registers.nes'),
    path.resolve('roms/nes-test-roms/cpu_reset/ram_after_reset.nes'),
  ];

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

