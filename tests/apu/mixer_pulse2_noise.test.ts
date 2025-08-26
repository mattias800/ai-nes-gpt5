import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU mixer (pulse2 + noise minimal)', () => {
  it('pulse2 contributes and changes over time', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Enable pulse2; set duty=25% (01), envelope period small (2)
    sys.io.write(0x4015, 0x02);
    sys.io.write(0x4004, (2 & 0x0F) | (1 << 6)); // duty=1 (25%), env period=2
    sys.io.write(0x4006, 0x08);
    sys.io.write(0x4007, 0x00);

    sys.apu.tick(3729);

    const samples: number[] = [];
    for (let i = 0; i < 32; i++) {
      samples.push(sys.apu.mixSample());
      sys.apu.tick(200);
    }
    const first = samples[0];
    const allEqual = samples.every((s) => s === first);
    expect(allEqual).toBe(false);
  });

  it('noise contributes and changes over time at a given period', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Enable noise; envelope constant off so envelope volume affects output
    sys.io.write(0x4015, 0x08);
    sys.io.write(0x400C, 0x00); // halt=0, constant=0, period=0
    sys.io.write(0x400E, 0x00); // mode=0, period index=0 (fast)
    sys.io.write(0x400F, 0x00); // length load and envelope start

    const samples: number[] = [];
    for (let i = 0; i < 64; i++) {
      samples.push(sys.apu.mixSample());
      sys.apu.tick(64);
    }
    const uniq = new Set(samples);
    // Expect a diversity of values due to LFSR; not necessarily all non-zero, but not one value
    expect(uniq.size).toBeGreaterThan(1);
  });
});

