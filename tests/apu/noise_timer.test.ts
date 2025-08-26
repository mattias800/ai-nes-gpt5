import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU noise timer period table', () => {
  it('steps the LFSR at different rates for distinct period indices', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Enable noise and set a known non-zero length via $400F
    sys.io.write(0x4015, 0x08);
    sys.io.write(0x400C, 0x00); // envelope settings irrelevant here
    sys.io.write(0x400F, 0x00); // load length

    const apu: any = sys.apu as any;
    apu['noiseShift'] = 0x41; // known seed

    // Helper to count steps over a fixed CPU cycle window
    function countSteps(periodIdx: number, cycles: number): number {
      sys.io.write(0x400E, (periodIdx & 0x0F)); // mode=0, set index
      apu['noiseStepCount'] = 0;
      sys.apu.tick(cycles);
      return apu['noiseStepCount'] as number;
    }

    const cycles = 4096;
    const s0 = countSteps(0, cycles);   // shortest period
    const s4 = countSteps(4, cycles);
    const s15 = countSteps(15, cycles); // longest period

    expect(s0).toBeGreaterThan(s4);
    expect(s4).toBeGreaterThan(s15);
    expect(s0).toBeGreaterThan(s15);
  });
});

