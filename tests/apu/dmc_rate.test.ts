import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU DMC rate timing (minimal)', () => {
  it('fetches bytes faster at higher rate indices', () => {
    const sys = new NESSystem(rom());
    sys.reset();
    const apu: any = sys.apu as any;

    // Configure a sample address/length
    sys.io.write(0x4012, 0x01); // base addr
    sys.io.write(0x4013, 0x04); // base length (65 bytes)

    // Enable DMC
    sys.io.write(0x4015, 0x10);

    // Helper: run with a given rate index and count fetches over a window
    function countFetches(rateIdx: number, cycles: number): number {
      sys.io.write(0x4010, rateIdx & 0x0F); // IRQ off, loop off, set rate
      apu['dmcFetchCount'] = 0;
      // Reset bytes remaining to ensure plenty to fetch
      apu['dmcBytesRemaining'] = apu['dmcLengthBase'];
      apu['dmcAddress'] = apu['dmcAddressBase'];
      sys.apu.tick(cycles);
      return apu['dmcFetchCount'] as number;
    }

    const window = 5000; // CPU cycles
    const slow = countFetches(0, window);  // slowest
    const mid = countFetches(8, window);
    const fast = countFetches(15, window); // fastest

    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(slow); // Note: with standard table, higher indices are faster
  });
});

