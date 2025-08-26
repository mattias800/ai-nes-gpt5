import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function romWithC000(fillByte: number): INesRom {
  const prg = new Uint8Array(0x8000);
  // Make $C000 region (offset 0x4000) be a known repeating value
  for (let i = 0; i < 0x4000; i++) prg[0x4000 + i] = fillByte & 0xFF;
  // Vectors
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80; // reset -> $8000
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x90; // IRQ -> $9000
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

// DMC timing invariants around prefetch and byte-to-byte continuity.
// We drive APU directly with tick(cpuCycles) using the known period for rate index 15 (54 CPU cycles per DMC tick).

describe('APU DMC prefetch and continuity timing', () => {
  it('prefetch occurs when finishing a byte; next load happens on the very next DMC tick', () => {
    const sys = new NESSystem(romWithC000(0xAA));
    sys.reset();

    // Configure DMC: fastest rate, loop off, IRQ off to avoid side effects; plenty of length
    sys.io.write(0x4010, 0x0F); // rate idx=15
    sys.io.write(0x4012, 0x00); // addr base $C000
    sys.io.write(0x4013, 0x02); // length base = 33 bytes
    sys.io.write(0x4015, 0x10); // enable DMC

    const apu: any = sys.apu as any;
    const period = 54; // DMC rate idx 15
    const dmcTick = () => sys.apu.tick(period + 1); // account for timer reload edge

    // First DMC tick will load the first byte into shifter (bitsRemaining=8), no bit processed
    dmcTick();
    expect(apu['dmcBitsRemaining']).toBe(8);

    // Process 7 bits (leave one bit remaining)
    for (let i = 0; i < 7; i++) dmcTick();
    expect(apu['dmcBitsRemaining']).toBe(1);

    // Next tick processes last bit; prefetch of next byte should occur within this tick
    dmcTick();
    expect(apu['dmcBitsRemaining']).toBe(0);
    expect(apu['dmcSampleBufferFilled']).toBe(true);

    // Next DMC tick should load that prefetched byte (bitsRemaining becomes 8)
    dmcTick();
    expect(apu['dmcBitsRemaining']).toBe(8);
    expect(apu['dmcSampleBufferFilled']).toBe(false);

    // No IRQ while bytes remain
    const st = sys.io.read(0x4015);
    expect((st & 0x80) !== 0).toBe(false);
  });

  it('non-looping: IRQ asserts only after fetch depletes length; reading $4015 clears it', () => {
    const sys = new NESSystem(romWithC000(0xFF));
    sys.reset();
    // Fastest rate, IRQ enabled, no loop; small sample (33 bytes)
    sys.io.write(0x4010, 0x80 | 0x0F);
    sys.io.write(0x4012, 0x00);
    sys.io.write(0x4013, 0x02);
    sys.io.write(0x4015, 0x10);

    // Drive enough cycles to consume the sample; each byte costs ~9 DMC ticks (1 load + 8 bits)
    const period = 54;
    const bytes = 33;
    const ticks = bytes * 9 + 10; // margin
    for (let i = 0; i < ticks; i++) sys.apu.tick(period + 1);

    const st1 = sys.io.read(0x4015);
    expect((st1 & 0x80) !== 0).toBe(true);

    // Reading clears; further ticks without new sample should not reassert
    for (let i = 0; i < 100; i++) sys.apu.tick(period);
    const st2 = sys.io.read(0x4015);
    expect((st2 & 0x80) !== 0).toBe(false);
  });
});

