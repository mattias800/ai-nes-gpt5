import { describe, it, expect } from 'vitest';
import { APU } from '@core/apu/apu';

describe('APU frame counter (fractional, 5-step)', () => {
  it('immediate quarter+half clocks on $4017 write with bit7=1 (5-step)', () => {
    const apu = new APU();
    apu.reset();
    (apu as any).setFrameTimingMode('fractional');

    // Enable pulse1 and set up envelope and length
    apu.write4015(0x01);
    (apu as any).writeRegister(0x4000, 0x00); // halt off, const off
    ;(apu as any).writeRegister(0x4003, 0x10); // load length and set envelope start
    const lenBefore = (apu as any)['pulse1Length'];

    // Write $4017 with bit7=1 -> 5-step mode + immediate quarter+half clocks
    apu.write4017(0x80);

    const lenAfter = (apu as any)['pulse1Length'];
    const vol = (apu as any)['pulse1EnvVolume'];
    expect(lenAfter).toBe(lenBefore - 1);
    expect(vol).toBe(15);
  });

  it('no frame IRQ at end of 5-step sequence in fractional mode, and half-frames at ~7456.5 and ~18641.5', () => {
    const apu = new APU();
    apu.reset();
    (apu as any).setFrameTimingMode('fractional');

    // Enter 5-step mode, IRQ inhibited implicitly
    apu.write4017(0x80);

    // Before first half-frame edge (~7456.5): at 7456 cycles, no half-frame yet
    apu.tick(7456);
    const s0 = apu.read4015();
    expect((s0 & 0x40) !== 0).toBe(false);

    // Cross first half-frame edge
    apu.tick(1);

    // Before sequence end (~18641.5): ensure no IRQ set
    apu.tick(18641 - 7457);
    const s1 = apu.read4015();
    expect((s1 & 0x40) !== 0).toBe(false);

    // Cross sequence end; still no IRQ in 5-step
    apu.tick(1);
    const s2 = apu.read4015();
    expect((s2 & 0x40) !== 0).toBe(false);
  });
});

