import { describe, it, expect } from 'vitest';
import { APU } from '@core/apu/apu';

describe('APU frame counter', () => {
  it('immediate quarter+half clocks occur on write to $4017 with bit7=1 (5-step)', () => {
    const apu = new APU();
    apu.reset();
    // Enable pulse1 and load a length
    apu.write4015(0x01);
    // Set pulse1 envelope loop/halt off, constant off, period arbitrary; duty whatever
    (apu as any).writeRegister(0x4000, 0x00);
    // Load a non-zero length
    ;(apu as any).writeRegister(0x4003, 0x10); // index = 0x10>>3 = 2 -> length > 0
    const beforeLen = (apu as any)['pulse1Length'];
    // Also envelope start is set by $4003; immediate quarter clock should process it and set volume=15
    // Now write $4017 with bit7=1 (5-step) to trigger immediate clocks
    apu.write4017(0x80);
    const afterLen = (apu as any)['pulse1Length'];
    const vol = (apu as any)['pulse1EnvVolume'];
    expect(afterLen).toBe(beforeLen - 1);
    expect(vol).toBe(15);
  });

  it('4-step mode sets IRQ flag at sequence end when not inhibited', () => {
    const apu = new APU();
    apu.reset();
    apu.write4017(0x00); // 4-step, IRQ enabled
    // Advance slightly beyond 4th step edge (~14916 cycles)
    apu.tick(15000);
    const status = apu.read4015();
    expect((status & 0x40) !== 0).toBe(true);
  });

  it('5-step mode inhibits IRQ and wraps without flag', () => {
    const apu = new APU();
    apu.reset();
    apu.write4017(0x80); // 5-step, IRQ inhibited implicitly
    apu.tick(19000);
    const status = apu.read4015();
    expect((status & 0x40) !== 0).toBe(false);
  });
});
