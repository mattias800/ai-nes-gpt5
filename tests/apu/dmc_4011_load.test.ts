import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU DMC $4011 DAC load', () => {
  it('writes to $4011 immediately set DAC (0..127) and affect mixer', () => {
    const sys = new NESSystem(rom());
    sys.reset();
    const before = sys.apu.mixSample();

    // Write beyond 7 bits should be masked
    sys.io.write(0x4011, 0xFF);
    const after = sys.apu.mixSample();
    expect(after).toBeGreaterThanOrEqual(before);

    // Lower value should reduce mixed sample compared to max
    sys.io.write(0x4011, 0x00);
    const afterLow = sys.apu.mixSample();
    expect(afterLow).toBeLessThanOrEqual(after);

    // Mid value produces mid-range compared to high/low
    sys.io.write(0x4011, 0x40);
    const afterMid = sys.apu.mixSample();
    expect(afterMid).toBeGreaterThan(afterLow);
    expect(afterMid).toBeLessThan(after);
  });
});

