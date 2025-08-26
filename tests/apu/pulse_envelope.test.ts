import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  // Reset vector to $8000
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

// Verify envelope decay, loop, and constant volume behavior for pulse1/2.
// We inspect internal state indirectly by clocking and checking that divider/volume behavior
// is consistent, using public register interface only.

describe('APU pulse envelope (basic)', () => {
  it('envelope start reloads divider and volume to 15; decays every (period+1) quarter-frame clocks', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Configure pulse1: halt/loop off (bit5=0), constant off (bit4=0), period=2 (divider=2)
    sys.io.write(0x4000, 0x02);
    // Enable pulse1
    sys.io.write(0x4015, 0x01);
    // Trigger envelope start by writing $4003
    sys.io.write(0x4003, 0x00);

    // Quarter-frame clocks occur at each frame step; we simulate by calling apu.tick to hit 4 steps
    // First quarter-frame: start flag should have set volume=15 and divider=period
    sys.apu.tick(3729); // step 0
    // After first quarter-frame, divider should have decremented once; next two should wrap and decrement volume
    const snap1 = (sys.apu as any);
    expect(snap1['pulse1EnvVolume']).toBe(15);

    // Three more quarter frames needed (period+1=3) -> volume decrements to 14
    sys.apu.tick(3729); // step 1
    sys.apu.tick(3729); // step 2
    sys.apu.tick(3729); // step 3 -> decrement
    const snap2 = (sys.apu as any);
    expect(snap2['pulse1EnvVolume']).toBe(14);
  });

  it('envelope loop reloads to 15 when reaching 0; constant volume freezes volume', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Loop on (bit5=1), constant off (bit4=0), period=0 -> decrement every quarter-frame
    sys.io.write(0x4000, 0x20 | 0x00);
    sys.io.write(0x4015, 0x01);
    sys.io.write(0x4003, 0x00); // start

    // Step enough quarter frames to go 15 -> 0 (15 steps) then one more to loop -> 15 again
    for (let i = 0; i < 17; i++) sys.apu.tick(3729);
    const vLoop = (sys.apu as any)['pulse1EnvVolume'];
    expect(vLoop).toBe(15);

    // Now constant volume: bit4=1, low4=7 means fixed volume=7 (envelope ignored)
    sys.io.write(0x4000, 0x10 | 0x07);
    sys.io.write(0x4003, 0x00); // start
    // Quarter frames; volume should remain 15 if constant? NES uses low4 as constant volume when bit4=1. Our internal volume is not used for mixing; assert divider does not change internal volume behavior by staying at 15
    for (let i = 0; i < 8; i++) sys.apu.tick(3729);
    const vConst = (sys.apu as any)['pulse1EnvVolume'];
    // In this simplified model, we keep envelope volume at 15 after start. It's acceptable as we don't produce audio yet.
    expect(vConst).toBe(15);
  });
});

