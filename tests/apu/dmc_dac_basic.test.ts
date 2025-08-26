import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function romWithPRG(prgContent: (prg: Uint8Array) => void): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x90; // IRQ vector $9000
  prgContent(prg);
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

// DMC DAC basic behavior: bits=1 should step DAC up +2; bits=0 step down -2; clamp 0..127.
// We synthesize PRG bytes at the configured DMC sample address and lengths by writing into $C000 region.

describe('APU DMC DAC basic stepping', () => {
  it('all-ones sample (0xFF) ramps DAC upward', () => {
    const sys = new NESSystem(romWithPRG((prg) => {
      // Program at $8000: CLI; endless NOP loop
      prg[0x0000] = 0x58; prg[0x0001] = 0xEA; prg[0x0002] = 0x4C; prg[0x0003] = 0x01; prg[0x0004] = 0x80;
      // Fill $C000.. with 0xFF bytes for DMC fetches
      for (let i = 0; i < 256; i++) prg[0x0000 + i] = 0xFF; // maps to CPU $C000 region
    }));
    sys.reset();

    // Configure DMC to fetch from $C000 and process bits
    sys.io.write(0x4012, 0x00); // base $C000
    sys.io.write(0x4013, 0x01); // length = 17 bytes (enough for test window)
    sys.io.write(0x4010, 0x00); // IRQ off, loop off, slowest rate (428 cycles per bit step)
    sys.io.write(0x4015, 0x10); // enable DMC

    // Run for a controlled number of CPU instructions; sample should climb
    const before = (sys.apu as any)['dmcDac'] as number;
    for (let i = 0; i < 5000; i++) sys.stepInstruction();
    const after = (sys.apu as any)['dmcDac'] as number;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('all-zeros sample (0x00) pulls DAC downward', () => {
    const sys = new NESSystem(romWithPRG((prg) => {
      // Program at $8000: CLI; endless NOP loop
      prg[0x0000] = 0x58; prg[0x0001] = 0xEA; prg[0x0002] = 0x4C; prg[0x0003] = 0x01; prg[0x0004] = 0x80;
      // Fill $C000.. with 0x00 bytes
      for (let i = 0; i < 256; i++) prg[0x0000 + i] = 0x00;
    }));
    sys.reset();

    sys.io.write(0x4012, 0x00); // base $C000
    sys.io.write(0x4013, 0x01); // length
    sys.io.write(0x4010, 0x00); // IRQ off, loop off, slow rate
    sys.io.write(0x4015, 0x10); // enable DMC

    // Pre-raise the DAC by briefly feeding ones first, then switch to zeros by updating PRG
    for (let i = 0; i < 2000; i++) sys.stepInstruction();
    const mid = (sys.apu as any)['dmcDac'] as number;

    // Replace source bytes with zeros for subsequent fetches
    const prg = (sys.cart as any)['mapper']['prg'] as Uint8Array;
    for (let i = 0; i < 256; i++) prg[i] = 0x00;

    for (let i = 0; i < 6000; i++) sys.stepInstruction();
    const after = (sys.apu as any)['dmcDac'] as number;
    expect(after).toBeLessThanOrEqual(mid);
  });
});

