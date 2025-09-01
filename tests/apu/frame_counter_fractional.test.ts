import { describe, it, expect } from 'vitest';
import { APU } from '@core/apu/apu';

describe('APU frame counter (fractional timing mode)', () => {
  it('quarter-frame envelope clock occurs after ~3729.5 CPU cycles', () => {
    const apu = new APU();
    apu.reset();
    (apu as any).setFrameTimingMode('fractional');

    // Enable pulse1 and configure envelope
    apu.write4015(0x01);
    (apu as any).writeRegister(0x4000, 0x00); // halt off, const off, period=0
    // Writing $4003 sets envelope start; volume remains 0 until next quarter-frame clock
    (apu as any).writeRegister(0x4003, 0x10);
    expect((apu as any)['pulse1EnvVolume']).toBe(0);

    // Before 3729.5: after 3729 cycles, not yet clocked
    apu.tick(3729);
    expect((apu as any)['pulse1EnvVolume']).toBe(0);

    // At 3730 cycles (>=3729.5), quarter-frame clock should have occurred -> volume=15
    apu.tick(1);
    expect((apu as any)['pulse1EnvVolume']).toBe(15);
  });

  it('half-frame length decrements after ~7456.5 and ~14916.5 in 4-step mode', () => {
    const apu = new APU();
    apu.reset();
    (apu as any).setFrameTimingMode('fractional');

    // 4-step mode (default). Enable pulse1 and load length
    apu.write4015(0x01);
    (apu as any).writeRegister(0x4000, 0x00); // ensure not halted
    ;(apu as any).writeRegister(0x4003, 0x10); // load length > 0 and start envelope

    const len0 = (apu as any)['pulse1Length'];

    // Before first half-frame (~7456.5): at 7456 cycles, not decremented
    apu.tick(7456);
    expect((apu as any)['pulse1Length']).toBe(len0);

    // Cross edge -> decrement by 1 at 7457
    apu.tick(1);
    const len1 = (apu as any)['pulse1Length'];
    expect(len1).toBe(len0 - 1);

    // Before second half-frame (~14916.5): from 7457 to 14916 is 7459 cycles
    apu.tick(14916 - 7457);
    expect((apu as any)['pulse1Length']).toBe(len1);

    // Cross edge -> decrement again
    apu.tick(1);
    expect((apu as any)['pulse1Length']).toBe(len1 - 1);
  });
  it('frame IRQ in 4-step fractional mode occurs after crossing the final edge (~14916.5)', () => {
    const apu = new APU();
    apu.reset();
    (apu as any).setFrameTimingMode('fractional');
    // 4-step, IRQ enabled (default)
    apu.write4017(0x00);
    // Tick to just before the final edge: 14916 cycles
    apu.tick(14916);
    const before = apu.read4015();
    expect((before & 0x40) !== 0).toBe(false);
    // Cross the fractional edge at 14916.5 -> at 14917 cycles we should have the IRQ flag
    apu.tick(1);
    const after = apu.read4015();
    expect((after & 0x40) !== 0).toBe(true);
  });
});

