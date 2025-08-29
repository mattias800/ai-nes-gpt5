import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

// Verify noise output polarity: bit0==1 should be silent; bit0==0 should output volume.
// We compare mixed samples with only noise enabled, constant volume set.

describe('APU noise output polarity', () => {
  it('bit0==1 yields lower output than bit0==0 (constant volume)', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Enable noise; constant volume=15, fast period, load length
    sys.io.write(0x4015, 0x08);
    sys.io.write(0x400C, 0x10 | 0x0F); // constant=1, volume=15
    sys.io.write(0x400E, 0x00); // mode=0, period index=0
    sys.io.write(0x400F, 0x00); // length load

    const apu: any = sys.apu as any;

    // Force bit0=1 -> expect silence contribution from noise
    apu['noiseShift'] = 0x0001; // lsb=1
    const s1 = sys.apu.mixSample();

    // Force bit0=0 -> expect non-zero contribution from noise
    apu['noiseShift'] = 0x0002; // lsb=0
    const s2 = sys.apu.mixSample();

    expect(s2).toBeGreaterThan(s1);
  });
});

