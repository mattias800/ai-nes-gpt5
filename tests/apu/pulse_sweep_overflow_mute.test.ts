import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU pulse sweep overflow mutes channel', () => {
  it('pulse2 overflow target causes sweep mute flag', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Enable pulse2; set duty/env minimal
    sys.io.write(0x4015, 0x02);
    sys.io.write(0x4004, 0x00);

    // Choose period close to max; shift=1 will overflow target (>0x7FF)
    sys.io.write(0x4006, 0xF0); // low
    sys.io.write(0x4007, 0x0F); // high (period ~0x7F0)

    // Enable sweep with shift=1 (negate=0), so next apply attempts overflow
    sys.io.write(0x4005, 0b1000_0001); // enable, period=0, negate=0, shift=1

    // First half-frame: reload only
    sys.apu.tick(7457);
    // Second half-frame: apply -> should set mute flag due to overflow
    sys.apu.tick(14916 - 7457);

    const apu: any = sys.apu as any;
    expect(apu['pulse2SweepMute']).toBe(true);
  });
});

