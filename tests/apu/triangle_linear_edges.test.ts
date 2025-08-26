import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

enum FC {
  Q = 3729,
  H = 7457,
}

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU triangle linear counter control/reload edge cases', () => {
  it('control=1 retains reload each quarter; toggling to 0 allows decrement', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Enable triangle
    sys.io.write(0x4015, 0x04);

    // Set control=1 (halt), reload=4
    sys.io.write(0x4008, 0x80 | 0x04);
    // Write $400B to set reload flag
    sys.io.write(0x400B, 0x00);

    // At next quarter, linear should reload to 4
    sys.apu.tick(FC.Q);
    expect((sys.apu as any)['triLinear']).toBe(4);

    // Next quarter, with control=1, linear should reload (remain 4)
    sys.apu.tick(FC.Q);
    expect((sys.apu as any)['triLinear']).toBe(4);

    // Toggle control=0 (no halt) and keep reload=4
    sys.io.write(0x4008, 0x00 | 0x04);
    // Next quarter: reload occurs once, then subsequent quarters decrement
    sys.apu.tick(FC.Q);
    expect((sys.apu as any)['triLinear']).toBe(4);
    sys.apu.tick(FC.Q);
    expect((sys.apu as any)['triLinear']).toBe(3);
  });
});

