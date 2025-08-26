import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function romWithC000(fill: number): INesRom {
  const prg = new Uint8Array(0x8000);
  // Fill $C000-FFFF mirror region in PRG with a known value for deterministic DAC stepping
  for (let i = 0; i < 0x4000; i++) prg[i] = fill & 0xFF; // maps to CPU $C000 region via NROM-256 mask
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU DMC disable mid-play behavior', () => {
  it('clears DMC playback state but retains DAC level when disabling via $4015', () => {
    const sys = new NESSystem(romWithC000(0xFF));
    sys.reset();

    // Configure DMC: IRQ off, loop off, fastest rate; non-zero length
    sys.io.write(0x4010, 0x0F);
    sys.io.write(0x4012, 0x00);
    sys.io.write(0x4013, 0x02); // 33 bytes

    // Enable DMC and run briefly to change DAC from 0
    sys.io.write(0x4015, 0x10);
    for (let i = 0; i < 3000; i++) sys.stepInstruction();
    const dacBefore = (sys.apu as any)['dmcDac'] as number;
    expect(dacBefore).toBeGreaterThanOrEqual(0);

    // Now disable DMC via $4015 (bit4 cleared). Expect engine stops shifting/fetching but DAC value is not forcibly changed.
    sys.io.write(0x4015, 0x00);
    const apu: any = sys.apu as any;
    expect(apu['dmcBytesRemaining']).toBe(0);
    expect(apu['dmcSampleBufferFilled']).toBe(false);
    expect(apu['dmcBitsRemaining']).toBe(0);

    const dacAfterDisable = (sys.apu as any)['dmcDac'] as number;
    expect(dacAfterDisable).toBe(dacBefore);

    // Advance more instructions; DAC should remain at the same level because DMC is disabled
    for (let i = 0; i < 5000; i++) sys.stepInstruction();
    const dacAfterRun = (sys.apu as any)['dmcDac'] as number;
    expect(dacAfterRun).toBe(dacBefore);
  });
});

