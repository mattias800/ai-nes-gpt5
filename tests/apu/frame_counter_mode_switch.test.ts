import { describe, it, expect } from 'vitest';
import { APU } from '@core/apu/apu';

describe('APU frame counter mode switch IRQ gating', () => {
  it('no IRQ in inhibited mode, IRQ after switching to 4-step with IRQ enabled', () => {
    const apu = new APU();
    apu.reset();

    // Inhibit IRQs (4-step with bit6=1)
    apu.write4017(0x40);
    apu.tick(20000);
    expect((apu.read4015() & 0x40) !== 0).toBe(false);

    // Switch to 4-step with IRQ enabled
    apu.write4017(0x00);
    apu.tick(15000);
    expect((apu.read4015() & 0x40) !== 0).toBe(true);
  });
});

