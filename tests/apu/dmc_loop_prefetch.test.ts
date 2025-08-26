import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x90;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU DMC loop and IRQ clearing', () => {
  it('looping prevents IRQ and restarts sample when length ends', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Configure: loop on, IRQ off, set small sample
    sys.io.write(0x4010, 0x40 | 0x0F); // loop=1, IRQ=0, fastest rate
    sys.io.write(0x4012, 0x01);
    sys.io.write(0x4013, 0x02);
    sys.io.write(0x4015, 0x10);

    const apu: any = sys.apu as any;

    // Run enough instructions to surpass one sample length a few times
    const startFetches = apu['dmcFetchCount'] as number;
    for (let i = 0; i < 20000; i++) sys.stepInstruction();
    const endFetches = apu['dmcFetchCount'] as number;

    // Expect some fetch activity
    expect(endFetches).toBeGreaterThan(startFetches);
    // Looping means no IRQ
    const st = sys.io.read(0x4015);
    expect((st & 0x80) !== 0).toBe(false);
  });

  it('non-looping sets IRQ once; $4015 read clears and does not reassert without new sample', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Non-looping, IRQ enabled, small sample, fast rate
    sys.io.write(0x4010, 0x80 | 0x0F);
    sys.io.write(0x4012, 0x01);
    sys.io.write(0x4013, 0x02);
    sys.io.write(0x4015, 0x10);

    // Run until IRQ should assert
    for (let i = 0; i < 20000; i++) sys.stepInstruction();
    const st1 = sys.io.read(0x4015);
    expect((st1 & 0x80) !== 0).toBe(true);

    // Reading clears; keep running more, should not reassert (bytesRemaining stays 0)
    for (let i = 0; i < 10000; i++) sys.stepInstruction();
    const st2 = sys.io.read(0x4015);
    expect((st2 & 0x80) !== 0).toBe(false);
  });
});

