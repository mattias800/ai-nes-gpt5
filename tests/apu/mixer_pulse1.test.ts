import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU mixer (pulse1 minimal)', () => {
  it('pulse1 contributes and changes over time with envelope decay', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Enable pulse1; set duty=50% (10), envelope period small (2)
    sys.io.write(0x4015, 0x01);
    sys.io.write(0x4000, (2 & 0x0F) | (2 << 6)); // duty=2 (50%), env period=2
    // Set timer period to an audible rate
    sys.io.write(0x4002, 0x08);
    sys.io.write(0x4003, 0x00); // length load + timer high bits

    // Quarter frame to start envelope
    sys.apu.tick(3729);

    const samples: number[] = [];
    for (let i = 0; i < 32; i++) {
      samples.push(sys.apu.mixSample());
      sys.apu.tick(200);
    }

    // Ensure not all equal
    const first = samples[0];
    const allEqual = samples.every((s) => s === first);
    expect(allEqual).toBe(false);
  });
});

