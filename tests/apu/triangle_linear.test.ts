import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU triangle linear counter (basic)', () => {
  it('reload flag behavior, control gating, and quarter-frame decrement', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Enable triangle (bit2)
    sys.io.write(0x4015, 0x04);

    // Set linear counter reload to 3, control=0 (no halt), write length to set reload flag
    sys.io.write(0x4008, 0x03);
    sys.io.write(0x400B, 0x00); // sets reload flag

    // Quarter frame: reload flag causes linear counter = reload value (3)
    sys.apu.tick(3729);
    let snap: any = sys.apu as any;
    expect(snap['triLinear']).toBe(3);

    // Since control=0, reload flag should clear after clock; subsequent quarter frames decrement
    sys.apu.tick(3729);
    snap = sys.apu as any;
    expect(snap['triLinear']).toBe(2);

    sys.apu.tick(3729);
    snap = sys.apu as any;
    expect(snap['triLinear']).toBe(1);

    // Now set control=1 (halt): length halting and reload flag retain
    sys.io.write(0x4008, 0x80 | 0x02); // control=1, reload=2
    sys.io.write(0x400B, 0x00); // set reload flag
    sys.apu.tick(3729);
    snap = sys.apu as any;
    expect(snap['triLinear']).toBe(2);

    // With control=1, reload flag stays set; subsequent quarter frame reloads to 2 again
    sys.apu.tick(3729);
    snap = sys.apu as any;
    expect(snap['triLinear']).toBe(2);

    // Disabling triangle clears length -> read4015 bit2 clears
    sys.io.write(0x4015, 0x00);
    const st = sys.io.read(0x4015);
    expect((st & 0x04) !== 0).toBe(false);
  });
});

