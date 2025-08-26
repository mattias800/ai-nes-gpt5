import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  // Reset $8000
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU DMC IRQ read-clear behavior', () => {
  it('reading $4015 clears DMC IRQ (bit7) and dmcIrqPending()', () => {
    const sys = new NESSystem(rom());
    sys.reset();
    const apu: any = sys.apu as any;

    // Configure DMC: IRQ on, no loop, set small length so IRQ asserts when done
    sys.io.write(0x4010, 0x80 | 0x00); // IRQ enabled, rate idx 0
    sys.io.write(0x4012, 0x00);        // base address $C000
    sys.io.write(0x4013, 0x01);        // length = 17 bytes
    sys.io.write(0x4015, 0x10);        // enable DMC

    // Simulate consuming all bytes to trigger IRQ
    for (let i = 0; i < 17; i++) apu['clockDmcByte']();

    // Bit7 should be set
    const st1 = sys.io.read(0x4015);
    expect((st1 & 0x80) !== 0).toBe(true);
    // Reading clears DMC IRQ flag
    const st2 = sys.io.read(0x4015);
    expect((st2 & 0x80) !== 0).toBe(false);
    // Public pending method should reflect cleared state
    expect(sys.apu.dmcIrqPending()).toBe(false);
  });
});

