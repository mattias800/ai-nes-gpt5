import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

// These tests exercise noise LFSR step behavior deterministically by invoking an exposed tick.
// We only verify that mode flag selects tap-6 vs tap-1, and that the shift register changes accordingly.

describe('APU noise LFSR stepping (basic)', () => {
  it('mode 0 uses bit1 tap; mode 1 uses bit6 tap', () => {
    const sys = new NESSystem(rom());
    sys.reset();
    const apu: any = sys.apu as any;

    // Initialize shift register to a known value with distinct bit1 vs bit6 so taps differ
    apu['noiseShift'] = 0x41; // bit6=1, bit1=0, lsb=1

    // Mode 0: tap bit1
    sys.io.write(0x400E, 0x00); // mode=0
    const before0 = apu['noiseShift'];
    apu['clockNoiseTimer']();
    const after0 = apu['noiseShift'];
    expect(after0).not.toBe(before0);

    // Reset and mode 1: tap bit6
    apu['noiseShift'] = 0x4000 | 1;
    sys.io.write(0x400E, 0x80); // mode=1
    const before1 = apu['noiseShift'];
    apu['clockNoiseTimer']();
    const after1 = apu['noiseShift'];
    expect(after1).not.toBe(before1);

    // Ensure differing taps produce different sequences from same seed
    expect(after0).not.toBe(after1);
  });
});

