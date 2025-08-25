import { describe, it, expect } from 'vitest';
import { APU } from '@core/apu/apu';

describe('APU frame counter', () => {
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
