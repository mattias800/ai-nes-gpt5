import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runBlarggRom } from '../../helpers/blargg';

// Blargg's CPU Interrupt Tests (v2)
// Uses APU frame IRQ; do NOT disable APU IRQs in these tests.
// Status semantics from README:
// - $6000 = $80 running, $81 request reset after delay, < $80 is final result (0 pass, 1 fail, >=2 specific error)
// - $6001..$6003 magic $DE $B0 $61 indicates validity
// We also surface timeouts as "NO RESULT (timeout)" to distinguish hangs.

describe('blargg cpu_interrupts_v2 multi-ROM', () => {
  const romPath = path.resolve('roms/nes-test-roms/cpu_interrupts_v2/cpu_interrupts.nes');
  const isQuick = process.env.BLARGG_QUICK === '1';
  const TIMEOUT = parseInt(process.env.BLARGG_TIMEOUT_MS || (isQuick ? '90000' : '180000'), 10);
  const MAXCYC = parseInt(process.env.BLARGG_MAX_CYCLES || (isQuick ? '120000000' : '200000000'), 10);

  it('passes cpu_interrupts.nes', () => {
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
        throw new Error(`NO RESULT (timeout) for ${romPath}: ${msg}`);
      }
      throw e;
    }
  }, TIMEOUT);
});

