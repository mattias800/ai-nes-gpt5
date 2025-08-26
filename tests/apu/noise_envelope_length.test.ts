import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU noise envelope and length (basic)', () => {
  it('envelope start/decay and loop, length enable/disable', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Enable noise (bit3)
    sys.io.write(0x4015, 0x08);

    // Envelope: halt(loop)=0, constant=0, period=0 -> decrement every quarter-frame
    sys.io.write(0x400C, 0x00);
    // Start envelope + load length (index 0 => 10)
    sys.io.write(0x400F, 0x00);

    // First quarter frame: start -> volume=15
    sys.apu.tick(3729);
    let snap: any = sys.apu as any;
    expect(snap['noiseEnvVolume']).toBe(15);

    // Next quarter frame: period+1=1 -> decrement volume to 14
    sys.apu.tick(3729);
    snap = sys.apu as any;
    expect(snap['noiseEnvVolume']).toBe(14);

    // Half-frame at ~7457 cycles decrements length by 1 when not halted
    sys.apu.tick(3729); // step 2
    sys.apu.tick(3729); // step 3 (half-frame)
    const st1 = sys.io.read(0x4015);
    expect((st1 & 0x08) !== 0).toBe(true);

    // Loop envelope: set halt(loop)=1, keep constant=0, period=0
    sys.io.write(0x400C, 0x20);
    sys.io.write(0x400F, 0x00); // restart envelope
    // Step 17 quarter frames to cycle 15->0 (15 steps) then loop -> 15
    for (let i = 0; i < 17; i++) sys.apu.tick(3729);
    snap = sys.apu as any;
    expect(snap['noiseEnvVolume']).toBe(15);

    // Disable noise -> length cleared
    sys.io.write(0x4015, 0x00);
    const st2 = sys.io.read(0x4015);
    expect((st2 & 0x08) !== 0).toBe(false);
  });
});

