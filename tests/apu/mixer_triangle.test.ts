import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU mixer (triangle minimal)', () => {
  it('produces a changing sequence when triangle enabled and clocked', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Enable triangle and set a reasonable timer period
    sys.io.write(0x4015, 0x04);
    sys.io.write(0x400A, 0x08);
    sys.io.write(0x4008, 0x03); // linear reload=3, control=0
    sys.io.write(0x400B, 0x00); // length load + reload flag

    // Quarter-frame to reload linear
    sys.apu.tick(3729);

    const samples: number[] = [];
    for (let i = 0; i < 32; i++) {
      samples.push(sys.apu.mixSample());
      // Advance a chunk of CPU cycles so the triangle phase advances between samples
      sys.apu.tick(100);
    }

    // Ensure not all samples are equal
    const first = samples[0];
    const allEqual = samples.every((s) => s === first);
    expect(allEqual).toBe(false);
  });
});

