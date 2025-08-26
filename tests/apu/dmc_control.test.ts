import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU DMC control (skeleton)', () => {
  it('address/length counters and IRQ flag with looping/non-looping', () => {
    const sys = new NESSystem(rom());
    sys.reset();
    const apu: any = sys.apu as any;

    // Configure DMC: IRQ enabled, no loop, small sample at $C000 + 64 * 1, length (value*16+1)
    sys.io.write(0x4010, 0x80 | 0x00); // IRQ on, loop=0, rate idx=0
    sys.io.write(0x4012, 0x01); // addr base = $C000 + 64
    sys.io.write(0x4013, 0x02); // length base = 33 bytes

    // Enable DMC (bit4)
    sys.io.write(0x4015, 0x10);

    // Simulate fetching all bytes
    for (let i = 0; i < 33; i++) apu['clockDmcByte']();

    // Non-looping with IRQ enabled should set DMC IRQ flag (bit7 of $4015)
    let st = sys.io.read(0x4015);
    expect((st & 0x80) !== 0).toBe(true);

    // Reading $4015 clears DMC IRQ; enabling loop should prevent IRQ and wrap
    sys.io.write(0x4010, 0x40); // IRQ off, loop on
    sys.io.write(0x4015, 0x10); // re-enable; should reload address/length

    // Simulate more than one length worth of bytes to verify wrapping without IRQ
    for (let i = 0; i < 40; i++) apu['clockDmcByte']();

    st = sys.io.read(0x4015);
    expect((st & 0x80) !== 0).toBe(false);
  });
});

